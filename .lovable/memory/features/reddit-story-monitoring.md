---
name: reddit-story-monitoring
description: Reddit read-only monitoring stratégia — 11 nyelvű személyes történet posztok, Brain csak olvas + összefoglal, válasz mindig kézi
type: feature
---

# Reddit story monitoring (READ-ONLY)

## Koncepció
- A felhasználó személyes/őszinte történetét 11 nyelvre lefordítva 11 külön Reddit accountról ő maga posztolja **kézzel** a megfelelő subredditekbe.
- Nem automatizált a posztolás. A Brain SOHA nem posztol, nem szavaz, nem kommentel Redditen.
- A Brain feladata: naponta belépni az accountokba, elolvasni az új hozzászólásokat, screenshotolni, és **tömörített összefoglalót** adni a felhasználónak.
- Válaszolni a felhasználó fog magyarul, tömbösítve (nem minden kommentre külön). A Gemini fordítja le a választ 11 nyelvre. A posztolás megint kézi.

## Proxy / account leképezés
- Ugyanaz a 12 proxy / 28 (proxy_id, language) profil stratégia, mint videós oldalon (lásd `proxy-language-strategy`).
- 11 Reddit account = 11 nyelvi profil egy-egy szelete. Belarusz / orosz + Kína Redditen igen (videós oldalon nem).
- Egy IP-n egy időben csak 1 Reddit account aktív (lásd `proxy-rules`).

## Brain feladat (új task_type)
- `reddit_thread_digest` — bejelentkezik cookie-val (login recording ugyanaz a minta, mint LinkedIn/Pinterest), megnyitja az account által posztolt szálakat, végiggörgeti a kommenteket, screenshotol, HTML-t/kommentszöveget kinyer.
- Gemini vision + text → strukturált összefoglaló per szál:
  - hangulat (pozitív/negatív/vegyes), új kommentek száma, felkapott témák, konkrét kérdések a felhasználónak, moderátori jelzések, downvote arány.
  - Nem az összes komment szövege, csak a lényeg + a válaszra érdemes szálak.
- Ütemezés: alapból naponta 1×, opcióként 2 naponta. Emberi jitter (nem fix órában).

## Kimeneti felület (megbeszélés alatt)
Opciók, amit javasolni fogunk:
1. Új "Reddit Inbox" nézet a Brain UI-ban (workflow-hoz kötött napi digest lista + screenshotok).
2. Napi email digest a felhasználónak.
3. Telegram üzenet (van már Telegram connector).
A **default javaslat: Brain UI Reddit Inbox nézet**, mert ott a screenshotok és a válaszszerkesztő is egy helyen van, és később a "válasz megírása magyarul → Gemini 11 nyelvre fordítja → kész poszt-szöveg copy-paste" folyamat is ide integrálható.

## Adatmodell (várható)
- Új tábla vagy meglévő `brain_task_queue` kiterjesztése:
  - `reddit_accounts` (account_id, language, proxy_id, subreddit_list)
  - `reddit_threads` (account_id, subreddit, post_url, posted_at, our_title)
  - `reddit_thread_digests` (thread_id, day, summary_json, screenshot_paths[], comment_count_delta, unread)
- RLS: tenant-scoped, csak a tulajdonos látja.

## Ütemterv
- Videós feltöltés (LinkedIn/Pinterest) most az elsődleges — ez holnap folytatódik.
- Reddit monitoring: külön workflow-típus, csak akkor kezdjük építeni, ha a videós login-replay + upload-replay ciklus stabilan megy.

## Nyitott kérdések
- Melyik felületre menjen a digest (UI / email / Telegram)?
- Milyen gyakoriságú digest az alap (1× / 2× nap)?
- Kell-e külön "válasz-fordító" funkció a Brain UI-ban, vagy elég a Gemini külön hívás?
- Reddit account létrehozás: kézi (mint most a poszt) vagy Brain warmup-flow?
