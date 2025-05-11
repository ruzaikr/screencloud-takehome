// jest.config.js
module.exports = {
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            roots: ['<rootDir>/src'],
            testMatch: [
                '**/__tests__/**/*.+(ts|tsx|js)',
                '**/?(*.)+(spec|test).+(ts|tsx|js)',
                '!**/*.integration.test.ts' // Exclude integration tests from unit project
            ],
            transform: {
                '^.+\\.(ts|tsx)$': 'ts-jest',
            },
            clearMocks: true,
            collectCoverageFrom: [
                'src/**/*.{ts,tsx}',
                '!src/**/*.d.ts',
                '!src/index.ts',
                '!src/db/client.ts',
                '!src/db/schema.ts',
                '!src/db/seed.ts',
                '!src/routes/**/*',
                // Exclude files that will be tested via integration tests if desired
                // For now, keeping existing exclusions
            ],
            coverageReporters: ["json", "lcov", "text", "clover"],
        },
        {
            displayName: 'integration',
            preset: 'ts-jest',
            testEnvironment: 'node', // or 'jest-environment-node'
            globalSetup: '<rootDir>/tests/integration/jest-global-setup.js',
            globalTeardown: '<rootDir>/tests/integration/jest-global-teardown.js',
            setupFilesAfterEnv: ['<rootDir>/tests/integration/jest-setup-after-env.ts'],
            testMatch: [
                '**/tests/integration/**/*.integration.test.ts'
            ],
            transform: {
                '^.+\\.(ts|tsx)$': 'ts-jest', // Ensure .ts files in tests/integration are transformed
            },
            clearMocks: true, // Good practice
            testTimeout: 60000, // Increase timeout for testcontainers setup and tests
        }
    ],
    // Optional: A default coverage directory for when running all projects
    coverageDirectory: 'coverage',
};