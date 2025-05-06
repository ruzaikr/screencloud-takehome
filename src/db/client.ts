import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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