ARG REVIEWED_FONT_BASE
FROM ${REVIEWED_FONT_BASE}
USER root
WORKDIR /app
# Reuse the digest-pinned reviewed exam image: Remotion, Chromium, ffmpeg and Noto fonts already installed.
COPY src ./sim-src
COPY public ./public
COPY validation ./validation
RUN chmod -R a+rX /app/sim-src /app/public /app/validation
USER 65532:65532
ENV HOME=/tmp
CMD ["bun", "sim-src/index.ts"]
