import { db } from '../db/client';
import { CreateOrderRequest, CreateOrderResponse } from '../schemas/order';
import * as productRepository from '../repositories/productRepository';
import * as warehouseRepository from '../repositories/warehouseRepository';
import * as inventoryRepository from '../repositories/inventoryRepository';
import * as reservationRepository from '../repositories/reservationRepository';
import * as orderRepository from '../repositories/orderRepository';
import { v4 as uuidv4 } from 'uuid';
import {
    calculateOverallProductTotals,
    performInventoryAllocation,
    calculateTotalShippingCost,
    isShippingCostValid,
    prepareOrderCreationData,
    InventoryAllocationError
} from "./shared/helpers";
import { InsufficientInventoryError, ShippingCostExceededError } from '../errors/customErrors';

export async function createWalkInOrder(
    request: CreateOrderRequest
): Promise<CreateOrderResponse> {

    const shippingLat = parseFloat(request.shippingAddress.latitude);
    const shippingLng = parseFloat(request.shippingAddress.longitude);

    const productIds = request.requestedProducts.map(p => p.productId);

    const [
        productDetailsMap,
        sortedWarehouses,
    ] = await Promise.all([
        productRepository.calculateProductCostsWithDiscounts(db, request.requestedProducts),
        warehouseRepository.getWarehousesSortedByShippingCost(db, shippingLat, shippingLng),
    ]);

    const { overallTotalPriceCents, overallTotalDiscountCents } = calculateOverallProductTotals(productDetailsMap);

    return db.transaction(async (tx) => {
        // Fetch Current Inventory (with locking to ensure consistent read for allocation check)
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(tx, productIds);

        // Fetch Reserved Inventory (reads committed data, consistent within this transaction)
        const reservedInventoryByWarehouse = await reservationRepository.getReservedInventoryByWarehouseForProducts(tx, productIds);

        let allocatedOrderLines;
        let inventoryUpdates;

        try {
            const allocationResult = performInventoryAllocation(
                productDetailsMap,
                sortedWarehouses,
                currentInventoryByWarehouse,
                reservedInventoryByWarehouse
            );
            allocatedOrderLines = allocationResult.allocatedOrderLines;
            inventoryUpdates = allocationResult.inventoryUpdates;
        } catch (error) {
            if (error instanceof InventoryAllocationError) {
                // Translate to the user-facing error with 409 status
                throw new InsufficientInventoryError(error.message);
            }
            throw error; // Re-throw other unexpected errors from allocation
        }


        const totalShippingCostCents = calculateTotalShippingCost(allocatedOrderLines);

        if (!isShippingCostValid(totalShippingCostCents, overallTotalPriceCents, overallTotalDiscountCents)) {
            throw new ShippingCostExceededError(
                `Shipping cost (${totalShippingCostCents} cents) exceeds the allowed percentage of discounted order value (${overallTotalPriceCents - overallTotalDiscountCents} cents).`
            );
        }

        const orderId = uuidv4();

        await inventoryRepository.updateInventoryAndLogChanges(tx, inventoryUpdates, orderId);

        const { orderHeaderParams, orderLineItemsData } = prepareOrderCreationData(
            orderId,
            shippingLat,
            shippingLng,
            overallTotalPriceCents,
            overallTotalDiscountCents,
            totalShippingCostCents,
            allocatedOrderLines
        );

        await orderRepository.createOrderAndLines(tx, orderHeaderParams, orderLineItemsData);

        return {
            orderId: orderId,
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
        };
    });
}
