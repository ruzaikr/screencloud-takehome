import { db } from "./client";
import { sql } from "drizzle-orm";
import {
    products,
    volumeDiscounts,
    warehouses,
    currentInventory,
} from "./schema";

async function seed() {
    await db.transaction(async (tx) => {
        // 1) Wipe tables (orders/order_lines/inventory_log left empty)
        await tx.execute(
            sql`TRUNCATE 
            inventory_log, order_lines, orders,
            current_inventory, volume_discounts,
            warehouses, product
          RESTART IDENTITY CASCADE`
        );

        // 2) Insert the single product
        const [prodRow] = await tx
            .insert(products)
            .values({
                name: "SCOS Station P1 Pro",
                unit_price: 150,      // $150 :contentReference[oaicite:0]{index=0}:contentReference[oaicite:1]{index=1}
                weight: 365,          // grams :contentReference[oaicite:2]{index=2}:contentReference[oaicite:3]{index=3}
            })
            .returning({ id: products.id });

        // 3) Insert volume-discount tiers
        const discounts = [
            { threshold: 25,  discount_percentage: 0.05 },  // 5% @25+ :contentReference[oaicite:4]{index=4}:contentReference[oaicite:5]{index=5}
            { threshold: 50,  discount_percentage: 0.10 },  // 10% @50+ :contentReference[oaicite:6]{index=6}:contentReference[oaicite:7]{index=7}
            { threshold:100,  discount_percentage: 0.15 },  // 15% @100+ :contentReference[oaicite:8]{index=8}:contentReference[oaicite:9]{index=9}
            { threshold:250,  discount_percentage: 0.20 },  // 20% @250+ :contentReference[oaicite:10]{index=10}:contentReference[oaicite:11]{index=11}
        ];
        for (const d of discounts) {
            await tx.insert(volumeDiscounts).values({
                productId: prodRow.id,
                threshold: d.threshold,
                discount_percentage: d.discount_percentage,
            });
        }

        // 4) Insert the 6 warehouses
        const warehouseDefs = [
            { name: "Los Angeles", latitude: 33.9425,    longitude: -118.408056, stock: 355 },
            { name: "New York",    latitude: 40.639722,  longitude:  -73.778889, stock: 578 },
            { name: "São Paulo",   latitude: -23.435556, longitude:  -46.473056, stock: 265 },
            { name: "Paris",       latitude: 49.009722,  longitude:    2.547778, stock: 694 },
            { name: "Warsaw",      latitude: 52.165833,  longitude:   20.967222, stock: 245 },
            { name: "Hong Kong",   latitude: 22.308889,  longitude:  113.914444, stock: 419 },
        ];                                                 // coords & stock :contentReference[oaicite:12]{index=12}:contentReference[oaicite:13]{index=13}

        for (const w of warehouseDefs) {
            const [wRow] = await tx
                .insert(warehouses)
                .values({ name: w.name, latitude: w.latitude, longitude: w.longitude })
                .returning({ id: warehouses.id });

            // 5) Seed current inventory
            await tx.insert(currentInventory).values({
                productId: prodRow.id,
                warehouseId: wRow.id,
                remaining_quantity: w.stock,
            });
        }
    });

    console.log("Seeding complete!");
}

seed().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
