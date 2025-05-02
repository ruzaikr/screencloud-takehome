import { db } from "../db/client";
import {
    products,
    volumeDiscounts,
    warehouses,
    currentInventory,
    orders,
    orderLines,
    inventoryLog,
} from "../db/schema";
import { and, eq, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";

interface Allocation {
    warehouseId: number;
    allocatedQuantity: number;
    shippingCost: number;
}

interface Quote {
    totalProductCost: number;
    discount: number;
    shippingCost: number;
    isValid: boolean;
    allocations: Allocation[];
}

// Haversine distance in km
function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius km
    const dLat = toRad(lat2 - lon1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function computeOrder(
    { latitude, longitude }: { latitude: number; longitude: number },
    productId: number,
    quantity: number,
): Promise<Quote> {
    // 1. Fetch product
    const productRow = await db
        .select({ id: products.id, unitPrice: products.unit_price, weight: products.weight })
        .from(products)
        .where(eq(products.id, productId));
    const product = productRow[0];
    if (!product) throw new Error("Product not found");

    const weightKg = product.weight / 1000;
    const totalProductCost = product.unitPrice * quantity;

    // 2. Volume discount
    const discountRows = await db
        .select({ threshold: volumeDiscounts.threshold, discount: volumeDiscounts.discount_percentage })
        .from(volumeDiscounts)
        .where(and(eq(volumeDiscounts.productId, productId), lte(volumeDiscounts.threshold, quantity)));
    const best = discountRows.reduce(
        (acc, row) => (row.threshold > acc.threshold ? row : acc),
        { threshold: 0, discount: 0 }
    );
    const discountAmount = totalProductCost * best.discount;
    const discountedTotal = totalProductCost - discountAmount;

    // 3. Fetch all warehouses
    const warehouseRows = await db
        .select({ id: warehouses.id, lat: warehouses.latitude, lng: warehouses.longitude })
        .from(warehouses);

    // 4. Get inventory for this product
    const currInventoryRows = await db
        .select({ warehouseId: currentInventory.warehouseId, remainingQuantity: currentInventory.remaining_quantity })
        .from(currentInventory)
        .where(eq(currentInventory.productId, productId));
    if (currInventoryRows.length === 0) throw new Error("Insufficient inventory");

    const shippingRate = 0.01;
    let unfulfilledQty = quantity;
    let shippingCost = 0;
    const allocations: Allocation[] = [];

    // compute per-unit shipping cost per warehouse, only those with stock
    const sortedWs = warehouseRows
        .map((warehouseRow) => {
            const warehouseCurrInventoryRow = currInventoryRows.find((element) => element.warehouseId === warehouseRow.id);
            const remainingQtyInWarehouse = warehouseCurrInventoryRow ? warehouseCurrInventoryRow.remainingQuantity : 0;
            const distanceToShippingAddress = distanceKm(latitude, longitude, warehouseRow.lat, warehouseRow.lng);
            const warehouseShippingCostPerUnit = shippingRate * weightKg * distanceToShippingAddress;
            return { warehouseId: warehouseRow.id, remainingQtyInWarehouse: remainingQtyInWarehouse, warehouseShippingCostPerUnit: warehouseShippingCostPerUnit };
        })
        .filter((w) => w.remainingQtyInWarehouse > 0)
        .sort((a, b) => a.warehouseShippingCostPerUnit - b.warehouseShippingCostPerUnit);

    for (const w of sortedWs) {
        if (unfulfilledQty <= 0) break;
        const qtyTakenFromWarehouse = Math.min(w.remainingQtyInWarehouse, unfulfilledQty);
        const warehouseShippingCost = w.warehouseShippingCostPerUnit * qtyTakenFromWarehouse
        shippingCost += warehouseShippingCost;
        allocations.push({ warehouseId: w.warehouseId, allocatedQuantity: qtyTakenFromWarehouse, shippingCost: warehouseShippingCost });
        unfulfilledQty -= qtyTakenFromWarehouse;
    }
    if (unfulfilledQty > 0) throw new Error("Insufficient inventory to fulfill order");

    const isValid = shippingCost <= discountedTotal * 0.15;
    return { totalProductCost, discount: discountAmount, shippingCost, isValid, allocations };
}

export async function submitOrder(
    { latitude, longitude }: { latitude: number; longitude: number },
    productId: number,
    quantity: number,
) {
    return await db.transaction(async (tx) => {
        const { totalProductCost, discount, shippingCost, isValid, allocations } =
            await computeOrder({ latitude, longitude }, productId, quantity);
        if (!isValid) throw new Error("Order invalid: shipping cost too high");

        // Insert order
        const [order] = await tx
            .insert(orders)
            .values({
                shipping_addr_latitude: latitude,
                shipping_addr_longitude: longitude,
                total_price: totalProductCost,
                discount,
                shipping_cost: shippingCost,
            })
            .returning({ id: orders.id, shipping_addr_latitude: orders.shipping_addr_latitude, shipping_addr_longitude: orders.shipping_addr_longitude, total_price: orders.total_price, discount: orders.discount, shipping_cost: orders.shipping_cost, created_at: orders.created_at });

        // Allocate & log per warehouse
        for (const alloc of allocations) {
            const [line] = await tx
                .insert(orderLines)
                .values({ orderId: order.id, productId, warehouseId: alloc.warehouseId, quantity: alloc.allocatedQuantity })
                .returning({ id: orderLines.id });

            // decrement inventory
            await tx.execute(sql`
                UPDATE "current_inventory"
                SET "remaining_quantity" = "remaining_quantity" - ${alloc.allocatedQuantity},
                    "updated_at" = now()
                WHERE "product_id" = ${productId} AND "warehouse_id" = ${alloc.warehouseId}
            `);

            // insert log
            await tx.insert(inventoryLog).values({
                productId,
                warehouseId: alloc.warehouseId,
                quantity_change: -alloc.allocatedQuantity,
                change_type: "order",
                reference_id: line.id,
            });
        }

        return order;
    });
}