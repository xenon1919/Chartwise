# syntax=docker/dockerfile:1
# Single image: the gateway serves the built web app on port 5050 and talks to the
# analytics engine running alongside it on 127.0.0.1:8001.

# ---------- 1. Build the web app ----------
FROM node:22-slim AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- 2. Gateway production dependencies ----------
FROM node:22-slim AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. Runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production \
    PORT=5050 \
    ENGINE_URL=http://127.0.0.1:8001

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Node runtime only (no npm needed at runtime)
COPY --from=client /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

COPY engine/requirements.txt engine/requirements.txt
RUN pip install -r engine/requirements.txt

COPY engine/app engine/app
COPY engine/samples engine/samples
COPY --from=server /build/server/node_modules server/node_modules
COPY server/package.json server/package.json
COPY server/src server/src
COPY --from=client /build/client/dist client/dist
COPY docker/start.sh /usr/local/bin/start.sh

RUN chmod +x /usr/local/bin/start.sh \
    && useradd --create-home --uid 10001 app \
    && mkdir -p engine/storage server/data \
    && chown -R app:app engine/storage server/data engine/samples

USER app

# Uploaded datasets and question history survive container restarts when mounted
VOLUME ["/app/engine/storage", "/app/server/data"]

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5050/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["start.sh"]
