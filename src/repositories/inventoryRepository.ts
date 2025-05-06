import { db } from '../db/client';
import { inventory } from '../db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Describes the structure for reporting inventory, organized by warehouse and then by product.
 * Example:
 * {
 *   "warehouseId_A": {
 *     "productId_X": 100,
 *     "productId_Y": 50
 *   },
 *   "warehouseId_B": {
 *     "productId_X": 75
 *   }
 * }
 */
export interface ProductInventoryByWarehouse {
    [warehouseId: string]: {
        [productId: string]: number;
    };
}

/**
 * Retrieves the current inventory quantities for a given list of product IDs,
 * categorized by warehouse.
 *
 * This function queries the `inventory` table to find all stock records
 * for the specified product IDs. It then aggregates this data into a nested
 * object structure where the top-level keys are warehouse IDs, and their
 * values are objects mapping product IDs to their respective quantities in that
 * warehouse.
 *
 * @param productIds - An array of product ID strings (UUIDs).
 * @returns A promise that resolves to a `ProductInventoryByWarehouse` object.
 *          If a product ID from the input list has no inventory in any warehouse,
 *          it will not be included in the result. If a warehouse does not stock
 *          any of the requested products, that warehouse ID will not appear as a
 *          key in the result. If the `productIds` array is empty, an empty
 *          object is returned.
 */
export async function getInventoryForProducts(
    productIds: string[]
): Promise<ProductInventoryByWarehouse> {
    if (!productIds || productIds.length === 0) {
        return {};
    }

    const inventoryRows = await db
        .select({
            productId: inventory.productId,
            warehouseId: inventory.warehouseId,
            quantity: inventory.quantity,
        })
        .from(inventory)
        .where(inArray(inventory.productId, productIds));

    const result: ProductInventoryByWarehouse = {};

    for (const inventoryRow of inventoryRows) {
        if (!result[inventoryRow.warehouseId]) {
            result[inventoryRow.warehouseId] = {};
        }
        result[inventoryRow.warehouseId][inventoryRow.productId] = inventoryRow.quantity;
    }

    return result;
}