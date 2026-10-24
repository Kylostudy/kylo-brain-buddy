// VPS production entrypoint for the Kylo exam-promo recipe renderer.
// Contract (agent.py): container receives
//   -v <recipe_root>:/recipe:ro      verified recipe files (manifest.files keys)
//   -v <request.json>:/request.json:ro   {"manifest":..., "video":...}
//   -v <work>:/work:rw               writable scratch; write /work/output.mp4
// No network, uid 65532, read-only root: stage referenced files into /tmp, bundle,
// render H.264 yuv420p + AAC. Exit non-zero on any failure.
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const RECIPE = "/recipe";
const REQUEST = "/request.json";
const OUT = "/work/output.mp4";

function fail(msg: string): never {
  console.error("render_failed: " + msg);
  process.exit(1);
}

function stageKey(key: string, stage: string) {
  const src = path.join(RECIPE, key);
  const dst = path.join(stage, key);
  if (!fs.existsSync(src)) fail("missing_recipe_file:" + key);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return dst;
}

async function main() {
  if (!fs.existsSync(REQUEST)) fail("no_request");
  if (!fs.existsSync(OUT.replace("/output.mp4", ""))) fail("no_work_dir");
  const req = JSON.parse(fs.readFileSync(REQUEST, "utf8"));
  const video = req.video;
  for (const k of ["audio", "text", "subtitle", "cta"]) {
    if (typeof video?.[k] !== "string") fail("bad_video_field:" + k);
  }
  const stage = "/tmp/stage";
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const text = JSON.parse(video.text);
  const subs = JSON.parse(video.subtitle);
  const cta = JSON.parse(video.cta);
  const timing = { beats: video.timing.map((t: {start_ms: number; end_ms: number}, i: number) => ({id: String(i), t0: t.start_ms, t1: t.end_ms})) };
  stageKey(video.audio, stage);
  for (const fixed of ["assets/bed-mp3", "assets/stinger-mp3", "assets/kylo-dog-png"]) {
    stageKey(fixed, stage);
  }
  for (const [from, to] of [["assets/bed-mp3", "assets/bed.mp3"], ["assets/stinger-mp3", "assets/stinger.mp3"], ["assets/kylo-dog-png", "assets/kylo-dog.png"]]) fs.renameSync(path.join(stage, from), path.join(stage, to));
  for (const f of fs.readdirSync(path.join(RECIPE, "fonts"))) stageKey("fonts/" + f, stage);
  for (const f of fs.readdirSync(path.join(stage, "fonts"))) fs.renameSync(path.join(stage, "fonts", f), path.join(stage, "fonts", f.replace(/-ttf$/, ".ttf")));

  const props = {
    lang: text.lang ?? video.video_id,
    beats: timing.beats,
    subs: subs.subs,
    narration: text.narration ?? {},
    strings: { ...text.strings, months: text.strings.months ?? "" },
    telegram: cta.telegram ?? null,
    assets: {
      vo: video.audio,
      bed: "assets/bed.mp3",
      stinger: "assets/stinger.mp3",
      dog: "assets/kylo-dog.png",
      tail: "assets/brand-tail.mp4",
    },
  };

  const serveUrl = await bundle({
    entryPoint: path.resolve(__dirname, "entry.tsx"),
    outDir: "/tmp/bundle",
    publicDir: stage,
    webpackOverride: (c) => c,
  });

  const composition = await selectComposition({
    browserExecutable: "/usr/bin/chromium",
    chromeMode: "chrome-for-testing",
    serveUrl,
    id: "IELTSPromo",
    inputProps: props as unknown as Record<string, unknown>,
  });

  await renderMedia({
    browserExecutable: "/usr/bin/chromium",
    chromeMode: "chrome-for-testing",
    concurrency: 1,
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: "/work/raw.mp4",
    inputProps: props as unknown as Record<string, unknown>,
    crf: 18,
    imageFormat: "jpeg",
    jpegQuality: 92,
    audioCodec: "aac",
    x264Preset: "medium",
    scale: 1,
    onProgress: () => undefined,
  });
  execFileSync("bash", ["/app/tight-cut.sh", "/work/raw.mp4", OUT, "7"], {stdio: "inherit"});
  if (!fs.existsSync(OUT) || fs.statSync(OUT).size < 100_000) fail("output_too_small");
  console.log("render_ok bytes=" + fs.statSync(OUT).size);
}

main().catch((e) => fail(String(e?.stack ?? e)));
