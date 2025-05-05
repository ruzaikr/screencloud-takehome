import express from "express";
import { OrderRequest } from "../schemas/order";
import { createOrder } from "../services/orderService";

const router = express.Router();

/**
 * POST /orders
 * Create a new order with product requests and shipping information
 */
router.post("/", async (req, res, next) => {
    try {
        // Validate request body
        const validationResult = OrderRequest.safeParse(req.body);

        if (!validationResult.success) {
            res.status(400).json({
                error: "Invalid request data",
                details: validationResult.error.format(),
            });
        } else {
            const orderRequest: OrderRequest = validationResult.data;

            // Create the order using the service
            const result = await createOrder(orderRequest);

            // Send the created order with 201 Created status
            res.status(201).json(result);
        }
    } catch (error) {
        // Handle known error types
        if (error instanceof Error && error.message.includes("Insufficient inventory")) {
            res.status(409).json({
                error: "Inventory conflict",
                message: error.message,
            });
        }

        // Pass unknown errors to the error handler
        next(error);
    }
});

export default router;