# Recorder image — interaktív, élő böngésző-felvétel a felhasználónak.
# Egy konténer-példány több párhuzamos session-t is kiszolgál
# (külön Playwright browser-context-tel sessionönként).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY recorder/package.json recorder/package-lock.json* ./
RUN npm install --omit=dev

COPY recorder/ ./
COPY executor/scripts/fingerprint-patch.js ./fingerprint-patch.js
RUN mkdir -p /executor/scripts
COPY executor/scripts/fingerprint-patch.js /executor/scripts/fingerprint-patch.js

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "index.js"]
