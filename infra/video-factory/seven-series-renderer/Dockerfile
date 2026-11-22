ARG REVIEWED_FONT_BASE
FROM ${REVIEWED_FONT_BASE}
USER root
WORKDIR /app
COPY src ./seven-src
COPY validation ./validation
RUN chmod -R a+rX /app/seven-src /app/validation
USER 65532:65532
ENV HOME=/tmp
CMD ["bun", "seven-src/index.ts"]
