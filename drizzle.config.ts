import { defineConfig } from "drizzle-kit";

const url =
    process.env.NODE_ENV === "test"
        ? `${process.env.DATABASE_URL!}?sslmode=disable`
        : `${process.env.DATABASE_URL!}?sslmode=no-verify`;

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: url
    }
})