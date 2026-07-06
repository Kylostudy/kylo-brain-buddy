---
name: kylogic-upload-gap
description: Kylogic jelenleg csak metrics/comments taskot küld — feltöltéshez hiányzó payload mezők listája, egyeztetni kell velük
type: feature
---

## Jelenleg működik (2026-07-06 állapot)
Kylogic küld a `kylogic_incoming_tasks`-ba:
- `metrics_snapshot` — payload: `{platform, post_url, our_post_id}`
- `comments_snapshot` — ugyanaz
- `ping`

Ehhez elég a bejelentkezett session (cookie replay) + a `post_url`.

## Feltöltéshez HIÁNYZÓ dolgok — egyeztetés Kylogic-kal

Új task_type kell, pl. `upload_post` vagy `create_post`, ezekkel a payload mezőkkel:

1. **`video_url`** (kötelező) — GCS signed URL a videóhoz, amit le tud tölteni a worker
   - vagy `media_urls: [...]` ha több fájl (kép + videó)
   - Kylogic oldalán biztosítani kell, hogy az URL a worker futásáig érvényes (min. 24h signed URL)
2. **`caption`** (kötelező) — a poszt szövege
3. **`hashtags`** (opcionális) — külön lista vagy már a caption része
4. **`mentions`** (opcionális) — @-említések
5. **`scheduled_at`** (kötelező) — ISO timestamp, mikorra időzítve — a Brain jitterrel indítja
6. **`account_id` / `account_handle`** (kötelező) — melyik LinkedIn/Pinterest fiókra töltsön fel
   (mert egy tenant alatt több account is lehet)
7. **`platform`** — már megvan a mostani payload-ban
8. **`media_type`** (opcionális) — `video` / `image` / `carousel` — a workflow választáshoz
9. **`kylogic_user_id`** — jelenleg mindig üres, kellene tölteni

## Két szálas elérhetőség (user kérése)
- Kylogic adjon meg **másodlagos elérhetőséget / kapcsolattartót** (email + telefon)
  amit a Brain használhat, ha valami elakad (pl. 2FA lejárt, cookie halott,
  account tiltás). Jelenleg csak `kylogic_callback_url` van.
- Vagy egy `escalation_webhook_url` a `kylogic_incoming_tasks`-ba, ahova a
  Brain jelezhet, ha manuális beavatkozás kell.

## Következő lépés
Amíg ezek nincsenek beállítva Kylogic oldalon, a Brain-be a feltöltési
funkciót nem érdemes bekötni — nincs mit végrehajtania.
