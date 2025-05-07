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

    return db.transaction(async (tx) => {
        // 1. Parse shipping address coordinates
        const shippingLat = parseFloat(request.shippingAddress.latitude);
        const shippingLng = parseFloat(request.shippingAddress.longitude);

        // 2. Fetch Product Details & Calculate initial costs
        const productQuantityInputs: productRepository.ProductQuantityInput[] = request.requestedProducts.map(p => ({
            productId: p.id,
            quantity: p.quantity,
        }));

        const productCostDetailsList = await productRepository.calculateProductCostsWithDiscounts(tx, productQuantityInputs);

        // Create a map for easy lookup
        const productDetailsMap = new Map<string, productRepository.ProductCostDetails>();
        productCostDetailsList.forEach((details, index) => {
            productDetailsMap.set(request.requestedProducts[index].id, details);
        });

        // 3. Calculate Total Price and Discount for the order
        let overallTotalPriceCents = 0;
        let overallTotalDiscountCents = 0;
        for (const details of productCostDetailsList) {
            overallTotalPriceCents += details.totalProductCostCents;
            overallTotalDiscountCents += details.totalDiscountCents;
        }

        // 4. Fetch Warehouses Sorted by Shipping Cost
        const sortedWarehouses = await warehouseRepository.getWarehousesSortedByShippingCost(tx, shippingLat, shippingLng);
        if (sortedWarehouses.length === 0 && request.requestedProducts.length > 0) {
            throw new Error("No warehouses available to fulfill the order.");
        }
        const warehouseShippingCostMap = new Map<string, number>(
            sortedWarehouses.map(wh => [wh.warehouseId, wh.shippingCostCentsPerKg])
        );


        // 5. Fetch Current Inventory & Reserved Inventory
        const productIds = request.requestedProducts.map(p => p.id);
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(productIds, tx);
        const reservedInventoryByWarehouse = await reservationRepository.getReservedInventoryByWarehouseForProducts(tx, productIds);

        // 6. Allocate Products to Warehouses
        const allocatedOrderLines: AllocatedOrderLine[] = [];
        const inventoryUpdates: inventoryRepository.InventoryUpdateItem[] = [];

        for (const reqProduct of request.requestedProducts) {
            let remainingQtyToAllocate = reqProduct.quantity;
            const productDetail = productDetailsMap.get(reqProduct.id);

            if (!productDetail) {
                // Should not happen if calculateProductCostsWithDiscounts worked and threw error for non-existent product
                throw new Error(`Details for product ID ${reqProduct.id} not found.`);
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
                throw new InsufficientStockError(`Insufficient stock for product ID ${reqProduct.id}. Required: ${reqProduct.quantity}, Available after reservations: ${reqProduct.quantity - remainingQtyToAllocate}`);
            }
        }

        // 7. Calculate Shipping Cost
        let totalShippingCostCents = 0;
        for (const line of allocatedOrderLines) {
            const totalWeightKgForLine = (line.allocatedQuantity * line.productWeightGrams) / 1000;
            const shippingCostPerKg = warehouseShippingCostMap.get(line.warehouseId);
            if (shippingCostPerKg === undefined) {
                throw new Error(`Shipping cost per kg not found for warehouse ${line.warehouseId}. This should not happen.`);
            }
            const legShippingCost = Math.ceil(totalWeightKgForLine * shippingCostPerKg);
            totalShippingCostCents += legShippingCost;
        }

        // 8. Validate Shipping Cost (max 15% of discounted product total)
        const discountedProductTotal = overallTotalPriceCents - overallTotalDiscountCents;
        const maxAllowedShippingCost = Math.floor(0.15 * discountedProductTotal); // Use Math.floor or ensure comparison handles floats correctly

        if (totalShippingCostCents > maxAllowedShippingCost) {
            throw new ShippingCostExceededError(
                `Shipping cost (${totalShippingCostCents} cents) exceeds 15% of discounted order value (${discountedProductTotal} cents). Maximum allowed: ${maxAllowedShippingCost} cents.`
            );
        }

        // 9. Update Inventory (pass generated orderId)
        await inventoryRepository.updateInventoryAndLogChanges(tx, inventoryUpdates, orderId);

        // 10. Create Order and Order Lines (pass generated orderId)
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

        // 11. Return Response
        return {
            orderId: orderId,
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
        };
    });
}