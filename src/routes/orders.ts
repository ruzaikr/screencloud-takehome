import { Router } from "express";
import { OrderRequest } from "../schemas/order";
import { computeOrder, submitOrder } from "../services/orderService";

const router = Router();

router.post("/validate", async (req, res, next) => {
    try {
        const { shippingAddress, productId, quantity } = OrderRequest.parse(req.body);
        const { totalProductCost, discount, shippingCost, isValid } = await computeOrder(shippingAddress, productId, quantity);
        res.json({ valid: isValid, totalProductCost, discount, shippingCost });
    } catch (err) {
        next(err);
    }
})

router.post("/", async (req, res, next) => {
    try {
        const { shippingAddress, productId, quantity } = OrderRequest.parse(req.body);
        const order = await submitOrder(shippingAddress, productId, quantity);
        res.status(201).json(order);
    } catch (err) {
        next(err);
    }
})

export default router;