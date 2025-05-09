#!/bin/sh

set -e # Exit immediately if a command exits with a non-zero status

# Environment variables PG_HOST, PG_PORT, PG_USER, PG_DATABASE
# will be set in docker-compose.yml for the api service.
# These are used by pg_isready.
# The main application uses DATABASE_URL.

echo "Waiting for PostgreSQL at $PG_HOST:$PG_PORT to be healthy..."
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -q; do
  echo "$(date) - PostgreSQL is unavailable - sleeping"
  sleep 1
done
echo "$(date) - PostgreSQL is up and ready."

# Apply database migrations
echo "Applying database migrations..."
npm run db:migrate
echo "Database migrations applied successfully."

# Optional: Run database seed script (make sure your seed script is idempotent)
# If you want to seed the database automatically on startup:
# echo "Running database seed..."
# npm run db:seed:prod
# echo "Database seed completed."

# Execute the main command (CMD) passed to this script
echo "Starting the application..."
exec "$@"