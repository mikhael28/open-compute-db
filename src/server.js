const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3100;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kv.sqlite');
const MAX_KEY_LENGTH = Number(process.env.MAX_KEY_LENGTH || 128);
const KEY_REGEX = /^[A-Za-z0-9._:-]+$/;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.prepare('CREATE INDEX IF NOT EXISTS idx_kv_updated_at ON kv_store(updated_at)').run();

const insertStmt = db.prepare(
  `INSERT INTO kv_store (key, value, value_type, updated_at)
   VALUES (@key, @value, @type, CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET
     value = excluded.value,
     value_type = excluded.value_type,
     updated_at = CURRENT_TIMESTAMP`
);
const selectStmt = db.prepare('SELECT key, value, value_type AS type, updated_at FROM kv_store WHERE key = ?');
const deleteStmt = db.prepare('DELETE FROM kv_store WHERE key = ?');
const listStmt = db.prepare(
  `SELECT key, value, value_type AS type, updated_at
     FROM kv_store
    WHERE key LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?`
);
const countStmt = db.prepare('SELECT COUNT(1) AS count FROM kv_store');

function sanitizeKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH || !KEY_REGEX.test(key)) {
    const hint = `Key must be 1-${MAX_KEY_LENGTH} chars of [A-Za-z0-9._:-]`;
    const err = new Error(hint);
    err.status = 400;
    throw err;
  }
  return key;
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) => {
  const { count } = countStmt.get();
  res.json({ status: 'ok', keys: count, dbPath: path.resolve(DB_PATH) });
});

app.put('/kv/:key', (req, res, next) => {
  try {
    const key = sanitizeKey(req.params.key);
    if (!Object.prototype.hasOwnProperty.call(req.body, 'value')) {
      const err = new Error('Body must include a "value" field');
      err.status = 400;
      throw err;
    }
    const value = req.body.value;
    const payload = JSON.stringify(value);
    const type = Array.isArray(value) ? 'array' : typeof value;
    insertStmt.run({ key, value: payload, type });
    const row = selectStmt.get(key);
    res.json({ key, value, type, updatedAt: row.updated_at });
  } catch (err) {
    next(err);
  }
});

app.get('/kv/:key', (req, res, next) => {
  try {
    const key = sanitizeKey(req.params.key);
    const row = selectStmt.get(key);
    if (!row) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ key: row.key, value: parseValue(row.value), type: row.type, updatedAt: row.updated_at });
  } catch (err) {
    next(err);
  }
});

app.delete('/kv/:key', (req, res, next) => {
  try {
    const key = sanitizeKey(req.params.key);
    const info = deleteStmt.run(key);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ key, deleted: true });
  } catch (err) {
    next(err);
  }
});

app.get('/kv', (req, res, next) => {
  try {
    const prefix = req.query.prefix ? sanitizeKey(String(req.query.prefix)) : '';
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = listStmt.all(`${prefix}%`, limit).map((row) => ({
      key: row.key,
      value: parseValue(row.value),
      type: row.type,
      updatedAt: row.updated_at,
    }));
    res.json({ prefix, limit, data: rows });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`open-compute-db listening on port ${PORT}`);
});
