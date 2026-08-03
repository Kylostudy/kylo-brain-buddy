# Playwright executor image — egyetlen workflow-futtatás konténerben.
# Bemenet: SPEC_JSON env változó (a workflow_runs.spec_snapshot tartalma).
# Kimenet: stdout JSON-line logok + utolsó sor { "status": "...", "result": {...} }.

FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Média- és OCR eszközök az stt_media_fetch taszkhoz
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg poppler-utils tesseract-ocr \
      tesseract-ocr-hun tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa \
      tesseract-ocr-ita tesseract-ocr-pol tesseract-ocr-por tesseract-ocr-nld \
      python3-minimal ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

# Csak az executor + spec runtime deps
COPY executor/package.json executor/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY executor/ ./

ENV NODE_ENV=production
# Ne legyen X szerver — Playwright headless
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "run.js"]
