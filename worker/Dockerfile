# Playwright executor image — egyetlen workflow-futtatás konténerben.
# Bemenet: SPEC_JSON env változó (a workflow_runs.spec_snapshot tartalma).
# Kimenet: stdout JSON-line logok + utolsó sor { "status": "...", "result": {...} }.

FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Média- és OCR eszközök az stt_media_fetch taszkhoz
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg poppler-utils tesseract-ocr \
      xvfb xauth x11-utils \
      tesseract-ocr-hun tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa \
      tesseract-ocr-ita tesseract-ocr-pol tesseract-ocr-por tesseract-ocr-nld \
      python3 python3-venv ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

# Helyi Whisper (stt_calibrate) — CPU, int8. Modellek a /stt-corpus/_models alatt.
# Rögzített, egymással kompatibilis verziók; a build végén próbaimport, hogy
# hibás telepítés esetén már az image építése bukjon el, ne a mérés.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/whisper \
 && /opt/whisper/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
 && /opt/whisper/bin/pip install --no-cache-dir \
      "numpy<2.1" "ctranslate2==4.5.0" "av==13.1.0" "onnxruntime==1.20.1" \
      "tokenizers>=0.13,<1" "huggingface_hub>=0.13" faster-whisper==1.1.1 \
 && /opt/whisper/bin/python -c "import av, ctranslate2; from faster_whisper import WhisperModel; print('faster-whisper OK')"

# Csak az executor + spec runtime deps
COPY executor/package.json executor/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY executor/ ./

ENV NODE_ENV=production
# Headed Chromium virtuális kijelzőn (Xvfb) — a headless mód erős botjel.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DISPLAY=:99

CMD ["node", "run.js"]
