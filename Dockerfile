FROM node:18-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci || npm install

# Copy source code
COPY . .

# Argument service name sesuai package.json (auth, config, transaction, settlerecon)
ARG SERVICE_NAME
RUN npx nest build ${SERVICE_NAME}

FROM node:18-alpine AS runner
WORKDIR /app

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Copy hasil build dan node_modules yang dibutuhkan
COPY --from=builder /app/dist/apps/${SERVICE_NAME} ./dist/apps/${SERVICE_NAME}
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Jalankan main.js dari folder dist service terkait
CMD node dist/apps/${SERVICE_NAME}/main.js
