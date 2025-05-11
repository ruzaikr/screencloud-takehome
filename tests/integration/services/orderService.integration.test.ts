import * as orderService from '../../../src/services/orderService';
import { CreateOrderRequest } from '../../../src/schemas/order';
import * as schema from '../../../src/db/schema';
import {
    seedProduct,
    seedWarehouse,
    seedInventory,
    seedVolumeDiscount,
    getInventoryQuantity,
    getOrderCount,
    getOrderLineCount,
    findOrderById,
    findInventoryLogByRefId
} from '../utils/dbTestUtils';
import { InsufficientInventoryError, ProductNotFoundError, ShippingCostExceededError } from '../../../src/errors/customErrors';

// Mock uuid
jest.mock('uuid', () => ({
    ...jest.requireActual('uuid'),
    v4: jest.fn(),
}));
const { v4: mockUuidv4 } = require('uuid') as { v4: jest.Mock };


describe('Order Service Integration Tests - createWalkInOrder', () => {
    let product1: typeof schema.products.$inferSelect, product2: typeof schema.products.$inferSelect;
    let warehouse1: typeof schema.warehouses.$inferSelect, warehouse2: typeof schema.warehouses.$inferSelect;

    const MOCK_ORDER_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

    beforeEach(async () => {
        jest.resetModules(); // Important to re-evaluate config if process.env changes

        // Default environment setup for config
        process.env.PORT = '3002';
        process.env.DATABASE_URL = process.env.DATABASE_URL; // Keep from globalSetup
        process.env.RESERVATION_TTL_MINUTES = '10';
        process.env.SHIPPING_COST_CENTS_PER_KG_PER_KM = '1'; // 1 cent per kg per km
        process.env.SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE = '15'; // 15%

        mockUuidv4.mockReturnValue(MOCK_ORDER_ID);

        // Seed common data
        [product1] = await seedProduct({ name: 'Super TV', unitPriceCents: 100000, weightGrams: 5000 }); // 5kg
        [product2] = await seedProduct({ name: 'Basic Radio', unitPriceCents: 2000, weightGrams: 500 });  // 0.5kg

        [warehouse1] = await seedWarehouse({ name: 'Main Warehouse (LA)', latitude: '34.0522', longitude: '-118.2437' }); // LA
        [warehouse2] = await seedWarehouse({ name: 'East Coast Hub (NY)', latitude: '40.7128', longitude: '-74.0060' }); // NY

        await seedInventory({ productId: product1.id, warehouseId: warehouse1.id, quantity: 10 });
        await seedInventory({ productId: product1.id, warehouseId: warehouse2.id, quantity: 5 });
        await seedInventory({ productId: product2.id, warehouseId: warehouse1.id, quantity: 100 });

        // Add a discount for product1
        await seedVolumeDiscount({ productId: product1.id, threshold: 2, discountPercentage: "10.00" }); // 10% off if 2 or more
    });

    afterEach(() => {
        mockUuidv4.mockClear();
        // Clean up any specific env vars set during tests if necessary, though resetModules handles config load.
    });

    const customerShippingAddress = { // Approx. Chicago
        latitude: '41.8781',
        longitude: '-87.6298',
    };

    it('should successfully create an order, update inventory, and log changes', async () => {
        // NY to Chicago is approx 1145.036 km. -> shippingCostCentsPerKg = Math.round(1145.036 * 1) = 1145 cents/kg
        // Warehouse 2 (NY) should be preferred for shipping cost if inventory allows.
        // Product1: 5kg. CostPerKg for WH2 (NY) = 1145 cents/kg
        // Product2: 0.5kg. CostPerKg for WH1 (LA) = 2802 cents/kg

        const request: CreateOrderRequest = {
            shippingAddress: customerShippingAddress,
            requestedProducts: [
                { productId: product1.id, quantity: 2 }, // Gets 10% discount
                { productId: product2.id, quantity: 10 },
            ],
        };

        const response = await orderService.createWalkInOrder(request);

        expect(response.orderId).toBe(MOCK_ORDER_ID);

        // Verify Order
        const orderInDb = await findOrderById(MOCK_ORDER_ID);
        expect(orderInDb).toBeDefined();
        expect(orderInDb?.totalPriceCents).toBe((100000 * 2) + (2000 * 10)); // 200000 + 20000 = 220000
        expect(orderInDb?.discountCents).toBe(Math.round(100000 * 2 * 0.10)); // 10% of 2 TVs = 20000

        // Shipping calc:
        // P1 (TVs) x2 from WH2 (NY): 2 * 5kg = 10kg. Math.ceil(10kg * 1145 cents/kg) = 11450 cents.
        //   Wait, WH2 has 5 P1. Request is 2 P1. So all 2 P1 from WH2.
        // P2 (Radios) x10 from WH1 (LA): 10 * 0.5kg = 5kg. Math.ceil(5kg * 2802 cents/kg) = 14010 cents.
        //   No, allocation prefers cheaper shipping if available.
        //   P2 from WH2 (NY): 0.5kg * 1145 cents/kg * 10 items = Math.ceil(5725) = 5725 cents if all 10 radios are from NY and NY has them.
        //   WH1 (LA): product1 (10), product2 (100)
        //   WH2 (NY): product1 (5)
        //   Requested: P1: 2, P2: 10
        //   Sorted Warehouses (to Chicago): NY (WH2) first, then LA (WH1)
        //   Allocate P1 (2 units):
        //     - WH2 (NY) has 5. Takes 2 from WH2. Cost: Math.ceil(2 * 5kg * 1145c/kg) = 11450
        //   Allocate P2 (10 units):
        //     - WH2 (NY) has 0. Try WH1 (LA).
        //     - WH1 (LA) has 100. Takes 10 from WH1. Cost: Math.ceil(10 * 0.5kg * 2802c/kg) = 14010
        // Total Shipping: 11450 + 14010 = 25460 cents
        expect(orderInDb?.shippingCostCents).toBe(25460);

        // Verify Order Lines
        expect(await getOrderLineCount(MOCK_ORDER_ID)).toBe(2); // 2 lines, one for P1 from WH2, one for P2 from WH1

        // Verify Inventory Update
        expect(await getInventoryQuantity(product1.id, warehouse1.id)).toBe(10); // Unchanged
        expect(await getInventoryQuantity(product1.id, warehouse2.id)).toBe(5 - 2); // 2 P1 from WH2
        expect(await getInventoryQuantity(product2.id, warehouse1.id)).toBe(100 - 10); // 10 P2 from WH1

        // Verify Inventory Log
        const logs = await findInventoryLogByRefId(MOCK_ORDER_ID);
        expect(logs.length).toBe(2);
        expect(logs.some(l => l.productId === product1.id && l.warehouseId === warehouse2.id && l.quantityChange === -2)).toBe(true);
        expect(logs.some(l => l.productId === product2.id && l.warehouseId === warehouse1.id && l.quantityChange === -10)).toBe(true);
    });

    it('should throw InsufficientInventoryError if stock is too low', async () => {
        const request: CreateOrderRequest = {
            shippingAddress: customerShippingAddress,
            requestedProducts: [
                { productId: product1.id, quantity: 50 }, // Not enough
            ],
        };

        await expect(orderService.createWalkInOrder(request))
            .rejects.toThrow(InsufficientInventoryError);

        // Verify no order created
        expect(await getOrderCount(MOCK_ORDER_ID)).toBe(0);
        // Verify inventory unchanged from initial seed for product1
        expect(await getInventoryQuantity(product1.id, warehouse1.id)).toBe(10);
        expect(await getInventoryQuantity(product1.id, warehouse2.id)).toBe(5);
    });

    it('should throw ShippingCostExceededError if shipping costs are too high', async () => {
        jest.resetModules(); // Reset modules to re-import config with new env vars
        process.env.SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE = '1'; // Set to 1% (very low)
        // Re-require or re-import orderService if config is deeply embedded.
        // The service itself imports config.
        const orderServiceWithNewConfig = require('../../../src/services/orderService');


        const request: CreateOrderRequest = {
            shippingAddress: customerShippingAddress, // Chicago
            requestedProducts: [
                // Request 1 TV. Cost 100000. Discount 0. Max shipping = 1% of 100000 = 1000 cents.
                // Shipping from WH2 (NY) to Chicago: 1 TV * 5kg * 1150c/kg = 5750 cents.
                // 5750 > 1000, so should fail.
                { productId: product1.id, quantity: 1 },
            ],
        };

        await expect(orderServiceWithNewConfig.createWalkInOrder(request))
            .rejects.toThrow(ShippingCostExceededError);

        // Verify no order created
        expect(await getOrderCount(MOCK_ORDER_ID)).toBe(0);
        // Verify inventory unchanged for product1
        expect(await getInventoryQuantity(product1.id, warehouse1.id)).toBe(10);
        expect(await getInventoryQuantity(product1.id, warehouse2.id)).toBe(5);
    });

    it('should throw ProductNotFoundError if a product ID is invalid', async () => {
        const request: CreateOrderRequest = {
            shippingAddress: customerShippingAddress,
            requestedProducts: [
                { productId: 'invalid-product-id-format', quantity: 1 }, // Invalid format
            ],
        };
        // This error comes from productRepository.calculateProductCostsWithDiscounts if ID not found.
        // If the ID format is invalid for UUID, Zod would catch it at route level (not tested here).
        // This tests if product repo throws if UUID is valid but product doesn't exist.

        // For this to be caught by ProductNotFoundError, the UUID must be valid format but not exist.
        const nonExistentValidUuid = '123e4567-e89b-12d3-a456-426614174000';
        const requestWithNonExistentProduct: CreateOrderRequest = {
            shippingAddress: customerShippingAddress,
            requestedProducts: [
                { productId: nonExistentValidUuid, quantity: 1 },
            ],
        }

        await expect(orderService.createWalkInOrder(requestWithNonExistentProduct))
            .rejects.toThrow(ProductNotFoundError);

        expect(await getOrderCount(MOCK_ORDER_ID)).toBe(0);
    });


    it('should handle transaction rollback on error during inventory update', async () => {
        // This test ensures that if an error occurs *after some operations but before commit*,
        // the whole transaction is rolled back.
        // We can mock a repository function called late in the process to throw an error.

        const inventoryRepo = require('../../../src/repositories/inventoryRepository');
        const originalUpdateInventory = inventoryRepo.updateInventoryAndLogChanges;
        inventoryRepo.updateInventoryAndLogChanges = jest.fn().mockImplementationOnce(async () => {
            // Simulate some successful DB writes for order/orderlines if they happened before inventory update mock
            // For this test, assume order/orderlines are created *before* inventory update is called to fail
            // Order of operations in service:
            // 1. calc costs (reads)
            // 2. TX start
            // 3. getInventoryForProducts (reads, locks)
            // 4. getReservedInventory (reads)
            // 5. performInventoryAllocation (logic)
            // 6. calc shipping, check validity
            // 7. inventoryRepository.updateInventoryAndLogChanges  <-- MOCK THIS TO FAIL
            // 8. orderRepository.createOrderAndLines
            // If (7) fails, (8) should not run, and TX should roll back.

            // So, if updateInventoryAndLogChanges itself throws, Drizzle handles rollback.
            throw new Error("Simulated DB error during inventory update");
        });

        const request: CreateOrderRequest = {
            shippingAddress: customerShippingAddress,
            requestedProducts: [{ productId: product1.id, quantity: 1 }],
        };

        await expect(orderService.createWalkInOrder(request))
            .rejects.toThrow("Simulated DB error during inventory update");

        // Verify DB state is rolled back
        expect(await getOrderCount(MOCK_ORDER_ID)).toBe(0);
        expect(await getOrderLineCount(MOCK_ORDER_ID)).toBe(0);
        expect(await getInventoryQuantity(product1.id, warehouse1.id)).toBe(10); // Should be initial value
        expect(await getInventoryQuantity(product1.id, warehouse2.id)).toBe(5);  // Should be initial value
        expect((await findInventoryLogByRefId(MOCK_ORDER_ID)).length).toBe(0);

        // Restore original function
        inventoryRepo.updateInventoryAndLogChanges = originalUpdateInventory;
    });
});