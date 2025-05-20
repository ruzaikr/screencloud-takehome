import dotenv from 'dotenv';

dotenv.config();

function getEnvVar(key: string, isOptional: boolean = false): string {
    const value = process.env[key];
    if (value === undefined && !isOptional) {
        throw new Error(`Missing critical environment variable: ${key}`);
    }
    return value as string; // if optional and undefined, it will return undefined and type assertion is fine
}

function getNumericEnvVar(key: string, isOptional: boolean = false): number {
    const valueStr = getEnvVar(key, isOptional);
    if (valueStr === undefined && isOptional) {
        throw new Error(`Numeric environment variable ${key} is optional but no default handling path defined if undefined.`);
    }
    const numValue = parseInt(valueStr, 10);
    if (isNaN(numValue)) {
        throw new Error(`Environment variable ${key} is expected to be a number, but got: ${valueStr}`);
    }
    return numValue;
}


interface AppConfig {
    NODE_ENV: string;
    PORT: number;
    DATABASE_URL: string;
    RESERVATION_TTL_MINUTES: number;
    SHIPPING_COST_CENTS_PER_KG_PER_KM: number;
    SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE: number;
    AUTH0_DOMAIN: string;
    AUTH0_AUDIENCE: string;
}

const config: AppConfig = {
    NODE_ENV: getEnvVar('NODE_ENV', true) || 'dev',
    PORT: getNumericEnvVar('PORT'),
    DATABASE_URL: getEnvVar('DATABASE_URL'),
    RESERVATION_TTL_MINUTES: getNumericEnvVar('RESERVATION_TTL_MINUTES'),
    SHIPPING_COST_CENTS_PER_KG_PER_KM: getNumericEnvVar('SHIPPING_COST_CENTS_PER_KG_PER_KM'),
    SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE: getNumericEnvVar('SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE'),
    AUTH0_DOMAIN: getEnvVar('AUTH0_DOMAIN'),
    AUTH0_AUDIENCE: getEnvVar('AUTH0_AUDIENCE'),
};

if (config.RESERVATION_TTL_MINUTES <= 0) {
    throw new Error('RESERVATION_TTL_MINUTES must be a positive integer.');
}
if (config.SHIPPING_COST_CENTS_PER_KG_PER_KM < 0) {
    throw new Error('SHIPPING_COST_CENTS_PER_KG_PER_KM must be a non-negative integer.');
}
if (config.SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE < 0 || config.SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE > 100) {
    throw new Error('SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE must be between 0 and 100 (inclusive).');
}
if (config.PORT <= 0 || config.PORT > 65535) {
    throw new Error('PORT must be a valid port number (1-65535).');
}
if (!config.AUTH0_DOMAIN || config.AUTH0_DOMAIN.trim() === '') {
    throw new Error('AUTH0_DOMAIN must be defined.');
}
if (!config.AUTH0_AUDIENCE || config.AUTH0_AUDIENCE.trim() === '') {
    throw new Error('AUTH0_AUDIENCE must be defined.');
}


// Freeze the config object to prevent modifications at runtime
export default Object.freeze(config);