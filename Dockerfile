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

RUN npm install --omit=dev

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/openapi ./openapi
COPY --from=builder /usr/src/app/drizzle ./drizzle
COPY --from=builder /usr/src/app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3002

# Default command to start the application.
# This will be used unless overridden by docker-compose or 'docker run'.
CMD ["npm", "start"]