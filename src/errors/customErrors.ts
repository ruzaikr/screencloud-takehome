import { ZodIssue } from 'zod';

// Base class for operational errors handled by the global error handler
export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly issues?: ZodIssue[];

    constructor(name: string, message: string, statusCode: number, issues?: ZodIssue[]) {
        super(message);
        this.name = name; // Set the error name to the class name
        this.statusCode = statusCode;
        this.issues = issues;
        Object.setPrototypeOf(this, new.target.prototype); // Ensure instanceof works correctly
        Error.captureStackTrace(this, this.constructor); // Maintain stack trace
    }
}

// General HTTP Errors
export class BadRequestError extends ApiError {
    constructor(message: string = "Bad Request", issues?: ZodIssue[]) {
        super("BadRequestError", message, 400, issues);
    }
}

export class NotFoundError extends ApiError {
    constructor(message: string = "Resource not found") {
        super("NotFoundError", message, 404);
    }
}

export class ConflictError extends ApiError { // For 409
    constructor(message: string = "Conflict") {
        super("ConflictError", message, 409);
    }
}

// Application-Specific Operational Errors
export class ProductNotFoundError extends BadRequestError { // Product not found due to bad input ID is a 400
    constructor(productId: string) {
        super(`Product details not found for productId: ${productId}. Ensure the product ID is valid.`);
        this.name = "ProductNotFoundError";
    }
}

export class InsufficientInventoryError extends ConflictError { // For actual inventory shortage leading to 409
    constructor(message: string) {
        super(message);
        this.name = "InsufficientInventoryError";
    }
}

export class ShippingCostExceededError extends BadRequestError { // For order creation, this is a 400
    constructor(message: string) {
        super(message);
        this.name = "ShippingCostExceededError";
    }
}

// Zod validation error specific class for consistent error response structure
export class ZodValidationError extends BadRequestError {
    constructor(issues: ZodIssue[]) {
        super("Invalid request payload. Please check the provided data.", issues);
        this.name = "ZodValidationError";
    }
}
