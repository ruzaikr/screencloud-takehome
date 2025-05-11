# ScreenCloud Order Management System (OMS)

A **TypeScript + Express** backend that lets ScreenCloud’s sales team price‑check and place hardware orders while automatically allocating inventory across multiple global warehouses at the lowest possible shipping cost.

---

## Key features

| Capability            | Details                                                                                                                                                   |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Quote / Feasibility   | `POST /reservations?reserve=false` calculates total price, discount tiers, shipping cost, and returns a boolean validity flag without touching inventory. |
| Submit Order          | `POST /orders` creates an atomic order, allocates inventory *optimally* across warehouses, deducts stock, and logs every movement.                        |
| Product catalogue     | `GET /products` returns the current device catalogue (only the *SCOS Station P1 Pro* for now).                                                            |
| OpenAPI docs          | Swagger UI is auto‑hosted at `/docs` and kept in‑repo (`openapi/openapi.json`).                                                                           |
| Database‑first schema | Postgres 15 with **Drizzle ORM/Kit** migrations, seed data, and strongly‑typed queries.                                                                   |
| Tests                 | Jest unit tests **and** containerised integration tests (PostgreSQL Testcontainers).                                                                      |
| Docker‑first Dev Exp  | One‑command startup for dev & CI; multi‑stage production image.                                                                                           |

---

## Quick start (Recommended)

> **Prerequisites:** Docker 20+, Docker Compose v2.

1. **Clone**
   ```bash
   git clone <repo-url>
   cd <directory>
   ```
2. **Start the Docker Dev Environment**

    ```bash
    # Build and start API + Postgres with live‑reloading
    npm run docker:dev:up
    ```
   
3. **DB Migration and Seed**
    ```bash
    # Run DB Migration
    npm run docker:dev:db:migrate
    
    # Seed DB
    npm run docker:dev:db:seed
    ```

The API will be live on [http://localhost:3002](http://localhost:3002), Swagger docs at [http://localhost:3002/docs](http://localhost:3002/docs).

```bash
# View logs
npm run docker:dev:logs

# DB Shell Access
npm run docker:dev:db:shell

# Stop containers and free volumes
npm run docker:dev:down
```
---

## Running tests

| Command                    | What it runs                                                              |
|----------------------------|---------------------------------------------------------------------------|
| `npm run test:unit`        | Unit suite only.                                                          |
| `npm run test:integration` | Integration suite only - spins up disposable Postgres via Testcontainers. |

> **Note** Integration tests require Docker locally **or** CI with privileged containers.

---

## Local development (without Docker)

1. **Clone & install**

   ```bash
   git clone <repo-url>
   cd <directory>
   npm ci
   ```
2. **Postgres** – start a local 15‑alpine instance (Docker or native) and create a database, e.g. `oms_db`.
3. **Environment** – copy and edit the template:

   ```bash
   cp .env.example .env
   # adjust DATABASE_URL etc.
   ```
4. **Migrate & seed**

   ```bash
   npm run db:migrate   # creates tables
   npm run db:seed      # loads initial dataset
   ```
5. **Run the server**

   ```bash
   npm run dev
   ```

---

## Project structure

```
├─ src/
│  ├─ config/             # env parsing & validation
│  ├─ routes/             # express routers (orders, reservations, products)
│  ├─ services/           # business logic orchestration
│  ├─ repositories/       # DB access (knows Drizzle)
│  ├─ db/
│  │  ├─ schema.ts        # Drizzle schema & enums
│  │  ├─ seed.ts          # demo data loader
│  │  └─ client.ts        # pg + Drizzle initialisation
│  ├─ errors/             # typed operational errors
│  ├─ utils/              # pure helpers (distance, allocation)
│  └─ index.ts            # HTTP bootstrap & global error handler
├─ tests/
│  └─ integration         # integration tests
├─ openapi/               # hand‑crafted OpenAPI spec
├─ drizzle.config.ts      # migration config
├─ docker-compose.dev.yml # dev container stack
├─ Dockerfile             # multi‑stage build

```

---

## Environment variables

| Variable                                      | Required | Example                               | Purpose                                            |
|-----------------------------------------------|----------|---------------------------------------|----------------------------------------------------|
| `PORT`                                        | yes      | `3002`                                | HTTP port API listens on.                          |
| `DATABASE_URL`                                | yes      | `postgres://user:pass@db:5432/oms_db` | Postgres connection string.                        |
| `RESERVATION_TTL_MINUTES`                     | yes      | `10`                                  | How long a provisional reservation stays `ACTIVE`. |
| `SHIPPING_COST_CENTS_PER_KG_PER_KM`           | yes      | `1`                                   | Rate for shipping cost calculation.                |
| `SHIPPING_COST_MAX_PERCENTAGE_OF_ORDER_VALUE` | yes      | `15`                                  | Max % of post‑discount value shipping may cost.    |

A ready‑made **`.env.example`** is included.

---

## Error handling & validation

* **Zod** drives request‐body schemas and pipes to typed `ZodValidationError`s for consistent 400 responses.
* Custom `ApiError` subclasses map domain problems to HTTP semantics (409 **InsufficientInventoryError**, 400 **ShippingCostExceededError**, …).

---

## Design highlights

* **Thin Express routers → services → repositories** keeps HTTP glue separate from domain & persistence.
* **Single‑source schema** – Drizzle schema feeds runtime types, migrations and seed data.
* **Inventory allocation algorithm** – picks cheapest shipping warehouses first while respecting stock & reservations, then computes shipping cost and validates upper bound.
* **Transaction‑safe order placement** – entire flow wrapped in `db.transaction`, inventory rows `FOR UPDATE`‑locked, ensuring no double‑allocate race.

---

## Next steps (given more time)

1. Extend the `POST /reservations` endpoint to hold inventory for a specific period of time.
2. **Add endpoints** for the following:
   1. Release a reservation: `PATCH /reservations/:id`.
   2. Re-stock/adjust inventory of a product in a warehouse.
   3. Create/Read/Update/Delete warehouses.
   4. Create/Read/Update/Delete products.
   5. Manage volume discounts for products.
3. Multiple currency support
4. Retry mechanisms for when an operation like submitting an order fails due to a race condition.
5. **E2E Tests**
6. **Authentication & RBAC** – JWT for sales reps vs admin; audit trails.
7. **CI/CD** – GitHub Actions pipeline ➜ push triggers lint + test + docker build + deploy.
8. **Observability** – structured JSON logs + OpenTelemetry traces; Prometheus metrics on allocation failures, shipping cost breaches.

---

## Known Issues

* Integration tests complete successfully, but Jest surfaces a benign `ERR_UNHANDLED_ERROR (57P01)` when the PostgreSQL Testcontainer shuts down during global teardown. This noise can be safely ignored (or filtered out) while we work on a cleaner shutdown hook.
* Inventory Repository integration test still asserts on a literal error string. Introduce a purpose-built `InventoryAllocationError` (or reuse an existing domain error) and update the test to `expect(...).rejects.toThrow(InventoryAllocationError)` instead of regex-matching the message.
