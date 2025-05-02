import {
    pgTable,
    varchar,
    doublePrecision,
    integer,
    timestamp,
    primaryKey,
} from "drizzle-orm/pg-core";

export const products = pgTable("product", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    unit_price: doublePrecision("unit_price").notNull(),
    weight: integer("weight").notNull(),
});

export const volumeDiscounts = pgTable(
    "volume_discounts",
    {
        productId: integer("product_id").notNull().references(() => products.id),
        threshold: integer("threshold").notNull(),
        discount_percentage: doublePrecision("discount_percentage").notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.productId, table.threshold] }),
    })
);

export const warehouses = pgTable("warehouses", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
});

export const currentInventory = pgTable(
    "current_inventory",
    {
        productId: integer("product_id").notNull().references(() => products.id),
        warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
        remaining_quantity: integer("remaining_quantity").notNull(),
        updated_at: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.productId, table.warehouseId] }),
    })
);

export const orders = pgTable("orders", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    shipping_addr_latitude: doublePrecision("shipping_addr_latitude").notNull(),
    shipping_addr_longitude: doublePrecision("shipping_addr_longitude").notNull(),
    total_price: doublePrecision("total_price").notNull(),
    discount: doublePrecision("discount").notNull(),
    shipping_cost: doublePrecision("shipping_cost").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
});

export const orderLines = pgTable("order_lines", {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    orderId: integer("order_id").notNull().references(() => orders.id),
    productId: integer("product_id").notNull().references(() => products.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    quantity: integer("quantity").notNull(),
});

export const inventoryLog = pgTable("inventory_log", {
    productId: integer("product_id").notNull().references(() => products.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    quantity_change: integer("quantity_change").notNull(),
    change_type: varchar("change_type", { length: 50 }).notNull(),
    reference_id: integer("reference_id").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
});