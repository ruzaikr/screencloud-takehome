import {
    calculateOverallProductTotals,
    performInventoryAllocation,
    calculateTotalShippingCost,
    isShippingCostValid,
    prepareOrderCreationData,
    InventoryAllocationError,
} from './helpers';
import type { ProductCostDetails } from '../../repositories/productRepository';
import type { WarehouseShippingInfo } from '../../repositories/warehouseRepository';
import type { ProductInventoryByWarehouse } from '../../repositories/inventoryRepository';
import type { ReservedInventoryByWarehouse } from '../../repositories/reservationRepository';
import type { CreateOrderParams, OrderLineData } from '../../repositories/orderRepository';

describe('Shared Service Helpers', () => {
    describe('calculateOverallProductTotals', () => {
        it('should return 0 for totals if the map is empty', () => {
            const productDetailsMap = new Map<string, ProductCostDetails>();
            const totals = calculateOverallProductTotals(productDetailsMap);
            expect(totals.overallTotalPriceCents).toBe(0);
            expect(totals.overallTotalDiscountCents).toBe(0);
        });

        it('should correctly sum total prices and discounts from multiple products', () => {
            const productDetailsMap = new Map<string, ProductCostDetails>([
                ['prod1', {
                    requestedQuantity: 1, unitPriceCents: 1000, weightGrams: 100, discountPercentage: 0,
                    totalProductCostCents: 1000, totalDiscountCents: 0, totalDiscountedProductCostCents: 1000
                }],
                ['prod2', {
                    requestedQuantity: 2, unitPriceCents: 500, weightGrams: 50, discountPercentage: 10,
                    totalProductCostCents: 1000, totalDiscountCents: 100, totalDiscountedProductCostCents: 900
                }],
            ]);
            const totals = calculateOverallProductTotals(productDetailsMap);
            expect(totals.overallTotalPriceCents).toBe(2000);
            expect(totals.overallTotalDiscountCents).toBe(100);
        });
    });

    describe('performInventoryAllocation', () => {
        const productDetailsMap: Map<string, ProductCostDetails> = new Map([
            ['prod1', { requestedQuantity: 10, unitPriceCents: 100, weightGrams: 100, discountPercentage: 0, totalProductCostCents: 1000, totalDiscountCents: 0, totalDiscountedProductCostCents: 1000 }],
            ['prod2', { requestedQuantity: 5, unitPriceCents: 200, weightGrams: 200, discountPercentage: 10, totalProductCostCents: 1000, totalDiscountCents: 100, totalDiscountedProductCostCents: 900 }],
        ]);

        const sortedWarehouses: WarehouseShippingInfo[] = [
            { warehouseId: 'wh1', shippingCostCentsPerKg: 100 },
            { warehouseId: 'wh2', shippingCostCentsPerKg: 200 },
        ];

        it('should allocate from single warehouse if sufficient inventory', () => {
            const currentInventory: ProductInventoryByWarehouse = {
                'wh1': { 'prod1': 15, 'prod2': 10 },
            };
            const reservedInventory: ReservedInventoryByWarehouse = {};

            const result = performInventoryAllocation(productDetailsMap, sortedWarehouses, currentInventory, reservedInventory);

            expect(result.allocatedOrderLines).toHaveLength(2);
            expect(result.allocatedOrderLines.find(l => l.productId === 'prod1')?.allocatedQuantity).toBe(10);
            expect(result.allocatedOrderLines.find(l => l.productId === 'prod1')?.warehouseId).toBe('wh1');
            expect(result.allocatedOrderLines.find(l => l.productId === 'prod2')?.allocatedQuantity).toBe(5);
            expect(result.allocatedOrderLines.find(l => l.productId === 'prod2')?.warehouseId).toBe('wh1');

            expect(result.inventoryUpdates).toHaveLength(2);
            expect(result.inventoryUpdates.find(u => u.productId === 'prod1')?.quantityToDecrement).toBe(10);
            expect(result.inventoryUpdates.find(u => u.productId === 'prod2')?.quantityToDecrement).toBe(5);
        });

        it('should allocate from multiple warehouses respecting sort order', () => {
            const currentInventory: ProductInventoryByWarehouse = {
                'wh1': { 'prod1': 7, 'prod2': 2 },
                'wh2': { 'prod1': 8, 'prod2': 10 },
            };
            const reservedInventory: ReservedInventoryByWarehouse = {};
            const result = performInventoryAllocation(productDetailsMap, sortedWarehouses, currentInventory, reservedInventory);

            // Prod1: req 10. wh1 has 7, wh2 has 8. -> 7 from wh1, 3 from wh2
            // Prod2: req 5.  wh1 has 2, wh2 has 10. -> 2 from wh1, 3 from wh2
            const prod1Allocations = result.allocatedOrderLines.filter(l => l.productId === 'prod1');
            expect(prod1Allocations).toHaveLength(2);
            expect(prod1Allocations.find(l => l.warehouseId === 'wh1')?.allocatedQuantity).toBe(7);
            expect(prod1Allocations.find(l => l.warehouseId === 'wh2')?.allocatedQuantity).toBe(3);

            const prod2Allocations = result.allocatedOrderLines.filter(l => l.productId === 'prod2');
            expect(prod2Allocations).toHaveLength(2);
            expect(prod2Allocations.find(l => l.warehouseId === 'wh1')?.allocatedQuantity).toBe(2);
            expect(prod2Allocations.find(l => l.warehouseId === 'wh2')?.allocatedQuantity).toBe(3);

            expect(result.inventoryUpdates.find(u => u.productId === 'prod1' && u.warehouseId === 'wh1')?.quantityToDecrement).toBe(7);
            expect(result.inventoryUpdates.find(u => u.productId === 'prod1' && u.warehouseId === 'wh2')?.quantityToDecrement).toBe(3);
        });

        it('should consider reserved inventory when allocating', () => {
            const currentInventory: ProductInventoryByWarehouse = {
                'wh1': { 'prod1': 15 }, // Total 15
            };
            const reservedInventory: ReservedInventoryByWarehouse = {
                'wh1': { 'prod1': 8 }, // 8 reserved, so 7 available
            };
            const singleProductMap: Map<string, ProductCostDetails> = new Map([
                ['prod1', { requestedQuantity: 10, unitPriceCents: 100, weightGrams: 100, discountPercentage: 0, totalProductCostCents: 1000, totalDiscountCents: 0, totalDiscountedProductCostCents: 1000 }],
            ]);

            // Request 10, 15 physical, 8 reserved -> 7 available. Should throw.
            expect(() => performInventoryAllocation(singleProductMap, sortedWarehouses, currentInventory, reservedInventory))
                .toThrow(new InventoryAllocationError('Insufficient inventory for product ID prod1. Requested: 10, Available (after reservations): 7.'));

            // Request 7, should be fine
            const satisfiableRequestMap: Map<string, ProductCostDetails> = new Map([
                ['prod1', { requestedQuantity: 7, unitPriceCents: 100, weightGrams: 100, discountPercentage: 0, totalProductCostCents: 700, totalDiscountCents: 0, totalDiscountedProductCostCents: 700 }],
            ]);
            const result = performInventoryAllocation(satisfiableRequestMap, sortedWarehouses, currentInventory, reservedInventory);
            expect(result.allocatedOrderLines.find(l=>l.productId === 'prod1')?.allocatedQuantity).toBe(7);
        });

        it('should throw InventoryAllocationError if inventory is insufficient', () => {
            const currentInventory: ProductInventoryByWarehouse = {
                'wh1': { 'prod1': 5 }, // Only 5 available for prod1 (requests 10)
            };
            const reservedInventory: ReservedInventoryByWarehouse = {};

            expect(() => performInventoryAllocation(productDetailsMap, sortedWarehouses, currentInventory, reservedInventory))
                .toThrow(InventoryAllocationError);
            expect(() => performInventoryAllocation(productDetailsMap, sortedWarehouses, currentInventory, reservedInventory))
                .toThrow('Insufficient inventory for product ID prod1. Requested: 10, Available (after reservations): 5.');
        });

        it('should handle empty sortedWarehouses gracefully (leading to insufficient inventory)', () => {
            const currentInventory: ProductInventoryByWarehouse = { 'wh1': { 'prod1': 100 }};
            const emptyWarehouses: WarehouseShippingInfo[] = [];
            expect(() => performInventoryAllocation(productDetailsMap, emptyWarehouses, currentInventory, {}))
                .toThrow(new InventoryAllocationError('Insufficient inventory for product ID prod1. Requested: 10, Available (after reservations): 0.'));
        });

        it('should handle product not in any warehouse (leading to insufficient inventory)', () => {
            const currentInventory: ProductInventoryByWarehouse = { 'wh1': { 'prodX': 100 }}; // prod1, prod2 not here
            expect(() => performInventoryAllocation(productDetailsMap, sortedWarehouses, currentInventory, {}))
                .toThrow(new InventoryAllocationError('Insufficient inventory for product ID prod1. Requested: 10, Available (after reservations): 0.'));
        });
    });

    describe('calculateTotalShippingCost', () => {
        it('should return 0 for no allocated lines', () => {
            expect(calculateTotalShippingCost([])).toBe(0);
        });

        it('should correctly calculate and sum shipping costs, rounding up cents', () => {
            const allocatedOrderLines = [
                { // 1 item * 500g = 0.5kg. 0.5kg * 100 cents/kg = 50 cents
                    productId: 'p1', warehouseId: 'w1', allocatedQuantity: 1, unitPriceCents: 0, discountPercentage: 0,
                    productWeightGrams: 500, shippingCostCentsPerKg: 100
                },
                { // 2 items * 300g = 0.6kg. 0.6kg * 150 cents/kg = 90 cents
                    productId: 'p2', warehouseId: 'w1', allocatedQuantity: 2, unitPriceCents: 0, discountPercentage: 0,
                    productWeightGrams: 300, shippingCostCentsPerKg: 150
                },
                { // 1 item * 123g = 0.123kg. 0.123kg * 100 cents/kg = 12.3 cents -> Math.ceil -> 13 cents
                    productId: 'p3', warehouseId: 'w2', allocatedQuantity: 1, unitPriceCents: 0, discountPercentage: 0,
                    productWeightGrams: 123, shippingCostCentsPerKg: 100
                }
            ];
            expect(calculateTotalShippingCost(allocatedOrderLines)).toBe(50 + 90 + 13); // 153
        });
    });

    describe('isShippingCostValid', () => {
        // Max allowed is 15% of (totalPrice - totalDiscount)
        it('should return true if shipping cost is below limit', () => {
            // Discounted price = 1000 - 100 = 900. 15% of 900 = 135.
            expect(isShippingCostValid(130, 1000, 100)).toBe(true);
        });

        it('should return true if shipping cost is at the limit', () => {
            expect(isShippingCostValid(135, 1000, 100)).toBe(true);
        });

        it('should return false if shipping cost is above limit', () => {
            expect(isShippingCostValid(136, 1000, 100)).toBe(false);
        });

        it('should handle zero discounted price: true if shipping is also zero', () => {
            expect(isShippingCostValid(0, 100, 100)).toBe(true); // 100-100=0. Shipping 0 is ok.
        });
        it('should handle zero discounted price: false if shipping is non-zero', () => {
            expect(isShippingCostValid(1, 100, 100)).toBe(false); // 100-100=0. Shipping 1 is not ok.
        });
        it('should handle negative discounted price (e.g. discount > price): true if shipping is also zero', () => {
            expect(isShippingCostValid(0, 100, 200)).toBe(true); // 100-200 = -100. Shipping 0 is ok.
        });
    });

    describe('prepareOrderCreationData', () => {
        it('should correctly map data to order header and line items', () => {
            const orderId = 'test-order-id';
            const shippingLat = 40.123;
            const shippingLng = -70.456;
            const overallTotalPriceCents = 2000;
            const overallTotalDiscountCents = 200;
            const totalShippingCostCents = 150;
            const allocatedOrderLines = [
                { productId: 'p1', warehouseId: 'w1', allocatedQuantity: 2, unitPriceCents: 500, discountPercentage: 10, productWeightGrams: 100, shippingCostCentsPerKg: 50 },
                { productId: 'p2', warehouseId: 'w2', allocatedQuantity: 1, unitPriceCents: 1000, discountPercentage: 0, productWeightGrams: 200, shippingCostCentsPerKg: 70 },
            ];

            const { orderHeaderParams, orderLineItemsData } = prepareOrderCreationData(
                orderId, shippingLat, shippingLng, overallTotalPriceCents, overallTotalDiscountCents, totalShippingCostCents, allocatedOrderLines
            );

            const expectedOrderHeaderParams: CreateOrderParams = {
                orderId,
                shippingAddrLatitude: shippingLat,
                shippingAddrLongitude: shippingLng,
                totalPriceCents: overallTotalPriceCents,
                discountCents: overallTotalDiscountCents,
                shippingCostCents: totalShippingCostCents,
            };
            expect(orderHeaderParams).toEqual(expectedOrderHeaderParams);

            const expectedOrderLineItemsData: OrderLineData[] = [
                { productId: 'p1', warehouseId: 'w1', quantity: 2, unitPriceCents: 500, discountPercentage: 10 },
                { productId: 'p2', warehouseId: 'w2', quantity: 1, unitPriceCents: 1000, discountPercentage: 0 },
            ];
            expect(orderLineItemsData).toEqual(expectedOrderLineItemsData);
        });
    });
});