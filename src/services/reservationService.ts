import { CheckReservationResponse } from "../schemas/reservation";
import { CreateOrderRequest } from "../schemas/order";
import * as productRepository from "../repositories/productRepository";
import {db} from "../db/client";
import * as warehouseRepository from "../repositories/warehouseRepository";
import * as reservationRepository from "../repositories/reservationRepository";
import {
    calculateOverallProductTotals,
    calculateTotalShippingCost, isShippingCostValid,
    performInventoryAllocation
} from "./shared/helpers";
import * as inventoryRepository from "../repositories/inventoryRepository";

export async function mainReservationServiceFunction( // @todo: rename function
    request: CreateOrderRequest,
): Promise<CheckReservationResponse> {

    const shippingLat = parseFloat(request.shippingAddress.latitude);
    const shippingLng = parseFloat(request.shippingAddress.longitude);

    const productIds = request.requestedProducts.map(p => p.productId);

    const [
        productDetailsMap,
        sortedWarehouses,
        reservedInventoryByWarehouse
    ] = await Promise.all([
        productRepository.calculateProductCostsWithDiscounts(db, request.requestedProducts),
        warehouseRepository.getWarehousesSortedByShippingCost(db, shippingLat, shippingLng),
        reservationRepository.getReservedInventoryByWarehouseForProducts(db, productIds)
    ]);

    const { overallTotalPriceCents, overallTotalDiscountCents } = calculateOverallProductTotals(productDetailsMap);

    return db.transaction(async (tx) => {
        // Fetch Current Inventory (WITHIN TRANSACTION, WITH LOCKING)
        const currentInventoryByWarehouse = await inventoryRepository.getInventoryForProducts(productIds, tx);

        // `inventoryUpdates` will be used to create reservation lines
        const { allocatedOrderLines, inventoryUpdates } = performInventoryAllocation(
            productDetailsMap,
            sortedWarehouses,
            currentInventoryByWarehouse,
            reservedInventoryByWarehouse
        );

        const totalShippingCostCents = calculateTotalShippingCost(allocatedOrderLines);

        return {
            isValid: isShippingCostValid(totalShippingCostCents, overallTotalPriceCents, overallTotalDiscountCents),
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
            message: "Shipping cost exceeds 15% of discounted order value.",
        };
    })



}