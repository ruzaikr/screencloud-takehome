import config from "./config";
import express from "express";
import ordersRouter from "./routes/orders";
import reservationsRouter from "./routes/reservations";
import productsRouter from "./routes/products";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { ApiError, ZodValidationError } from './errors/customErrors';

const app = express();
const PORT = config.PORT;

const openapiPath = path.join(__dirname, "../openapi/openapi.json");
const openapiDocument = JSON.parse(fs.readFileSync(openapiPath, "utf8"));

app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/orders", ordersRouter);
app.use("/reservations", reservationsRouter);
app.use("/products", productsRouter);

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
    });
});

// Global Error Handling Middleware
// This should be the last middleware added.
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction): void => {

    // Log the full error for server-side diagnostics, except for known operational ZodValidationErrors
    // which might be too verbose if they happen often and are expected user input errors.
    if (!(err instanceof ZodValidationError)) {
        console.error(
            `Global Error Handler Caught: ${err.name || 'Error'} - ${err.message}. Request: ${req.method} ${req.path}. Stack: ${err.stack}`
        );
    }


    if (err instanceof ZodValidationError) { // Handles ZodValidationError passed by next()
        res.status(err.statusCode).json({
            message: err.message,
            issues: err.issues,
        });
        return;
    }

    if (err instanceof ApiError) {
        res.status(err.statusCode).json({
            message: err.message,
            // Include issues if the specific ApiError subclass populates them
            ...(err.issues && err.issues.length > 0 && { issues: err.issues }),
        });
        return;
    }

    // Generic fallback for unexpected errors
    res.status(500).json({
        message: "An unexpected internal server error occurred. Please try again later.",
    });
});


app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`OpenAPI docs: http://localhost:${PORT}/docs`);
});
