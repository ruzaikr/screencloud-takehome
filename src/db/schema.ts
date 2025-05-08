import { sql } from 'drizzle-orm';
import {
    pgTable,
    text,
    integer,
    numeric,
    timestamp,
    uuid,
    uniqueIndex,
    pgEnum,
    check,
} from 'drizzle-orm/pg-core';

// --- Enums ---
export const reservationStatusEnum = pgEnum('reservation_status', [
    'ACTIVE',
    'EXPIRED',
    'CONSUMED',
    'RELEASED',
]);

export const inventoryLogChangeTypeEnum = pgEnum('inventory_log_change_type', [
    'ORDER_FULFILLMENT',
    'RESERVATION_CREATED', // Note: Reservation creation doesn't change physical inventory
    'RESERVATION_CONSUMED', // This happens implicitly with ORDER_FULFILLMENT from reservation
    'RESERVATION_EXPIRED',  // When expired reservation quantity is released
    'RESERVATION_RELEASED', // When manually released
    'INVENTORY_ADJUSTMENT', // For manual inventory changes
]);


// --- Tables ---

export const products = pgTable('products', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    unitPriceCents: integer('unit_price_cents').notNull().default(0), // Store price in cents
    weightGrams: integer('weight_grams').notNull().default(0),
});

export const volumeDiscounts = pgTable('volume_discounts', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    threshold: integer('threshold').notNull(), // Minimum quantity for this discount
    discountPercentage: numeric('discount_percentage', { precision: 5, scale: 2 }).notNull(), // e.g., 5.00 for 5%
}, (table) => ([
    uniqueIndex('unq_product_threshold').on(table.productId, table.threshold),
]));

export const warehouses = pgTable('warehouses', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
});

export const inventory = pgTable('inventory', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    // version: integer('version').notNull().default(0), // For optimistic locking if needed later
}, (table) => ([
    uniqueIndex('unq_product_warehouse').on(table.productId, table.warehouseId),
    check('check_quantity_non_negative', sql`${table.quantity} >= 0`),
]));

export const orders = pgTable('orders', {
    id: uuid('id').defaultRandom().primaryKey(),
    shippingAddrLatitude: numeric('shipping_addr_latitude', { precision: 9, scale: 6 }).notNull(),
    shippingAddrLongitude: numeric('shipping_addr_longitude', { precision: 9, scale: 6 }).notNull(),
    totalPriceCents: integer('total_price_cents').notNull(), // Total *before* discount
    discountCents: integer('discount_cents').notNull(),
    shippingCostCents: integer('shipping_cost_cents').notNull(),
    // derived: discountedProductPriceCents = totalPriceCents - discountCents
    // derived: totalOrderCostCents = totalPriceCents - discountCents + shippingCostCents
    salesRepReference: text('sales_rep_reference'),
    customerReference: text('customer_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const orderLines = pgTable('order_lines', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(), // Price at the time of order
    discountPercentage: numeric('discount_percentage', { precision: 5, scale: 2 }).notNull(), // Discount applied at time of order
}, (table) => ([
    check('check_quantity_positive', sql`${table.quantity} > 0`),
]));

export const reservations = pgTable('reservations', {
    id: uuid('id').defaultRandom().primaryKey(),
    status: reservationStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    shippingAddrLatitude: numeric('shipping_addr_latitude', { precision: 9, scale: 6 }).notNull(),
    shippingAddrLongitude: numeric('shipping_addr_longitude', { precision: 9, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const reservationLines = pgTable('reservation_lines', {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
}, (table) => ([
    check('check_quantity_positive', sql`${table.quantity} > 0`),
    uniqueIndex('unq_res_prod_wh').on(table.reservationId, table.productId, table.warehouseId), // Ensure unique line per product/warehouse in a reservation
]));

export const inventoryLog = pgTable('inventory_log', {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    quantityChange: integer('quantity_change').notNull(), // e.g., -10 for fulfillment, +10 for restock
    newQuantity: integer('new_quantity').notNull(), // Record the quantity *after* the change
    changeType: inventoryLogChangeTypeEnum('change_type').notNull(),
    referenceId: text('reference_id'), // e.g., Order ID, Reservation ID, Adjustment Note
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
