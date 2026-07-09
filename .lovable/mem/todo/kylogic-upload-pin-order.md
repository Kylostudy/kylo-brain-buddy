# TODO — Kylogic oldali `upload_pin` task-kiadás

Amikor a Kylogic-ot bővítjük, ezt a brain_task payloadot kell tudnia kiadni a Brain felé.

## Pinterest pin feltöltés (kész van a Brain oldalon)

Fájl: `worker/executor/scripts/brain-tasks/pinterest-upload-pin.js`
task_type: `upload_pin`, platform: `pinterest`

Payload amit a Kylogic-nak generálnia kell:
```json
{
  "brain_task": {
    "task_type": "upload_pin",
    "platform": "pinterest",
    "media": { "kind": "url", "value": "https://gcs.../video.mp4" },
    "title": "...",              // kötelező, max 100 char
    "description": "...",         // opcionális, max 500 char
    "destination_link": "https://...", // opcionális
    "board_name": "..."           // opcionális, ha nincs → utolsó használt board
  }
}
```

Kylogic oldali TODO:
- account_id → workflow_id / credential feloldás (melyik Pinterest fiókra megy)
- ütemezés jitterrel (napi 2 pin, humán időpontokban)
- video_url a GCS-ből (streaming-upload memória: MOST #1)
- ne ismétlődjön ugyanaz az időpont X napon belül (pattern-avoidance)

Kapcsolódó memóriák: kylogic-integration, kylogic-upload-gap, pattern-avoidance, streaming-upload.

## Következő lépés (holnap): TikTok feltöltési flow

Ugyanaz a minta mint Pinterestnél: emberi koreográfia (feed → For You görgetés → 1-2 videó megnézése → CSAK EZUTÁN upload → utána még görgetés). TikTok és Pinterest ugyanabban a Dolphin profilban van, tehát ha a Pinterest süti megy, TikToknak is mennie kell ugyanabból a recorder session-ből.
