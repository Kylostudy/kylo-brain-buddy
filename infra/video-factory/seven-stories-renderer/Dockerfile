ARG REVIEWED_FONT_BASE
FROM ${REVIEWED_FONT_BASE}
USER root
WORKDIR /app
# Reuse the existing digest-reviewed font/dependency image without reinstalling fonts.
COPY src ./seven-src
COPY public ./public
COPY validation ./seven-validation
RUN mkdir -p /app/validation && cp /app/seven-validation/* /app/validation/ && chmod -R a+rX /app/seven-src /app/public /app/validation
USER 65532:65532
ENV HOME=/tmp
CMD ["bun", "seven-src/index.ts"]