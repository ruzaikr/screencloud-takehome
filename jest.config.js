module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'], // Look for tests within the src directory
    testMatch: [
        '**/__tests__/**/*.+(ts|tsx|js)', // Standard Jest pattern
        '**/?(*.)+(spec|test).+(ts|tsx|js)' // Another common pattern
    ],
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest',
    },
    // Automatically clear mock calls, instances and results before every test
    clearMocks: true,
    // Collect coverage from src, excluding certain files/patterns
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts', // Exclude declaration files
        '!src/index.ts', // Exclude main entry point (usually E2E tested)
        '!src/db/client.ts', // Exclude DB client setup
        '!src/db/schema.ts', // Exclude schema definitions (tested via ORM)
        '!src/db/seed.ts', // Exclude seeding scripts
        '!src/routes/**/*', // Exclude route handlers (E2E/Integration)
        // Add other files/patterns to exclude if necessary
    ],
    // Configure coverage reporters
    coverageReporters: ["json", "lcov", "text", "clover"],
    // Optional: Set a coverage threshold
    // coverageThreshold: {
    //   global: {
    //     branches: 80,
    //     functions: 80,
    //     lines: 80,
    //     statements: -10,
    //   },
    // },
};