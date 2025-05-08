import { z } from 'zod';

export const CheckReservationResponseSchema = z.object({
    isValid: z.boolean(),
    totalPriceCents: z.number().int(),
    discountCents: z.number().int(),
    shippingCostCents: z.number().int(),
    // Optional: include a message if isValid is false
    message: z.string().optional(),
});

export type CheckReservationResponse = z.infer<typeof CheckReservationResponseSchema>;