import type { AppTransactionExecutor } from '../db/client';
import { inventory as inventoryTable, inventoryLog as inventoryLogTable, inventoryLogChangeTypeEnum } from '../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

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
 * categorized by warehouse, and locks the selected rows for update.
 *
 * It queries the `inventory` table using the provided transaction to find all
 * inventory records for the specified product IDs. It then aggregates this data
 * into a nested object structure where the top-level keys are warehouse IDs,
 * and their values are objects mapping product IDs to their respective
 * quantities in that warehouse. The selected inventory rows are locked using
 * `FOR UPDATE` to prevent concurrent modifications until the transaction completes.
 *
 * @param tx - A Drizzle transaction object. This object must have been
 *                            obtained from a Drizzle instance initialized with the schema
 *                            (e.g., `db = drizzle(pool, { schema })`).
 * @param productIds - An array of product ID strings (UUIDs).
 * @returns A promise that resolves to a `ProductInventoryByWarehouse` object.
 *          If a product ID from the input list has no inventory in any warehouse,
 *          it will not be included in the result. If a warehouse does not stock
 *          any of the requested products, that warehouse ID will not appear as a
 *          key in the result. If the `productIds` array is empty, an empty
 *          object is returned.
 */
export async function getInventoryForProducts(
    tx: AppTransactionExecutor,
    productIds: string[],
): Promise<ProductInventoryByWarehouse> {
    if (!productIds || productIds.length === 0) {
        return {};
    }

    const inventoryRows = await tx
        .select({
            productId: inventoryTable.productId,
            warehouseId: inventoryTable.warehouseId,
            quantity: inventoryTable.quantity,
        })
        .from(inventoryTable)
        .where(inArray(inventoryTable.productId, productIds))
        .for('update');

    const result: ProductInventoryByWarehouse = {};

    for (const inventoryRow of inventoryRows) {
        if (!result[inventoryRow.warehouseId]) {
            result[inventoryRow.warehouseId] = {};
        }
        result[inventoryRow.warehouseId][inventoryRow.productId] = inventoryRow.quantity;
    }

    return result;
}

/**
 * Represents an item for inventory update.
 */
export interface InventoryUpdateItem {
    productId: string;
    warehouseId: string;
    /** The amount to decrement the quantity by (should be positive). */
    quantityToDecrement: number;
}

/**
 * Updates inventory quantities for a list of items and logs the changes.
 * This function is designed to be used for order fulfillment, decrementing inventory.
 * It ensures that inventory does not go below zero through a WHERE clause condition.
 *
 * @param tx The Drizzle transaction executor.
 * @param updates An array of `InventoryUpdateItem` objects.
 * @param orderId The ID of the order for which inventory is being updated, used as reference in logs.
 * @throws Error if an update fails (e.g., insufficient inventory for an item, or item not found).
 */
export async function updateInventoryAndLogChanges(
    tx: AppTransactionExecutor,
    updates: InventoryUpdateItem[],
    orderId: string
): Promise<void> {
    if (updates.length === 0) {
        return;
    }

    for (const update of updates) {
        if (update.quantityToDecrement <= 0) {
            // Skip if quantity to decrement is not positive, though logic should ensure this.
            console.warn(`Skipping inventory update for product ${update.productId} in warehouse ${update.warehouseId} due to non-positive quantityToDecrement: ${update.quantityToDecrement}`);
            continue;
        }

        const updatedRows = await tx
            .update(inventoryTable)
            .set({
                quantity: sql`${inventoryTable.quantity} - ${update.quantityToDecrement}`,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(inventoryTable.productId, update.productId),
                    eq(inventoryTable.warehouseId, update.warehouseId),
                    sql`${inventoryTable.quantity} >= ${update.quantityToDecrement}` // Ensure inventory doesn't go negative
                )
            )
            .returning({
                newQuantity: inventoryTable.quantity,
                productId: inventoryTable.productId, // For verification if needed
                warehouseId: inventoryTable.warehouseId, // For verification if needed
            });

        if (updatedRows.length === 0) {
            // This means either the product-warehouse combination was not found,
            // or the quantity condition (>= quantityToDecrement) failed.
            // The allocation logic in the service should prevent attempting to decrement
            // more than available inventory. If this error occurs, it might indicate a race condition
            // not fully covered, a flaw in pre-check logic, or an attempt to update a non-existent record.
            // With FOR UPDATE, insufficient inventory at this stage (if pre-checks were correct based on locked reads)
            // would be highly unlikely unless there's a logical flaw in how available inventory was calculated.
            throw new Error(
                `Failed to update inventory for product ${update.productId} in warehouse ${update.warehouseId}. ` +
                `This could be due to insufficient inventory (meaning the pre-check based on locked read was somehow bypassed or incorrect) or the item not being found. ` +
                `Attempted to decrement by ${update.quantityToDecrement}.`
            );
        }

        const { newQuantity } = updatedRows[0];

        await tx.insert(inventoryLogTable).values({
            productId: update.productId,
            warehouseId: update.warehouseId,
            quantityChange: -update.quantityToDecrement, // Logged as negative for decrement
            newQuantity: newQuantity,
            changeType: inventoryLogChangeTypeEnum.enumValues[0], // 'ORDER_FULFILLMENT'
            referenceId: orderId,
            createdAt: new Date(), // Drizzle sets defaultNow, but explicit for clarity
        });
    }
}