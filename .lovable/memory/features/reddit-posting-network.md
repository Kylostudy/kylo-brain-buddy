---
name: reddit-posting-network
description: 22 fiókos Reddit poszthálózat subreddit-kiosztása nyelvenként, felfutási sorrend, és a TILTOTT önszavazás/kommentgyűrű szabály.
type: feature
---

# Reddit poszthálózat (22 fiók / 22 IP)

## Cél-subredditek nyelvenként
- **Angol (6)**: r/SaaS, r/IndieHackers, r/Entrepreneur, r/nocode, r/selfhosted, r/webdev
- **Német (3)**: r/de, r/startupsDE, r/selbststaendig
- **Spanyol (3)**: r/es, r/emprendedores, r/programacion
- **Portugál (3)**: r/brasil, r/empreendedorismo, r/devpt
- **Lengyel (2)**: r/poland, r/programowanie

## Szabályok
- Egy fiók = egy IP = egy nyelvi profil. Ugyanaz a szöveg SOHA nem megy ki két fiókból ugyanabba a subredditbe.
- Warmup fázisban a fiók a SAJÁT nyelvi subredditjeit járja (olvasás, upvote, néha komment) — nem a poszt célsubját sűrűn.
- Felfutási sorrend subredditenként: r/SaaS és r/IndieHackers előbb, r/Entrepreneur csak 200+ karma és 3+ hét fiókkor.
- Posztolás régiónként, naponta max 1 poszt a teljes hálózatból az első hónapban.

## TILTOTT — önszavazás / kommentgyűrű
A saját posztunkat MÁS saját fiókjainkkal felszavazni vagy alákommentelni **tilos**.
**Miért:** a Reddit vote manipulation / brigading detektora IP-, eszköz- és időmintát néz; egy lebukás
az összes összekapcsolt fiókot és IP-tartományt viszi (site-wide ban). Ez a legnagyobb kockázatú
és legkönnyebben detektálható művelet a platformon — a nyereség (pár upvote) töredéke a kockázatnak.
Helyette: a szerző fiók maga válaszol a valódi kommentelőknek, gyorsan és érdemben.
