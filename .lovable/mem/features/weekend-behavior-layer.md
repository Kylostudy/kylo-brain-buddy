---
name: hétvégi viselkedési réteg
description: Kylogic adja az időpontot, Brain csak igazít a fiók helyi ideje szerint: H–P 07–09 indulás, Szo 09–11 indulás késő estig, V 13–20; nincs kerek perc, 3 hétig ±30 perc ismétlés tilos
type: feature
---
Döntés: a Kylogic marad az időpontok forrása, a Brain CSAK igazít (nem generál saját heti tervet).
- Ablakok fiók helyi ideje szerint, fiókonként + hetente eltolt sávval: H–P 07–09 → ~21–22:30; Szo 09–11 → ~22:30–23:40; V 13–14:30 → ~19–20:30.
- Szünet ugyanazon fiók posztjai között: H–P 40–90 perc, Szo 70–160, V 90–200.
- Soha nem kerek perc (5-tel osztható tilos), másodperc is véletlen.
- Ugyanaz a fiók ugyanazon a hét-napon az előző 3 hétben ±30 percen belül nem posztol.
- Két fiók nem posztol ±3 percen belül.
- Darabszámot a Brain nem dob el (szokásos: H–P 4, Szo 3, V 2 — túllépést naplóz); a mennyiséget és a tartalom-mixet a Kylogic szabályozza.
- Napló: brain_task_queue payload._timing.
