import { db } from '../db/client';
import { CreateOrderRequest, CreateOrderResponse } from '../schemas/order';
import * as productRepository from '../repositories/productRepository';
import * as warehouseRepository from '../repositories/warehouseRepository';
import * as inventoryRepository from '../repositories/inventoryRepository';
import * as reservationRepository from '../repositories/reservationRepository';
import * as orderRepository from '../repositories/orderRepository';
import { v4 as uuidv4 } from 'uuid';

// Custom error classes for specific business rule failures
export class InsufficientStockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsufficientStockError";
    }
}

export class ShippingCostExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ShippingCostExceededError";
    }
}

interface AllocatedOrderLine {
    productId: string;
    warehouseId: string;
    allocatedQuantity: number;
    unitPriceCents: number;
    discountPercentage: number;
    productWeightGrams: number;
    shippingCostCentsPerKg: number;
}


export async function createWalkInOrder(
    request: CreateOrderRequest
): Promise<CreateOrderResponse> {
    const orderId = uuidv4(); // Generate Order ID upfront

    // 1. Parse shipping address coordinates (outside transaction)
    const shippingLat = parseFloat(request.shippingAddress.latitude);
    const shippingLng = parseFloat(request.shippingAddress.longitude);

    // 2. Extract productIds from request
    const productIds = request.requestedProducts.map(p => p.productId);

    // 3. Perform read-only operations in parallel (outside transaction, using main db client)
    const [
        productDetailsMap,
        sortedWarehouses,
        reservedInventoryByWarehouse
    ] = await Promise.all([
        productRepository.calculateProductCostsWithDiscounts(db, request.requestedProducts),
        warehouseRepository.getWarehousesSortedByShippingCost(db, shippingLat, shippingLng),
        reservationRepository.getReservedInventoryByWarehouseForProducts(db, productIds)
    ]);

    // --- Process data fetched outside transaction ---

    let overallTotalPriceCents = 0;
    let overallTotalDiscountCents = 0;
    for (const details of productDetailsMap.values()) {
        overallTotalPriceCents += details.totalProductCostCents;
        overallTotalDiscountCents += details.totalDiscountCents;
    }

    // Warehouse processing
    if (sortedWarehouses.length === 0 && request.requestedProducts.length > 0) {
        // This check might be more nuanced: if productDetailsMap is empty and request.requestedProducts was not,
        // it means all product IDs were invalid, which calculateProductCostsWithDiscounts should have errored on.
        // If request.requestedProducts was empty, productDetailsMap would also be empty.
        // This mostly ensures warehouses exist if there are valid products to ship.
        throw new Error("No warehouses available to fulfill the order.");
    }

    return db.transaction(async (tx) => {
        // 4. Fetch Current Inventory (WITHIN TRANSACTION, WITH LOCKING)
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(productIds, tx);

        // 5. Allocate Products to Warehouses
        const allocatedOrderLines: AllocatedOrderLine[] = [];
        const inventoryUpdates: inventoryRepository.InventoryUpdateItem[] = [];

        for (const [productId, productDetail] of productDetailsMap.entries()) {
            let remainingQtyToAllocate = productDetail.requestedQuantity;

            for (const warehouse of sortedWarehouses) {
                if (remainingQtyToAllocate <= 0) break;

                const warehouseId = warehouse.warehouseId;
                const stockInWarehouse = currentInventoryByWarehouse[warehouseId]?.[productId] ?? 0;
                const reservedInWarehouse = reservedInventoryByWarehouse[warehouseId]?.[productId] ?? 0;
                const availableForWalkIn = Math.max(0, stockInWarehouse - reservedInWarehouse);

                if (availableForWalkIn > 0) {
                    const qtyToAllocateFromWarehouse = Math.min(remainingQtyToAllocate, availableForWalkIn);

                    allocatedOrderLines.push({
                        productId: productId,
                        warehouseId: warehouseId,
                        allocatedQuantity: qtyToAllocateFromWarehouse,
                        unitPriceCents: productDetail.unitPriceCents,
                        discountPercentage: productDetail.discountPercentage,
                        productWeightGrams: productDetail.weightGrams,
                        shippingCostCentsPerKg: warehouse.shippingCostCentsPerKg,
                    });

                    inventoryUpdates.push({
                        productId: productId,
                        warehouseId: warehouseId,
                        quantityToDecrement: qtyToAllocateFromWarehouse,
                    });
                    remainingQtyToAllocate -= qtyToAllocateFromWarehouse;
                }
            }

            if (remainingQtyToAllocate > 0) {
                const allocatedForThisProduct = productDetail.requestedQuantity - remainingQtyToAllocate;
                throw new InsufficientStockError(`Insufficient stock for product ID ${productId}. Requested: ${productDetail.requestedQuantity}, Allocated from available stock: ${allocatedForThisProduct}.`);
            }
        }

        // 6. Calculate Shipping Cost
        let totalShippingCostCents = 0;
        for (const line of allocatedOrderLines) {
            const totalWeightKgForLine = (line.allocatedQuantity * line.productWeightGrams) / 1000;
            const legShippingCost = Math.ceil(totalWeightKgForLine * line.shippingCostCentsPerKg);
            totalShippingCostCents += legShippingCost;
        }

        // 7. Validate Shipping Cost
        const discountedProductTotal = overallTotalPriceCents - overallTotalDiscountCents;
        const maxAllowedShippingCost = Math.floor(0.15 * discountedProductTotal);

        if (totalShippingCostCents > maxAllowedShippingCost) {
            throw new ShippingCostExceededError(
                `Shipping cost (${totalShippingCostCents} cents) exceeds 15% of discounted order value (${discountedProductTotal} cents). Maximum allowed: ${maxAllowedShippingCost} cents.`
            );
        }

        // 8. Update Inventory
        await inventoryRepository.updateInventoryAndLogChanges(tx, inventoryUpdates, orderId);

        // 9. Create Order and Order Lines
        const orderHeaderParams: orderRepository.CreateOrderParams = {
            orderId,
            shippingAddrLatitude: shippingLat,
            shippingAddrLongitude: shippingLng,
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
        };
        const orderLineItemsData: orderRepository.OrderLineData[] = allocatedOrderLines.map(al => ({
            productId: al.productId,
            warehouseId: al.warehouseId,
            quantity: al.allocatedQuantity,
            unitPriceCents: al.unitPriceCents,
            discountPercentage: al.discountPercentage,
        }));

        await orderRepository.createOrderAndLines(tx, orderHeaderParams, orderLineItemsData);

        // 10. Return Response
        return {
            orderId: orderId,
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
        };
    });
}
