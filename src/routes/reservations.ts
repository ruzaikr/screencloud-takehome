import { Router, Request, Response, NextFunction } from 'express';
import * as reservationService from '../services/reservationService';
import { CreateOrderRequestSchema, CreateOrderRequest } from '../schemas/order';
import { CheckReservationResponse } from '../schemas/reservation';
import { ErrorResponse } from '../schemas/order'; // Re-use error response
import { ZodError } from 'zod';

const router = Router();

/**
 * @openapi
 * /reservations:
 *   post:
 *     summary: Check reservation feasibility
 *     description: Checks if a reservation for specified products is feasible based on current inventory, existing reservations, and shipping cost limits. Does not create a reservation.
 *     operationId: checkReservationFeasibility
 *     tags:
 *       - Reservations
 *     parameters:
 *       - name: reserve
 *         in: query
 *         required: true
 *         description: Must be 'false' to check feasibility without creating a reservation.
 *         schema:
 *           type: string
 *           enum: [false]
 *     requestBody:
 *       description: Reservation check payload (same as creating an order)
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest' # Reuses order creation schema
 *     responses:
 *       '200':
 *         description: Reservation feasibility check successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CheckReservationResponse'
 *       '400':
 *         description: Bad Request - Invalid input, insufficient inventory, or shipping cost too high.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '501':
 *         description: Not Implemented - If 'reserve' query param is not 'false'.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', async (
    req: Request<object, CheckReservationResponse | ErrorResponse, CreateOrderRequest, { reserve?: string }>,
    res: Response<CheckReservationResponse | ErrorResponse>,
    next: NextFunction
): Promise<void> => {
    if (req.query.reserve !== 'false') {
        const errorPayload: ErrorResponse = {
            message: "Reservation creation not implemented for this endpoint. Use ?reserve=false to check feasibility."
        };
        res.status(501).json(errorPayload);
        return;
    }

    const parsedRequest = CreateOrderRequestSchema.safeParse(req.body);

    if (!parsedRequest.success) {
        const errorPayload: ErrorResponse = {
            message: "Invalid request payload. Please check the provided data.",
            issues: parsedRequest.error.issues,
        };
        res.status(400).json(errorPayload);
        return;
    }

    try {
        const feasibilityDetails = await reservationService.reserve(parsedRequest.data);

        // If feasibilityDetails.isValid is false, it means a business rule failed (inventory or shipping)
        // The service.ts already populates the message field in feasibilityDetails for this.
        // The HTTP status code should still be 200 as the *operation* (feasibility check) was successful.
        // The client then inspects the `isValid` field.
        // However, if the problem statement implies that "insufficient inventory, or shipping cost too high" should be a 400,
        // we can adjust. The OpenAPI spec for POST /orders uses 400 for these.
        // Let's align with that for consistency for user-correctable errors.
        if (!feasibilityDetails.isValid) {
            const errorPayload: ErrorResponse = {
                message: feasibilityDetails.message || "Reservation is not feasible due to business constraints (e.g., inventory or shipping costs)."
            };
            res.status(400).json(errorPayload);
            return;
        }

        res.status(200).json(feasibilityDetails);

    } catch (error) {
        console.error(`Error processing POST /reservations?reserve=false request. Body: ${JSON.stringify(req.body)}. Error:`, error);

        let errorPayload: ErrorResponse;

        // These specific errors are handled by the isValid: false path above now.
        // This catch block is for other errors, like unexpected ones or Zod errors from deeper layers.
        // if (error instanceof InsufficientInventoryError || error instanceof ShippingCostExceededError) {
        //     errorPayload = { message: error.message };
        //     res.status(400).json(errorPayload);
        //     return;
        // }

        if (error instanceof Error && error.message.startsWith("Product details not found for productId")) {
            errorPayload = { message: error.message };
            res.status(400).json(errorPayload);
            return;
        }

        if (error instanceof ZodError) {
            errorPayload = {
                message: "A data validation error occurred during processing.",
                issues: error.issues,
            };
            res.status(400).json(errorPayload);
            return;
        }

        errorPayload = { message: "An unexpected internal error occurred while processing your request. Please try again later." };
        res.status(500).json(errorPayload);
    }
});

export default router;