/**
 * KyloKit — Playwright session kezelő
 * Feladata:
 *   - Böngésző session-ök indítása és kezelése
 *   - Böngésző izoláció (külön context = külön cookie, cache, fingerprint)
 *   - Cookie kezelés (mentés / betöltés)
 *   - Parancsok végrehajtása a böngészőben (navigálás, kattintás, gépelés)
 */

import express from 'express';
import { chromium } from 'playwright';
import { createClient } from 'redis';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Adatbázis kapcsolat ───────────────────────────────────────────────────
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// ─── Redis kapcsolat ───────────────────────────────────────────────────────
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});
redisClient.on('error', (err) => console.error('Redis hiba:', err));
await redisClient.connect();

// ─── Konfiguráció ──────────────────────────────────────────────────────────
const COOKIE_PATH = process.env.COOKIE_STORAGE_PATH || '/app/cookies';
const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL_SESSIONS || '5', 10);

if (!fs.existsSync(COOKIE_PATH)) {
  fs.mkdirSync(COOKIE_PATH, { recursive: mode: 0o700 }); // Csak tulajdonos olvashatja
}

// Aktív session-ök tárolása memóriában (sessionId -> {browser, context, page})
const sessions = new Map();

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await dbPool.query('SELECT 1');
    await redisClient.ping();
    res.json({
      status: 'ok',
      service: 'kylo-kit',
      activeSessions: sessions.size,
      maxSessions: MAX_PARALLEL,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ─── Session kezelés ───────────────────────────────────────────────────────

// Új böngésző session indítása
app.post('/api/session/start', async (req, res) => {
  const { fingerprint, proxy, cookieFile } = req.body;

  if (sessions.size >= MAX_PARALLEL) {
    return res.status(429).json({ error: 'Túl sok aktív session. Várj, amíg egy lezárul.' });
  }

  const sessionId = uuidv4();

  try {
    // Böngésző indítása (headless = nincs látható ablak)
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    // Új context = teljes izoláció (külön cookie-k, cache, localStorage)
    const contextOptions = {
      viewport: fingerprint?.viewport || { width: 1920, height: 1080 },
      userAgent: fingerprint?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
      locale: fingerprint?.locale || 'hu-HU',
      timezoneId: fingerprint?.timezone || 'Europe/Budapest',
    };

    // Ha van proxy, hozzáadjuk
    if (proxy) {
      contextOptions.proxy = {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      };
    }

    const context = await browser.newContext(contextOptions);

    // Ha van korábbi cookie fájl, betöltjük
    if (cookieFile) {
      const cookieFilePath = path.join(COOKIE_PATH, cookieFile);
      if (fs.existsSync(cookieFilePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookieFilePath, 'utf-8'));
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();

    // Session tárolása
    sessions.set(sessionId, { browser, context, page, startedAt: new Date() });

    console.log(`🌐 Új session indítva: ${sessionId} (összesen: ${sessions.size})`);

    res.json({ sessionId, status: 'started' });
  } catch (err) {
    console.error('Session indítási hiba:', err);
    res.status(500).json({ error: err.message });
  }
});

// Böngésző navigálás
app.post('/api/session/:sessionId/navigate', async (req, res) => {
  const { sessionId } = req.params;
  const { url, waitUntil = 'networkidle' } = req.body;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session nem található' });
  }

  try {
    await session.page.goto(url, { waitUntil });
    const title = await session.page.title();
    res.json({ sessionId, url, title, status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kattintás egy elemre
app.post('/api/session/:sessionId/click', async (req, res) => {
  const { sessionId } = req.params;
  const { selector } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nem található' });

  try {
    await session.page.click(selector);
    res.json({ sessionId, action: 'click', selector, status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Szöveg gépelés
app.post('/api/session/:sessionId/type', async (req, res) => {
  const { sessionId } = req.params;
  const { selector, text } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nem található' });

  try {
    await session.page.fill(selector, text);
    res.json({ sessionId, action: 'type', selector, status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Képernyőkép készítése
app.post('/api/session/:sessionId/screenshot', async (req, res) => {
  const { sessionId } = req.params;
  const { fullPage = false } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nem található' });

  try {
    const screenshot = await session.page.screenshot({ fullPage, type: 'png' });
    res.setHeader('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Oldal forrásának lekérdezése
app.get('/api/session/:sessionId/content', async (req, res) => {
  const { sessionId } = req.params;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nem található' });

  try {
    const content = await session.page.content();
    res.json({ sessionId, contentLength: content.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cookie-k mentése
app.post('/api/session/:sessionId/save-cookies', async (req, res) => {
  const { sessionId } = req.params;
  const { filename } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session nem található' });

  try {
    const cookies = await session.context.cookies();
    const cookieFilePath = path.join(COOKIE_PATH, filename || `${sessionId}_cookies.json`);
    fs.writeFileSync(cookieFilePath, JSON.stringify(cookies, null, 2), { mode: 0o600 });
    res.json({ sessionId, filename, cookieCount: cookies.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Session lezárása és erőforrások felszabadítása
app.post('/api/session/:sessionId/close', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session nem található' });
  }

  try {
    await session.context.close();
    await session.browser.close();
    sessions.delete(sessionId);
    console.log(`🔒 Session lezárva: ${sessionId} (maradt: ${sessions.size})`);
    res.json({ sessionId, status: 'closed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Összes aktív session listázása
app.get('/api/sessions', (req, res) => {
  const activeSessions = Array.from(sessions.entries()).map(([id, s]) => ({
    sessionId: id,
    startedAt: s.startedAt,
    ageSeconds: Math.floor((Date.now() - s.startedAt) / 1000),
  }));
  res.json({ sessions: activeSessions, count: sessions.size, max: MAX_PARALLEL });
});

// ─── Adatbázis inicializálás ───────────────────────────────────────────────
async function initDatabase() {
  const createTables = `
    CREATE TABLE IF NOT EXISTS browser_sessions (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL UNIQUE,
      fingerprint JSONB,
      proxy TEXT,
      status TEXT DEFAULT 'active',
      started_at TIMESTAMP DEFAULT NOW(),
      closed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES browser_sessions(session_id),
      action TEXT,
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
  try {
    await dbPool.query(createTables);
    console.log('✅ KyloKit adatbázis táblák készen');
  } catch (err) {
    console.error('❌ Adatbázis hiba:', err);
  }
}

// ─── Szerver indítás ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

await initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎭 KyloKit fut a ${PORT}-es porton`);
  console.log(`🍪 Cookie tároló: ${COOKIE_PATH}`);
  console.log(`🚀 Max párhuzamos session: ${MAX_PARALLEL}`);
});
