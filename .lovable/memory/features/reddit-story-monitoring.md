---
name: reddit-story-monitoring
description: Reddit READ-ONLY monitoring — 11 nyelvű személyes történet, Brain csak olvas + email digest Gmail API-n át, válasz+posztolás mindig kézi
type: feature
---

# Reddit story monitoring (READ-ONLY, email digest)

## Koncepció
- A felhasználó személyes/őszinte történetét 11 nyelvre lefordítva 11 külön Reddit accountról **ő maga posztolja kézzel** a megfelelő subredditekbe.
- A Brain SOHA nem posztol, nem szavaz, nem kommentel, nem upvote-ol Redditen. Kizárólag olvas és screenshotol.
- A Brain feladata: naponta belépni az accountokba, végigolvasni az új hozzászólásokat, screenshotolni, és **email digest**-et küldeni a felhasználónak.
- Válaszolni a felhasználó fog magyarul, tömbösítve (nem minden kommentre külön). A Gemini fordítja 11 nyelvre. A **posztolás megint kézi** — az Entert mindig a felhasználó nyomja meg.

## Miért READ-ONLY (paranoid platform szabály)
A Reddit ugyanolyan paranoid, mint a Meta/TikTok/LinkedIn:
- Ha a Brain akár egy upvote-ot, akár egy komment-tervezetet automatikusan feltöltene, az anti-spam pipeline azonnal shadowbanoli az accountot.
- 11 nyelvi account = 11× lebukási felület. Egy is bukik → a történet hitelessége odavan, újraindulni gyakorlatilag lehetetlen (ugyanaz a személyes sztori, más account = azonnal duplikátum).
- Ezért: **a Brain read-only megfigyelő. Semmit nem ír Redditre.**

## Kimeneti csatorna: EMAIL (Gmail API-n át) — MINDEN MAGYARUL
- **Nem UI, hanem email.** Indoklás: a felhasználó napközben, telefonról is tudjon reagálni, nem kell a Brain dashboardot megnyitnia.
- Gmail API már be van kötve a projektbe (`GOOGLE_MAIL_API_KEY`, lásd `src/lib/gmail.functions.ts`). Erre fut a kiküldés — nem Lovable Emails, nem Resend, nem SMTP.
- **Egy összesített email cím** kap minden digest-et (a felhasználó email címe; nem külön workflow-nkénti email).
- **NYELV: a felhasználó csak magyarul olvas és ír.** A Gemini oda-vissza fordít:
  - Bejövő irány: a Reddit kommenteket (11 nyelvről) a Gemini **magyarra fordítja**, mielőtt az email digestbe kerülnek. Az eredeti nyelvű szöveg is ott van kis szürke idézetként a magyar fordítás alatt (későbbi ellenőrzés végett), de a főszöveg magyar.
  - Kimenő irány: a felhasználó magyarul ír választ emailben → Gemini lefordítja az adott komment eredeti nyelvére → piszkozat visszaküldve emailben → **a felhasználó másolja be és posztolja kézzel** Redditbe.
- Email tartalma per workflow (per Reddit account) egy szekció:
  - subreddit + poszt link
  - új komment darabszám (delta az előző digesthez képest)
  - hangulat összefoglaló (Gemini, magyarul)
  - válaszra érdemes kommentek kiemelve, **magyar fordítással + eredeti szöveggel**
  - screenshot csatolmány vagy inline kép
  - moderátori jelzések, downvote arány, ha van

## Ütemezés
- Alapból napi 1 digest email, emberi jitterrel (nem fix órában megy a Reddit olvasás).
- Ha valamelyik szál felkap (nagy komment-delta), opcionálisan 2×/nap.
- Sürgős moderátori jelzés → azonnali email.

## Proxy / account leképezés
- Ugyanaz a 12 proxy / 28 (proxy_id, language) profil stratégia, mint videós oldalon (`proxy-language-strategy`).
- 11 Reddit account = 11 nyelvi profil egy-egy szelete. Redditen mehet a belarusz/orosz/kínai is (videón nem, szankciók/blokk miatt).
- Egy IP-n egy időben csak 1 Reddit account aktív (`proxy-rules`).

## Brain task_type
- `reddit_thread_digest` — cookie-alapú login (LinkedIn/Pinterest recording minta), megnyitja az account posztolt szálait, végiggörget, screenshotol, komment-szöveget kinyer.
- **Emberi viselkedés kötelező** (`human-behavior`): Poisson időzítés, véletlen kurzor, alkalmi görgetés-hiba. Nincs fix sleep, nincs egyenes egér.
- Nincs kattintás komment-mezőbe, nincs upvote/downvote. Csak scroll + képernyőolvasás.

## Adatmodell (várható)
- `reddit_accounts` (account_id, language, proxy_id, subreddit_list)
- `reddit_threads` (account_id, subreddit, post_url, posted_at, our_title)
- `reddit_thread_digests` (thread_id, day, summary_json, screenshot_paths[], comment_count_delta, emailed_at)
- RLS: tenant-scoped, csak a tulajdonos látja.

## Ütemterv
- Elsődleges: videós LinkedIn/Pinterest login-replay + upload-replay stabilizálása.
- Reddit monitoring csak azután indul.

## Nyitott / eldöntött kérdések
- Kimenet: **EMAIL Gmail API-n át (DÖNTÖTT).**
- Digest gyakoriság: **napi 1 (DÖNTÖTT), opcionálisan 2× ha felkap.**
- Válasz-fordító funkció: később, Gemini + email piszkozat.
- Reddit account létrehozás: kézi (mint most a poszt).
