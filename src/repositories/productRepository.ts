import { db } from '../db/client';
import {products, volumeDiscounts} from '../db/schema';
import {inArray} from "drizzle-orm";

export interface ProductQuantityRequest {
    productId: string;
    quantity: number;
}

export interface ProductPricingResult extends ProductQuantityRequest {
    unitPriceCents: number;
    weightGrams: number;
    discountPercentage: number;
}

export class ProductRepository {
    /**
     * Calculate product pricing with appropriate volume discounts
     * @param productRequests Array of product IDs and quantities
     * @returns Array of products with pricing information
     */
    async calculateProductPricing(
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
            .orderBy(volumeDiscounts.threshold); // Sort by threshold ascending

        // Group discounts by product ID
        const discountsByProduct = allDiscounts.reduce((acc, discount) => {
            if (!acc[discount.productId]) {
                acc[discount.productId] = [];
            }
            acc[discount.productId].push(discount);
            return acc;
        }, {} as Record<string, typeof allDiscounts>);

        // Calculate final pricing for each requested product+quantity
        return productRequests.map(productRequest => {
            const productDetail = productDetailsMap.get(productRequest.productId);

            if (!productDetail) {
                throw new Error(`Product not found: ${productRequest.productId}`);
            }

            // Find the applicable discount
            const discounts = discountsByProduct[productRequest.productId] || [];
            let discountPercentage = 0;

            // Iterate backwards through discounts to find highest applicable threshold
            // (we know they're sorted by threshold ascending)
            for (let i = discounts.length - 1; i >= 0; i--) {
                if (productRequest.quantity >= discounts[i].threshold) {
                    discountPercentage = Number(discounts[i].discountPercentage);
                    break;
                }
            }

            return {
                productId: productRequest.productId,
                quantity: productRequest.quantity,
                unitPriceCents: productDetail.unitPriceCents,
                weightGrams: productDetail.weightGrams,
                discountPercentage,
            };
        });
    }
}

// Export a singleton instance for use throughout the application
export const productRepository = new ProductRepository();