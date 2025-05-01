import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? +process.env.PORT : 3002;

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
    })
})

// TODO: mount your /orders, /products, etc. routes here

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
})