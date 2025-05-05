import { db } from '../db/client';
import { inArray } from 'drizzle-orm';
import { inventory } from '../db/schema';

/**
 * Maps product IDs to their available quantities
 */
export interface ProductInventoryMap {
    [productId: string]: number;
}

/**
 * Maps warehouse IDs to their product inventory
 */
export interface WarehouseInventoryMap {
    [warehouseId: string]: ProductInventoryMap;
}

/**
 * Returns available inventory for specified products across all warehouses
 * @param productIds Array of product UUIDs to query
 * @returns A map where keys are warehouse IDs and values are maps of product IDs to quantities
 */
export async function getAvailableInventoryByProducts(productIds: string[]): Promise<WarehouseInventoryMap> {
    // Return empty result if no product IDs provided
    if (!productIds.length) {
        return {};
    }

    // Query inventory for the specified products
    const inventoryRows = await db
        .select({
            productId: inventory.productId,
            warehouseId: inventory.warehouseId,
            quantity: inventory.quantity,
        })
        .from(inventory)
        .where(inArray(inventory.productId, productIds));

    // Create the nested map structure using plain objects
    const result: WarehouseInventoryMap = {};

    // Populate the result map
    for (const inventoryRow of inventoryRows) {
        const { warehouseId, productId, quantity } = inventoryRow;

        // If this warehouse isn't in the result map yet, initialize it
        if (!result[warehouseId]) {
            result[warehouseId] = {};
        }

        // Set the quantity for this product in this warehouse
        result[warehouseId][productId] = quantity;
    }

    return result;
}

/**
 * Example usage:
 *
 * import { getAvailableInventoryByProducts } from './inventoryRepository';
 *
 * const inventoryMap = await getAvailableInventoryByProducts(['product-id-1', 'product-id-2']);
 *
 * // To get quantity of a specific product in a specific warehouse:
 * const quantity = inventoryMap['warehouse-id']?.[product-id] || 0;
 */