# KyloBrain — Workflow kezelő, LEGO könyvtár, Gemini router
# Alap: Node.js 20 + Playwright (Chromium előre telepítve)

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Alapcsomagok + Playwright böngészők
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js függőségek telepítése
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Forráskód másolása
COPY src/ ./src/

# LEGO könyvtár (moduláris kódok tárolója)
RUN mkdir -p /app/lego-library /app/logs

# Playwright böngészők elérési útja
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production
ENV PORT=3000

# Health check — 30 másodpercenként ellenőrzi, hogy él-e a szerver
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "src/index.js"]
