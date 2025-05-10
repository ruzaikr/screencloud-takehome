import { CheckReservationResponse } from "../schemas/reservation";
import { CreateOrderRequest } from "../schemas/order";
import * as productRepository from "../repositories/productRepository";
import {db} from "../db/client";
import * as warehouseRepository from "../repositories/warehouseRepository";
import * as reservationRepository from "../repositories/reservationRepository";
import {
    calculateOverallProductTotals,
    calculateTotalShippingCost, isShippingCostValid,
    performInventoryAllocation,
    InventoryAllocationError
} from "./shared/helpers";
import * as inventoryRepository from "../repositories/inventoryRepository";
import { InsufficientInventoryError } from "../errors/customErrors";

// Interface for allocated order lines, internal to this service/shared helpers
interface AllocatedOrderLine {
    productId: string;
    warehouseId: string;
    allocatedQuantity: number;
    unitPriceCents: number;
    discountPercentage: number;
    productWeightGrams: number;
    shippingCostCentsPerKg: number;
}

/**
 * Checks the feasibility of a reservation.
 * - If inventory is insufficient, throws InsufficientInventoryError (leading to HTTP 409).
 * - If inventory is sufficient but shipping cost exceeds limits, returns CheckReservationResponse with isValid: false.
 * - If all checks pass, returns CheckReservationResponse with isValid: true.
 * - Throws ProductNotFoundError if any product ID is invalid.
 *
 * @param request The reservation request details.
 * @returns A promise resolving to CheckReservationResponse if inventory is sufficient.
 * @throws InsufficientInventoryError if inventory cannot meet the request.
 * @throws ProductNotFoundError if a product ID is invalid.
 * @throws Other ApiErrors or standard Errors for unexpected issues.
 */
export async function checkFeasibility(
    request: CreateOrderRequest,
): Promise<CheckReservationResponse> {

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

        let allocatedOrderLines: AllocatedOrderLine[];

        try {
            const allocationResult = performInventoryAllocation(
                productDetailsMap,
                sortedWarehouses,
                currentInventoryByWarehouse,
                reservedInventoryByWarehouse
            );
            allocatedOrderLines = allocationResult.allocatedOrderLines;
            // inventoryUpdates from allocationResult is not used for feasibility check
        } catch (error) {
            if (error instanceof InventoryAllocationError) {
                // Translate to the user-facing error with 409 status
                throw new InsufficientInventoryError(error.message);
            }
            throw error; // Re-throw other unexpected errors from allocation
        }

        const totalShippingCostCents = calculateTotalShippingCost(allocatedOrderLines);

        const shippingIsValid = isShippingCostValid(
            totalShippingCostCents,
            overallTotalPriceCents,
            overallTotalDiscountCents
        );

        if (!shippingIsValid) {
            return {
                isValid: false,
                totalPriceCents: overallTotalPriceCents,
                discountCents: overallTotalDiscountCents,
                shippingCostCents: totalShippingCostCents,
                message: `Reservation not feasible: Shipping cost (${totalShippingCostCents} cents) exceeds the allowed percentage of discounted order value (${overallTotalPriceCents - overallTotalDiscountCents} cents).`,
            };
        }

        return {
            isValid: true,
            totalPriceCents: overallTotalPriceCents,
            discountCents: overallTotalDiscountCents,
            shippingCostCents: totalShippingCostCents,
            message: "Reservation is feasible.",
        };
    });
}
