import { degreesToRadians, calculateDistanceKm } from "./shippingUtils"

describe('Warehouse Repository Utilities', () => {

    describe('degreesToRadians', () => {
        it('should convert degrees to radians correctly', () => {
            expect(degreesToRadians(0)).toBe(0);
            expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
            expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
            expect(degreesToRadians(270)).toBeCloseTo(3 * Math.PI / 2);
            expect(degreesToRadians(360)).toBeCloseTo(2 * Math.PI);
        });
    });

    describe('calculateDistanceKm', () => {
        // Test cases (approximate distances)
        // Paris to London: ~344 km
        // Lat/Lon: Paris (48.8566, 2.3522), London (51.5074, 0.1278)
        it('should calculate distance between Paris and London', () => {
            const parisLat = 48.8566;
            const parisLon = 2.3522;
            const londonLat = 51.5074;
            const londonLon = -0.1278; // Corrected: London is west of PM
            expect(calculateDistanceKm(parisLat, parisLon, londonLat, londonLon)).toBeCloseTo(343.5, 0);
        });

        it('should return 0 for the same coordinates', () => {
            const lat = 40.7128;
            const lon = -74.0060;
            expect(calculateDistanceKm(lat, lon, lat, lon)).toBe(0);
        });

        // New York (40.7128, -74.0060) to Los Angeles (34.0522, -118.2437) approx 3935 km
        it('should calculate distance between New York and Los Angeles', () => {
            const nyLat = 40.7128;
            const nyLon = -74.0060;
            const laLat = 34.0522;
            const laLon = -118.2437;
            expect(calculateDistanceKm(nyLat, nyLon, laLat, laLon)).toBeCloseTo(3935.7, 0);
        });
    });

});