ARG REVIEWED_FONT_BASE
FROM ${REVIEWED_FONT_BASE}
USER root
WORKDIR /app
# Reuse digest-pinned reviewed image and its already installed Noto fonts/dependencies.
COPY src ./piggy-src
COPY public ./public
COPY validation ./validation
RUN chmod -R a+rX /app/piggy-src /app/public /app/validation
USER 65532:65532
ENV HOME=/tmp
CMD ["bun", "piggy-src/index.ts"]