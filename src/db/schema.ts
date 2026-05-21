// SQLite schema. Idempotent: safe to run on every boot.
export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  domain        TEXT,
  website_url   TEXT,
  industry      TEXT,
  location      TEXT,
  size_estimate INTEGER,
  source        TEXT NOT NULL,
  source_url    TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_domain_idx
  ON companies(domain) WHERE domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(status);

CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT,
  role         TEXT,
  email        TEXT,
  linkedin_url TEXT,
  confidence   REAL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts(company_id);

CREATE TABLE IF NOT EXISTS signals (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  value      TEXT NOT NULL,
  confidence REAL NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS signals_company_idx ON signals(company_id);
CREATE INDEX IF NOT EXISTS signals_type_idx    ON signals(type);

CREATE TABLE IF NOT EXISTS lead_scores (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_score   REAL NOT NULL,
  intent_score REAL NOT NULL,
  final_score  REAL NOT NULL,
  priority     TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_scores_company_idx  ON lead_scores(company_id);
CREATE INDEX IF NOT EXISTS lead_scores_priority_idx ON lead_scores(priority);

CREATE TABLE IF NOT EXISTS review_queue (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'queued',
  priority   TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS review_queue_priority_idx ON review_queue(priority);
CREATE INDEX IF NOT EXISTS review_queue_status_idx   ON review_queue(status);

CREATE TABLE IF NOT EXISTS source_runs (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  leads_found     INTEGER NOT NULL DEFAULT 0,
  leads_accepted  INTEGER NOT NULL DEFAULT 0,
  leads_rejected  INTEGER NOT NULL DEFAULT 0,
  api_calls       INTEGER NOT NULL DEFAULT 0,
  errors_json     TEXT,
  params_json     TEXT
);

CREATE INDEX IF NOT EXISTS source_runs_source_idx     ON source_runs(source);
CREATE INDEX IF NOT EXISTS source_runs_started_at_idx ON source_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS website_inspections (
  id               TEXT PRIMARY KEY,
  company_id       TEXT REFERENCES companies(id) ON DELETE SET NULL,
  url              TEXT NOT NULL,
  domain           TEXT,
  status           TEXT NOT NULL,
  status_code      INTEGER,
  title            TEXT,
  meta_description TEXT,
  content_length   INTEGER,
  signals_json     TEXT NOT NULL,
  fingerprint_json TEXT,
  error_message    TEXT,
  fetched_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS website_inspections_domain_idx
  ON website_inspections(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_inspections_company_idx
  ON website_inspections(company_id);
CREATE INDEX IF NOT EXISTS website_inspections_fetched_at_idx
  ON website_inspections(fetched_at DESC);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id                             TEXT PRIMARY KEY,
  company_id                     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prompt_version                 TEXT NOT NULL,
  input_hash                     TEXT NOT NULL,
  ai_provider                    TEXT NOT NULL,
  model                          TEXT NOT NULL,
  summary                        TEXT,
  confidence                     REAL,
  operational_pain_points_json   TEXT,
  automation_opportunities_json  TEXT,
  estimated_business_impact_json TEXT,
  likely_buyer_json              TEXT,
  urgency_json                   TEXT,
  proof_angles_json              TEXT,
  risks_json                     TEXT,
  raw_response_json              TEXT,
  tokens_input                   INTEGER NOT NULL DEFAULT 0,
  tokens_cached                  INTEGER NOT NULL DEFAULT 0,
  tokens_output                  INTEGER NOT NULL DEFAULT 0,
  estimated_cost                 REAL NOT NULL DEFAULT 0,
  feedback_status                TEXT NOT NULL DEFAULT 'pending',
  feedback_notes                 TEXT,
  feedback_updated_at            TEXT,
  status                         TEXT NOT NULL DEFAULT 'ok',
  error_message                  TEXT,
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_analyses_company_idx     ON ai_analyses(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_analyses_hash_idx ON ai_analyses(company_id, input_hash);
CREATE INDEX IF NOT EXISTS ai_analyses_created_at_idx  ON ai_analyses(created_at DESC);
`;
