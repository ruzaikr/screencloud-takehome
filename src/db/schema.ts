import {
    pgTable,
    serial,
    varchar,
    doublePrecision,
    integer,
    text,
    primaryKey,
} from "drizzle-orm/pg-core";

export const products = pgTable("product", {
    id: serial("id").primaryKey(),
    name: varchar("name", {length: 255}),
    price: doublePrecision("price"),
    weight: doublePrecision("weight"),
});

export const volumeDiscounts = pgTable(
    "volume_discounts",
    {
        productId: integer("product_id")
            .notNull()
            .references(() => products.id),
        volume: integer("volume")
            .notNull(),
        discountPct: doublePrecision("discount_pct")
            .notNull(),
    },
    (table) => ({
        pk: primaryKey({columns: [table.productId, table.volume]})
    })
);

export const warehouses = pgTable("warehouses", {
    id: serial("id").primaryKey(),
    name: varchar("name", {length: 255}),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
})

export const stocks = pgTable(
    "stocks",
    {
        productId: integer("product_id")
            .notNull()
            .references(() => products.id),
        warehouseId: integer("warehouse_id")
            .notNull()
            .references(() => warehouses.id),
        remainingAmount: integer("remaining_amount"),
    },
    (table) => ({
        pk: primaryKey({columns: [table.productId, table.warehouseId]})
    })
);

export const orders = pgTable("order", {
    id: serial("id").primaryKey(),
    shippingAddress: text("shipping_address"),
    totalPrice: doublePrecision("total_price"),
    discount: doublePrecision("discount"),
    shippingCost: doublePrecision("shipping_cost"),
    createdAt: integer("created_at"),
});

export const orderLines = pgTable("order_line", {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
        .notNull()
        .references(() => orders.id),
    productId: integer("product_id")
        .notNull()
        .references(() => products.id),
    warehouseId: integer("warehouse_id")
        .notNull()
        .references(() => warehouses.id),
    amount: integer("amount"),
});