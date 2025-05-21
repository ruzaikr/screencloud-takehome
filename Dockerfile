# Stage 1: Build the application
FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS builder
RUN curl -sL https://rpm.nodesource.com/setup_20.x | bash - && \
    dnf install -y nodejs npm git make gcc-c++ python3 && dnf clean all

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./

# Install ALL dependencies (including dev) needed for building and potentially for running migration tools later
RUN npm ci

COPY . .

RUN npm run build

# Stage 2: Create the production-like image
FROM public.ecr.aws/amazonlinux/amazonlinux:2023
RUN curl -sL https://rpm.nodesource.com/setup_20.x | bash - && \
    dnf install -y nodejs npm && dnf clean all

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