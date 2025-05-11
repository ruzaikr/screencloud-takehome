const { PostgreSqlContainer } = require("@testcontainers/postgresql");
const { execSync } = require("child_process");
const path = require("path");

module.exports = async () => {
    console.log("\nSetting up PostgreSQL Testcontainer...");

    const container = await new PostgreSqlContainer("postgres:15-alpine")
        .withDatabase("test_oms_db")
        .withUsername("test_user")
        .withPassword("test_password")
        .withExposedPorts(5432)
        .start();

    process.env.DATABASE_URL = container.getConnectionUri();
    // Drizzle Kit needs these explicitly for some environments or if connection string isn't fully parsed by it.
    // However, a full URL should be sufficient.
    // process.env.PGHOST = container.getHost();
    // process.env.PGPORT = container.getMappedPort(5432).toString();
    // process.env.PGUSER = container.getUsername();
    // process.env.PGPASSWORD = container.getPassword();
    // process.env.PGDATABASE = container.getDatabase();


    console.log(`Testcontainer DATABASE_URL: ${process.env.DATABASE_URL}`);
    console.log("Running Drizzle migrations...");

    try {
        // Assuming drizzle.config.ts is at the root and will pick up DATABASE_URL from process.env
        // The command needs to be run from the project root context.
        // Jest's globalSetup runs from the project root.
        execSync("npx drizzle-kit migrate --config drizzle.config.ts", {
            stdio: "inherit",
            env: { ...process.env }, // Pass current environment variables
        });
        console.log("Drizzle migrations completed.");
    } catch (error) {
        console.error("Failed to run Drizzle migrations:", error);
        // Attempt to stop the container if migrations fail to prevent leaks
        await container.stop();
        throw error; // Propagate error to fail the setup
    }

    global.__TEST_POSTGRES_CONTAINER__ = container;
    console.log("PostgreSQL Testcontainer setup complete.");
};