# Project engineering rules

- For proxied Google Live Browse sessions, keep a no-op Playwright route enabled because Chromium proxy-auth redirects can otherwise hang.
- Treat recorder status polling as failed only after five consecutive misses, then persist the failure so sessions cannot remain falsely active.
- Launch recorder Chromium with handleSIGTERM/SIGINT/SIGHUP false, because Playwright otherwise kills live sessions during blue-green drain.
- Pinterest Live Browse sessions load the official Google Translate extension via launchPersistentContext (--load-extension, worker/recorder/extensions/google-translate) because extensions cannot load in ephemeral browser contexts; TRANSLATE_EXTENSION=off disables it.
- Social credentials, cookies, and persistent browser profiles are isolated by workflow account and platform; never inherit or copy them by country, proxy, tenant, or sibling workflow, because that creates cross-account identity conflicts.
- Recorder and executor profiles live on host-backed persistent volumes and use the real Linux browser identity; locale and timezone follow proxy geography, preventing a fresh-device signal and OS contradictions.
