---
name: Reddit bemelegítési napló
description: Minden sikeres Reddit warmup futás automatikusan naplózódik (percek, upvote-ok, subredditek); 14 naplózott nap után a fiók „érett"
type: feature
---

- A `worker/complete` végpont minden sikeres `reddit_warmup` futás után ír egy
  napi sort a `reddit_warmup_log` táblába (aznapi futások összeadódnak).
- A fiókon frissül: `warmup_days_completed` (különböző naplózott napok száma),
  `subreddits_joined` (uniós lista), `warmup_status`.
- **Érettségi küszöb: 14 naplózott nap** → `warmup_status = ready`, ekkor
  posztolható a fiók. A legérettebb fiókban posztolunk először.
