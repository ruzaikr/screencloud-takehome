import type { DatabaseExecutor } from '../db/client';
import { products, volumeDiscounts } from '../db/schema';
import { inArray, desc } from 'drizzle-orm';
import { OrderRequestedProduct  } from "../schemas/order";
import { ProductNotFoundError } from '../errors/customErrors';
import type { Product } from '../schemas/product';

/**
 * Represents the calculated cost details for a product, including discounts.
 */
export interface ProductCostDetails {
    /** The quantity of the product that was requested and used for these calculations. */
    requestedQuantity: number;
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
 * @param items An array of OrderRequestedProduct objects, each specifying a productId and quantity.
 * @returns A Promise resolving to a Map where keys are productIds and values are
 *          ProductCostDetails objects.
 * @throws ProductNotFoundError if any productId in the input items does not correspond to an existing product.
 */
export async function calculateProductCostsWithDiscounts(
    dbx: DatabaseExecutor,
    items: OrderRequestedProduct[]
): Promise<Map<string, ProductCostDetails>> {
    if (!items || items.length === 0) {
        return new Map();
    }

    const productIds = items.map(item => item.productId);
    const uniqueProductIds = [...new Set(productIds)];

    if (uniqueProductIds.length === 0) {
        return new Map();
    }

    const fetchedProducts = await dbx
        .select({
            id: products.id,
            unitPriceCents: products.unitPriceCents,
            weightGrams: products.weightGrams,
        })
        .from(products)
        .where(inArray(products.id, uniqueProductIds));

    const productDataMap = new Map(
        fetchedProducts.map(p => [
            p.id,
            { unitPriceCents: p.unitPriceCents, weightGrams: p.weightGrams },
        ])
    );

    // Check if all requested product IDs were found
    for (const item of items) {
        if (!productDataMap.has(item.productId)) {
            throw new ProductNotFoundError(item.productId);
        }
    }

    const fetchedDiscounts = await dbx
        .select({
            productId: volumeDiscounts.productId,
            threshold: volumeDiscounts.threshold,
            discountPercentage: volumeDiscounts.discountPercentage,
        })
        .from(volumeDiscounts)
        .where(inArray(volumeDiscounts.productId, uniqueProductIds))
        .orderBy(desc(volumeDiscounts.threshold));

    const productDiscountsMap = new Map<string, Array<{ threshold: number; discountPercentage: string }>>();
    for (const discount of fetchedDiscounts) {
        if (!productDiscountsMap.has(discount.productId)) {
            productDiscountsMap.set(discount.productId, []);
        }
        productDiscountsMap.get(discount.productId)!.push({
            threshold: discount.threshold,
            discountPercentage: discount.discountPercentage
        });
    }

    const resultsMap = new Map<string, ProductCostDetails>();
    for (const item of items) {
        const productInfo = productDataMap.get(item.productId);

        // This check is now redundant due to the earlier check, but kept for safety/clarity if logic changes.
        // It should ideally not be reached if the previous check is in place.
        if (!productInfo) {
            // Should have been caught by the check after fetching products
            throw new ProductNotFoundError(item.productId);
        }

        const { unitPriceCents, weightGrams } = productInfo;
        const requestedQuantity = item.quantity;

        let appliedDiscountPercentageValue = 0.0;
        const discountsForProduct = productDiscountsMap.get(item.productId) || [];

        for (const vd of discountsForProduct) {
            if (requestedQuantity >= vd.threshold) {
                appliedDiscountPercentageValue = parseFloat(vd.discountPercentage);
                break;
            }
        }

        const totalProductCostCents = unitPriceCents * requestedQuantity;
        const totalDiscountCents = Math.round(
            totalProductCostCents * (appliedDiscountPercentageValue / 100)
        );
        const totalDiscountedProductCostCents = totalProductCostCents - totalDiscountCents;

        const costDetails: ProductCostDetails = {
            requestedQuantity,
            unitPriceCents,
            weightGrams,
            discountPercentage: appliedDiscountPercentageValue,
            totalProductCostCents,
            totalDiscountCents,
            totalDiscountedProductCostCents,
        };
        resultsMap.set(item.productId, costDetails);
    }

    return resultsMap;
}


/**
 * Retrieves all products from the database.
 *
 * @param dbx The Drizzle database executor (db or tx).
 * @returns A Promise resolving to an array of Product objects.
 */
export async function getAllProducts(dbx: DatabaseExecutor): Promise<Product[]> {
    const result = await dbx
        .select({
            id: products.id,
            name: products.name,
            unitPriceCents: products.unitPriceCents,
            weightGrams: products.weightGrams,
        })
        .from(products);
    return result;
}
