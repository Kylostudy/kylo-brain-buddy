# Playwright executor image — egyetlen workflow-futtatás konténerben.
# Bemenet: SPEC_JSON env változó (a workflow_runs.spec_snapshot tartalma).
# Kimenet: stdout JSON-line logok + utolsó sor { "status": "...", "result": {...} }.

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Csak az executor + spec runtime deps
COPY executor/package.json executor/package-lock.json* ./
RUN npm ci --omit=dev

COPY executor/ ./

ENV NODE_ENV=production
# Ne legyen X szerver — Playwright headless
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "run.js"]
