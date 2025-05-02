import { z } from "zod";

export const OrderRequest = z.object({
    shippingAddress: z.object({ latitude: z.number(), longitude: z.number() }),
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
})

export type OrderRequest = z.infer<typeof OrderRequest>;