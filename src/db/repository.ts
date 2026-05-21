import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type {
  CombinedScore,
  Company,
  Contact,
  PersistedSignal,
  RawLead,
  Priority,
  ReviewItem,
  SourceRun,
} from '../types/index';
import { getDb } from './client';

function now(): string {
  return new Date().toISOString();
}

export function extractDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Company upserts: dedupe by domain when present, fall back to (name+source).
// ---------------------------------------------------------------------------
export interface UpsertResult {
  company: Company;
  created: boolean;
}

export function upsertCompanyFromLead(lead: RawLead, db: Database = getDb()): UpsertResult {
  const domain = extractDomain(lead.websiteUrl);
  const existing = findCompanyByDomainOrName(lead.companyName, domain, db);

  if (existing) {
    const updated: Company = {
      ...existing,
      website_url: existing.website_url ?? lead.websiteUrl,
      industry: existing.industry ?? lead.industry,
      location: existing.location ?? lead.location,
      size_estimate: existing.size_estimate ?? lead.sizeEstimate,
      source_url: existing.source_url ?? lead.sourceUrl,
      updated_at: now(),
    };
    db.prepare(
      `UPDATE companies
         SET website_url = @website_url,
             industry = @industry,
             location = @location,
             size_estimate = @size_estimate,
             source_url = @source_url,
             updated_at = @updated_at
       WHERE id = @id`,
    ).run(updated);
    return { company: updated, created: false };
  }

  const company: Company = {
    id: randomUUID(),
    name: lead.companyName,
    domain,
    website_url: lead.websiteUrl,
    industry: lead.industry,
    location: lead.location,
    size_estimate: lead.sizeEstimate,
    source: lead.source,
    source_url: lead.sourceUrl,
    status: 'new',
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO companies
       (id, name, domain, website_url, industry, location, size_estimate,
        source, source_url, status, created_at, updated_at)
     VALUES
       (@id, @name, @domain, @website_url, @industry, @location, @size_estimate,
        @source, @source_url, @status, @created_at, @updated_at)`,
  ).run(company);
  return { company, created: true };
}

export function findCompanyByDomainOrName(
  name: string,
  domain: string | null,
  db: Database = getDb(),
): Company | undefined {
  if (domain) {
    const byDomain = db
      .prepare('SELECT * FROM companies WHERE domain = ?')
      .get(domain) as Company | undefined;
    if (byDomain) return byDomain;
  }
  return db
    .prepare('SELECT * FROM companies WHERE lower(name) = lower(?)')
    .get(name) as Company | undefined;
}

export function setCompanyStatus(
  companyId: string,
  status: Company['status'],
  db: Database = getDb(),
): void {
  db.prepare('UPDATE companies SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    now(),
    companyId,
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export function upsertContactFromLead(
  companyId: string,
  lead: RawLead,
  db: Database = getDb(),
): Contact | null {
  if (!lead.contactName && !lead.contactEmail && !lead.linkedinUrl) return null;

  const existing = db
    .prepare(
      'SELECT * FROM contacts WHERE company_id = ? AND (email = ? OR linkedin_url = ? OR lower(name) = lower(?))',
    )
    .get(
      companyId,
      lead.contactEmail ?? '',
      lead.linkedinUrl ?? '',
      lead.contactName ?? '',
    ) as Contact | undefined;

  if (existing) return existing;

  const contact: Contact = {
    id: randomUUID(),
    company_id: companyId,
    name: lead.contactName,
    role: lead.contactRole,
    email: lead.contactEmail,
    linkedin_url: lead.linkedinUrl,
    confidence: lead.contactEmail ? 70 : lead.linkedinUrl ? 50 : 30,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO contacts (id, company_id, name, role, email, linkedin_url, confidence, created_at)
     VALUES (@id, @company_id, @name, @role, @email, @linkedin_url, @confidence, @created_at)`,
  ).run(contact);
  return contact;
}

