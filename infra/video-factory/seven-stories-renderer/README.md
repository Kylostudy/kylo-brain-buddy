# Seven approved Hungarian stories — source-reviewed additive renderer

Renderer: `seven-stories-hu-v1`. Contract: `kylo-seven-stories-hu-v1`.
There is one distinct scene and one immutable `v1` HU trial recipe per topic:
`hajo`, `auto`, `repulo`, `ust`, `szamlatorony`, `hatizsak`, `malacpersely-uj`.
This is not the legacy piggy-bank video or an exam-simulator version.

## Data contract

`../seven_stories.py` is the acceptance authority. Its `contract_export()` returns
the full accepted instances, approved-input digest, scene list, operations and
audio limits. `../seven-stories-recipes/*.json` contains the seven exact recipes.
The validator compares **every field**, rejects unknown/missing fields, changed
media/approval hashes, mixed topics, alternate languages/versions and audio
speed/trim/regeneration changes. `recipe_runtime.py` dispatches only this family
to the new validator; legacy validators stay byte-identical.

The input keys (without file extensions, matching the existing ingestion rules):

| Original package file in inputs/each-topic | Recipe key |
| --- | --- |
| narration.mp3 | audio/narration-mp3 |
| alignment.json | timing/alignment-json |
| timeline.json | timing/timeline-json |

Keep those original file bytes, including JSON whitespace/order. KyLogic serves
the checksum-bound original data through the existing authenticated asset
channel. Do not register source files as data or use the subject-package receiver.

## Runtime

The reviewed local image receives read-only `/request.json` containing
`{manifest, video}`, read-only `/recipe` and writable `/work`. Its fixed entrypoint
validates the request with the pinned Python validator, stages only checked
files, verifies the immutable existing brand image, bundles local source and
renders **silent** 1080×1920 / 30fps pictures to scratch. No renderer runs in the
Lovable app or on the sandbox; local browser inspection is not MP4 production.

Every real rendered frame emits measured text/object bounds. All frames,
subtitle presence, CTA, outro and the safe zone (65/950/231/1459) must pass.
Missing measurements and overlaps fail closed. Glyph measurement uses Range,
not a fixed container's scrollHeight. Font assets/dependencies come from the
existing reviewed font image, never the recipe.

The complete original narration starts at zero, is not sped up/trimmed, and is
padded only with silence to the frame-derived end. No tight-cut, -shortest,
tempo, sample-rate manipulation, regeneration or remote audio call is allowed.
Decoded MP3 vs decoded output is compared at zero with the same 48kHz mono
comparison format; similarity >= .99, gain .95–1.05, relative error <= .15.
These tolerances account for AAC encoding, not changed narration. At least two
seconds of final holding time is mandatory. Full video decode, host waveform
and frame evidence checks happen before no-clobber archival/readback.

## Deployment and verification

`../prepare-seven-stories-renderer.sh` stages a checksum-bound source release,
builds an additional image from an available existing v4/v3 font-complete full
digest, and registers only the new fixed name/scene tuple. It does not replace
old images, install fonts, start/claim jobs, register recipes or restart the
manager. It persists the **actual** installed image ID and base ID in
`/var/lib/kylo-video-factory/seven-stories-renderer-status.json` and runs the
standalone full self-check. Status `production_ready:false` is deliberate;
installation evidence is not video completion evidence.

The reviewed normal deploy stages all new host modules and the manager's fixed
allowlist supports the exact seven scenes. Its background deployment job runs
preparation and the existing normal manager activation sequentially, with
activation conditional on preparation success. Activation is outside this
preparation script, retains the normal production/activation locks and creates
no recipes or trial commands. Confirm that the running manager uses the new
release before KyLogic dispatches recipes; a deferred busy-render restart must
not be mistaken for completed activation.

One aggregate read-only check for **all seven** original inputs:

```sh
sudo python3 /opt/kylo-video-factory/current/seven_preflight.py \
  /path/to/verified-package/inputs \
  --config /etc/kylo-video-factory/config.json
```

The input path must be the real locally staged package; it is not guessed or
installed by this source release. The command reports every topic's errors and
skipped checks. Exit status zero only means available input/host checks passed;
`ok:false` remains while production-only checks or KyLogic ACK are skipped.
`preparation_ok` requires actual installed image/config, disk and full legacy
self-check. Never relabel skipped checks as successes.

After registration, the factory's actual layout is also supported with
`--registered /var/lib/kylo-video-factory/recipes` (the directory is the positional
input, not the flag's value). Each seven-story registration automatically checks
**all seven topics** in that registered layout, sends its aggregate result via
the existing signed `self_check` outbox and persists the small sanitized report
at `/var/lib/kylo-video-factory/seven-stories-preflight.json`. The protected
heartbeat exposes this report and the fixed preparation status/log; no new
public operation, arbitrary path or command channel is introduced. The full
schema is exported separately rather than repeated in the heartbeat.

KyLogic starts **seven separate trial commands**, ship first, serially through
the existing single-render production lock. Duplicate trial deliveries return
the existing topic job. No `start_series`, other languages or social publishing
is authorized. A completed MP4 means verified archive readback, not an active
unit or a successful source test. Retrying a failed job uses the existing
explicit retry and maximum-attempt rules; never create a new recipe to retry.