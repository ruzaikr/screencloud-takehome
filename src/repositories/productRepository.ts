import type { DatabaseExecutor } from '../db/client';
import { products, volumeDiscounts } from '../db/schema';
import { inArray, desc } from 'drizzle-orm';

/**
 * Represents an item in the input, specifying a product and its quantity.
 */
export interface ProductQuantityInput {
    productId: string;
    quantity: number;
}

/**
 * Represents the calculated cost details for a product, including discounts.
 */
export interface ProductCostDetails {
    /** The base price per unit for the product, in cents. */
    unitPriceCents: number;
    /** The weight of a single unit of the product, in grams. */
    weightGrams: number;
    /**
     * The percentage discount applied based on the quantity.
     * E.g., 15.00 for a 15% discount. This is a numeric value.
     */
    discountPercentage: number;
    /** The total cost for the given quantity of the product, before any discounts, in cents. */
    totalProductCostCents: number;
    /** The total amount of discount applied for the given quantity, in cents. */
    totalDiscountCents: number;
    /** The final cost for the given quantity of the product after discount, in cents. */
    totalDiscountedProductCostCents: number;
}

/**
 * Calculates the cost details for a list of products and their quantities,
 * applying the best available volume discount for each product.
 * This function can operate with either a main DB connection or a transaction.
 *
 * @param dbx The Drizzle database executor (db or tx).
 * @param items An array of ProductQuantityInput objects, each specifying a productId and quantity.
 * @returns A Promise resolving to an array of ProductCostDetails objects,
 *          corresponding to each input item.
 * @throws Error if any productId in the input items does not correspond to an existing product.
 */
export async function calculateProductCostsWithDiscounts(
    dbx: DatabaseExecutor,
    items: ProductQuantityInput[]
): Promise<ProductCostDetails[]> {
    if (!items || items.length === 0) {
        return [];
    }

    const productIds = items.map(item => item.productId);
    // Use a Set to get unique product IDs for efficient fetching
    const uniqueProductIds = [...new Set(productIds)];

    // Defensive check, though covered by the first items.length check if productIds must be non-empty
    if (uniqueProductIds.length === 0) {
        return [];
    }

    // 1. Fetch product base details (price, weight)
    const fetchedProducts = await dbx
        .select({
            id: products.id,
            unitPriceCents: products.unitPriceCents,
            weightGrams: products.weightGrams,
        })
        .from(products)
        .where(inArray(products.id, uniqueProductIds));

    // Store product data in a Map for quick lookup: Map<productId, {unitPriceCents, weightGrams}>
    const productDataMap = new Map(
        fetchedProducts.map(p => [
            p.id,
            { unitPriceCents: p.unitPriceCents, weightGrams: p.weightGrams },
        ])
    );

    // 2. Fetch all relevant volume discounts for these products
    // Order by threshold descending to easily find the best applicable discount later
    const fetchedDiscounts = await dbx
        .select({
            productId: volumeDiscounts.productId,
            threshold: volumeDiscounts.threshold,
            discountPercentage: volumeDiscounts.discountPercentage, // This is a string from DB, e.g., "15.00"
        })
        .from(volumeDiscounts)
        .where(inArray(volumeDiscounts.productId, uniqueProductIds))
        .orderBy(desc(volumeDiscounts.threshold)); // Crucial: highest thresholds first globally

    // Group discounts by productId. The discounts for each product will be sorted by threshold descending.
    // Map<productId, Array<{threshold, discountPercentage}>>
    const productDiscountsMap = new Map<string, Array<{ threshold: number; discountPercentage: string }>>();
    for (const discount of fetchedDiscounts) {
        if (!productDiscountsMap.has(discount.productId)) {
            productDiscountsMap.set(discount.productId, []);
        }
        // Since fetchedDiscounts is sorted by threshold DESC globally,
        // pushing them into product-specific arrays preserves this order for each product's list of discounts.
        productDiscountsMap.get(discount.productId)!.push({
            threshold: discount.threshold,
            discountPercentage: discount.discountPercentage // Keep as string initially
        });
    }

    // 3. Process each input item to calculate costs and apply discounts
    const results: ProductCostDetails[] = [];
    for (const item of items) {
        const productInfo = productDataMap.get(item.productId);

        if (!productInfo) {
            // If a product ID from input is not found, it's an error condition.
            // This indicates invalid input or a data integrity issue.
            throw new Error(`Product details not found for productId: ${item.productId}. Ensure all product IDs are valid.`);
        }

        const { unitPriceCents, weightGrams } = productInfo;
        const quantity = item.quantity;

        let appliedDiscountPercentageValue = 0.0; // Default to 0% discount

        const discountsForProduct = productDiscountsMap.get(item.productId) || [];

        // Find the best applicable discount for the current product and quantity.
        // Discounts for this product are already sorted by threshold in descending order.
        for (const vd of discountsForProduct) {
            if (quantity >= vd.threshold) {
                // vd.discountPercentage is a string like "15.00", parse it to a number for calculation.
                appliedDiscountPercentageValue = parseFloat(vd.discountPercentage);
                break; // Found the highest threshold discount that applies, so stop.
            }
        }

        // Calculate costs
        const totalProductCostCents = unitPriceCents * quantity;

        // Apply discount. Ensure discount calculation is done carefully.
        // The discount percentage is used as a float (e.g., 15.0 for 15%).
        // Result is rounded to the nearest cent.
        const totalDiscountCents = Math.round(
            totalProductCostCents * (appliedDiscountPercentageValue / 100)
        );

        const totalDiscountedProductCostCents = totalProductCostCents - totalDiscountCents;

        results.push({
            unitPriceCents,
            weightGrams,
            discountPercentage: appliedDiscountPercentageValue, // Store as a number (e.g., 15.0 or 15.25)
            totalProductCostCents,
            totalDiscountCents,
            totalDiscountedProductCostCents,
        });
    }

    return results;
}