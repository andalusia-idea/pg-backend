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

# Copy package.json dan install hanya production dependencies untuk menekan ukuran image
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy hasil build (dist) dari tahap builder
COPY --from=builder /app/dist ./dist

# Batas heap runtime. HARUS diletakkan setelah `npm ci` — kalau di atasnya, npm
# sendiri ikut terkena batas ini dan mati dengan "JavaScript heap out of memory"
# saat memasang dependensi.
ENV NODE_OPTIONS="--max-old-space-size=150"

EXPOSE 3000

# Jalankan aplikasi
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
