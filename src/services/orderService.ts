import { db } from '../db/client';
import {
    orders,
    orderLines,
    inventory,
    inventoryLog
} from '../db/schema';
import { getInventoryForProducts, ProductInventoryByWarehouse } from '../repositories/inventoryRepository';
import { calculateProductCostsWithDiscounts, ProductCostDetails, ProductQuantityInput } from '../repositories/productRepository';
import { getReservedQuantitiesByWarehouse, ReservationsByWarehouse } from '../repositories/reservationRepository';
import { getWarehousesSortedByShippingCost, WarehouseShippingInfo } from '../repositories/warehouseRepository';
import { eq, and } from 'drizzle-orm';

// Define Quote interface for order pricing
export interface Quote {
    totalPriceCents: number;
    totalDiscountCents: number;
    totalShippingCostCents: number;
    totalOrderCostCents: number; // This is the final cost with shipping included
}

// Define Allocation interface for inventory allocation
export interface Allocation {
    productId: string;
    warehouseId: string;
    quantity: number;
}

// Define the order request interface
export interface OrderRequest {
    productRequests: ProductQuantityInput[];
    shippingAddrLatitude: number;
    shippingAddrLongitude: number;
    salesRepReference?: string;
    customerReference?: string;
}

// Define the order creation result
export interface OrderCreationResult {
    orderId: string;
    quote: Quote;
    allocations: Allocation[];
}

/**
 * Creates an order based on the product quantities, shipping location, and optional references
 * @param orderRequest The order request containing product quantities and shipping information
 * @returns The created order details including pricing and allocations
 */
export async function createOrder(orderRequest: OrderRequest): Promise<OrderCreationResult> {
    const {
        productRequests,
        shippingAddrLatitude,
        shippingAddrLongitude,
        salesRepReference,
        customerReference
    } = orderRequest;

    // Validate input
    if (!productRequests.length) {
        throw new Error('Order must contain at least one product');
    }

    // Step 1: Get product pricing information
    const productIds = productRequests.map(req => req.productId);
    const productPricing = await calculateProductCostsWithDiscounts(productRequests);

    // Step 2: Get warehouse shipping costs sorted by cost
    const warehouseShippingCosts = await getWarehousesSortedByShippingCost(
        shippingAddrLatitude,
        shippingAddrLongitude
    );

    // Step 3: Get available inventory for these products
    const warehouseInventory = await getInventoryForProducts(productIds);

    // Step 4: Get reserved quantities for these products
    const reservedQuantities = await getReservedQuantitiesByWarehouse(productIds);

    // Step 5: Allocate inventory and calculate shipping costs
    const { allocations, totalShippingCostCents } = allocateInventory(
        productPricing,
        warehouseShippingCosts,
        warehouseInventory,
        reservedQuantities
    );

    // Ensure all products were allocated fully
    validateAllocations(productPricing, allocations);

    // Step 6: Calculate the final quote
    const quote = calculateQuote(productPricing, totalShippingCostCents);

    // Step 7: Create the order in a transaction to ensure consistency
    const orderId = await db.transaction(async (tx) => {
        // Insert the order
        const [createdOrder] = await tx
            .insert(orders)
            .values({
                shippingAddrLatitude: shippingAddrLatitude.toString(),
                shippingAddrLongitude: shippingAddrLongitude.toString(),
                totalPriceCents: quote.totalPriceCents,
                discountCents: quote.totalDiscountCents,
                shippingCostCents: quote.totalShippingCostCents,
                salesRepReference: salesRepReference || null,
                customerReference: customerReference || null,
            })
            .returning({ id: orders.id });

        // Insert the order lines
        await tx
            .insert(orderLines)
            .values(
                allocations.map(allocation => {
                    // Find the corresponding pricing info
                    const pricingInfo = productPricing.find(p => p.productId === allocation.productId);
                    const unitPriceCents = pricingInfo?.unitPriceCents || 0;
                    const discountPercentage = pricingInfo?.discountPercentage || 0; // This is a number

                    return {
                        orderId: createdOrder.id,
                        productId: allocation.productId,
                        warehouseId: allocation.warehouseId,
                        quantity: allocation.quantity,
                        unitPriceCents: unitPriceCents, // Stays as number (assuming the schema expects number/integer)
                        // Convert discountPercentage number to string
                        discountPercentage: discountPercentage.toString(),
                    };
                })
            );

        // Update the inventory for each allocation
        for (const allocation of allocations) {
            // Get current inventory
            const [currentInventory] = await tx
                .select({ quantity: inventory.quantity })
                .from(inventory)
                .where(
                    and(
                        eq(inventory.productId, allocation.productId),
                        eq(inventory.warehouseId, allocation.warehouseId)
                    )
                );

            if (!currentInventory) {
                throw new Error(`Inventory not found for product ${allocation.productId} in warehouse ${allocation.warehouseId}`);
            }

            // Calculate new quantity
            const newQuantity = currentInventory.quantity - allocation.quantity;

            // Update inventory
            await tx
                .update(inventory)
                .set({
                    quantity: newQuantity,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(inventory.productId, allocation.productId),
                        eq(inventory.warehouseId, allocation.warehouseId)
                    )
                );

            // Log the inventory change
            await tx
                .insert(inventoryLog)
                .values({
                    productId: allocation.productId,
                    warehouseId: allocation.warehouseId,
                    quantityChange: -allocation.quantity, // Negative for outgoing inventory
                    newQuantity,
                    changeType: 'ORDER_FULFILLMENT',
                    referenceId: createdOrder.id,
                });
        }

        // Return the created order ID
        return createdOrder.id;
    });

    // Return the final result
    return {
        orderId,
        quote,
        allocations,
    };
}

