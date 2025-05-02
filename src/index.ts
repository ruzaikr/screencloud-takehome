import express from "express";
import dotenv from "dotenv";
import ordersRouter from "./routes/orders";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? +process.env.PORT : 3002;

app.use(express.json());

app.use("/orders", ordersRouter);

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
    })
})

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
})