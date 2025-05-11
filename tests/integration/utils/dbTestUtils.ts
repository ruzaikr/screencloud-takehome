// tests/integration/utils/dbTestUtils.ts
import { db } from '../../../src/db/client'; // This will use the DATABASE_URL set by globalSetup
import * as schema from '../../../src/db/schema';
import { sql } from 'drizzle-orm';

// Order of tables for truncation matters due to foreign key constraints.
// Start with tables that are referenced by others, or use CASCADE.
const tablesToTruncate = [
    // Tables that are referenced by others (FK targets) or have no FKs to tables below
    // These might be okay to truncate first if using CASCADE or if order is managed carefully

    // Tables that reference others (delete from these first)
    schema.inventoryLog,
    schema.orderLines,
    schema.reservationLines,

    // Then tables they reference (if not already handled by cascade or earlier truncation)
    schema.orders,
    schema.reservations,

    // Then inventory, volume discounts
    schema.inventory,
    schema.volumeDiscounts,

    // Finally, products and warehouses
    schema.products,
    schema.warehouses,
];


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


// Example Seeding Helpers (add more as needed)

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


// Example Query Helpers for Assertions

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

// Import 'eq' if not already available
import { eq } from 'drizzle-orm';

// ... you might add more specific helpers ...