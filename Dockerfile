# OpenClaw editor-agent (template)
# Railway не ставит глобальный openclaw сам (nixpacks) — поэтому образ собирается из этого Dockerfile.
FROM node:24-bookworm-slim

# Тулчейн для нативных модулей OpenClaw (better-sqlite3) + git/curl/ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# OpenClaw — фиксированная версия
RUN npm install -g openclaw@2026.5.18

WORKDIR /app
COPY . /app
RUN chmod +x /app/deploy/entrypoint.sh

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
