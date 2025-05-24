import { Pool } from "pg";
import { drizzle, NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from "./schema";
import config from '../config';

const disableSslEnvs = ["test", "dev"];
const connectionString =
    disableSslEnvs.includes(config.NODE_ENV)
        ? `${config.DATABASE_URL!}?sslmode=disable`
        : `${config.DATABASE_URL!}?sslmode=no-verify`;

const pool = new Pool({
    connectionString: connectionString,
});

type PgError = Error & { code?: string };

function isAdminShutdown(err: unknown): err is PgError & { code: "57P01" } {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as PgError).code === "57P01"
    );
}

/**
 * Prevent “Unhandled 'error' event” when the test container is shut down.
 * 57P01 = admin_shutdown (see https://www.postgresql.org/docs/current/errcodes-appendix.html)
 */
pool.on("error", (err, _client) => {
    if (process.env.NODE_ENV === "test" && isAdminShutdown(err)) {
        // Expected when the Testcontainer stops – swallow it.
        return;
    }
    console.error("Unexpected pg pool error:", err);
});

// Initialize Drizzle with the schema for schema-aware client and transactions
export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

/**
 * A fully-typed Drizzle transaction executor for the application.
 * This type should be used for any function parameter that expects a transaction object.
 */
export type AppTransactionExecutor = NodePgTransaction<
    typeof schema,
    ExtractTablesWithRelations<typeof schema>
>;

/**
 * A Drizzle query executor type that can represent either the main db connection
 * or a transaction, suitable for read operations.
 */
export type DatabaseExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export async function closeDb() {
    await pool.end(); // drains & closes every client
}