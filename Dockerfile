# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

# Install ALL dependencies (including dev) needed for building and potentially for running migration tools later
RUN npm install

COPY . .

RUN npm run build

# Stage 2: Create the production-like image
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

# Install only production dependencies for a leaner image.
# However, if 'drizzle-kit' (typically a devDep) is needed for 'npm run db:migrate'
# run via 'docker-compose exec' in development, it needs to be available.
# EITHER: Move 'drizzle-kit' to 'dependencies' in package.json (simplest for now)
# OR:     Copy it from the builder stage (more complex to manage its binaries)
# OR:     Use a multi-stage Dockerfile for migration tasks.
# Assuming 'drizzle-kit' will be moved to 'dependencies' for this dev setup.
RUN npm install --omit=dev
# If 'drizzle-kit' stays in devDependencies and you need it:
# RUN npm install # This would install devDependencies too.
# Or copy necessary parts from builder (can be tricky):
# COPY --from=builder /usr/src/app/node_modules/drizzle-kit /usr/src/app/node_modules/drizzle-kit
# COPY --from=builder /usr/src/app/node_modules/.bin/drizzle-kit /usr/src/app/node_modules/.bin/drizzle-kit

# postgresql-client is needed if 'drizzle-kit migrate' shells out to psql or for 'pg_isready'
# Drizzle ORM itself uses the 'pg' driver.
# Keeping it for now for robust migration execution and potential debugging.
RUN apk add --no-cache postgresql-client

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/openapi ./openapi
COPY --from=builder /usr/src/app/drizzle ./drizzle
COPY --from=builder /usr/src/app/drizzle.config.ts ./drizzle.config.ts
# We DO NOT copy entrypoint.sh by default into this image

EXPOSE 3002

# Environment variables like DATABASE_URL, PORT will be injected at runtime
# ENV DATABASE_URL=...
# ENV PORT=...

# Default command to start the application.
# This will be used unless overridden by docker-compose or 'docker run'.
CMD ["npm", "start"]