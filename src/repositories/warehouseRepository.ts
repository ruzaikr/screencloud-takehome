import { db } from '../db/client';
import { warehouses } from '../db/schema';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Shipping cost calculation result for a warehouse
 */
export interface WarehouseShippingCost {
    warehouseId: string;
    shippingCostCentsPerKg: number;
}

/**
 * Calculates shipping costs from all warehouses to a given shipping address
 * Sorted by shipping cost in ascending order (cheapest first)
 * @param shippingAddrLatitude Latitude of the shipping address
 * @param shippingAddrLongitude Longitude of the shipping address
 * @returns Array of warehouse IDs with their calculated shipping costs per kg, sorted by cost
 */
export async function getWarehouseShippingCosts(
    shippingAddrLatitude: number,
    shippingAddrLongitude: number
): Promise<WarehouseShippingCost[]> {
    // Get shipping cost per kg per km from environment variables
    const shippingCostPerKgPerKm = Number(process.env.SHIPPING_COST_CENTS_PER_KG_PER_KM || '1');

    if (isNaN(shippingCostPerKgPerKm)) {
        throw new Error('Invalid SHIPPING_COST_CENTS_PER_KG_PER_KM in environment variables');
    }

    // Get all warehouses
    const allWarehouses = await db
        .select({
            id: warehouses.id,
            latitude: warehouses.latitude,
            longitude: warehouses.longitude,
        })
        .from(warehouses);

    // Calculate shipping cost for each warehouse
    const shippingCosts = allWarehouses.map(warehouse => {
        // Calculate distance in kilometers using Haversine formula
        const distanceKm = calculateHaversineDistance(
            Number(shippingAddrLatitude),
            Number(shippingAddrLongitude),
            Number(warehouse.latitude),
            Number(warehouse.longitude)
        );

        // Calculate shipping cost per kg based on distance
        const shippingCostCentsPerKg = Math.round(distanceKm * shippingCostPerKgPerKm);

        return {
            warehouseId: warehouse.id,
            shippingCostCentsPerKg
        };
    });

    // Sort warehouses by shipping cost (ascending)
    return shippingCosts.sort((a, b) => a.shippingCostCentsPerKg - b.shippingCostCentsPerKg);
}

/**
 * Calculates the great-circle distance between two points using the Haversine formula
 * @param lat1 Latitude of point 1 in degrees
 * @param lon1 Longitude of point 1 in degrees
 * @param lat2 Latitude of point 2 in degrees
 * @param lon2 Longitude of point 2 in degrees
 * @returns Distance in kilometers
 */
function calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    // Earth's radius in kilometers
    const earthRadiusKm = 6371;

    // Convert degrees to radians
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);

    // Calculate haversine formula
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

/**
 * Converts degrees to radians
 * @param degrees Angle in degrees
 * @returns Angle in radians
 */
function degToRad(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Example usage:
 *
 * import { getWarehouseShippingCosts } from './warehouseRepository';
 *
 * // Get shipping costs for all warehouses to deliver to this location
 * const shippingCosts = await getWarehouseShippingCosts(37.7749, -122.4194);
 *
 * // Since the array is already sorted, the first warehouse is the cheapest option
 * const cheapestWarehouse = shippingCosts[0];
 */