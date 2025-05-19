import config from "./config";
import express from "express";
import ordersRouter from "./routes/orders";
import reservationsRouter from "./routes/reservations";
import productsRouter from "./routes/products";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { ApiError, ZodValidationError } from './errors/customErrors';
import { checkJwt } from "./middleware/authMiddleware";

const app = express();
const PORT = config.PORT;

const openapiPath = path.join(__dirname, "../openapi/openapi.json");
const openapiDocument = JSON.parse(fs.readFileSync(openapiPath, "utf8"));

app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: Date.now(),
    });
});

app.use("/orders", checkJwt, ordersRouter);
app.use("/reservations", checkJwt, reservationsRouter);
app.use("/products", checkJwt, productsRouter);

// Global Error Handling Middleware
// This should be the last middleware added.
app.use((err: Error & { status?: number; statusCode?: number; code?: string; }, req: express.Request, res: express.Response, _next: express.NextFunction): void => {

    // Log the full error for server-side diagnostics, except for known operational ZodValidationErrors
    // which might be too verbose if they happen often and are expected user input errors.
    // Also, don't log full stack for common 401 errors if they are too noisy,
    // but log a concise message for them.
    if (!(err instanceof ZodValidationError) && err.status !== 401) {
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

    // Handle errors from express-oauth2-jwt-bearer (or its underlying 'jose' library)
    // These errors are typically thrown with a 'status' property (e.g., 401).
    if (err.status === 401) {
        // Log a concise message for authentication errors
        console.warn(
            `Authentication Error: ${err.name || 'AuthError'} - ${err.message}. Code: ${err.code || 'N/A'}. Request: ${req.method} ${req.path}`
        );
        res.status(401).json({
            message: "Authentication token is missing or invalid.", // Standardized message
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
