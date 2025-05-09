import { Router, Request, Response, NextFunction } from 'express';
import * as orderService from '../services/orderService';
import {
    CreateOrderRequestSchema,
    CreateOrderRequest,
    CreateOrderResponse,
    ErrorResponse
} from '../schemas/order';
import { ZodValidationError } from '../errors/customErrors';

const router = Router();

router.post('/', async (
    req: Request<object, CreateOrderResponse | ErrorResponse, CreateOrderRequest>,
    res: Response<CreateOrderResponse | ErrorResponse>,
    next: NextFunction
): Promise<void> => {

    const parsedRequest = CreateOrderRequestSchema.safeParse(req.body);

    if (!parsedRequest.success) {
        return next(new ZodValidationError(parsedRequest.error.issues));
    }

    try {
        const orderConfirmation = await orderService.createWalkInOrder(parsedRequest.data);
        res.status(201).json(orderConfirmation);
    } catch (error) {
        // Be mindful of logging sensitive data from req.body in production environments
        const inputForLog = { ...req.body };
        console.error(
            `Error processing POST /orders request. Path: ${req.path}, Input: ${JSON.stringify(inputForLog)}. Error: ${error instanceof Error ? error.stack : String(error)}`
        );

        next(error);
    }
});

export default router;
