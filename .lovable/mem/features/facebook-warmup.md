---
name: Facebook bemelegítés
description: HU IP-s Facebook fiók passzív melegítése — csak süti-alapú belépés, soha nem posztol/kommentel, checkpoint esetén azonnal leáll
type: feature
---

- Task type: `facebook_warmup` (worker: `brain-tasks/facebook-warmup.js`), workflow: „HU Facebook".
- **Kizárólag mentett sütikkel lép be.** Jelszavas belépés TILOS: új helyről azonnal
  ellenőrző-kódot / fiókzárolást hozna. Lejárt süti = hibaüzenet, nem próbálkozás.
- Soha nem posztol, kommentel, üzen, ismerőst jelöl. Reakció (like) csak ~20% eséllyel,
  csak a hírfolyamban.
- Tevékenység: hírfolyam görgetés + alkalmi mellékutca (Videók, Marketplace, Csoportok, Ismerősök).
- Checkpoint / „fiók zárolva" / biztonsági ellenőrzés észlelésekor a futás AZONNAL leáll.
- Alap időtartam 20 perc (max 60). Naponta 1 futás, mindig ugyanarról a magyar IP-ről.
