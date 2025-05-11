module.exports = {
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            roots: ['<rootDir>/src'],
            setupFiles: ['<rootDir>/tests/integration/jest-setup-env.js'],
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
            clearMocks: true,
        }
    ],
    // Optional: A default coverage directory for when running all projects
    coverageDirectory: 'coverage',
};