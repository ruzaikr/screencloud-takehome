## Testing Strategy

### 1. Unit Tests (`npm run test:unit`)

*   **Purpose:** To test individual functions, modules, or classes in isolation. These tests verify the smallest pieces of code, such as business logic calculations, utility functions, and individual methods within services or repositories (with their dependencies mocked).
*   **Scope:**
    *   Pure utility functions (e.g., `src/utils/shippingUtils.ts`, `src/services/shared/helpers.ts`).
    *   Business logic within services (e.g., cost calculation, discount application, validation logic within `src/services/*.ts`), with repository and external calls mocked.
    *   Request/response schema validation logic (e.g., `src/schemas/*.ts`).
    *   Error handling and custom error classes (`src/errors/customErrors.ts`).
*   **Tools:** Jest, `ts-jest`.
*   **Characteristics:** Fast, isolated, and provide quick feedback to developers. Table-driven tests are encouraged for comprehensive coverage of various input scenarios and edge cases (as demonstrated in `src/services/shared/helpers.test.ts`).
*   **Location:** The `jest.config.js` configures unit tests to run from `src/` (excluding integration tests). Tests are typically `*.test.ts` or `*.spec.ts` files.

### 2. Integration Tests (`npm run test:integration`)

*   **Purpose:** To verify the interaction between different components of the system, particularly the service layer's integration with the database. These tests ensure that database queries, transactions, data integrity, and ORM mappings work as expected.
*   **Scope:**
    *   **Repository Layer:** Testing each repository method (`src/repositories/*.ts`) against a real database instance to confirm SQL correctness and data manipulation (e.g., `tests/integration/repositories/inventoryRepository.integration.test.ts`).
    *   **Service Layer:** Testing service methods that orchestrate calls to multiple repositories or involve complex database transactions (e.g., `orderService.createWalkInOrder` in `tests/integration/services/orderService.integration.test.ts`).
    *   **Database Schema & Migrations:** Implicitly tested by running migrations and interacting with the schema during test setup.
    *   **Concurrency:** Some integration tests can be designed to verify the robustness of transactional logic and pessimistic locking (e.g., ensuring `FOR UPDATE` prevents race conditions in inventory updates).
*   **Tools:** Jest, `ts-jest`, `@testcontainers/postgresql` (for spinning up a real PostgreSQL database instance per test run).
*   **Characteristics:** Slower than unit tests as they involve I/O operations with a database, but crucial for detecting issues at component boundaries. Each test run uses a clean, migrated database, with data seeded as needed per test suite or test case.
*   **Location:** `tests/integration/**/*.integration.test.ts`.

### 3. End-to-End (E2E) Tests (Future Enhancement)

*   **Purpose:** (As noted in "Next steps") To test the entire application flow from the API endpoint down to the database and back, simulating real user scenarios.
*   **Scope:**
    *   Key API endpoints (`/orders`, `/reservations`, `/products`).
    *   Complete user workflows: e.g., getting a quote, placing an order, and verifying the impact on inventory and order records.
*   **Tools:** Could involve Supertest (with Jest) for HTTP request testing against a running application instance, or more comprehensive E2E frameworks.
*   **Characteristics:** Slowest but provide the highest confidence that the system works as a whole from a user's perspective.

### 4. Performance & Load Testing (Future Enhancement)

*   **Purpose:** To assess the system's responsiveness, stability, and scalability under various load conditions. This is particularly important for operations like order placement which involve database locks and potential contention.
*   **Scope:**
    *   High-traffic API endpoints.
    *   Operations known to be resource-intensive or prone to concurrency issues (e.g., concurrent order submissions).
*   **Tools:** Tools like k6, JMeter, or Artillery could be used.
*   **Characteristics:** These are non-functional tests focused on performance metrics (latency, throughput, error rates under load) rather than the functional correctness of individual features.
