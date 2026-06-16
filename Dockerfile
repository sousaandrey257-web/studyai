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

# su-exec: lightweight tool to drop privileges (like gosu but smaller)
RUN apk add --no-cache su-exec

# Security: create non-root user (runs via su-exec after volume chown)
RUN addgroup -g 1001 -S studyai \
    && adduser  -u 1001 -S studyai -G studyai

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (exclude files via .dockerignore)
COPY . .

# Entrypoint: chowns Railway volume to studyai, then drops privileges
RUN chmod +x entrypoint.sh

# Create data directory so it exists in the image
RUN mkdir -p data/backups && chown -R studyai:studyai data

# Run as root so entrypoint.sh can chown the mounted volume
USER root

# Expose port
EXPOSE 3000

# Health check — lightweight endpoint, no auth required
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Entrypoint chowns /app/data then drops to studyai
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
