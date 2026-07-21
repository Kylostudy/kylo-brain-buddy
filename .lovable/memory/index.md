# Projekt Memória

## Core
- Minden válasz magyarul. Technikai zsargon helyett egyszerű magyarázat.
- Brain workflow-k KÖTELEZŐEN emberi módon viselkednek: Poisson időzítés, véletlen kurzor, alkalmi hibázás+javítás. Fix sleep / egyenes kurzor / tökéletes kattintás TILOS.
- Proxy stratégia: 12 proxy, 28 (proxy_id, language) profil. Első fázis (aug-szept): csak en + de régiók. Új proxyt csak akkor veszünk, ha a jelenlegi 12 fel van töltve.

## Memóriák
- [emberi-viselkedés](mem://features/human-behavior) — Poisson időzítés, véletlen kurzor overshoot+jitter, kötelező misclick+javítás. Brain ≠ Audit (Audit nyíltan bot lehet).
- [workflow-architektúra](mem://features/workflow-architecture) — 3 rétegű workflow rendszer: workflow, scheduled_runs, dispatcher
- [proxy-szabályok](mem://features/proxy-rules) — Azonos IP-n azonos platform = csak 1 account egyszerre, különböző platformok mehetnek párhuzamosan
- [proxy-nyelv-stratégia](mem://features/proxy-language-strategy) — VÉGLEGES 12 proxy → 28 nyelv/ország profil kiosztás, warmup+ütemterv
- [minta-elkerülés](mem://features/pattern-avoidance) — Ugyanaz az időpont nem ismétlődhet X napon belül (konkrét szám megbeszélés alatt)
- [kylogic-integráció](mem://features/kylogic-integration) — Kylogic adja az időpontokat jitterrel, Brain csak végrehajt. Konkrét paraméterek még egyeztetés alatt.
- [moduláris-architektúra](mem://features/modular-architecture) — Minden modul és workflow másolható más tenantnak, hogy ne kelljen újraépíteni
- [brain-univerzalitás](mem://features/brain-universality) — A Brain nem csak social media feltöltésre, hanem bármilyen automatizációra használható
- [kylogic-feltöltés-hiány](mem://features/kylogic-upload-gap) — Kylogic ma csak metrics/comments taskot küld; feltöltéshez hiányzó payload mezők (video_url, caption, scheduled_at, account_id, kétszálas elérhetőség) — egyeztetni Kylogic-kal
- [reddit-story-monitoring](mem://features/reddit-story-monitoring) — 11 nyelvű személyes történet Reddit posztok, Brain READ-ONLY: napi digest+screenshot, válasz mindig kézi, Gemini fordít
- [streaming-upload](mem://features/streaming-upload) — GCS→platform videó feltöltés: MOST #1 (memória-buffer, nincs lemezírás), KÉSŐBB #3 (régiónkénti upload worker 200+ videó/nap fölött). #2/b kihagyva.
- [pinterest-upload](mem://features/pinterest-upload) — Pin feltöltés brain_task `upload_pin` platform=pinterest. Human koreográfia: feed→analytics→pin→upload→feed. Fájl: worker/executor/scripts/brain-tasks/pinterest-upload-pin.js
- [tiktok-upload](mem://features/tiktok-upload) — Videó feltöltés brain_task `upload_video` platform=tiktok. Human koreográfia: For You→analytics→profil→upload→For You. Ugyanaz a Dolphin profil, mint Pinterest. Fájl: worker/executor/scripts/brain-tasks/tiktok-upload-video.js
- [account-separation](mem://features/account-separation) — Brain-only accountok kötelező. User saját profiljai SOHA nem futnak a VPS-en. FB: Kovács László profil külön HU telefonszámmal admin az összes HU Kylo oldalon. User saját FB feketelistás. TikTok/Instagram: usernek nincs is személyes, párhuzam-probléma eleve nem játszik.
- [kylo-study-positioning](mem://features/kylo-study-positioning) — Kylo.study képességprofil (nyelvvizsga fő eladhatóság + matek/kémia/fizika/rajz soronkénti magyarázattal, 3 vizsgáztatói személyiség, %-alapú értékelés). Gemini promptokhoz.
- [reddit-scout](mem://features/reddit-scout) — READ-ONLY figyelő nyelvi subredditekhez (EnglishLearning, IELTS, TOEFL, ChineseLanguage, Italian, Spanish, LearnJapanese, stb.). Publikus JSON, Gemini pontoz Kylo.study szempontból, 0-100 relevancia + magyar válaszjavaslat. Semmi auto-post.