export function getContactsForCompany(
  companyId: string,
  db: Database = getDb(),
): Contact[] {
  return db
    .prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY confidence DESC')
    .all(companyId) as Contact[];
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------
export function persistSignals(
  companyId: string,
  lead: RawLead,
  db: Database = getDb(),
): PersistedSignal[] {
  if (lead.signals.length === 0) return [];
  const stmt = db.prepare(
    `INSERT INTO signals (id, company_id, type, value, confidence, source, created_at)
     VALUES (@id, @company_id, @type, @value, @confidence, @source, @created_at)`,
  );
  const persisted: PersistedSignal[] = [];
  for (const s of lead.signals) {
    const row: PersistedSignal = {
      id: randomUUID(),
      company_id: companyId,
      source: lead.source,
      created_at: now(),
      ...s,
    };
    stmt.run(row);
    persisted.push(row);
  }
  return persisted;
}

export function getSignalsForCompany(
  companyId: string,
  db: Database = getDb(),
): PersistedSignal[] {
  return db
    .prepare('SELECT * FROM signals WHERE company_id = ? ORDER BY created_at DESC')
    .all(companyId) as PersistedSignal[];
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------
export function persistScore(
  companyId: string,
  score: CombinedScore,
  db: Database = getDb(),
): void {
  const row = {
    id: randomUUID(),
    company_id: companyId,
    rule_score: score.rule.ruleScore,
    intent_score: score.intent.intentScore,
    final_score: score.finalScore,
    priority: score.priority,
    reasons_json: JSON.stringify({
      rule: score.rule,
      intent: score.intent,
    }),
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO lead_scores
       (id, company_id, rule_score, intent_score, final_score, priority, reasons_json, created_at)
     VALUES
       (@id, @company_id, @rule_score, @intent_score, @final_score, @priority, @reasons_json, @created_at)`,
  ).run(row);
}

export function getLatestScore(
  companyId: string,
  db: Database = getDb(),
): { rule_score: number; intent_score: number; final_score: number; priority: Priority; reasons_json: string; created_at: string } | undefined {
  return db
    .prepare(
      'SELECT rule_score, intent_score, final_score, priority, reasons_json, created_at FROM lead_scores WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(companyId) as
    | {
        rule_score: number;
        intent_score: number;
        final_score: number;
        priority: Priority;
        reasons_json: string;
        created_at: string;
      }
    | undefined;
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------
export function upsertReviewItem(
  companyId: string,
  priority: Priority,
  db: Database = getDb(),
): ReviewItem {
  const existing = db
    .prepare('SELECT * FROM review_queue WHERE company_id = ?')
    .get(companyId) as ReviewItem | undefined;
  if (existing) {
    const updated: ReviewItem = { ...existing, priority, updated_at: now() };
    db.prepare(
      'UPDATE review_queue SET priority = ?, updated_at = ? WHERE id = ?',
    ).run(priority, updated.updated_at, existing.id);
    return updated;
  }
  const created: ReviewItem = {
    id: randomUUID(),
    company_id: companyId,
    status: 'queued',
    priority,
    notes: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO review_queue (id, company_id, status, priority, notes, created_at, updated_at)
     VALUES (@id, @company_id, @status, @priority, @notes, @created_at, @updated_at)`,
  ).run(created);
  return created;
}

export function getAllCompanies(db: Database = getDb()): Company[] {
  return db
    .prepare('SELECT * FROM companies ORDER BY created_at DESC')
    .all() as Company[];
}

export function getReviewQueue(db: Database = getDb()): Array<ReviewItem & Company> {
  return db
    .prepare(
      `SELECT r.id              AS review_id,
              r.status          AS review_status,
              r.priority        AS review_priority,
              r.notes           AS review_notes,
              r.created_at      AS review_created_at,
              r.updated_at      AS review_updated_at,
              c.*
         FROM review_queue r
         JOIN companies c ON c.id = r.company_id`,
    )
    .all() as Array<ReviewItem & Company>;
}

export function updateReviewItemStatus(
  companyId: string,
  status: ReviewItem['status'],
  notes: string | null = null,
  db: Database = getDb(),
): ReviewItem | undefined {
  const existing = db
    .prepare('SELECT * FROM review_queue WHERE company_id = ?')
    .get(companyId) as ReviewItem | undefined;
  if (!existing) return undefined;
  const updated_at = now();
  db.prepare(
    'UPDATE review_queue SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?',
  ).run(status, notes, updated_at, existing.id);
  return { ...existing, status, notes: notes ?? existing.notes, updated_at };
}

// ---------------------------------------------------------------------------
// Source runs
// ---------------------------------------------------------------------------
export interface CreateSourceRunInput {
  source: string;
  params?: Record<string, unknown>;
}

export function createSourceRun(
  input: CreateSourceRunInput,
  db: Database = getDb(),
): SourceRun {
  const run: SourceRun = {
    id: randomUUID(),
    source: input.source,
    status: 'running',
    started_at: now(),
    completed_at: null,
    leads_found: 0,
    leads_accepted: 0,
    leads_rejected: 0,
    api_calls: 0,
    errors_json: null,
    params_json: input.params ? JSON.stringify(input.params) : null,
  };
  db.prepare(
    `INSERT INTO source_runs
       (id, source, status, started_at, completed_at,
        leads_found, leads_accepted, leads_rejected, api_calls,
        errors_json, params_json)
     VALUES
       (@id, @source, @status, @started_at, @completed_at,
        @leads_found, @leads_accepted, @leads_rejected, @api_calls,
        @errors_json, @params_json)`,
  ).run(run);
  return run;
}

export interface FinishSourceRunInput {
  id: string;
  status: 'completed' | 'failed';
  leadsFound: number;
  leadsAccepted: number;
  leadsRejected: number;
  apiCalls: number;
  errors: string[];
}

export function finishSourceRun(input: FinishSourceRunInput, db: Database = getDb()): void {
  db.prepare(
    `UPDATE source_runs
        SET status         = @status,
            completed_at   = @completed_at,
            leads_found    = @leads_found,
            leads_accepted = @leads_accepted,
            leads_rejected = @leads_rejected,
            api_calls      = @api_calls,
            errors_json    = @errors_json
      WHERE id = @id`,
  ).run({
    id: input.id,
    status: input.status,
    completed_at: now(),
    leads_found: input.leadsFound,
    leads_accepted: input.leadsAccepted,
    leads_rejected: input.leadsRejected,
    api_calls: input.apiCalls,
    errors_json: input.errors.length > 0 ? JSON.stringify(input.errors) : null,
  });
}

export function getRecentSourceRuns(
  limit = 20,
  db: Database = getDb(),
): SourceRun[] {
  return db
    .prepare('SELECT * FROM source_runs ORDER BY started_at DESC LIMIT ?')
    .all(limit) as SourceRun[];
}

// ---------------------------------------------------------------------------
// Website inspections cache
// ---------------------------------------------------------------------------
export interface WebsiteInspectionRecord {
  id: string;
  company_id: string | null;
  url: string;
  domain: string | null;
  status: string;
  status_code: number | null;
  title: string | null;
  meta_description: string | null;
  content_length: number | null;
  signals_json: string;
  fingerprint_json: string | null;
  error_message: string | null;
  fetched_at: string;
}

export function getInspectionByDomain(
  domain: string,
  db: Database = getDb(),
): WebsiteInspectionRecord | undefined {
  return db
    .prepare('SELECT * FROM website_inspections WHERE domain = ?')
    .get(domain) as WebsiteInspectionRecord | undefined;
}

export function getInspectionByCompany(
  companyId: string,
  db: Database = getDb(),
): WebsiteInspectionRecord | undefined {
  return db
    .prepare('SELECT * FROM website_inspections WHERE company_id = ? ORDER BY fetched_at DESC LIMIT 1')
    .get(companyId) as WebsiteInspectionRecord | undefined;
}

export interface UpsertInspectionInput {
  companyId: string | null;
  url: string;
  domain: string | null;
  status: string;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  contentLength: number | null;
  signalsJson: string;
  fingerprintJson: string | null;
  errorMessage: string | null;
}

export function upsertInspection(
  input: UpsertInspectionInput,
  db: Database = getDb(),
): WebsiteInspectionRecord {
  const fetchedAt = now();
  if (input.domain) {
    const existing = getInspectionByDomain(input.domain, db);
    if (existing) {
      const updated: WebsiteInspectionRecord = {
        ...existing,
        company_id: input.companyId ?? existing.company_id,
        url: input.url,
        status: input.status,
        status_code: input.statusCode,
        title: input.title,
        meta_description: input.metaDescription,
        content_length: input.contentLength,
        signals_json: input.signalsJson,
        fingerprint_json: input.fingerprintJson,
        error_message: input.errorMessage,
        fetched_at: fetchedAt,
      };
      db.prepare(
        `UPDATE website_inspections SET
            company_id       = @company_id,
            url              = @url,
            status           = @status,
            status_code      = @status_code,
            title            = @title,
            meta_description = @meta_description,
            content_length   = @content_length,
            signals_json     = @signals_json,
            fingerprint_json = @fingerprint_json,
            error_message    = @error_message,
            fetched_at       = @fetched_at
          WHERE id = @id`,
      ).run(updated);
      return updated;
    }
  }
  const record: WebsiteInspectionRecord = {
    id: randomUUID(),
    company_id: input.companyId,
    url: input.url,
    domain: input.domain,
    status: input.status,
    status_code: input.statusCode,
    title: input.title,
    meta_description: input.metaDescription,
    content_length: input.contentLength,
    signals_json: input.signalsJson,
    fingerprint_json: input.fingerprintJson,
    error_message: input.errorMessage,
    fetched_at: fetchedAt,
  };
  db.prepare(
    `INSERT INTO website_inspections
       (id, company_id, url, domain, status, status_code, title, meta_description,
        content_length, signals_json, fingerprint_json, error_message, fetched_at)
     VALUES
       (@id, @company_id, @url, @domain, @status, @status_code, @title, @meta_description,
        @content_length, @signals_json, @fingerprint_json, @error_message, @fetched_at)`,
  ).run(record);
  return record;
}

// ---------------------------------------------------------------------------
// AI analyses (cache + persistence)
// ---------------------------------------------------------------------------
export interface PersistAnalysisInput {
  id: string;
  companyId: string;
  promptVersion: string;
  inputHash: string;
  provider: string;
  model: string;
  summary: string | null;
  confidence: number | null;
  operationalPainPointsJson: string | null;
  automationOpportunitiesJson: string | null;
  estimatedBusinessImpactJson: string | null;
  likelyBuyerJson: string | null;
  urgencyJson: string | null;
  proofAnglesJson: string | null;
  risksJson: string | null;
  rawResponseJson: string | null;
  tokensInput: number;
  tokensCached: number;
  tokensOutput: number;
  estimatedCost: number;
  status: 'ok' | 'failed';
  errorMessage: string | null;
}

export function persistAiAnalysis(
  input: PersistAnalysisInput,
  db: Database = getDb(),
): void {
  const fields = {
    id: input.id,
    company_id: input.companyId,
    prompt_version: input.promptVersion,
    input_hash: input.inputHash,
    ai_provider: input.provider,
    model: input.model,
    summary: input.summary,
    confidence: input.confidence,
    operational_pain_points_json: input.operationalPainPointsJson,
    automation_opportunities_json: input.automationOpportunitiesJson,
    estimated_business_impact_json: input.estimatedBusinessImpactJson,
    likely_buyer_json: input.likelyBuyerJson,
    urgency_json: input.urgencyJson,
    proof_angles_json: input.proofAnglesJson,
    risks_json: input.risksJson,
    raw_response_json: input.rawResponseJson,
    tokens_input: input.tokensInput,
    tokens_cached: input.tokensCached,
    tokens_output: input.tokensOutput,
    estimated_cost: input.estimatedCost,
    status: input.status,
    error_message: input.errorMessage,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO ai_analyses
       (id, company_id, prompt_version, input_hash, ai_provider, model,
        summary, confidence,
        operational_pain_points_json, automation_opportunities_json,
        estimated_business_impact_json, likely_buyer_json, urgency_json,
        proof_angles_json, risks_json, raw_response_json,
        tokens_input, tokens_cached, tokens_output, estimated_cost,
        status, error_message, created_at, updated_at)
     VALUES
       (@id, @company_id, @prompt_version, @input_hash, @ai_provider, @model,
        @summary, @confidence,
        @operational_pain_points_json, @automation_opportunities_json,
        @estimated_business_impact_json, @likely_buyer_json, @urgency_json,
        @proof_angles_json, @risks_json, @raw_response_json,
        @tokens_input, @tokens_cached, @tokens_output, @estimated_cost,
        @status, @error_message, @created_at, @updated_at)
     ON CONFLICT(company_id, input_hash) DO UPDATE SET
        summary                        = excluded.summary,
        confidence                     = excluded.confidence,
        operational_pain_points_json   = excluded.operational_pain_points_json,
        automation_opportunities_json  = excluded.automation_opportunities_json,
        estimated_business_impact_json = excluded.estimated_business_impact_json,
        likely_buyer_json              = excluded.likely_buyer_json,
        urgency_json                   = excluded.urgency_json,
        proof_angles_json              = excluded.proof_angles_json,
        risks_json                     = excluded.risks_json,
        raw_response_json              = excluded.raw_response_json,
        tokens_input                   = excluded.tokens_input,
        tokens_cached                  = excluded.tokens_cached,
        tokens_output                  = excluded.tokens_output,
        estimated_cost                 = excluded.estimated_cost,
        status                         = excluded.status,
        error_message                  = excluded.error_message,
        updated_at                     = excluded.updated_at`,
  ).run(fields);
}

export function updateAiAnalysisFeedback(
  analysisId: string,
  feedbackStatus: string,
  notes: string | null = null,
  db: Database = getDb(),
): boolean {
  const result = db
    .prepare(
      `UPDATE ai_analyses
          SET feedback_status     = ?,
              feedback_notes      = COALESCE(?, feedback_notes),
              feedback_updated_at = ?
        WHERE id = ?`,
    )
    .run(feedbackStatus, notes, now(), analysisId);
  return result.changes > 0;
}

export function getAllAnalysesForCompany(
  companyId: string,
  db: Database = getDb(),
): Array<{ id: string; created_at: string; status: string; summary: string | null; confidence: number | null; estimated_cost: number; feedback_status: string }> {
  return db
    .prepare(
      'SELECT id, created_at, status, summary, confidence, estimated_cost, feedback_status FROM ai_analyses WHERE company_id = ? ORDER BY created_at DESC',
    )
    .all(companyId) as Array<{
    id: string;
    created_at: string;
    status: string;
    summary: string | null;
    confidence: number | null;
    estimated_cost: number;
    feedback_status: string;
  }>;
}

export function getAiAnalysisStats(db: Database = getDb()): {
  total: number;
  ok: number;
  failed: number;
  todayCostUsd: number;
  totalCostUsd: number;
  feedback: Record<string, number>;
} {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const totals = db
    .prepare(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(CASE WHEN substr(created_at,1,10) = ? THEN estimated_cost END), 0) AS today_cost,
          COALESCE(SUM(estimated_cost), 0) AS total_cost
         FROM ai_analyses`,
    )
    .get(todayPrefix) as {
    total: number;
    ok: number;
    failed: number;
    today_cost: number;
    total_cost: number;
  };
  const feedbackRows = db
    .prepare(
      'SELECT feedback_status, COUNT(*) AS n FROM ai_analyses GROUP BY feedback_status',
    )
    .all() as Array<{ feedback_status: string; n: number }>;
  const feedback: Record<string, number> = {};
  for (const r of feedbackRows) feedback[r.feedback_status] = r.n;
  return {
    total: totals.total,
    ok: totals.ok ?? 0,
    failed: totals.failed ?? 0,
    todayCostUsd: totals.today_cost,
    totalCostUsd: totals.total_cost,
    feedback,
  };
}

export function getInspectionStats(db: Database = getDb()): {
  inspected: number;
  failed: number;
  byStatus: Record<string, number>;
} {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM website_inspections GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const byStatus: Record<string, number> = {};
  let inspected = 0;
  let failed = 0;
  for (const r of rows) {
    byStatus[r.status] = r.n;
    inspected += r.n;
    if (r.status === 'failed' || r.status === 'timeout') failed += r.n;
  }
  return { inspected, failed, byStatus };
}
