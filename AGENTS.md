# Project engineering rules

- For proxied Google Live Browse sessions, keep a no-op Playwright route enabled because Chromium proxy-auth redirects can otherwise hang.
- Treat recorder status polling as failed only after five consecutive misses, then persist the failure so sessions cannot remain falsely active.
- Launch recorder Chromium with handleSIGTERM/SIGINT/SIGHUP false, because Playwright otherwise kills live sessions during blue-green drain.
- Pinterest Live Browse sessions load the official Google Translate extension via launchPersistentContext (--load-extension, worker/recorder/extensions/google-translate) because extensions cannot load in ephemeral browser contexts; TRANSLATE_EXTENSION=off disables it.
- Social credentials, cookies, and persistent browser profiles are isolated by workflow account and platform; never inherit or copy them by country, proxy, tenant, or sibling workflow, because that creates cross-account identity conflicts.
- Recorder and executor profiles live on host-backed persistent volumes and use the real Linux browser identity; locale and timezone follow proxy geography, preventing a fresh-device signal and OS contradictions.
- STT raw audio and reference texts stay on the VPS corpus volume (STT_CORPUS_HOST_DIR → /stt-corpus); stt_media_fetch defaults to local storage and stt_calibrate returns only small accuracy results, because cloud storage of the corpus is too costly.
- Membership archives (membership_archive / membership_transcribe) keep media, transcripts and manifest.json only on the VPS volume (MEMBERSHIP_HOST_DIR → /membership); only small status results and text chunks for structuring leave the VPS, because the content is the owner's private paid material.
- The Brain reaches the VPS file server only via its HTTPS hostname (vaultFileBaseUrl), never a bare IP, because Cloudflare Workers reject outbound fetches to raw IPs with 403.
- worker/deploy.sh re-execs itself once right after git pull, because bash reads scripts lazily and a pull that rewrites deploy.sh corrupts the running instance.
