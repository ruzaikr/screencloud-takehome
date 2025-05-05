import { db } from '../db/client';
import { products, volumeDiscounts } from '../db/schema';
import {inArray} from "drizzle-orm";

export interface ProductQuantityRequest {
    productId: string;
    quantity: number;
}

export interface ProductPricingResult extends ProductQuantityRequest {
    unitPriceCents: number;
    weightGrams: number;
    discountPercentage: number;
    totalDiscountedPriceCents: number;
}

/**
 * Calculate the applicable discount percentage for a product based on quantity
 * @param quantity The requested quantity
 * @param productDiscounts Array of volume discounts for the product
 * @returns The applicable discount percentage
 */
function calculateDiscountPercentage(
    quantity: number,
    productDiscounts: typeof volumeDiscounts.$inferSelect[]
): number {
    if (!productDiscounts.length) {
        return 0;
    }

    // Sort discounts by threshold in descending order
    const sortedDiscounts = [...productDiscounts].sort(
        (a, b) => b.threshold - a.threshold
    );

    // Find the first discount where quantity meets or exceeds the threshold
    const applicableDiscount = sortedDiscounts.find(
        discount => quantity >= discount.threshold
    );

    return applicableDiscount ? Number(applicableDiscount.discountPercentage) : 0;
}

/**
 * Calculate product pricing with appropriate volume discounts
 * @param productRequests Array of product IDs and quantities
 * @returns Array of products with pricing information
 */
export async function calculateProductPricing(
    productRequests: ProductQuantityRequest[]
): Promise<ProductPricingResult[]> {
    if (!productRequests.length) {
        return [];
    }

    // Get unique product IDs to query
    const productIds = [...new Set(productRequests.map(req => req.productId))];

    // Fetch product details
    const productDetails = await db
        .select({
            id: products.id,
            unitPriceCents: products.unitPriceCents,
            weightGrams: products.weightGrams,
        })
        .from(products)
        .where(inArray(products.id, productIds));

    // Create a lookup map for quick access
    const productDetailsMap = new Map(
        productDetails.map(p => [p.id, p])
    );

    // Fetch all volume discounts for these products
    const allDiscounts = await db
        .select()
        .from(volumeDiscounts)
        .where(inArray(volumeDiscounts.productId, productIds))

    // Group discounts by product ID
    const discountsByProduct = allDiscounts.reduce((acc, discount) => {
        if (!acc[discount.productId]) {
            acc[discount.productId] = [];
        }
        acc[discount.productId].push(discount);
        return acc;
    }, {} as Record<string, typeof allDiscounts>);

    // Calculate final pricing for each requested product+quantity
    return productRequests.map(req => {
        const productDetail = productDetailsMap.get(req.productId);

        if (!productDetail) {
            throw new Error(`Product not found: ${req.productId}`);
        }

        // Find the applicable discount
        const discounts = discountsByProduct[req.productId] || [];
        const discountPercentage = calculateDiscountPercentage(req.quantity, discounts);

        // Calculate the total discounted price
        const discountMultiplier = 1 - (discountPercentage / 100);
        const totalDiscountedPriceCents = Math.round(
            productDetail.unitPriceCents * req.quantity * discountMultiplier
        );

        return {
            productId: req.productId,
            quantity: req.quantity,
            unitPriceCents: productDetail.unitPriceCents,
            weightGrams: productDetail.weightGrams,
            discountPercentage,
            totalDiscountedPriceCents,
        };
    });
}