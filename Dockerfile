# ============================================================
#  StudyAI — Production Dockerfile
#  Multi-stage build: deps → prune → final
#  Target: Node 20 LTS Alpine (minimal attack surface)
# ============================================================

# ── Stage 1: Install production dependencies ─────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first (layer caching)
COPY package.json package-lock.json ./

# Install production deps only; skip optional (ioredis/bullmq handled at runtime)
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# ── Stage 2: Final image ──────────────────────────────────────
FROM node:20-alpine AS final

# Security: run as non-root
RUN addgroup -g 1001 -S studyai \
    && adduser  -u 1001 -S studyai -G studyai

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps --chown=studyai:studyai /app/node_modules ./node_modules

# Copy application source (exclude files via .dockerignore)
COPY --chown=studyai:studyai . .

# Create data directory with correct ownership
RUN mkdir -p data/backups \
    && chown -R studyai:studyai data

# Drop to non-root user
USER studyai

# Expose port
EXPOSE 3000

# Health check — lightweight endpoint, no auth required
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Start server
CMD ["node", "server.js"]
