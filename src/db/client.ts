import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index';
import { SCHEMA_SQL } from './schema';

type Db = Database.Database;

let _db: Db | null = null;

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function addColumnIfMissing(
  db: Db,
  table: string,
  column: string,
  ddl: string,
): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // SQLite raises "duplicate column name" when the column already exists.
    // Everything else propagates so we don't silently lose schema errors.
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

function runMigrations(db: Db): void {
  // Phase 6 — campaign segmentation
  addColumnIfMissing(db, 'lead_scores', 'primary_campaign', 'TEXT');
  addColumnIfMissing(db, 'lead_scores', 'campaign_scores_json', 'TEXT');
  addColumnIfMissing(db, 'lead_scores', 'campaign_reasons_json', 'TEXT');
  addColumnIfMissing(db, 'lead_scores', 'primary_reason', 'TEXT');
  addColumnIfMissing(db, 'lead_scores', 'suggested_investigation', 'TEXT');
}

export function getDb(): Db {
  if (_db) return _db;
  ensureDir(config.dbPath);
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Convenience for tests / scripts that want a clean slate.
export function resetDb(): void {
  closeDb();
  if (fs.existsSync(config.dbPath)) fs.rmSync(config.dbPath);
  const wal = `${config.dbPath}-wal`;
  const shm = `${config.dbPath}-shm`;
  if (fs.existsSync(wal)) fs.rmSync(wal);
  if (fs.existsSync(shm)) fs.rmSync(shm);
  getDb();
}
