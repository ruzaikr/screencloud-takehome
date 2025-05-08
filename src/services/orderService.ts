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
    prepareOrderCreationData
} from "./shared/helpers";

export class ShippingCostExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ShippingCostExceededError";
    }
}

// --- Main Service Function ---

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
        // Fetch Current Inventory (with locking)
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(tx, productIds);

        // Fetch Reserved Inventory (no locking here because updates to reservations require acquiring a lock on inventories)
        const reservedInventoryByWarehouse = await reservationRepository.getReservedInventoryByWarehouseForProducts(tx, productIds)

        const { allocatedOrderLines, inventoryUpdates } = performInventoryAllocation(
            productDetailsMap,
            sortedWarehouses,
            currentInventoryByWarehouse,
            reservedInventoryByWarehouse
        );

        const totalShippingCostCents = calculateTotalShippingCost(allocatedOrderLines);

        if (!isShippingCostValid(totalShippingCostCents, overallTotalPriceCents, overallTotalDiscountCents)) {
            throw new ShippingCostExceededError(
                `Shipping cost (${totalShippingCostCents} cents) exceeds 15% of discounted order value.`
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