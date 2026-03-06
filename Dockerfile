# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./

# Install ALL dependencies (dev tools needed to compile TypeScript)
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy manifests and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Default to stdio transport.
# Override with -e MCP_MODE=http to run the HTTP server.
ENV MCP_MODE=stdio
ENV PORT=3000

EXPOSE 3000

# stdio mode: docker run -i --rm <image>
# http  mode: docker run -p 3000:3000 -e MCP_MODE=http <image>
ENTRYPOINT ["node", "dist/index.js"]
