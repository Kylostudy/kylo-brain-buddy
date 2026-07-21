# Recorder image — interaktív, élő böngésző-felvétel a felhasználónak.
# Egy konténer-példány több párhuzamos session-t is kiszolgál
# (külön Playwright browser-context-tel sessionönként).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb xauth \
  && rm -rf /var/lib/apt/lists/*

COPY recorder/package.json recorder/package-lock.json* ./
RUN npm install --omit=dev

COPY recorder/ ./
COPY executor/scripts/fingerprint-patch.js ./fingerprint-patch.js
RUN mkdir -p /executor/scripts
COPY executor/scripts/fingerprint-patch.js /executor/scripts/fingerprint-patch.js
RUN chmod +x ./start-recorder.sh

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DISPLAY=:99

CMD ["./start-recorder.sh"]
