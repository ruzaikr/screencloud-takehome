module.exports = async () => {
    console.log("\nTearing down PostgreSQL Testcontainer...");
    if (global.__TEST_POSTGRES_CONTAINER__) {
        await global.__TEST_POSTGRES_CONTAINER__.stop();
        console.log("PostgreSQL Testcontainer stopped.");
    } else {
        console.log("No PostgreSQL Testcontainer found to stop.");
    }
};