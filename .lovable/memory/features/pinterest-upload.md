---
name: Pinterest upload flow
description: Pin (videó/kép) feltöltés emberi koreográfiával — brain_task "upload_pin"
type: feature
---
Fájl: worker/executor/scripts/brain-tasks/pinterest-upload-pin.js
task_type: `upload_pin`, platform: `pinterest`

Koreográfia (KÖTELEZŐ sorrend):
1. Cookie betöltés → home feed görgetés (~3 kör)
2. Analytics benézés (business hub)
3. 1 random pin megnyitása a feedből + görgetés + vissza
4. Pin creation tool → fájl upload → cím/leírás/link/board
5. Publish + megerősítés (URL vagy toast)
6. Vissza a feedre + még 3 kör görgetés (nem tűnik el azonnal)

Kötelező brain_task mezők: media.value, title. Opcionális: description, destination_link, board_name.
Cookie kötelező (recorder session); frissített sütiket visszaadja cookies_export-ban keep-alive-nek.
