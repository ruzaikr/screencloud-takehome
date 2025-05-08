import { Router, Request, Response, NextFunction } from 'express';
import * as orderService from '../services/orderService';
import { InsufficientInventoryError } from "../services/shared/helpers";

import {
    CreateOrderRequestSchema,
    CreateOrderRequest,
    CreateOrderResponse,
    ErrorResponse
} from '../schemas/order';
import { ZodError } from 'zod'; // z is needed for z.infer

const router = Router();

/**
 * @openapi
 * /orders:
 *   post:
 *     summary: Place a new order
 *     description: Creates a new order for specified products. For 'walk-in' orders, inventory is allocated from available inventory (inventory - reservations).
 *     operationId: createOrder
 *     tags:
 *       - Orders
 *     requestBody:
 *       description: Order creation payload
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest'
 *     responses:
 *       '201':
 *         description: Order successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CreateOrderResponse'
 *       '400':
 *         description: Bad Request - Invalid input, insufficient inventory, or shipping cost too high.
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
    // Define types for Request: P (Params), ResBody, ReqBody, ReqQuery
    req: Request<object, CreateOrderResponse | ErrorResponse, CreateOrderRequest>,
    res: Response<CreateOrderResponse | ErrorResponse>,
    next: NextFunction // Add next to match RequestHandler signature
): Promise<void> => { // Explicitly set return type to Promise<void>

    // 1. Validate request body
    // req.body is typed as CreateOrderRequest via the Request generic
    const parsedRequest = CreateOrderRequestSchema.safeParse(req.body);

    if (!parsedRequest.success) {
        const errorPayload: ErrorResponse = {
            message: "Invalid request payload. Please check the provided data.",
            // ZodError.issues is compatible with the ErrorResponseSchema's issues structure
            issues: parsedRequest.error.issues,
        };
        res.status(400).json(errorPayload);
        return; // Ensure the function path ends, fulfilling Promise<void>
    }

    try {
        // parsedRequest.data is of type CreateOrderRequest
        const orderConfirmation = await orderService.createWalkInOrder(parsedRequest.data);

        res.status(201).json(orderConfirmation);
        // No explicit return needed here; async function implicitly returns Promise<void>
        // if no value is returned from the last statement.
    } catch (error) {
        // It's good practice to log the actual error on the server
        // Be mindful of logging sensitive data from req.body in production environments
        console.error(`Error processing POST /orders request. Body: ${JSON.stringify(req.body)}. Error:`, error);

        let errorPayload: ErrorResponse;

        if (error instanceof InsufficientInventoryError ||
            error instanceof orderService.ShippingCostExceededError) {
            errorPayload = { message: error.message };
            res.status(400).json(errorPayload);
            return;
        }

        // Check for specific error message from productRepository (fragile, custom error preferred)
        if (error instanceof Error && error.message.startsWith("Product details not found for productId")) {
            errorPayload = { message: error.message };
            res.status(400).json(errorPayload);
            return;
        }

        // Handle ZodErrors that might bubble up from deeper layers (if any)
        if (error instanceof ZodError) {
            errorPayload = {
                message: "A data validation error occurred during processing.",
                issues: error.issues,
            };
            res.status(400).json(errorPayload);
            return;
        }

        // For all other unexpected errors, send a generic 500 response
        errorPayload = { message: "An unexpected internal error occurred while processing your order. Please try again later." };
        res.status(500).json(errorPayload);
        // No explicit return needed for the last statement in this block.
        // Note: if 'next' were to be used for error handling middleware, it would be called here: next(error);
    }
});

export default router;