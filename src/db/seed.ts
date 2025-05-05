import { db } from "./client";
import {
    products,
    volumeDiscounts,
    warehouses,
    inventory,
} from "./schema";

async function seed() {

    const [{ id: productId }] = await db
        .insert(products)
        .values({
            name: 'SCOS Station P1 Pro',
            unitPriceCents: 150 * 100, // $150 → 15000¢
            weightGrams: 365,           // 365 g
        })
        .returning({ id: products.id });

    const warehouseSpecs = [
        { name: 'Los Angeles', latitude: 33.9425, longitude: -118.408056, stock: 355 },
        { name: 'New York',    latitude: 40.639722, longitude: -73.778889,  stock: 578 },
        { name: 'São Paulo',   latitude: -23.435556,longitude: -46.473056,  stock: 265 },
        { name: 'Paris',       latitude: 49.009722, longitude: 2.547778,    stock: 694 },
        { name: 'Warsaw',      latitude: 52.165833, longitude: 20.967222,   stock: 245 },
        { name: 'Hong Kong',   latitude: 22.308889, longitude: 113.914444,  stock: 419 },
    ];

    for (const { name, latitude, longitude, stock } of warehouseSpecs) {
        const [{ id: warehouseId }] = await db
            .insert(warehouses)
            .values({ name, latitude, longitude })
            .returning({ id: warehouses.id });

        // 4. Seed inventory for this warehouse
        await db.insert(inventory).values({
            productId,
            warehouseId,
            quantity: stock,
        });
    }

    await db.insert(volumeDiscounts).values(
        {
            productId,
            threshold: 25,
            discountPercentage: 5.00,   // 5% for 25+
        },
        {
            productId,
            threshold: 50,
            discountPercentage: 10.00,  // 10% for 50+
        },
        {
            productId,
            threshold: 100,
            discountPercentage: 15.00,  // 15% for 100+
        },
        {
            productId,
            threshold: 250,
            discountPercentage: 20.00,  // 20% for 250+
        }
    );

    console.log('Seeding complete.');
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
