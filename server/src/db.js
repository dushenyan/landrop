import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { StringDecoder } from 'node:string_decoder';

let db;

export function initDb() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      current_version_id INTEGER,
      friendly_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      prev_version_id INTEGER,
      blob_sha256 TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      source_device TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_sec REAL,
      meta_json TEXT,
      deleted_at TEXT,
      UNIQUE(asset_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS blobs (
      sha256 TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thumbs (
      blob_sha256 TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      mime TEXT,
      PRIMARY KEY (blob_sha256, kind)
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      version_id INTEGER NOT NULL,
      from_device TEXT NOT NULL,
      to_device TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_versions_asset ON versions(asset_id);
    CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
  `);

  // 老库升级：M1 建表时还没有删除标记，缺列就补，不碰已有数据。
  for (const table of ['assets', 'versions']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((col) => col.name === 'deleted_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
    }
  }
}

export function getDb() {
  if (!db) throw new Error('db not initialized');
  return db;
}

// ---- 资产与版本 ----

export function findAssetByNameAndDevice(name, device) {
  // asset id 形如 "<deviceId>:<uuid>"。用 substr 做字面前缀比较，
  // 避免 deviceId 里的 % / _ 被 LIKE 当通配符，串到别的设备名下。
  const prefix = `${device}:`;
  return getDb().prepare(
    'SELECT * FROM assets WHERE friendly_name = ? AND substr(id, 1, ?) = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(name, prefix.length, prefix);
}

export function createAsset(id, name, kind, now) {
  getDb().prepare(
    'INSERT INTO assets (id, current_version_id, friendly_name, kind, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)'
  ).run(id, name, kind, now, now);
  return getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

export function nextVersionNo(assetId) {
  const row = getDb().prepare(
    'SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM versions WHERE asset_id = ?'
  ).get(assetId);
  return row.n;
}

export function insertVersion(v) {
  const now = v.uploaded_at;
  const info = getDb().prepare(`
    INSERT INTO versions
      (asset_id, version_no, prev_version_id, blob_sha256, original_name, mime, size,
       source_device, uploaded_at, width, height, duration_sec, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    v.asset_id, v.version_no, v.prev_version_id ?? null, v.blob_sha256,
    v.original_name, v.mime, v.size, v.source_device, now,
    v.width ?? null, v.height ?? null, v.duration_sec ?? null,
    v.meta_json ? JSON.stringify(v.meta_json) : null
  );
  const versionId = Number(info.lastInsertRowid);
  getDb().prepare('UPDATE assets SET current_version_id = ?, updated_at = ? WHERE id = ?')
    .run(versionId, now, v.asset_id);
  return versionId;
}

const EXCERPT_BYTES = 1024;
const EXCERPT_CHARS = 140;

function isTextRow(row) {
  const mime = (row.mime || '').split(';')[0].trim().toLowerCase();
  return row.kind === 'text' || mime.startsWith('text/') || mime === 'application/json';
}

function readTextExcerpt(sha256) {
  const filePath = path.join(config.blobsDir, sha256.slice(0, 2), sha256.slice(2));
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(EXCERPT_BYTES);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const decoder = new StringDecoder('utf8');
    return (decoder.write(buf.subarray(0, bytes)) + decoder.end())
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, EXCERPT_CHARS);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function withExcerpt(row) {
  return isTextRow(row) ? { ...row, excerpt: readTextExcerpt(row.blob_sha256) } : row;
}

export function listAssets({ kind, limit = 200, offset = 0 } = {}) {
  let sql = `
    SELECT a.*, v.original_name, v.mime, v.size, v.blob_sha256, v.source_device,
           v.uploaded_at, v.width, v.height, v.duration_sec
    FROM assets a
    JOIN versions v ON v.id = a.current_version_id
  `;
  const params = [];
  if (kind && kind !== 'all') {
    sql += ' WHERE a.deleted_at IS NULL AND a.kind = ?';
    params.push(kind);
  } else {
    sql += ' WHERE a.deleted_at IS NULL';
  }
  sql += ' ORDER BY a.updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params).map(withExcerpt);
}

export function getAsset(id) {
  return getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

export function listVersions(assetId) {
  return getDb().prepare(
    'SELECT * FROM versions WHERE asset_id = ? AND deleted_at IS NULL ORDER BY version_no DESC'
  ).all(assetId);
}

export function getVersion(id) {
  return getDb().prepare('SELECT * FROM versions WHERE id = ?').get(id);
}

// ---- 回收站：只打标记，CAS 字节暂不删除，恢复可逆 ----

function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function listDeletedAssets({ limit = 200, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT a.*, v.original_name, v.mime, v.size, v.blob_sha256, v.source_device,
           v.uploaded_at, v.width, v.height, v.duration_sec
    FROM assets a
    JOIN versions v ON v.id = a.current_version_id
    WHERE a.deleted_at IS NOT NULL
    ORDER BY a.deleted_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset).map(withExcerpt);
}

export function softDeleteAsset(id, now = new Date().toISOString()) {
  return transaction(() => {
    const info = getDb().prepare(
      'UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, now, id);
    if (info.changes === 0) return false;
    getDb().prepare(
      'UPDATE versions SET deleted_at = ? WHERE asset_id = ? AND deleted_at IS NULL'
    ).run(now, id);
    return true;
  });
}

export function restoreAsset(id, now = new Date().toISOString()) {
  return transaction(() => {
    const info = getDb().prepare(
      'UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
    ).run(now, id);
    if (info.changes === 0) return false;
    getDb().prepare(
      'UPDATE versions SET deleted_at = NULL WHERE asset_id = ? AND deleted_at IS NOT NULL'
    ).run(id);
    const newest = getDb().prepare(
      'SELECT id FROM versions WHERE asset_id = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1'
    ).get(id);
    if (newest) {
      getDb().prepare('UPDATE assets SET current_version_id = ? WHERE id = ?').run(newest.id, id);
    }
    return true;
  });
}

export function softDeleteVersion(id, now = new Date().toISOString()) {
  const version = getVersion(id);
  if (!version || version.deleted_at) return null;
  return transaction(() => {
    getDb().prepare('UPDATE versions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, id);
    const newest = getDb().prepare(
      'SELECT id FROM versions WHERE asset_id = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1'
    ).get(version.asset_id);
    if (newest) {
      getDb().prepare('UPDATE assets SET current_version_id = ?, updated_at = ? WHERE id = ?')
        .run(newest.id, now, version.asset_id);
    } else {
      getDb().prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, version.asset_id);
    }
    return version;
  });
}

export function restoreVersion(id, now = new Date().toISOString()) {
  const version = getVersion(id);
  if (!version || !version.deleted_at) return null;
  return transaction(() => {
    getDb().prepare('UPDATE versions SET deleted_at = NULL WHERE id = ?').run(id);
    getDb().prepare('UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now, version.asset_id);
    const newest = getDb().prepare(
      'SELECT id FROM versions WHERE asset_id = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1'
    ).get(version.asset_id);
    if (newest) {
      getDb().prepare('UPDATE assets SET current_version_id = ? WHERE id = ?').run(newest.id, version.asset_id);
    }
    return version;
  });
}

export function upsertBlob(sha256, size) {
  const existing = getDb().prepare('SELECT sha256 FROM blobs WHERE sha256 = ?').get(sha256);
  if (existing) {
    getDb().prepare('UPDATE blobs SET ref_count = ref_count + 1 WHERE sha256 = ?').run(sha256);
  } else {
    getDb().prepare(
      'INSERT INTO blobs (sha256, size, ref_count, created_at) VALUES (?, ?, 1, ?)'
    ).run(sha256, size, new Date().toISOString());
  }
}

export function setAssetKind(id, kind) {
  getDb().prepare('UPDATE assets SET kind = ? WHERE id = ?').run(kind, id);
}

export function renameAsset(id, name, now = new Date().toISOString()) {
  return transaction(() => {
    const asset = getAsset(id);
    if (!asset || asset.deleted_at) return null;
    getDb().prepare('UPDATE assets SET friendly_name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
    if (asset.current_version_id) {
      getDb().prepare('UPDATE versions SET original_name = ? WHERE id = ?').run(name, asset.current_version_id);
    }
    return getAsset(id);
  });
}

export function saveThumb(sha256, kind, relPath, width, height, mime) {
  getDb().prepare(
    'INSERT OR REPLACE INTO thumbs (blob_sha256, kind, path, width, height, mime) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sha256, kind, relPath, width, height, mime);
}

export function getThumb(sha256, kind) {
  return getDb().prepare('SELECT * FROM thumbs WHERE blob_sha256 = ? AND kind = ?').get(sha256, kind);
}

// ---- 设备 ----

export function touchDevice(id, name) {
  getDb().prepare(`
    INSERT INTO devices (id, name, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at
  `).run(id, name, new Date().toISOString());
}

export function listDevices() {
  return getDb().prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all();
}

export function recordTransfer(id, versionId, fromDevice, toDevice) {
  getDb().prepare(`
    INSERT INTO transfers (id, version_id, from_device, to_device, created_at, status)
    VALUES (?, ?, ?, ?, ?, 'done')
  `).run(id, versionId, fromDevice, toDevice, new Date().toISOString());
}

export function stats() {
  const assets = getDb().prepare('SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL').get().n;
  const versions = getDb().prepare('SELECT COUNT(*) AS n FROM versions WHERE deleted_at IS NULL').get().n;
  const blobs = getDb().prepare('SELECT COUNT(*) AS n FROM blobs').get().n;
  return { assets, versions, blobs };
}
