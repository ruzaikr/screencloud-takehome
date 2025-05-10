import type { DatabaseExecutor } from '../db/client';
import { warehouses as warehousesTable } from '../db/schema';
import { calculateDistanceKm } from "../utils/shippingUtils";
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---

/**
 * Retrieves and validates the shipping cost configuration from environment variables.
 * This function is called once when the module is loaded.
 * @throws Error if the environment variable is missing or invalid.
 * @returns The shipping cost in cents per kilogram per kilometer.
 */
function getShippingCostCentsPerKgPerKmFromEnv(): number {
    const costString = process.env.SHIPPING_COST_CENTS_PER_KG_PER_KM;

    if (costString === undefined) {
        // This error will be thrown when the module is loaded if the variable is not set,
        // causing the application to fail fast, which is desirable for missing critical configuration.
        throw new Error(
            "Configuration Error: The SHIPPING_COST_CENTS_PER_KG_PER_KM environment variable is not set."
        );
    }

    const cost = parseInt(costString, 10);

    if (isNaN(cost) || cost < 0) {
        throw new Error(
            "Configuration Error: The SHIPPING_COST_CENTS_PER_KG_PER_KM environment variable must be a non-negative integer."
        );
    }
    return cost;
}

// This constant will hold the validated configuration value.
// If getShippingCostCentsPerKgPerKmFromEnv() throws, the module loading will fail.
const SHIPPING_COST_CENTS_PER_KG_PER_KM: number = getShippingCostCentsPerKgPerKmFromEnv();

/**
 * Represents the shipping information for a single warehouse.
 */
export interface WarehouseShippingInfo {
    warehouseId: string;
    shippingCostCentsPerKg: number;
}

/**
 * Retrieves all warehouses, calculates the shipping cost per kilogram to a given
 * shipping address for each warehouse, and returns them sorted by this cost in ascending order.
 *
 * This function can operate with either a main DB connection or a transaction.
 *
 * @param dbx The Drizzle database executor (db or tx).
 * @param shippingAddrLatitude The latitude of the shipping address.
 * @param shippingAddrLongitude The longitude of the shipping address.
 * @returns A Promise resolving to an array of WarehouseShippingInfo objects,
 *          sorted by shippingCostCentsPerKg. Returns an empty array if no warehouses exist.
 * @throws Error if warehouse coordinates are invalid (e.g., cannot be parsed to numbers),
 *         or if critical configuration is missing/invalid (checked at module load time).
 */
export async function getWarehousesSortedByShippingCost(
    dbx: DatabaseExecutor,
    shippingAddrLatitude: number,
    shippingAddrLongitude: number
): Promise<WarehouseShippingInfo[]> {
    // 1. Fetch all warehouses from the database
    // Selecting 'name' as well for better error messages or debugging if needed.
    const allWarehouses = await dbx
        .select({
            id: warehousesTable.id,
            name: warehousesTable.name,
            latitude: warehousesTable.latitude,
            longitude: warehousesTable.longitude,
        })
        .from(warehousesTable);

    if (allWarehouses.length === 0) {
        return []; // No warehouses, return empty array as per common practice.
    }

    // 2. Calculate distance and shipping cost for each warehouse
    const warehousesWithCosts: WarehouseShippingInfo[] = allWarehouses.map(warehouse => {
        // Drizzle ORM typically returns numeric SQL types as strings to preserve precision.
        // We need to parse them to numbers for calculations.
        const warehouseLatitude = parseFloat(warehouse.latitude);
        const warehouseLongitude = parseFloat(warehouse.longitude);

        // Validate parsed coordinates.
        // Database constraints (NOT NULL, numeric type) should prevent malformed data,
        // but robust code includes checks for unexpected scenarios.
        if (isNaN(warehouseLatitude) || isNaN(warehouseLongitude)) {
            // This indicates a data integrity issue or an unexpected format from the DB.
            console.error(
                `Warehouse ID ${warehouse.id} (Name: '${warehouse.name}') has invalid coordinates: latitude='${warehouse.latitude}', longitude='${warehouse.longitude}'.`
            );
            // Throw an error to halt the process and flag the data issue.
            // Alternatively, this warehouse could be skipped, but failing fast is often safer.
            throw new Error(`Invalid coordinates for warehouse ID ${warehouse.id} ('${warehouse.name}').`);
        }

        const distanceKm = calculateDistanceKm(
            warehouseLatitude,
            warehouseLongitude,
            shippingAddrLatitude,
            shippingAddrLongitude
        );

        // Calculate cost: distance (km) * cost_rate (cents/kg/km) = total_cost (cents/kg)
        const costPerKg = distanceKm * SHIPPING_COST_CENTS_PER_KG_PER_KM;

        // Round to the nearest whole cent, as shipping costs are typically integer cents.
        // Example: 123.45 cents becomes 123 cents, 123.78 cents becomes 124 cents.
        const shippingCostCentsPerKg = Math.round(costPerKg);

        return {
            warehouseId: warehouse.id,
            shippingCostCentsPerKg,
        };
    });

    // 3. Sort the array by shippingCostCentsPerKg in ascending order
    // The sort compareFunction handles numbers correctly.
    warehousesWithCosts.sort((a, b) => a.shippingCostCentsPerKg - b.shippingCostCentsPerKg);

    return warehousesWithCosts;
}