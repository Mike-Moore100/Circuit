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

  // Phase 14.1 — data-origin correctness. Every company carries the
  // mode it belongs to so the dashboard can keep mock/demo/test data
  // out of real-mode operations.
  addColumnIfMissing(db, 'companies', 'data_origin', "TEXT NOT NULL DEFAULT 'REAL'");
  addColumnIfMissing(db, 'companies', 'source_type', "TEXT NOT NULL DEFAULT 'REAL_SOURCE'");
  // One-shot retag: pre-existing rows seeded by the mock connector get
  // DEMO/MOCK_SOURCE so this migration leaves the DB in a clean state.
  db.prepare(
    `UPDATE companies SET data_origin = 'DEMO', source_type = 'MOCK_SOURCE'
     WHERE source = 'mock' AND data_origin = 'REAL'`,
  ).run();

  // Phase 1 industry tagging — capture discovery metadata so we can
  // populate companies.industry deterministically (rather than leaving
  // every promoted lead as "(unknown)").
  addColumnIfMissing(db, 'raw_discoveries', 'industry', 'TEXT');
  addColumnIfMissing(db, 'raw_discoveries', 'discovery_query', 'TEXT');
  addColumnIfMissing(db, 'raw_discoveries', 'discovery_location', 'TEXT');
  addColumnIfMissing(db, 'companies', 'discovery_query', 'TEXT');
  addColumnIfMissing(db, 'companies', 'discovery_location', 'TEXT');
  // Records where the industry inference came from + how confident we
  // were. Lets the dashboard distinguish "tagged from query" (95%)
  // from "inferred from website body" (60%).
  addColumnIfMissing(db, 'companies', 'industry_source', 'TEXT');
  addColumnIfMissing(db, 'companies', 'industry_confidence', 'INTEGER');

  // Phase 8 — contact discovery
  addColumnIfMissing(db, 'contacts', 'contact_type', 'TEXT');
  addColumnIfMissing(db, 'contacts', 'source', 'TEXT');
  addColumnIfMissing(db, 'contacts', 'source_url', 'TEXT');
  addColumnIfMissing(db, 'contacts', 'email_type', 'TEXT');
  addColumnIfMissing(db, 'contacts', 'email_status', 'TEXT');
  addColumnIfMissing(db, 'contacts', 'role_confidence', 'REAL');
  addColumnIfMissing(db, 'contacts', 'email_confidence', 'REAL');
  addColumnIfMissing(db, 'contacts', 'overall_confidence', 'REAL');
  addColumnIfMissing(db, 'contacts', 'is_primary', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'contacts', 'discovered_at', 'TEXT');
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
