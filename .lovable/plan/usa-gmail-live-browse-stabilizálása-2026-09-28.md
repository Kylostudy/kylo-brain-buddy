# USA Gmail Live Browse stabilizálása

## Javítás
- A Google átirányításaihoz bekapcsolom a proxyhitelesítés ismert böngészőhibájának célzott kerülőútját.
- A kerülőút csak proxyn futó Live Browse esetén él, más workflow-k működését nem változtatja meg.
- Ha a böngésző vagy a képfolyam ténylegesen megszakad, a munkamenet hibával lezárul, nem marad hamisan aktív.

## Ellenőrzés
- Ellenőrzöm a felvevő kódját és a csomag összeállását.
- Frissítem a szervert.
- Új USA Gmail Live Browse próbával ellenőrzöm, hogy a Google-oldal képe megjelenik, és a munkamenet nem ragad be.
