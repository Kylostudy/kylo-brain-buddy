---
name: reddit-scout
description: READ-ONLY Reddit figyelő nyelvi subredditekhez — publikus JSON + Gemini pontozás (Kylo.study relevancia). Külön a Reddit posztoló accountoktól. Semmi auto-post.
type: feature
---

# Reddit Scout (read-only figyelő)

## Cél
Nyelvi subredditek felkutatása bekapcsolódási pontokra: hol tudunk **segítséggel** (nem reklámmal) hozzászólni a beszélgetéshez, ahol a Kylo.study releváns eszköz.

## Elsődleges subredditek
- **Angol**: r/EnglishLearning, r/IELTS, r/TOEFL
- **Kínai**: r/ChineseLanguage, r/SpeakChinese
- **Olasz**: r/Italian, r/italy
- **Spanyol**: r/Spanish, r/learnspanish
- **Japán**: r/LearnJapanese, r/japanlife

Később bővítjük.

## Architektúra
- **Külön workflow-típus**: `monitor_type: reddit-readonly-scout` — TELJESEN elválasztva a Reddit Inbox (posztoló) workflow-któl.
- Táblák: `reddit_readonly_watches` (workflow-onként subreddit-lista + Kylo pozicionálás), `reddit_readonly_findings` (Gemini-vel pontozott szálak).
- UI: `/reddit-scout` (csak Brain modul, saray oldalsávban).
- Beolvasás: publikus Reddit JSON (`/r/<sub>/new.json`), bejelentkezés nélkül.
- Elemzés: Gemini 2.5 flash, 8-as batch, JSON schema. Kimenet: relevancia (0-100) + magyar magyarázat + magyar válaszjavaslat (csak ha >=60).

## Alapelvek
- **Semmi automatikus válasz.** Csak megfigyelés + javaslat. Posztolás mindig kézi (Reddit Inbox modul).
- **Semmi cookie / session.** Publikus JSON-t olvas, kockázat = 0 a posztoló accountoknak.
- Proxy: NL IPRoyal mögé kerül (döntés), hogy anonim legyen és ne kössük össze a posztoló accountjainkkal — jelenleg direkt szerverről fut (Cloudflare Worker fetch); ha Reddit blokkolna, VPS worker task-ra kerül át.

## Nyitott
- Ütemezés (cron 2×/nap): még nincs bekötve, kézi „Scan most" gomb működik.
- Ütemezett futáshoz `/api/public/hooks/reddit-scout` route + pg_cron kell később.
