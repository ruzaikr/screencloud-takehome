import { db } from '../../../src/db/client';
import * as schema from '../../../src/db/schema';
import { sql, eq } from 'drizzle-orm';

export async function resetDatabase(): Promise<void> {
    // Simpler approach: Truncate with CASCADE, let PostgreSQL handle the order.
    // Ensure the user has permissions for TRUNCATE. The testcontainer user should.
    const tableNames = [
        'inventory_log',
        'order_lines',
        'reservation_lines',
        'orders',
        'reservations',
        'inventory',
        'volume_discounts',
        'products',
        'warehouses',
    ];

    try {
        for (const tableName of tableNames) {
            // Using db.execute to run raw SQL for TRUNCATE
            await db.execute(sql.raw(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`));
        }
    } catch (error) {
        console.error('Failed to truncate tables:', error);
        throw error;
    }
}

export async function seedProduct(productData: typeof schema.products.$inferInsert) {
    return db.insert(schema.products).values(productData).returning();
}

export async function seedWarehouse(warehouseData: typeof schema.warehouses.$inferInsert) {
    return db.insert(schema.warehouses).values(warehouseData).returning();
}

export async function seedInventory(inventoryData: typeof schema.inventory.$inferInsert) {
    return db.insert(schema.inventory).values(inventoryData).returning();
}

export async function seedVolumeDiscount(discountData: typeof schema.volumeDiscounts.$inferInsert) {
    return db.insert(schema.volumeDiscounts).values(discountData).returning();
}

export async function getInventoryQuantity(productId: string, warehouseId: string): Promise<number | null> {
    const result = await db.select({ quantity: schema.inventory.quantity })
        .from(schema.inventory)
        .where(sql`${schema.inventory.productId} = ${productId} AND ${schema.inventory.warehouseId} = ${warehouseId}`);
    return result.length > 0 ? result[0].quantity : null;
}

export async function getInventoryLogCount(referenceId?: string): Promise<number> {
    const baseQuery = db.select({ count: sql<number>`count(*)` }).from(schema.inventoryLog);

    const result = referenceId
        ? await baseQuery.where(sql`${schema.inventoryLog.referenceId} = ${referenceId}`)
        : await baseQuery;

    return Number(result[0].count);
}

export async function getOrderCount(orderId?: string): Promise<number> {
    const baseQuery = db.select({ count: sql<number>`count(*)` }).from(schema.orders);

    const result = orderId
        ? await baseQuery.where(sql`${schema.orders.id} = ${orderId}`)
        : await baseQuery;

    return Number(result[0].count);
}

export async function getOrderLineCount(orderId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
        .from(schema.orderLines)
        .where(sql`${schema.orderLines.orderId} = ${orderId}`);
    return Number(result[0].count);
}

export async function findProductById(productId: string) {
    return db.query.products.findFirst({ where: eq(schema.products.id, productId) });
}

export async function findOrderById(orderId: string) {
    return db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
}

export async function findInventoryLogByRefId(refId: string) {
    return db.query.inventoryLog.findMany({ where: eq(schema.inventoryLog.referenceId, refId) });
}
