import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: "postgresql://oms_staging:l8syz6gMr9m9FBBu4Dxn@oms-staging-default-db.cha2ik2us81v.ap-southeast-1.rds.amazonaws.com:5432/oms_staging?sslmode=no-verify",
    }
})