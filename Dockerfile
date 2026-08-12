# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (termasuk devDependencies untuk build)
RUN npm ci

# Copy source code
COPY . .

# Argument service name (auth, config, transaction)
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Build service spesifik
RUN npx nest build ${SERVICE_NAME}

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Set Node Options agar Garbage Collection lebih agresif di RAM kecil
ENV NODE_OPTIONS="--max-old-space-size=150"

# Copy package.json dan install hanya production dependencies untuk menekan ukuran image
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy hasil build (dist) dari tahap builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Jalankan aplikasi
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
