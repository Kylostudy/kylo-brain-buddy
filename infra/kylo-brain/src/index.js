/**
 * KyloBrain — Fő szerver
 * Feladata:
 *   - API endpointok a workflow-k kezeléséhez
 *   - LEGO könyvtár kezelése (újrafelhasználható kód blokkok)
 *   - Gemini API kommunikáció (később)
 *   - Kapcsolat a PostgreSQL és Redis szolgáltatásokkal
 */

import express from 'express';
import { createClient } from 'redis';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Adatbázis kapcsolat ───────────────────────────────────────────────────
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,  // Belső Docker hálózaton nem kell SSL
});

// ─── Redis kapcsolat ───────────────────────────────────────────────────────
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});
redisClient.on('error', (err) => console.error('Redis hiba:', err));
await redisClient.connect();

// ─── LEGO könyvtár elérési út ──────────────────────────────────────────────
const LEGO_PATH = process.env.LEGO_LIBRARY_PATH || '/app/lego-library';
if (!fs.existsSync(LEGO_PATH)) {
  fs.mkdirSync(LEGO_PATH, { recursive: true });
}

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await dbPool.query('SELECT 1');
    await redisClient.ping();
    res.json({ status: 'ok', service: 'kylo-brain', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ─── Workflow API ──────────────────────────────────────────────────────────

// Új workflow létrehozása
app.post('/api/workflows', async (req, res) => {
  const { name, description, spec } = req.body;
  try {
    const result = await dbPool.query(
      `INSERT INTO workflows (name, description, spec, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'draft', NOW(), NOW())
       RETURNING *`,
      [name, description, JSON.stringify(spec)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Workflow létrehozási hiba:', err);
    res.status(500).json({ error: err.message });
  }
});

// Workflow lista lekérdezése
app.get('/api/workflows', async (req, res) => {
  try {
    const result = await dbPool.query(
      'SELECT id, name, description, status, created_at, updated_at FROM workflows ORDER BY updated_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEGO könyvtár API ─────────────────────────────────────────────────────

// LEGO blokk feltöltése (újrafelhasználható kód)
app.post('/api/lego', async (req, res) => {
  const { name, description, tags, code } = req.body;
  const filename = `${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.js`;
  const filepath = path.join(LEGO_PATH, filename);

  try {
    fs.writeFileSync(filepath, code, 'utf-8');
    await dbPool.query(
      `INSERT INTO lego_blocks (name, description, tags, filename, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [name, description, tags || [], filename]
    );
    res.status(201).json({ message: 'LEGO blokk elmentve', filename });
  } catch (err) {
    console.error('LEGO mentési hiba:', err);
    res.status(500).json({ error: err.message });
  }
});

// LEGO blokkok listája
app.get('/api/lego', async (req, res) => {
  try {
    const result = await dbPool.query(
      'SELECT id, name, description, tags, filename, created_at FROM lego_blocks ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LEGO blokk kód lekérdezése
app.get('/api/lego/:filename', (req, res) => {
  const filepath = path.join(LEGO_PATH, req.params.filename);
  if (!filepath.startsWith(LEGO_PATH)) {
    return res.status(403).json({ error: 'Tiltott elérési út' });
  }
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Nem található' });
  }
  const code = fs.readFileSync(filepath, 'utf-8');
  res.json({ filename: req.params.filename, code });
});

// ─── Adatbázis inicializálás (ha a táblák még nem léteznek) ────────────────
async function initDatabase() {
  const createTables = `
    CREATE TABLE IF NOT EXISTS workflows (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      spec JSONB,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id SERIAL PRIMARY KEY,
      workflow_id INTEGER REFERENCES workflows(id),
      status TEXT DEFAULT 'queued',
      logs TEXT,
      result JSONB,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lego_blocks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT[],
      filename TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
  try {
    await dbPool.query(createTables);
    console.log('✅ Adatbázis táblák készen');
  } catch (err) {
    console.error('❌ Adatbázis inicializálási hiba:', err);
  }
}

// ─── Szerver indítás ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

await initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 KyloBrain fut a ${PORT}-es porton`);
  console.log(`📁 LEGO könyvtár: ${LEGO_PATH}`);
});
