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

export function getDb(): Db {
  if (_db) return _db;
  ensureDir(config.dbPath);
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
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
