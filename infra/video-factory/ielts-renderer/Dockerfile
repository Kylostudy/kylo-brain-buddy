FROM oven/bun:1.3.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg bash python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --production
COPY src ./src
COPY tight-cut.sh ./tight-cut.sh
RUN chmod -R a+rX /app
USER 65532:65532
ENV HOME=/tmp
CMD ["bun", "src/index.ts"]