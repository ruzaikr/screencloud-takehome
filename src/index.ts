import express from "express";
import dotenv from "dotenv";
import ordersRouter from "./routes/orders";
import reservationsRouter from "./routes/reservations";

import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? +process.env.PORT : 3002;

const openapiPath = path.join(__dirname, "../openapi/openapi.json");
const openapiDocument = JSON.parse(fs.readFileSync(openapiPath, "utf8"));

app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/orders", ordersRouter);
app.use("/reservations", reservationsRouter);

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
    });
});

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`OpenAPI docs: http://localhost:${PORT}/docs`);
});