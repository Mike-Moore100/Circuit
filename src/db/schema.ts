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

-- Phase 6: campaign segmentation. Columns are added via idempotent ALTERs in
-- client.ts because SQLite doesn't support ADD COLUMN IF NOT EXISTS.

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

-- Phase 7: validation sprint — reviewer feedback + metric snapshots
CREATE TABLE IF NOT EXISTS lead_reviews (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  review_type        TEXT NOT NULL,
  previous_campaign  TEXT,
  corrected_campaign TEXT,
  reviewer_notes     TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_reviews_company_idx ON lead_reviews(company_id);
CREATE INDEX IF NOT EXISTS lead_reviews_type_idx    ON lead_reviews(review_type);

CREATE TABLE IF NOT EXISTS review_metrics (
  id          TEXT PRIMARY KEY,
  metric_type TEXT NOT NULL,
  value       REAL NOT NULL,
  source      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS review_metrics_type_idx       ON review_metrics(metric_type);
CREATE INDEX IF NOT EXISTS review_metrics_created_at_idx ON review_metrics(created_at DESC);

-- Phase 8: contact discovery — extra columns on contacts added via idempotent
-- ALTERs in client.ts. New contact_routes table for non-email reach paths.
CREATE TABLE IF NOT EXISTS contact_routes (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_type  TEXT NOT NULL,
  value       TEXT NOT NULL,
  source_url  TEXT,
  confidence  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS contact_routes_company_idx ON contact_routes(company_id);
CREATE INDEX IF NOT EXISTS contact_routes_type_idx    ON contact_routes(route_type);

-- Phase 9: evidence / proof extraction
CREATE TABLE IF NOT EXISTS lead_evidence (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evidence_type            TEXT NOT NULL,
  evidence_summary         TEXT,
  confidence               REAL NOT NULL DEFAULT 0,
  screenshot_path          TEXT,
  mobile_screenshot_path   TEXT,
  metadata_json            TEXT,
  created_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_evidence_company_idx ON lead_evidence(company_id);
CREATE INDEX IF NOT EXISTS lead_evidence_type_idx    ON lead_evidence(evidence_type);
CREATE INDEX IF NOT EXISTS lead_evidence_created_at_idx ON lead_evidence(created_at DESC);

-- Phase 10: Opportunity Intelligence. Single row per company with the
-- latest computed intelligence snapshot. Replaced wholesale on each run.
CREATE TABLE IF NOT EXISTS opportunity_intelligence (
  company_id                       TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_score                INTEGER NOT NULL,
  human_attention_priority         TEXT NOT NULL,
  operational_pain_score           INTEGER NOT NULL,
  buying_readiness_score           INTEGER NOT NULL,
  accessibility_score              INTEGER NOT NULL,
  implementation_fit_score         INTEGER NOT NULL,
  trust_barrier_score              INTEGER NOT NULL,
  evidence_confidence_score        INTEGER NOT NULL,
  likely_project_type              TEXT NOT NULL,
  estimated_project_complexity     TEXT NOT NULL,
  estimated_commercial_potential   TEXT NOT NULL,
  payload_json                     TEXT NOT NULL,
  computed_at                      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS opp_intel_score_idx     ON opportunity_intelligence(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS opp_intel_priority_idx  ON opportunity_intelligence(human_attention_priority);

-- Phase 11: massive cheap discovery layer. raw_discoveries is the wide
-- top-of-funnel table; validated unique rows get promoted into companies.
CREATE TABLE IF NOT EXISTS discovery_runs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  raw_found     INTEGER NOT NULL DEFAULT 0,
  valid_domains INTEGER NOT NULL DEFAULT 0,
  deduped       INTEGER NOT NULL DEFAULT 0,
  rejected      INTEGER NOT NULL DEFAULT 0,
  errors_json   TEXT
);

CREATE INDEX IF NOT EXISTS discovery_runs_started_at_idx ON discovery_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS raw_discoveries (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT REFERENCES discovery_runs(id) ON DELETE CASCADE,
  source             TEXT NOT NULL,
  business_name      TEXT NOT NULL,
  raw_url            TEXT NOT NULL,
  extracted_domain   TEXT,
  title              TEXT,
  snippet            TEXT,
  location           TEXT,
  phone              TEXT,
  discovered_at      TEXT NOT NULL,
  validation_status  TEXT NOT NULL,
  validation_reason  TEXT
);

CREATE INDEX IF NOT EXISTS raw_discoveries_domain_idx     ON raw_discoveries(extracted_domain);
CREATE INDEX IF NOT EXISTS raw_discoveries_run_idx        ON raw_discoveries(run_id);
CREATE INDEX IF NOT EXISTS raw_discoveries_source_idx     ON raw_discoveries(source);
CREATE INDEX IF NOT EXISTS raw_discoveries_status_idx     ON raw_discoveries(validation_status);
CREATE INDEX IF NOT EXISTS raw_discoveries_discovered_idx ON raw_discoveries(discovered_at DESC);

-- Phase 12: Discovery → Qualification auto-promotion. Single row per
-- (discovery → company) decision. PROMOTED rows link to companies.id;
-- SKIPPED rows are the audit trail of what we chose NOT to deeply
-- process and why.
CREATE TABLE IF NOT EXISTS qualification_queue (
  id                TEXT PRIMARY KEY,
  discovery_id      TEXT REFERENCES raw_discoveries(id) ON DELETE SET NULL,
  company_id        TEXT REFERENCES companies(id) ON DELETE SET NULL,
  domain            TEXT NOT NULL,
  source            TEXT NOT NULL,
  status            TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0,
  promotion_reason  TEXT NOT NULL,
  error_message     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- One queue row per domain. Re-promotion needs to delete the existing
-- row first (or the upsert path takes care of it).
CREATE UNIQUE INDEX IF NOT EXISTS qualification_queue_domain_idx ON qualification_queue(domain);
CREATE INDEX IF NOT EXISTS qualification_queue_status_idx        ON qualification_queue(status);
CREATE INDEX IF NOT EXISTS qualification_queue_priority_idx      ON qualification_queue(priority DESC);
CREATE INDEX IF NOT EXISTS qualification_queue_created_at_idx    ON qualification_queue(created_at DESC);
`;
