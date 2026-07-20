## Cél
Reddit angol nyelvű regisztrációk beindítása 5 különböző account-tal, kommentek automatikus figyelése, és belső Inbox a kézi válaszadáshoz — mind a Brain modulon belül.

## Lépés 1 — Reddit workflow-k (5 db)
Létrehozok 5 Reddit workflow-t az adatbázisban a bejelentkezett felhasználó tenantjához:
- `reddit-au` (Ausztrália)
- `reddit-ca` (Kanada)
- `reddit-gb` (Egyesült Királyság)
- `reddit-us` (USA)
- `reddit-nl` (Hollandia)

Mindegyik: `module: 'brain'`, `status: 'draft'`, `spec.platform: 'reddit'`, `spec.monitor_type: 'reddit-account'`, `spec.locale` és `spec.subreddits` alapértékek.

## Lépés 2 — Reddit Inbox adatbázis
Új táblák a `public` sémában (RLS-sel, GRANT-tel):

- `reddit_accounts` — workflow-hoz kötött Reddit fiók metaadatok (username, karma, létrehozás dátuma, status).
- `reddit_comments` — begyűjtött kommentek: workflow_id, account_id, permalink, author, body_en (eredeti), body_hu (magyar fordítás), suggested_reply_hu (Gemini javaslat magyarul), suggested_reply_en (Gemini javaslat angolul), reply_status (`pending` | `answered` | `ignored`), collected_at.

## Lépés 3 — Read-only monitoring backend
- Új szerverfüggvény `reddit-monitor.functions.ts`:
  - `fetchRedditComments(workflowId)` — pillanatnyilag Reddit publikus JSON API-ról olvassa be a subreddit inbox / user mentions listát (bejelentkezés nélkül, publikus adat).
  - Minden új kommentre Gemini hívás: magyar fordítás + magyar és angol válaszjavaslat.
  - Eredmény mentése `reddit_comments`-be.
- `generateReplySuggestion(commentId, hungarianDraft)` — a felhasználó által írt magyar szöveget fordítja angolra Geminivel; visszaadja a tiszta angol szöveget másoláshoz.
- Ütemezés: pg_cron TanStack public API route-ra hívva, kétnaponta reggel 8:00 CET.

## Lépés 4 — Inbox UI
Új útvonal: `_authenticated.inbox.tsx` (a bal oldalsávban „Inbox" néven, csak Brain modulban).
- Bal oldal: 5 Reddit account fül; jobb oldal: pending kommentek listája.
- Egy komment kártya: eredeti angol szöveg, magyar fordítás, Gemini javaslat magyarul (szerkeszthető mező), plain-text mező a végleges magyar válaszhoz, „Fordítás angolra" gomb, „Másolás vágólapra" gomb (tiszta plain text), „Megválaszoltnak jelöl" és „Elrejt" gombok.
- Nincs auto-post — csak kézi másolás és beillesztés Redditbe.

## Technikai megjegyzések
- A Reddit crawler egyelőre a publikus JSON végponttal dolgozik (`old.reddit.com/user/<user>/comments.json`), később bejelentkezéses módra bővíthető, ha karmagyűjtés után account-specifikus feed kell.
- A workflow-lock (nincs auto-run, ha nyitva a Live Browse) már az előző körben elkészült — nem érintjük.
- Anti-detect a kézi Reddit használathoz: külön proxy account-onként, plain-text Ctrl+C/Ctrl+V (nem Wordből), pár perces késleltetés a posztolás előtt.

## Nem része ennek a körnek
- Reddit auto-poster runner (VPS worker kód) — külön körben.
- Fejlettebb keyword-alapú subreddit scraping — később.
