import { Pool } from "pg";
import { drizzle, NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from "./schema";
import config from '../config';

const pool = new Pool({
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
    database: config.DATABASE_NAME,
    ssl: { ca: config.DATABASE_CA },
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