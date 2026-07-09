---
name: TikTok upload flow
description: Videó feltöltés emberi koreográfiával — brain_task "upload_video", platform "tiktok"
type: feature
---
Fájl: worker/executor/scripts/brain-tasks/tiktok-upload-video.js
task_type: `upload_video`, platform: `tiktok`

Koreográfia (KÖTELEZŐ sorrend, Pinterest/LinkedIn mintára):
1. Cookie betöltés → For You feed görgetés (~3 kör) + idle drift
2. Creator Center / Analytics benézés (tiktokstudio/analytics)
3. Saját profil megnyitása, korábbi videók megnézése + görgetés
4. Upload Studio (tiktokstudio/upload) → fájl setInputFiles → caption gépelés
5. Post gomb (várunk míg engedélyezett) + megerősítés (toast/URL)
6. Vissza For You feedre + 3 kör görgetés (nem tűnik el azonnal)

Kötelező brain_task mezők: media.value. Opcionális: caption.
Cookie kötelező — ugyanaz a Dolphin profil, mint a Pinterest, tehát ha a Pinterest süti él, a TikTok is.
Frissített sütiket visszaadja cookies_export-ban keep-alive-nek.
