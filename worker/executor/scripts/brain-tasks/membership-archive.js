// worker/executor/scripts/brain-tasks/membership-archive.js
//
// membership_archive — saját előfizetéses tagsági oldal (pl. klub.meggyozes.hu)
// anyagainak archiválása a VPS lemezére, kizárólag a tulajdonos saját,
// személyes használatára. Semmi nem megy felhőbe: szöveg, MP3, videó a
// /membership/<slug>/ mappában marad.
//
// Menet (egy futás = korlátos köteg, újrafuttatva folytatja):
//   1) belépés (e-mail + jelszó a workflow fióktárából), emberi gépeléssel
//   2) bejárás: azonos domainen belüli oldalak (max_pages/futás), oldalszöveg
//      Markdownként, média-linkek (audio/video/mp3/mp4/pdf/beágyazott lejátszó)
//   3) letöltés: max_downloads/futás — közvetlen (bejelentkezett sütikkel)
//      vagy yt-dlp (beágyazott lejátszó, a oldal referer-ével)
// Állapot: <root>/manifest.json — idempotens, a kész tételeket átugorja.
//
// payload: { start_url, slug?, mode?: "crawl"|"map", max_pages?, max_downloads? }

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { humanClick, humanType, humanWait, humanThink, humanCasualScroll } from "../humanize.js";

const ROOT = process.env.MEMBERSHIP_ROOT || "/membership";
const SKIP_RX = /(logout|kijelentkez|kilep|wp-login|\/cart|kosar|checkout|penztar|\/account|fiokom|profil|elofizet|\/feed|\.xml$|#)/i;
const MEDIA_EXT_RX = /\.(mp3|m4a|aac|wav|ogg|mp4|m4v|mov|webm|pdf|docx?|pptx?)(\?|$)/i;
const EMBED_RX = /(vimeo\.com|youtube\.com|youtu\.be|wistia|vidyard|bunny|mediadelivery|jwplayer|cloudflarestream|videos\.files)/i;

function slugify(s, max = 80) {
  return (
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "anyag"
  );
}

function run(cmd, args, timeoutMs = 60 * 60 * 1000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stderr.on("data", (d) => { if (err.length < 8000) err += d.toString(); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, err: e.message }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, err }); });
  });
}

async function loadManifest(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { pages: {}, media: {}, created_at: new Date().toISOString() };
  }
}
async function saveManifest(file, m) {
  m.updated_at = new Date().toISOString();
  await fs.writeFile(`${file}.tmp`, JSON.stringify(m, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

function normUrl(u, base) {
  try {
    const x = new URL(u, base);
    x.hash = "";
    return x.toString();
  } catch {
    return null;
  }
}

async function ensureLoggedIn(page, startUrl, creds, log) {
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanWait(page, 1500);
  const pwd = page.locator('input[type="password"]:visible').first();
  if (!(await pwd.count().catch(() => 0))) {
    // Lehet, hogy egy "Belépés" gomb mögött van az űrlap.
    const loginLink = page.getByRole("link", { name: /belép|bejelentkez|login|sign in/i }).first();
    if (await loginLink.count().catch(() => 0)) {
      await humanClick(page, loginLink).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await humanWait(page, 1200);
    }
  }
  const pwd2 = page.locator('input[type="password"]:visible').first();
  if (!(await pwd2.count().catch(() => 0))) {
    log("info", "Nincs belépő űrlap — a mentett munkamenet érvényes.");
    return;
  }
  if (!creds?.username || !creds?.password) {
    throw new Error("Belépés kell, de nincs e-mail/jelszó a workflow fióktárában.");
  }
  const email = page
    .locator('input[type="email"]:visible, input[name*="mail" i]:visible, input[name*="user" i]:visible, input[name="log"]:visible')
    .first();
  await humanClick(page, email);
  await humanType(page, creds.username);
  await humanThink(page, 700);
  await humanClick(page, pwd2);
  await humanType(page, creds.password, { typoRate: 0 });
  await humanThink(page, 600);
  const submit = page
    .locator('button[type="submit"]:visible, input[type="submit"]:visible')
    .or(page.getByRole("button", { name: /belép|bejelentkez|login|sign in/i }))
    .first();
  await humanClick(page, submit);
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);
  if (await page.locator('input[type="password"]:visible').count().catch(() => 0)) {
    throw new Error("A belépés nem sikerült (a jelszó-mező még látszik) — ellenőrizd az e-mailt/jelszót.");
  }
  log("info", "Belépés sikeres.");
}

async function extractPage(page) {
  return await page.evaluate(() => {
    const pick =
      document.querySelector("main article, article, main, .entry-content, .lesson-content, #content, .content") ||
      document.body;
    const title = (document.querySelector("h1")?.innerText || document.title || "").trim();
    const text = (pick?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({
      href: a.href,
      text: (a.innerText || "").trim().slice(0, 200),
    }));
    const media = [];
    document.querySelectorAll("audio[src], video[src], source[src]").forEach((el) => media.push(el.src));
    document.querySelectorAll("iframe[src]").forEach((el) => media.push(el.src));
    document.querySelectorAll("[data-src],[data-video-url],[data-audio]").forEach((el) => {
      for (const k of ["data-src", "data-video-url", "data-audio"]) {
        const v = el.getAttribute(k);
        if (v) media.push(new URL(v, location.href).toString());
      }
    });
    return { title, text, links, media };
  });
}

function mediaKind(url) {
  if (/\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url)) return "audio";
  if (/\.(pdf|docx?|pptx?)(\?|$)/i.test(url)) return "document";
  return "video";
}

async function writeCookieFile(context, file) {
  const cookies = await context.cookies();
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    lines.push(
      [
        c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
        "TRUE",
        c.path || "/",
        c.secure ? "TRUE" : "FALSE",
        Math.round(c.expires > 0 ? c.expires : Date.now() / 1000 + 86400),
        c.name,
        c.value,
      ].join("\t"),
    );
  }
  await fs.writeFile(file, lines.join("\n") + "\n", { mode: 0o600 });
}

