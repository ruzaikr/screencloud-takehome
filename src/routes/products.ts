import { Router, Response, NextFunction, Request } from 'express';
import * as productService from '../services/productService';
import type { GetProductsResponse } from '../schemas/product';

const router = Router();

router.get('/', async (
    _req: Request, res: Response<GetProductsResponse>,
    next: NextFunction
): Promise<void> => {
    try {
        const products = await productService.getAllProductsService();
        res.json(products);
    } catch (error) {
        console.error(`Error processing GET /products request. Error: ${error instanceof Error ? error.stack : String(error)}`);
        next(error);
    }
});

export default router;
