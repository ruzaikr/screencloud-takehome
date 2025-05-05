import { db } from '../db/client';
import { reservations, reservationLines } from '../db/schema';
import { and, eq, gt, inArray } from 'drizzle-orm';

/**
 * Result type for product reservation quantities by warehouse
 * The outer key is the warehouseId
 * The inner key is the productId
 * The value is the total reserved quantity
 */
export interface ReservationsByWarehouse {
    [warehouseId: string]: {
        [productId: string]: number;
    };
}

/**
 * Gets the total reserved quantities for specified products by warehouse
 * Only considers active reservations that haven't expired
 *
 * @param productIds Array of product IDs to get reservation quantities for
 * @returns Object mapping warehouseIds to productIds to reserved quantities
 */
export async function getReservedQuantitiesByWarehouse(
    productIds: string[]
): Promise<ReservationsByWarehouse> {
    // Return empty result if no product IDs provided
    if (!productIds.length) {
        return {};
    }

    const currentTime = new Date();

    // Get all active reservation lines for the specified products
    const activeReservationLines = await db
        .select({
            warehouseId: reservationLines.warehouseId,
            productId: reservationLines.productId,
            quantity: reservationLines.quantity,
            reservationId: reservationLines.reservationId,
        })
        .from(reservationLines)
        .innerJoin(
            reservations,
            and(
                eq(reservationLines.reservationId, reservations.id),
                eq(reservations.status, 'ACTIVE'),
                gt(reservations.expiresAt, currentTime)
            )
        )
        .where(inArray(reservationLines.productId, productIds));

    // Construct the result object
    const result: ReservationsByWarehouse = {};

    // Group the reservation quantities by warehouse and product
    for (const line of activeReservationLines) {
        const warehouseId = line.warehouseId;
        const productId = line.productId;
        const quantity = line.quantity;

        // Initialize the warehouse entry if it doesn't exist
        if (!result[warehouseId]) {
            result[warehouseId] = {};
        }

        // Initialize or add to the product quantity
        if (!result[warehouseId][productId]) {
            result[warehouseId][productId] = quantity;
        } else {
            result[warehouseId][productId] += quantity;
        }
    }

    return result;
}

/**
 * Example usage:
 *
 * import { getReservedQuantitiesByWarehouse } from './reservationRepository';
 *
 * // Get reserved quantities for these products across all warehouses
 * const productIds = ['product-id-1', 'product-id-2'];
 * const reservedQuantities = await getReservedQuantitiesByWarehouse(productIds);
 *
 * // Check a specific product's reserved quantity in a warehouse
 * const specificWarehouseId = 'warehouse-id-1';
 * const specificProductId = 'product-id-1';
 * const reservedQuantity = reservedQuantities[specificWarehouseId]?.[specificProductId] || 0;
 */