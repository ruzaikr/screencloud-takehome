import { z } from "zod";

export const productQuantityRequestSchema = z.object({
    productId: z.string().uuid({ message: "Product ID must be a valid UUID" }),
    quantity: z.number().int().positive({ message: "Quantity must be a positive integer" }),
});

export const OrderRequest = z.object({
    productRequests: z.array(productQuantityRequestSchema).nonempty({
        message: "Order must contain at least one product",
    }),
    shippingAddrLatitude: z.number().min(-90).max(90, {
        message: "Latitude must be between -90 and 90 degrees",
    }),
    shippingAddrLongitude: z.number().min(-180).max(180, {
        message: "Longitude must be between -180 and 180 degrees",
    }),
    salesRepReference: z.string().optional(),
    customerReference: z.string().optional(),
});

export type OrderRequest = z.infer<typeof OrderRequest>;