async function downloadOne(context, item, dir, cookieFile, log) {
  await fs.mkdir(dir, { recursive: true });
  const isEmbed = EMBED_RX.test(item.url) || !MEDIA_EXT_RX.test(item.url);
  if (!isEmbed) {
    const res = await context.request.get(item.url, {
      headers: { Referer: item.page_url },
      timeout: 30 * 60 * 1000,
      maxRedirects: 10,
    });
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    const buf = await res.body();
    if (buf.length < 1024) throw new Error("túl kicsi / üres válasz");
    const name = slugify(decodeURIComponent(path.basename(new URL(item.url).pathname)).replace(/\.[^.]+$/, ""));
    const ext = (item.url.match(MEDIA_EXT_RX)?.[1] || "bin").toLowerCase();
    const file = path.join(dir, `${name}.${ext}`);
    await fs.writeFile(file, buf);
    return { file, bytes: buf.length, method: "direct" };
  }
  const out = path.join(dir, "%(title).80B.%(ext)s");
  const r = await run("yt-dlp", [
    "--cookies", cookieFile,
    "--referer", item.page_url,
    "--add-header", `Referer:${item.page_url}`,
    "-f", "bv*[height<=1080]+ba/b",
    "--merge-output-format", "mp4",
    "--no-playlist", "--restrict-filenames", "--no-warnings",
    "--retries", "5", "--sleep-requests", "1",
    "--print", "after_move:filepath",
    "-o", out,
    item.url,
  ]);
  if (r.code !== 0) throw new Error(`yt-dlp: ${(r.err || "").trim().slice(-400)}`);
  const files = (await fs.readdir(dir)).filter((f) => !f.endsWith(".part"));
  const newest = (
    await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs })))
  ).sort((a, b) => b.t - a.t)[0];
  if (!newest) throw new Error("yt-dlp nem hozott létre fájlt");
  const file = path.join(dir, newest.f);
  return { file, bytes: (await fs.stat(file)).size, method: "yt-dlp" };
}