/**
 * Allocates inventory from warehouses based on shipping costs
 * @param productPricing Array of products with pricing information
 * @param warehouseShippingCosts Warehouses with shipping costs sorted by cost
 * @param warehouseInventory Available inventory by warehouse and product
 * @param reservedQuantities Reserved quantities by warehouse and product
 * @returns Allocations and total shipping cost
 */
function allocateInventory(
    productPricing: ProductCostDetails[],
    warehouseShippingCosts: WarehouseShippingInfo[],
    warehouseInventory: ProductInventoryByWarehouse,
    reservedQuantities: ReservationsByWarehouse
): { allocations: Allocation[], totalShippingCostCents: number } {
    const allocations: Allocation[] = [];
    let totalShippingCostCents = 0;

    // For each product in the order
    for (const product of productPricing) {
        let remainingQuantity = product.quantity;

        // Try to allocate from warehouses in order of shipping cost
        for (const warehouse of warehouseShippingCosts) {
            // Skip if already fulfilled
            if (remainingQuantity <= 0) break;

            const warehouseId = warehouse.warehouseId;

            // Get inventory in this warehouse for this product
            const availableInventory = warehouseInventory[warehouseId]?.[product.productId] || 0;

            // Get reserved quantity in this warehouse for this product
            const reservedQuantity = reservedQuantities[warehouseId]?.[product.productId] || 0;

            // Calculate real available inventory
            const realAvailableInventory = Math.max(0, availableInventory - reservedQuantity);

            // Skip if no inventory available
            if (realAvailableInventory <= 0) continue;

            // Determine how much to allocate from this warehouse
            const allocateQuantity = Math.min(remainingQuantity, realAvailableInventory);

            if (allocateQuantity > 0) {
                // Add allocation
                allocations.push({
                    productId: product.productId,
                    warehouseId,
                    quantity: allocateQuantity,
                });

                // Calculate shipping cost for this allocation
                const allocatedWeightKg = (product.weightGrams * allocateQuantity) / 1000;
                const shippingCost = Math.round(allocatedWeightKg * warehouse.shippingCostCentsPerKg);
                totalShippingCostCents += shippingCost;

                // Update remaining quantity
                remainingQuantity -= allocateQuantity;
            }
        }
    }

    return { allocations, totalShippingCostCents };
}

/**
 * Validates that all product quantities were fully allocated
 * @param productPricing Array of products with pricing information
 * @param allocations Array of inventory allocations
 */
function validateAllocations(
    productPricing: ProductCostDetails[],
    allocations: Allocation[]
): void {
    // Aggregate allocations by product
    const allocatedQuantities: Record<string, number> = {};

    for (const allocation of allocations) {
        if (!allocatedQuantities[allocation.productId]) {
            allocatedQuantities[allocation.productId] = 0;
        }
        allocatedQuantities[allocation.productId] += allocation.quantity;
    }

    // Validate each product was fully allocated
    for (const product of productPricing) {
        const allocatedQuantity = allocatedQuantities[product.productId] || 0;

        if (allocatedQuantity < product.quantity) {
            throw new Error(
                `Insufficient inventory for product ${product.productId}. ` +
                `Requested: ${product.quantity}, Available: ${allocatedQuantity}`
            );
        }
    }
}

/**
 * Calculates the final order quote including shipping
 * @param productPricing Array of products with pricing information
 * @param totalShippingCostCents Total shipping cost in cents
 * @returns The final quote
 */
function calculateQuote(
    productPricing: ProductCostDetails[],
    totalShippingCostCents: number
): Quote {
    // Sum up the pricing components
    let totalPriceCents = 0;
    let totalDiscountCents = 0;

    for (const product of productPricing) {
        totalPriceCents += product.totalPriceCents;
        totalDiscountCents += product.totalDiscountCents;
    }

    const totalDiscountedPriceCents = totalPriceCents - totalDiscountCents;
    const totalOrderCostCents = totalDiscountedPriceCents + totalShippingCostCents;

    return {
        totalPriceCents,
        totalDiscountCents,
        totalShippingCostCents,
        totalOrderCostCents,
    };
}

/**
 * Example usage:
 *
 * import { createOrder } from './orderService';
 *
 * const orderResult = await createOrder({
 *   productRequests: [
 *     { productId: 'product-uuid-1', quantity: 5 },
 *     { productId: 'product-uuid-2', quantity: 3 },
 *   ],
 *   shippingAddrLatitude: 37.7749,
 *   shippingAddrLongitude: -122.4194,
 *   salesRepReference: 'SR-12345',
 *   customerReference: 'CUST-6789',
 * });
 *
 * console.log(`Order created with ID: ${orderResult.orderId}`);
 * console.log(`Total order cost: ${orderResult.quote.totalOrderCostCents / 100}`);
 */