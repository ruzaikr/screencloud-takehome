import type { DatabaseExecutor } from '../db/client';
import { reservations, reservationLines } from '../db/schema';
import { and, eq, gt, inArray, sum, sql } from 'drizzle-orm';

/**
 * Defines the structure for reserved inventory information, mapping warehouse IDs
 * to an object that maps product IDs to their total reserved quantity.
 * The `warehouseId` and `productId` in the index signatures are illustrative names
 * for the keys.
 *
 * @example
 * {
 *   "a3fb5cea-7c49-4b9c-a061-cb4f66693671": { // warehouseId (string)
 *     "721c711e-94a0-456b-bb53-bdf96b3c062e": 450, // productId (string): totalReservedQuantity (number)
 *     "dad59363-885c-4505-9ac5-f6923f4993e2": 100
 *   },
 *   "fe3bb7a6-68c8-430d-8bcb-e4bbef8af595": {
 *     "721c711e-94a0-456b-bb53-bdf96b3c062e": 90,
 *     "dad59363-885c-4505-9ac5-f6923f4993e2": 400
 *   }
 * }
 */
export interface ReservedInventoryByWarehouse {
    [warehouseId: string]: {
        [productId: string]: number;
    };
}

/**
 * Retrieves the total reserved quantities for a given set of product IDs,
 * grouped by warehouse.
 *
 * This function considers only reservations that are currently 'ACTIVE'
 * and have an 'expiresAt' timestamp in the future. It can operate with
 * either a main DB connection or a transaction.
 *
 * @param dbx The Drizzle database executor (db or tx).
 * @param productIds An array of product IDs for which to fetch reserved inventory.
 *                   If empty, an empty object will be returned.
 * @returns A promise that resolves to an object structured as `ReservedInventoryByWarehouse`.
 *          If no reservations are found for the given products, or if the
 *          `productIds` array is empty, an empty object is returned.
 */
export async function getReservedInventoryByWarehouseForProducts(
    dbx: DatabaseExecutor,
    productIds: string[]
): Promise<ReservedInventoryByWarehouse> {
    if (productIds.length === 0) {
        return {};
    }

    const activeReservationsData = await dbx
        .select({
            warehouseId: reservationLines.warehouseId,
            productId: reservationLines.productId,
            totalReservedQuantity: sum(reservationLines.quantity).mapWith(Number),
        })
        .from(reservationLines)
        .innerJoin(reservations, eq(reservationLines.reservationId, reservations.id))
        .where(
            and(
                eq(reservations.status, 'ACTIVE'),
                gt(reservations.expiresAt, sql`CURRENT_TIMESTAMP`),
                inArray(reservationLines.productId, productIds)
            )
        )
        .groupBy(
            reservationLines.warehouseId,
            reservationLines.productId
        );

    const result: ReservedInventoryByWarehouse = {};

    for (const item of activeReservationsData) {
        if (!result[item.warehouseId]) {
            result[item.warehouseId] = {};
        }
        result[item.warehouseId][item.productId] = item.totalReservedQuantity;
    }

    return result;
}