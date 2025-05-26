import { db } from '../../../src/db/client';
import * as inventoryRepo from '../../../src/repositories/inventoryRepository';
import * as schema from '../../../src/db/schema';
import { seedProduct, seedWarehouse, seedInventory, getInventoryQuantity, getInventoryLogCount } from '../utils/dbTestUtils';
import { sql, eq, and } from 'drizzle-orm';

describe('Inventory Repository Integration Tests', () => {

    let product1Id: string, product2Id: string;
    let warehouse1Id: string, warehouse2Id: string;

    beforeEach(async () => {
        // Seeding common data for inventory tests
        const [p1] = await seedProduct({ name: 'Test Product 1', unitPriceCents: 1000, weightGrams: 100 });
        const [p2] = await seedProduct({ name: 'Test Product 2', unitPriceCents: 2000, weightGrams: 200 });
        product1Id = p1.id;
        product2Id = p2.id;

        const [wh1] = await seedWarehouse({ name: 'Test Warehouse 1', latitude: '10.0', longitude: '10.0' });
        const [wh2] = await seedWarehouse({ name: 'Test Warehouse 2', latitude: '20.0', longitude: '20.0' });
        warehouse1Id = wh1.id;
        warehouse2Id = wh2.id;

        await seedInventory({ productId: product1Id, warehouseId: warehouse1Id, quantity: 100 });
        await seedInventory({ productId: product1Id, warehouseId: warehouse2Id, quantity: 50 });
        await seedInventory({ productId: product2Id, warehouseId: warehouse1Id, quantity: 75 });
    });

    describe('getInventoryForProducts', () => {
        it('should retrieve correct inventory quantities for specified products', async () => {
            await db.transaction(async (tx) => {
                const inventory = await inventoryRepo.getInventoryForProducts(tx, [product1Id, product2Id]);

                expect(inventory[warehouse1Id]?.[product1Id]).toBe(100);
                expect(inventory[warehouse2Id]?.[product1Id]).toBe(50);
                expect(inventory[warehouse1Id]?.[product2Id]).toBe(75);
                expect(inventory[warehouse2Id]?.[product2Id]).toBeUndefined(); // Not stocked
            });
        });

        it('should return empty object if no products match or productIds array is empty', async () => {
            await db.transaction(async (tx) => {
                const nonExistentValidUuid = '123e4567-e89b-12d3-a456-426614174000';
                const inventory1 = await inventoryRepo.getInventoryForProducts(tx, [nonExistentValidUuid]);
                expect(inventory1).toEqual({});

                const inventory2 = await inventoryRepo.getInventoryForProducts(tx, []);
                expect(inventory2).toEqual({});
            });
        });

    });

    describe('updateInventoryAndLogChanges', () => {
        it('should correctly update inventory and log changes for multiple items', async () => {
            const orderId = 'test-order-123';
            const updates: inventoryRepo.InventoryUpdateItem[] = [
                { productId: product1Id, warehouseId: warehouse1Id, quantityToDecrement: 10 },
                { productId: product2Id, warehouseId: warehouse1Id, quantityToDecrement: 5 },
            ];

            await db.transaction(async (tx) => {
                await inventoryRepo.updateInventoryAndLogChanges(tx, updates, orderId);
            });

            expect(await getInventoryQuantity(product1Id, warehouse1Id)).toBe(90);
            expect(await getInventoryQuantity(product2Id, warehouse1Id)).toBe(70);

            const logs = await db.select().from(schema.inventoryLog).where(sql`${schema.inventoryLog.referenceId} = ${orderId}`);
            expect(logs.length).toBe(2);

            const logP1 = logs.find(log => log.productId === product1Id);
            expect(logP1?.quantityChange).toBe(-10);
            expect(logP1?.newQuantity).toBe(90);
            expect(logP1?.changeType).toBe('ORDER_FULFILLMENT');

            const logP2 = logs.find(log => log.productId === product2Id);
            expect(logP2?.quantityChange).toBe(-5);
            expect(logP2?.newQuantity).toBe(70);
            expect(logP2?.changeType).toBe('ORDER_FULFILLMENT');
        });

        it('should throw an error if attempting to decrement more than available quantity', async () => {
            const orderId = 'test-order-insufficient';
            const updates: inventoryRepo.InventoryUpdateItem[] = [
                { productId: product1Id, warehouseId: warehouse1Id, quantityToDecrement: 101 }, // Current: 100
            ];

            await expect(
                db.transaction(async (tx) => {
                    await inventoryRepo.updateInventoryAndLogChanges(tx, updates, orderId);
                })
            ).rejects.toThrowError(/Failed to update inventory for product .* This could be due to insufficient inventory/); // @todo: use toBeInstanceOf and compare with custom error

            expect(await getInventoryQuantity(product1Id, warehouse1Id)).toBe(100); // Unchanged
            expect(await getInventoryLogCount(orderId)).toBe(0); // No logs
        });

        it('should throw an error if attempting to update non-existent product/warehouse inventory', async () => {
            const orderId = 'test-order-nonexistent';
            const nonExistentProductId = '123e4567-e89b-12d3-a456-426614174010';
            const updates: inventoryRepo.InventoryUpdateItem[] = [
                { productId: nonExistentProductId, warehouseId: warehouse1Id, quantityToDecrement: 1 },
            ];

            await expect(
                db.transaction(async (tx) => {
                    await inventoryRepo.updateInventoryAndLogChanges(tx, updates, orderId);
                })
            ).rejects.toThrowError(/Failed to update inventory for product 123e4567-e89b-12d3-a456-426614174010/); // @todo: use toBeInstanceOf and compare with custom error
            expect(await getInventoryLogCount(orderId)).toBe(0);
        });

    });
});