export async function runMembershipArchive({ brainTask, page, context, creds, log }) {
  const p = brainTask.payload || brainTask;
  const startUrl = p.start_url;
  if (!startUrl || !/^https?:\/\//.test(startUrl)) throw new Error("start_url hiányzik");
  const host = new URL(startUrl).host;
  const slug = slugify(p.slug || host);
  const root = path.join(ROOT, slug);
  const maxPages = Number(p.max_pages) > 0 ? Number(p.max_pages) : 150;
  const maxDownloads = p.mode === "map" ? 0 : Number(p.max_downloads) > 0 ? Number(p.max_downloads) : 15;
  await fs.mkdir(path.join(root, "pages"), { recursive: true });
  const manifestFile = path.join(root, "manifest.json");
  const m = await loadManifest(manifestFile);

  // Hálózati elkapás: lejátszó által kért hang/videó/stream URL-ek.
  const sniffed = new Set();
  page.on("response", (res) => {
    const u = res.url();
    const ct = (res.headers()["content-type"] || "").toLowerCase();
    if (/\.(m3u8|mpd)(\?|$)/i.test(u) || ((ct.startsWith("audio/") || ct.startsWith("video/")) && !/\.ts(\?|$)/.test(u))) {
      sniffed.add(u);
    }
  });

  // Proxy mögötti átirányítások beragadása ellen (lásd recorder): no-op route.
  await context.route("**/*", (route) => route.continue()).catch(() => {});

  await ensureLoggedIn(page, startUrl, creds, log);

  // ---- 2) bejárás ----
  const queue = Object.keys(m.pages).length
    ? Object.entries(m.pages).filter(([, v]) => !v.visited_at).map(([u]) => u)
    : [startUrl];
  if (!queue.length && !Object.keys(m.pages).length) queue.push(startUrl);
  let visited = 0;
  while (queue.length && visited < maxPages) {
    const url = queue.shift();
    if (m.pages[url]?.visited_at) continue;
    try {
      sniffed.clear();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await humanWait(page, 1800);
      await humanCasualScroll(page).catch(() => {});
      // Lejátszó indítása, hogy a stream-URL látszódjon.
      await page.evaluate(() => document.querySelectorAll("audio,video").forEach((el) => { try { el.muted = true; el.play(); } catch {} })).catch(() => {});
      await humanWait(page, 2500);
      const info = await extractPage(page);
      const title = info.title || url;
      const pageSlug = `${String(Object.keys(m.pages).length + 1).padStart(4, "0")}-${slugify(title, 60)}`;
      const prev = m.pages[url] || {};
      const pslug = prev.slug || pageSlug;
      let textFile = null;
      if (info.text.length > 200) {
        textFile = `pages/${pslug}.md`;
        await fs.writeFile(
          path.join(root, textFile),
          `# ${title}\n\n> Forrás: ${url}\n> Mentve: ${new Date().toISOString().slice(0, 10)}\n\n${info.text}\n`,
        );
      }
      m.pages[url] = { ...prev, title, slug: pslug, text_file: textFile, visited_at: new Date().toISOString() };

      for (const l of info.links) {
        const u = normUrl(l.href, url);
        if (!u) continue;
        if (MEDIA_EXT_RX.test(u)) {
          if (!m.media[u]) m.media[u] = { url: u, kind: mediaKind(u), page_url: url, page_title: title, page_slug: pslug, status: "pending" };
          continue;
        }
        if (new URL(u).host !== host || SKIP_RX.test(u)) continue;
        if (!m.pages[u]) {
          m.pages[u] = { found_from: url };
          queue.push(u);
        }
      }
      for (const raw of [...info.media, ...sniffed]) {
        const u = normUrl(raw, url);
        if (!u || u.startsWith("blob:") || m.media[u]) continue;
        if (!(MEDIA_EXT_RX.test(u) || EMBED_RX.test(u) || /\.(m3u8|mpd)(\?|$)/i.test(u))) continue;
        m.media[u] = { url: u, kind: mediaKind(u), page_url: url, page_title: title, page_slug: pslug, status: "pending" };
      }
      visited++;
      if (visited % 5 === 0) await saveManifest(manifestFile, m);
      await humanThink(page, 2500);
    } catch (e) {
      log("warn", `Oldal hiba (${url}): ${e.message}`);
      m.pages[url] = { ...(m.pages[url] || {}), visited_at: new Date().toISOString(), error: e.message };
    }
  }
  await saveManifest(manifestFile, m);
  log("info", `Bejárás: ${visited} oldal ebben a futásban, összesen ${Object.keys(m.pages).length} ismert.`);

  // ---- 3) letöltés ----
  const cookieFile = path.join(root, ".cookies.txt");
  await writeCookieFile(context, cookieFile);
  let downloaded = 0, failed = 0;
  const pending = Object.values(m.media).filter((x) => x.status === "pending" || (x.status === "failed" && (x.attempts || 0) < 3));
  for (const item of pending.slice(0, maxDownloads)) {
    try {
      log("info", `Letöltés: ${item.kind} — ${item.page_title}`);
      const r = await downloadOne(context, item, path.join(root, "media", item.page_slug), cookieFile, log);
      Object.assign(item, { status: "done", file: path.relative(root, r.file), bytes: r.bytes, method: r.method, error: null, downloaded_at: new Date().toISOString() });
      downloaded++;
    } catch (e) {
      Object.assign(item, { status: "failed", attempts: (item.attempts || 0) + 1, error: e.message });
      failed++;
      log("warn", `Letöltési hiba: ${e.message}`);
    }
    await saveManifest(manifestFile, m);
    await humanWait(page, 4000);
  }
  await fs.rm(cookieFile, { force: true }).catch(() => {});

  const media = Object.values(m.media);
  const pages = Object.values(m.pages);
  return {
    ok: true,
    archive: slug,
    pages_known: pages.length,
    pages_visited: pages.filter((x) => x.visited_at).length,
    pages_with_text: pages.filter((x) => x.text_file).length,
    media_found: media.length,
    media_audio: media.filter((x) => x.kind === "audio").length,
    media_video: media.filter((x) => x.kind === "video").length,
    media_done: media.filter((x) => x.status === "done").length,
    media_failed: media.filter((x) => x.status === "failed").length,
    media_pending: media.filter((x) => x.status === "pending").length,
    this_run: { visited, downloaded, failed },
    crawl_finished: pages.every((x) => x.visited_at),
  };
}
