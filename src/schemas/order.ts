import { z } from 'zod';

// Schema for shipping address in the request
export const OrderShippingAddressSchema = z.object({
    latitude: z.string().regex(/^-?([1-8]?[0-9]|[1-9]0)\.{1}\d{1,6}$/, "Invalid latitude format or precision"),
    longitude: z.string().regex(/^-?((1[0-7]|[1-9])?[0-9]|180)\.{1}\d{1,6}$/, "Invalid longitude format or precision"),
});

// Schema for a single requested product
export const OrderRequestedProductSchema = z.object({
    id: z.string().uuid({ message: "Invalid product ID format (UUID required)" }),
    quantity: z.number().int().positive({ message: "Product quantity must be a positive integer" }),
});

// Schema for the POST /orders request body
export const CreateOrderRequestSchema = z.object({
    shippingAddress: OrderShippingAddressSchema,
    requestedProducts: z.array(OrderRequestedProductSchema).nonempty({
        message: "requestedProducts array cannot be empty",
    }),
    // reservationId: z.string().uuid().optional(), // To be added later
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;


// Schema for the POST /orders response body
export const CreateOrderResponseSchema = z.object({
    orderId: z.string().uuid(),
    totalPriceCents: z.number().int(),
    discountCents: z.number().int(),
    shippingCostCents: z.number().int(),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

// Schema for error responses (e.g., 400 Bad Request)
export const ErrorResponseSchema = z.object({
    message: z.string(),
    issues: z.array(z.object({ path: z.array(z.string().or(z.number())), message: z.string() })).optional(),
});