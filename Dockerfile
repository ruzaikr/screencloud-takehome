# Stage 1: Build the application
FROM node:20-slim AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

# Install ALL dependencies (including dev) needed for building and potentially for running migration tools later
RUN npm ci

COPY . .

RUN npm run build

# Stage 2: Create the production-like image
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    curl -sSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
         -o /usr/local/share/ca-certificates/aws-rds-ca.crt && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

RUN npm ci --omit=dev

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/openapi ./openapi
COPY --from=builder /usr/src/app/drizzle ./drizzle
COPY --from=builder /usr/src/app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3002

# Default command to start the application.
# This will be used unless overridden by docker-compose or 'docker run'.
CMD ["npm", "start"]