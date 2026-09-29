# Project engineering rules

- For proxied Google Live Browse sessions, keep a no-op Playwright route enabled because Chromium proxy-auth redirects can otherwise hang.
- Treat recorder status polling as failed only after five consecutive misses, then persist the failure so sessions cannot remain falsely active.
- Launch recorder Chromium with handleSIGTERM/SIGINT/SIGHUP false, because Playwright otherwise kills live sessions during blue-green drain.
- Pinterest Live Browse sessions load the official Google Translate extension via launchPersistentContext (--load-extension, worker/recorder/extensions/google-translate) because extensions cannot load in ephemeral browser contexts; TRANSLATE_EXTENSION=off disables it.
