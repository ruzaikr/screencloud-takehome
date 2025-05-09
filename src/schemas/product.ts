import { z } from 'zod';

export const ProductSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    unitPriceCents: z.number().int().nonnegative(),
    weightGrams: z.number().int().nonnegative(),
});

export type Product = z.infer<typeof ProductSchema>;

export const GetProductsResponseSchema = z.array(ProductSchema);
export type GetProductsResponse = z.infer<typeof GetProductsResponseSchema>;
