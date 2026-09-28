# Project engineering rules

- For proxied Google Live Browse sessions, keep a no-op Playwright route enabled because Chromium proxy-auth redirects can otherwise hang.
- Treat recorder status polling as failed only after five consecutive misses, then persist the failure so sessions cannot remain falsely active.