# Recorder image — interaktív, élő böngésző-felvétel a felhasználónak.
# Egy konténer-példány több párhuzamos session-t is kiszolgál
# (külön Playwright browser-context-tel sessionönként).
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY recorder/package.json recorder/package-lock.json* ./
RUN npm install --omit=dev

COPY recorder/ ./

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "index.js"]
