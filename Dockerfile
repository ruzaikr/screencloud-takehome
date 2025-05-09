# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

RUN npm install

# Copy the rest of the application code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Create the production image
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy package.json and lock file for installing production dependencies
COPY package.json ./
COPY package-lock.json ./

# Install only production dependencies
RUN npm install --omit=dev

RUN apk add --no-cache postgresql-client

# Copy built assets from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/openapi ./openapi
COPY --from=builder /usr/src/app/drizzle ./drizzle
COPY --from=builder /usr/src/app/drizzle.config.ts ./

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Expose the port the app runs on
EXPOSE 3002

# Set environment variables for database connection (these will be set by docker-compose)
# ENV DATABASE_URL=...
# ENV PORT=...

# Use the entrypoint script to handle migrations and start the app
ENTRYPOINT ["./entrypoint.sh"]

# Default command to start the application (will be passed to entrypoint.sh)
CMD ["npm", "start"]