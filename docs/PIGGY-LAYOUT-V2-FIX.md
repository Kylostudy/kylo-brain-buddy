# Malacpersely feliratmérési javítás

Feladat: `424bf311-fe2a-424e-9d0d-1342f9a6eb09`, recept `malacpersely-hu-trial/v1`.
VPS-hibajel: `piggy_empty_layout`, Docker-kilépési kód 1.

A feliratmérés a képalap nulla szélességét is üres elrendezésnek tekintette.
A Remotion előzetes adatértékelése méret nélküli, képernyőn kívüli befogadóba
helyezi a jelenetet. A 100%-os örökölt méret itt nulla. Böngészős, média nélküli
regressziós próba ezt reprodukálta; a fix képméret után a szöveg mérhető és
a 65/950/231/1459 határokon belül marad.

Külön készítő: `piggy-bank-layout-safe-v2`, változatlan jelenet `piggy-bank-v1`.
Forrás: `piggy-layout-v2-renderer`, előkészítő: `prepare-piggy-layout-v2-renderer.sh`.
Az eredeti v1 kép, betűk, hang, archívum, nyugták és recept változatlanok.
A javítókiadás csak a képalap méreteit deklarálja; nem kapcsolja ki a
felirat-/átfedés-/képkocka-ellenőrzéseket és nem enged további nyelvet/sorozatot.

KyLogic csak sikeres VPS-telepítés és önellenőrzés után használhatja az új
készítőt egy külön verziós receptben. A meglévő v1 recept és feladat nem
írható át. A hang és időzítés változtatása nem szükséges ehhez a hibához.
Ez a javítás nem regisztrál receptet és nem indít új próbát.

Helyi ellenőrzés: 165 Python-teszt, 3 Bun-teszt/13 állítás sikeres.
VPS-telepítés és valódi gyártási próba még nem igazolt.