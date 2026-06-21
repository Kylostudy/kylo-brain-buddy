# KyloKit — Playwright session kezelő, böngésző izoláció
# Alap: Node.js 20 + Playwright (Chromium előre telepítve)

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Alapcsomagok
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js függőségek telepítése
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Forráskód másolása
COPY src/ ./src/

# Cookie tároló és logok mappa
RUN mkdir -p /app/cookies /app/logs

# Playwright böngészők elérési útja
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "src/index.js"]
