import { Router, Request, Response, NextFunction } from 'express';
import * as reservationService from '../services/reservationService';
import {
    CreateOrderRequestSchema,
    CreateOrderRequest,
    ErrorResponse
} from '../schemas/order';
import { CheckReservationResponse } from '../schemas/reservation';
import { ZodValidationError } from '../errors/customErrors';

const router = Router();

router.post('/', async (
    req: Request<object, CheckReservationResponse | ErrorResponse, CreateOrderRequest, { reserve?: string }>,
    res: Response<CheckReservationResponse | ErrorResponse>,
    next: NextFunction
): Promise<void> => {
    if (req.query.reserve !== 'false') {
        res.status(501).json({
            message: "Reservation creation not implemented for this endpoint. Use ?reserve=false to check feasibility."
        });
        return;
    }

    const parsedRequest = CreateOrderRequestSchema.safeParse(req.body);

    if (!parsedRequest.success) {
        return next(new ZodValidationError(parsedRequest.error.issues));
    }

    try {
        const feasibilityDetails = await reservationService.checkFeasibility(parsedRequest.data);
        res.status(200).json(feasibilityDetails);
    } catch (error) {
        // Be mindful of logging sensitive data from req.body in production environments
        const inputForLog = { ...req.body };
        console.error(
            `Error processing POST /reservations?reserve=false. Input: ${JSON.stringify(inputForLog)}. Error: ${error instanceof Error ? error.stack : String(error)}`
        );

        next(error);
    }
});

export default router;
