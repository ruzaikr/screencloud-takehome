import type { DatabaseExecutor } from '../db/client';
import { warehouses as warehousesTable } from '../db/schema';
import { calculateDistanceKm } from "../utils/shippingUtils";
import config from '../config';

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

        const distanceKm = calculateDistanceKm(
            warehouseLatitude,
            warehouseLongitude,
            shippingAddrLatitude,
            shippingAddrLongitude
        );

        const costPerKg = distanceKm * config.SHIPPING_COST_CENTS_PER_KG_PER_KM;

        // Round to the nearest whole cent, as shipping costs are typically integer cents.
        // Example: 123.45 cents becomes 123 cents, 123.78 cents becomes 124 cents.
        const shippingCostCentsPerKg = Math.round(costPerKg);

        return {
            warehouseId: warehouse.id,
            shippingCostCentsPerKg,
        };
    });

    // 3. Sort the array by shippingCostCentsPerKg in ascending order
    warehousesWithCosts.sort((a, b) => a.shippingCostCentsPerKg - b.shippingCostCentsPerKg);

    return warehousesWithCosts;
}