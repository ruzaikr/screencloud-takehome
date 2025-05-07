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
    discountPercentage: number; // e.g. 15.0 for 15%
    productWeightGrams: number;
}


export async function createWalkInOrder(
    request: CreateOrderRequest
): Promise<CreateOrderResponse> {
    const orderId = uuidv4(); // Generate Order ID upfront

    // 1. Parse shipping address coordinates (outside transaction)
    const shippingLat = parseFloat(request.shippingAddress.latitude);
    const shippingLng = parseFloat(request.shippingAddress.longitude);

    // 2. Prepare inputs for repository calls (outside transaction)
    const productQuantityInputs: productRepository.ProductQuantityInput[] = request.requestedProducts.map(p => ({
        productId: p.id,
        quantity: p.quantity,
    }));
    const productIds = request.requestedProducts.map(p => p.id);

    // 3. Perform read-only operations in parallel (outside transaction, using main db client)
    const [
        productCostDetailsList,
        sortedWarehouses,
        reservedInventoryByWarehouse
    ] = await Promise.all([
        productRepository.calculateProductCostsWithDiscounts(db, productQuantityInputs),
        warehouseRepository.getWarehousesSortedByShippingCost(db, shippingLat, shippingLng),
        reservationRepository.getReservedInventoryByWarehouseForProducts(db, productIds)
    ]);

    // --- Process data fetched outside transaction ---

    // Product details processing
    const productDetailsMap = new Map<string, productRepository.ProductCostDetails>();
    productCostDetailsList.forEach((details, index) => {
        // calculateProductCostsWithDiscounts returns results in the order of input items
        productDetailsMap.set(request.requestedProducts[index].id, details);
    });

    let overallTotalPriceCents = 0;
    let overallTotalDiscountCents = 0;
    for (const details of productCostDetailsList) {
        overallTotalPriceCents += details.totalProductCostCents;
        overallTotalDiscountCents += details.totalDiscountCents;
    }

    // Warehouse processing
    if (sortedWarehouses.length === 0 && request.requestedProducts.length > 0) {
        throw new Error("No warehouses available to fulfill the order.");
    }
    const warehouseShippingCostMap = new Map<string, number>(
        sortedWarehouses.map(wh => [wh.warehouseId, wh.shippingCostCentsPerKg])
    );

    return db.transaction(async (tx) => {
        // 4. Fetch Current Inventory (WITHIN TRANSACTION, WITH LOCKING)
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(productIds, tx);

        // 5. Allocate Products to Warehouses
        // Uses:
        // - `productDetailsMap` (from outside tx product costs)
        // - `sortedWarehouses` (from outside tx warehouse sort)
        // - `currentInventoryByWarehouse` (from INSIDE tx, locked inventory)
        // - `reservedInventoryByWarehouseData` (from OUTSIDE tx, snapshot of reservations)
        const allocatedOrderLines: AllocatedOrderLine[] = [];
        const inventoryUpdates: inventoryRepository.InventoryUpdateItem[] = [];

        for (const reqProduct of request.requestedProducts) {
            let remainingQtyToAllocate = reqProduct.quantity;
            const productDetail = productDetailsMap.get(reqProduct.id);

            if (!productDetail) {
                // This should ideally be caught by calculateProductCostsWithDiscounts if a product ID is invalid.
                // This is an assertion for internal consistency.
                throw new Error(`Internal Error: Details for product ID ${reqProduct.id} not found after initial fetch.`);
            }

            for (const warehouse of sortedWarehouses) {
                if (remainingQtyToAllocate <= 0) break;

                const warehouseId = warehouse.warehouseId;
                const stockInWarehouse = currentInventoryByWarehouse[warehouseId]?.[reqProduct.id] ?? 0;
                const reservedInWarehouse = reservedInventoryByWarehouse[warehouseId]?.[reqProduct.id] ?? 0;
                const availableForWalkIn = Math.max(0, stockInWarehouse - reservedInWarehouse);

                if (availableForWalkIn > 0) {
                    const qtyToAllocateFromWarehouse = Math.min(remainingQtyToAllocate, availableForWalkIn);

                    allocatedOrderLines.push({
                        productId: reqProduct.id,
                        warehouseId: warehouseId,
                        allocatedQuantity: qtyToAllocateFromWarehouse,
                        unitPriceCents: productDetail.unitPriceCents,
                        discountPercentage: productDetail.discountPercentage,
                        productWeightGrams: productDetail.weightGrams,
                    });

                    inventoryUpdates.push({
                        productId: reqProduct.id,
                        warehouseId: warehouseId,
                        quantityToDecrement: qtyToAllocateFromWarehouse,
                    });
                    remainingQtyToAllocate -= qtyToAllocateFromWarehouse;
                }
            }

            if (remainingQtyToAllocate > 0) {
                const allocatedForThisProduct = reqProduct.quantity - remainingQtyToAllocate;
                throw new InsufficientStockError(`Insufficient stock for product ID ${reqProduct.id}. Requested: ${reqProduct.quantity}, Allocated from available stock: ${allocatedForThisProduct}.`);
            }
        }

        // 6. Calculate Shipping Cost
        // Uses `allocatedOrderLines` (derived from locked stock) and `warehouseShippingCostMap` (from outside tx)
        let totalShippingCostCents = 0;
        for (const line of allocatedOrderLines) {
            const totalWeightKgForLine = (line.allocatedQuantity * line.productWeightGrams) / 1000;
            const shippingCostPerKg = warehouseShippingCostMap.get(line.warehouseId);
            if (shippingCostPerKg === undefined) {
                // This would indicate an internal logic error.
                throw new Error(`Internal Error: Shipping cost per kg not found for warehouse ${line.warehouseId}.`);
            }
            const legShippingCost = Math.ceil(totalWeightKgForLine * shippingCostPerKg);
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
        // `inventoryUpdates` derived from locked stock, `orderId` generated upfront.
        await inventoryRepository.updateInventoryAndLogChanges(tx, inventoryUpdates, orderId);

        // 9. Create Order and Order Lines
        const orderHeaderParams: orderRepository.CreateOrderParams = {
            orderId,
            shippingAddrLatitude: shippingLat,           // from outside tx
            shippingAddrLongitude: shippingLng,          // from outside tx
            totalPriceCents: overallTotalPriceCents,     // from outside tx
            discountCents: overallTotalDiscountCents,    // from outside tx
            shippingCostCents: totalShippingCostCents,   // calculated within tx scope, but based on outside data + allocation
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