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
    `INSERT INTO contacts (id, company_id, name, role, email, linkedin_url, confidence, created_at, source)
     VALUES (@id, @company_id, @name, @role, @email, @linkedin_url, @confidence, @created_at, 'source-feed')`,
  ).run(contact);
  return contact;
}

// The extended contact row carries the Phase-8 discovery fields alongside
// the legacy columns. Older rows (from before discovery existed) will have
// NULLs in the new columns — callers should default-safely.
export interface ContactRow extends Contact {
  contact_type: string | null;
  source: string | null;
  source_url: string | null;
  email_type: string | null;
  email_status: string | null;
  role_confidence: number | null;
  email_confidence: number | null;
  overall_confidence: number | null;
  is_primary: number | null;
  discovered_at: string | null;
}

export function getContactsForCompany(
  companyId: string,
  db: Database = getDb(),
): ContactRow[] {
  return db
    .prepare(
      `SELECT * FROM contacts WHERE company_id = ?
        ORDER BY COALESCE(overall_confidence, confidence) DESC`,
    )
    .all(companyId) as ContactRow[];
}

// ---------------------------------------------------------------------------
// Phase 8 — Contact discovery
// ---------------------------------------------------------------------------
export interface DiscoveredContactInput {
  name: string | null;
  role: string | null;
  email: string | null;
  emailType: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  source: string;
  roleConfidence: number;
  emailConfidence: number;
  overallConfidence: number;
  isPrimary: boolean;
  contactType: string | null;
}

function findExistingContact(
  companyId: string,
  input: DiscoveredContactInput,
  db: Database,
): ContactRow | undefined {
  // De-dupe by (email) if email is set; otherwise by (lowercased name).
  if (input.email) {
    return db
      .prepare('SELECT * FROM contacts WHERE company_id = ? AND email = ?')
      .get(companyId, input.email) as ContactRow | undefined;
  }
  if (input.name) {
    return db
      .prepare(
        'SELECT * FROM contacts WHERE company_id = ? AND lower(name) = lower(?)',
      )
      .get(companyId, input.name) as ContactRow | undefined;
  }
  return undefined;
}

export function insertOrUpdateContact(
  companyId: string,
  input: {
    name: string | null;
    role: string | null;
    email: string | null;
    emailType: string | null;
    emailStatus: string | null;
    linkedinUrl: string | null;
    sourceUrl: string;
    // Phase 8.1: 'static' | 'playwright' | 'guessed' | 'inferred' — how
    // this contact was originally discovered. Defaults to 'static' for
    // back-compat with callers that don't pass it.
    source?: string;
    roleConfidence: number;
    emailConfidence: number;
    overallConfidence: number;
    isPrimary: boolean;
  },
  db: Database = getDb(),
): ContactRow {
  const source = input.source ?? 'static';
  const existing = findExistingContact(
    companyId,
    { ...input, source, contactType: null } as DiscoveredContactInput,
    db,
  );
  if (existing) {
    db.prepare(
      `UPDATE contacts SET
         name               = COALESCE(?, name),
         role               = COALESCE(?, role),
         email              = COALESCE(?, email),
         linkedin_url       = COALESCE(?, linkedin_url),
         source             = ?,
         source_url         = COALESCE(?, source_url),
         email_type         = COALESCE(?, email_type),
         email_status       = COALESCE(?, email_status),
         role_confidence    = ?,
         email_confidence   = ?,
         overall_confidence = ?,
         is_primary         = ?,
         confidence         = ?,
         discovered_at      = ?
       WHERE id = ?`,
    ).run(
      input.name,
      input.role,
      input.email,
      input.linkedinUrl,
      source,
      input.sourceUrl,
      input.emailType,
      input.emailStatus,
      input.roleConfidence,
      input.emailConfidence,
      input.overallConfidence,
      input.isPrimary ? 1 : 0,
      input.overallConfidence,
      now(),
      existing.id,
    );
    return {
      ...existing,
      name: input.name ?? existing.name,
      role: input.role ?? existing.role,
      email: input.email ?? existing.email,
      linkedin_url: input.linkedinUrl ?? existing.linkedin_url,
      source,
      source_url: input.sourceUrl,
      email_type: input.emailType,
      email_status: input.emailStatus,
      role_confidence: input.roleConfidence,
      email_confidence: input.emailConfidence,
      overall_confidence: input.overallConfidence,
      is_primary: input.isPrimary ? 1 : 0,
      confidence: input.overallConfidence,
      discovered_at: now(),
    };
  }
  const row: ContactRow = {
    id: randomUUID(),
    company_id: companyId,
    name: input.name,
    role: input.role,
    email: input.email,
    linkedin_url: input.linkedinUrl,
    confidence: input.overallConfidence,
    created_at: now(),
    contact_type: null,
    source,
    source_url: input.sourceUrl,
    email_type: input.emailType,
    email_status: input.emailStatus,
    role_confidence: input.roleConfidence,
    email_confidence: input.emailConfidence,
    overall_confidence: input.overallConfidence,
    is_primary: input.isPrimary ? 1 : 0,
    discovered_at: now(),
  };
  db.prepare(
    `INSERT INTO contacts
       (id, company_id, name, role, email, linkedin_url, confidence,
        created_at, contact_type, source, source_url, email_type, email_status,
        role_confidence, email_confidence, overall_confidence, is_primary,
        discovered_at)
     VALUES
       (@id, @company_id, @name, @role, @email, @linkedin_url, @confidence,
        @created_at, @contact_type, @source, @source_url, @email_type, @email_status,
        @role_confidence, @email_confidence, @overall_confidence, @is_primary,
        @discovered_at)`,
  ).run(row);
  return row;
}

export interface ContactRouteRow {
  id: string;
  company_id: string;
  route_type: string;
  value: string;
  source_url: string | null;
  confidence: number;
  created_at: string;
}

export function insertContactRoute(
  companyId: string,
  input: {
    type: string;
    value: string;
    sourceUrl: string;
    confidence: number;
  },
  db: Database = getDb(),
): void {
  // Dedupe by (company_id, route_type, value) — re-runs don't double-up.
  const existing = db
    .prepare(
      'SELECT id FROM contact_routes WHERE company_id = ? AND route_type = ? AND value = ?',
    )
    .get(companyId, input.type, input.value) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE contact_routes SET confidence = ?, source_url = ? WHERE id = ?',
    ).run(input.confidence, input.sourceUrl, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO contact_routes (id, company_id, route_type, value, source_url, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    companyId,
    input.type,
    input.value,
    input.sourceUrl,
    input.confidence,
    now(),
  );
}

export function getContactRoutesForCompany(
  companyId: string,
  db: Database = getDb(),
): ContactRouteRow[] {
  return db
    .prepare(
      'SELECT * FROM contact_routes WHERE company_id = ? ORDER BY confidence DESC',
    )
    .all(companyId) as ContactRouteRow[];
}

// ---------------------------------------------------------------------------
// Phase 9 — Evidence / proof extraction
// ---------------------------------------------------------------------------
export interface EvidenceRow {
  id: string;
  company_id: string;
  evidence_type: string;
  evidence_summary: string | null;
  confidence: number;
  screenshot_path: string | null;
  mobile_screenshot_path: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface PersistEvidenceInput {
  companyId: string;
  evidenceType: string;
  evidenceSummary: string | null;
  confidence: number;
  screenshotPath: string | null;
  mobileScreenshotPath: string | null;
  metadata: Record<string, unknown> | null;
}

export function insertLeadEvidence(
  input: PersistEvidenceInput,
  db: Database = getDb(),
): EvidenceRow {
  const row: EvidenceRow = {
    id: randomUUID(),
    company_id: input.companyId,
    evidence_type: input.evidenceType,
    evidence_summary: input.evidenceSummary,
    confidence: input.confidence,
    screenshot_path: input.screenshotPath,
    mobile_screenshot_path: input.mobileScreenshotPath,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO lead_evidence
       (id, company_id, evidence_type, evidence_summary, confidence,
        screenshot_path, mobile_screenshot_path, metadata_json, created_at)
     VALUES (@id, @company_id, @evidence_type, @evidence_summary, @confidence,
             @screenshot_path, @mobile_screenshot_path, @metadata_json, @created_at)`,
  ).run(row);
  return row;
}

// Clear previous evidence for a company so re-runs don't accumulate stale
// rows. Each fresh extraction is the single source of truth.
export function clearLeadEvidence(
  companyId: string,
  db: Database = getDb(),
): void {
  db.prepare('DELETE FROM lead_evidence WHERE company_id = ?').run(companyId);
}

export function getEvidenceForCompany(
  companyId: string,
  db: Database = getDb(),
): EvidenceRow[] {
  return db
    .prepare(
      'SELECT * FROM lead_evidence WHERE company_id = ? ORDER BY confidence DESC, created_at DESC',
    )
    .all(companyId) as EvidenceRow[];
}

export function getLatestEvidenceTimestamp(
  companyId: string,
  db: Database = getDb(),
): string | null {
  const row = db
    .prepare(
      'SELECT MAX(created_at) AS t FROM lead_evidence WHERE company_id = ?',
    )
    .get(companyId) as { t: string | null } | undefined;
  return row?.t ?? null;
}

// ---------------------------------------------------------------------------
// Phase 10 — Opportunity Intelligence
// ---------------------------------------------------------------------------
export interface OpportunityIntelligenceRow {
  company_id: string;
  opportunity_score: number;
  human_attention_priority: string;
  operational_pain_score: number;
  buying_readiness_score: number;
  accessibility_score: number;
  implementation_fit_score: number;
  trust_barrier_score: number;
  evidence_confidence_score: number;
  likely_project_type: string;
  estimated_project_complexity: string;
  estimated_commercial_potential: string;
  payload_json: string;
  computed_at: string;
}

export interface UpsertIntelligenceInput {
  companyId: string;
  opportunityScore: number;
  humanAttentionPriority: string;
  operationalPainScore: number;
  buyingReadinessScore: number;
  accessibilityScore: number;
  implementationFitScore: number;
  trustBarrierScore: number;
  evidenceConfidenceScore: number;
  likelyProjectType: string;
  estimatedProjectComplexity: string;
  estimatedCommercialPotential: string;
  payload: Record<string, unknown>;
  computedAt: string;
}

export function upsertOpportunityIntelligence(
  input: UpsertIntelligenceInput,
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO opportunity_intelligence
       (company_id, opportunity_score, human_attention_priority,
        operational_pain_score, buying_readiness_score, accessibility_score,
        implementation_fit_score, trust_barrier_score, evidence_confidence_score,
        likely_project_type, estimated_project_complexity, estimated_commercial_potential,
        payload_json, computed_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       opportunity_score              = excluded.opportunity_score,
       human_attention_priority       = excluded.human_attention_priority,
       operational_pain_score         = excluded.operational_pain_score,
       buying_readiness_score         = excluded.buying_readiness_score,
       accessibility_score            = excluded.accessibility_score,
       implementation_fit_score       = excluded.implementation_fit_score,
       trust_barrier_score            = excluded.trust_barrier_score,
       evidence_confidence_score      = excluded.evidence_confidence_score,
       likely_project_type            = excluded.likely_project_type,
       estimated_project_complexity   = excluded.estimated_project_complexity,
       estimated_commercial_potential = excluded.estimated_commercial_potential,
       payload_json                   = excluded.payload_json,
       computed_at                    = excluded.computed_at`,
  ).run(
    input.companyId,
    input.opportunityScore,
    input.humanAttentionPriority,
    input.operationalPainScore,
    input.buyingReadinessScore,
    input.accessibilityScore,
    input.implementationFitScore,
    input.trustBarrierScore,
    input.evidenceConfidenceScore,
    input.likelyProjectType,
    input.estimatedProjectComplexity,
    input.estimatedCommercialPotential,
    JSON.stringify(input.payload),
    input.computedAt,
  );
}

export function getOpportunityIntelligence(
  companyId: string,
  db: Database = getDb(),
): OpportunityIntelligenceRow | undefined {
  return db
    .prepare('SELECT * FROM opportunity_intelligence WHERE company_id = ?')
    .get(companyId) as OpportunityIntelligenceRow | undefined;
}

export function listOpportunityIntelligence(
  db: Database = getDb(),
  options: { limit?: number; priority?: string } = {},
): OpportunityIntelligenceRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (options.priority) {
    where.push('human_attention_priority = ?');
    args.push(options.priority);
  }
  const sql = `
    SELECT oi.*
    FROM opportunity_intelligence oi
    JOIN companies c ON c.id = oi.company_id
    WHERE c.status NOT IN ('rejected','archived')
    ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY oi.opportunity_score DESC
    ${typeof options.limit === 'number' ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : ''}
  `;
  return db.prepare(sql).all(...args) as OpportunityIntelligenceRow[];
}

// ---------------------------------------------------------------------------
// Phase 11 — Discovery (top-of-funnel)
// ---------------------------------------------------------------------------
export interface DiscoveryRunRow {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  raw_found: number;
  valid_domains: number;
  deduped: number;
  rejected: number;
  errors_json: string | null;
}

export interface RawDiscoveryRow {
  id: string;
  run_id: string | null;
  source: string;
  business_name: string;
  raw_url: string;
  extracted_domain: string | null;
  title: string | null;
  snippet: string | null;
  location: string | null;
  phone: string | null;
  discovered_at: string;
  validation_status: string;
  validation_reason: string | null;
}

export function insertDiscoveryRun(
  input: { source: string; startedAt: string },
  db: Database = getDb(),
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO discovery_runs (id, source, started_at) VALUES (?, ?, ?)`,
  ).run(id, input.source, input.startedAt);
  return id;
}

export function updateDiscoveryRunStats(
  input: {
    id: string;
    completedAt: string;
    rawFound: number;
    validDomains: number;
    deduped: number;
    rejected: number;
    errors: string[];
  },
  db: Database = getDb(),
): void {
  db.prepare(
    `UPDATE discovery_runs
       SET completed_at  = ?,
           raw_found     = ?,
           valid_domains = ?,
           deduped       = ?,
           rejected      = ?,
           errors_json   = ?
     WHERE id = ?`,
  ).run(
    input.completedAt,
    input.rawFound,
    input.validDomains,
    input.deduped,
    input.rejected,
    JSON.stringify(input.errors),
    input.id,
  );
}

export function insertRawDiscovery(
  input: {
    runId: string;
    source: string;
    businessName: string;
    rawUrl: string;
    extractedDomain: string | null;
    title: string | null;
    snippet: string | null;
    location: string | null;
    phone: string | null;
    discoveredAt: string;
    validationStatus: string;
    validationReason: string | null;
  },
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO raw_discoveries
       (id, run_id, source, business_name, raw_url, extracted_domain, title,
        snippet, location, phone, discovered_at, validation_status, validation_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.runId,
    input.source,
    input.businessName,
    input.rawUrl,
    input.extractedDomain,
    input.title,
    input.snippet,
    input.location,
    input.phone,
    input.discoveredAt,
    input.validationStatus,
    input.validationReason,
  );
}

export function listDiscoveryRuns(
  db: Database = getDb(),
  limit = 20,
): DiscoveryRunRow[] {
  return db
    .prepare(
      `SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as DiscoveryRunRow[];
}

export function getDiscoveryStats(db: Database = getDb()): {
  totalRuns: number;
  totalRawFound: number;
  totalValid: number;
  totalDeduped: number;
  totalRejected: number;
  bySource: Record<string, { runs: number; valid: number; rejected: number; deduped: number }>;
  validationFailures: Record<string, number>;
  domainsToday: number;
  validToday: number;
} {
  const runs = db
    .prepare('SELECT * FROM discovery_runs')
    .all() as DiscoveryRunRow[];
  const totalRuns = runs.length;
  let totalRawFound = 0;
  let totalValid = 0;
  let totalDeduped = 0;
  let totalRejected = 0;
  const bySource: Record<string, { runs: number; valid: number; rejected: number; deduped: number }> = {};
  for (const r of runs) {
    totalRawFound += r.raw_found;
    totalValid += r.valid_domains;
    totalDeduped += r.deduped;
    totalRejected += r.rejected;
    // source field is comma-joined connector names — split for the breakdown
    for (const s of r.source.split(',').filter(Boolean)) {
      if (!bySource[s]) bySource[s] = { runs: 0, valid: 0, rejected: 0, deduped: 0 };
      bySource[s].runs += 1;
      // Splitting the totals across sources is approximate when multiple
      // connectors ran in the same run; the per-source breakdown below
      // from raw_discoveries gives the accurate split.
    }
  }
  const perSource = db
    .prepare(
      `SELECT source AS s,
              SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END) AS valid,
              SUM(CASE WHEN validation_status = 'invalid' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN validation_status = 'duplicate' THEN 1 ELSE 0 END) AS deduped
       FROM raw_discoveries
       GROUP BY source`,
    )
    .all() as Array<{ s: string; valid: number; rejected: number; deduped: number }>;
  for (const row of perSource) {
    if (!bySource[row.s]) bySource[row.s] = { runs: 0, valid: 0, rejected: 0, deduped: 0 };
    bySource[row.s].valid = row.valid;
    bySource[row.s].rejected = row.rejected;
    bySource[row.s].deduped = row.deduped;
  }

  const failures = db
    .prepare(
      `SELECT COALESCE(validation_reason, 'unknown') AS reason, COUNT(*) AS n
       FROM raw_discoveries
       WHERE validation_status = 'invalid'
       GROUP BY reason
       ORDER BY n DESC
       LIMIT 12`,
    )
    .all() as Array<{ reason: string; n: number }>;
  const validationFailures: Record<string, number> = {};
  for (const f of failures) validationFailures[f.reason] = f.n;

  // Today's volume — counts every raw row discovered in the last 24h, plus
  // those that ended up valid.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN validation_status = 'valid' THEN 1 ELSE 0 END) AS v
       FROM raw_discoveries
       WHERE discovered_at >= ?`,
    )
    .get(since) as { n: number; v: number };

  return {
    totalRuns,
    totalRawFound,
    totalValid,
    totalDeduped,
    totalRejected,
    bySource,
    validationFailures,
    domainsToday: today.n ?? 0,
    validToday: today.v ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Phase 12 — Qualification queue (Discovery → Qualification promotion)
// ---------------------------------------------------------------------------
export interface QualificationQueueDbRow {
  id: string;
  discovery_id: string | null;
  company_id: string | null;
  domain: string;
  source: string;
  status: string;
  priority: number;
  promotion_reason: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertQualificationQueueRow(
  input: {
    discoveryId: string | null;
    companyId: string | null;
    domain: string;
    source: string;
    status: string;
    priority: number;
    promotionReason: string;
    errorMessage?: string | null;
  },
  db: Database = getDb(),
): QualificationQueueDbRow {
  const existing = db
    .prepare('SELECT * FROM qualification_queue WHERE domain = ?')
    .get(input.domain) as QualificationQueueDbRow | undefined;
  const ts = now();
  if (existing) {
    db.prepare(
      `UPDATE qualification_queue
         SET discovery_id    = COALESCE(?, discovery_id),
             company_id      = COALESCE(?, company_id),
             source          = ?,
             status          = ?,
             priority        = ?,
             promotion_reason= ?,
             error_message   = ?,
             updated_at      = ?
       WHERE id = ?`,
    ).run(
      input.discoveryId,
      input.companyId,
      input.source,
      input.status,
      input.priority,
      input.promotionReason,
      input.errorMessage ?? null,
      ts,
      existing.id,
    );
    return {
      ...existing,
      discovery_id: input.discoveryId ?? existing.discovery_id,
      company_id: input.companyId ?? existing.company_id,
      source: input.source,
      status: input.status,
      priority: input.priority,
      promotion_reason: input.promotionReason,
      error_message: input.errorMessage ?? null,
      updated_at: ts,
    };
  }
  const row: QualificationQueueDbRow = {
    id: randomUUID(),
    discovery_id: input.discoveryId,
    company_id: input.companyId,
    domain: input.domain,
    source: input.source,
    status: input.status,
    priority: input.priority,
    promotion_reason: input.promotionReason,
    error_message: input.errorMessage ?? null,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO qualification_queue
       (id, discovery_id, company_id, domain, source, status, priority,
        promotion_reason, error_message, created_at, updated_at)
     VALUES
       (@id, @discovery_id, @company_id, @domain, @source, @status, @priority,
        @promotion_reason, @error_message, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function transitionQualificationStatus(
  domain: string,
  status: string,
  options: { companyId?: string | null; errorMessage?: string | null } = {},
  db: Database = getDb(),
): void {
  db.prepare(
    `UPDATE qualification_queue
       SET status        = ?,
           company_id    = COALESCE(?, company_id),
           error_message = ?,
           updated_at    = ?
     WHERE domain = ?`,
  ).run(
    status,
    options.companyId ?? null,
    options.errorMessage ?? null,
    now(),
    domain,
  );
}

export function listQualificationQueue(
  options: { status?: string | string[]; limit?: number } = {},
  db: Database = getDb(),
): QualificationQueueDbRow[] {
  const statuses = options.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : null;
  const where = statuses ? `WHERE status IN (${statuses.map(() => '?').join(',')})` : '';
  const limit = typeof options.limit === 'number' ? `LIMIT ${options.limit}` : '';
  const sql = `SELECT * FROM qualification_queue ${where} ORDER BY priority DESC, created_at ASC ${limit}`;
  return (statuses
    ? db.prepare(sql).all(...statuses)
    : db.prepare(sql).all()) as QualificationQueueDbRow[];
}

export function getQualificationQueueStats(
  db: Database = getDb(),
): {
  total: number;
  byStatus: Record<string, number>;
  topPromotionReasons: Array<{ reason: string; count: number }>;
  recent24hPromoted: number;
  recent24hSkipped: number;
  recent24hFailed: number;
} {
  const rows = db
    .prepare('SELECT status, promotion_reason, created_at FROM qualification_queue')
    .all() as Array<{ status: string; promotion_reason: string; created_at: string }>;
  const byStatus: Record<string, number> = {};
  const reasonsPromoted: Record<string, number> = {};
  const reasonsSkipped: Record<string, number> = {};
  let recent24hPromoted = 0;
  let recent24hSkipped = 0;
  let recent24hFailed = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const created = new Date(r.created_at).getTime();
    if (created >= cutoff) {
      if (r.status === 'PROMOTED' || r.status === 'PENDING' || r.status === 'PROCESSING')
        recent24hPromoted += 1;
      else if (r.status === 'SKIPPED') recent24hSkipped += 1;
      else if (r.status === 'FAILED') recent24hFailed += 1;
    }
    if (r.status === 'PROMOTED' || r.status === 'PENDING' || r.status === 'PROCESSING') {
      reasonsPromoted[r.promotion_reason] = (reasonsPromoted[r.promotion_reason] ?? 0) + 1;
    } else if (r.status === 'SKIPPED') {
      reasonsSkipped[r.promotion_reason] = (reasonsSkipped[r.promotion_reason] ?? 0) + 1;
    }
  }
  const topPromotionReasons = Object.entries(reasonsPromoted)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
  return {
    total: rows.length,
    byStatus,
    topPromotionReasons,
    recent24hPromoted,
    recent24hSkipped,
    recent24hFailed,
  };
}

// Read fresh validated discoveries that haven't yet been considered by
// the promotion gate. The promoter joins against the queue so we never
// re-evaluate the same domain twice.
export function listValidatedDiscoveriesAwaitingPromotion(
  db: Database = getDb(),
  limit = 500,
): Array<{
  id: string;
  domain: string;
  business_name: string;
  source: string;
  title: string | null;
  snippet: string | null;
  location: string | null;
  phone: string | null;
}> {
  return db
    .prepare(
      `SELECT rd.id, rd.extracted_domain AS domain, rd.business_name, rd.source,
              rd.title, rd.snippet, rd.location, rd.phone
       FROM raw_discoveries rd
       LEFT JOIN qualification_queue qq ON qq.domain = rd.extracted_domain
       WHERE rd.validation_status = 'valid'
         AND rd.extracted_domain IS NOT NULL
         AND qq.id IS NULL
       ORDER BY rd.discovered_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    domain: string;
    business_name: string;
    source: string;
    title: string | null;
    snippet: string | null;
    location: string | null;
    phone: string | null;
  }>;
}

// Plain upsert path used by the promoter — creates a companies row
// keyed on (domain, source). Returns the company id.
export function upsertCompanyFromPromotion(
  input: {
    name: string;
    domain: string;
    websiteUrl: string;
    source: string;
    location: string | null;
  },
  db: Database = getDb(),
): string {
  const existing = db
    .prepare('SELECT id FROM companies WHERE domain = ?')
    .get(input.domain) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO companies (id, name, domain, website_url, industry, location,
                            size_estimate, source, source_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, NULL, 'review', ?, ?)`,
  ).run(id, input.name, input.domain, input.websiteUrl, input.location, input.source, ts, ts);
  return id;
}

export function getEvidenceStats(db: Database = getDb()): {
  companiesWithEvidence: number;
  totalEvidenceRows: number;
  withDesktopScreenshot: number;
  withMobileScreenshot: number;
  byType: Record<string, number>;
} {
  const rows = db
    .prepare(
      'SELECT company_id, evidence_type, screenshot_path, mobile_screenshot_path FROM lead_evidence',
    )
    .all() as Array<{
    company_id: string;
    evidence_type: string;
    screenshot_path: string | null;
    mobile_screenshot_path: string | null;
  }>;
  const companies = new Set<string>();
  const byType: Record<string, number> = {};
  let desktop = 0;
  let mobile = 0;
  for (const r of rows) {
    companies.add(r.company_id);
    byType[r.evidence_type] = (byType[r.evidence_type] ?? 0) + 1;
    if (r.screenshot_path) desktop += 1;
    if (r.mobile_screenshot_path) mobile += 1;
  }
  return {
    companiesWithEvidence: companies.size,
    totalEvidenceRows: rows.length,
    withDesktopScreenshot: desktop,
    withMobileScreenshot: mobile,
    byType,
  };
}

export function getContactStats(db: Database = getDb()): {
  total: number;
  withDirectEmail: number;
  withGuessedEmail: number;
  withNamedDm: number;
  withForm: number;
  withPhone: number;
  withBooking: number;
  noContact: number;
  bySource: Record<string, number>;
} {
  const companies = db
    .prepare('SELECT id FROM companies WHERE status NOT IN (?, ?)')
    .all('rejected', 'archived') as Array<{ id: string }>;
  const contacts = db
    .prepare('SELECT company_id, name, email, email_status, source FROM contacts')
    .all() as Array<{
    company_id: string;
    name: string | null;
    email: string | null;
    email_status: string | null;
    source: string | null;
  }>;
  const routes = db
    .prepare('SELECT company_id, route_type FROM contact_routes')
    .all() as Array<{ company_id: string; route_type: string }>;

  const contactByCompany = new Map<string, typeof contacts>();
  for (const c of contacts) {
    if (!contactByCompany.has(c.company_id)) contactByCompany.set(c.company_id, []);
    contactByCompany.get(c.company_id)!.push(c);
  }
  const routeByCompany = new Map<string, Set<string>>();
  for (const r of routes) {
    if (!routeByCompany.has(r.company_id)) routeByCompany.set(r.company_id, new Set());
    routeByCompany.get(r.company_id)!.add(r.route_type);
  }

  let withDirectEmail = 0;
  let withGuessedEmail = 0;
  let withNamedDm = 0;
  let withForm = 0;
  let withPhone = 0;
  let withBooking = 0;
  let noContact = 0;
  const bySource: Record<string, number> = {};

  for (const co of companies) {
    const cs = contactByCompany.get(co.id) ?? [];
    const rs = routeByCompany.get(co.id) ?? new Set();
    const hasDirect = cs.some((c) => c.email && c.email_status === 'extracted');
    const hasGuess = cs.some((c) => c.email && c.email_status === 'guessed');
    const hasName = cs.some((c) => c.name);
    if (hasDirect) withDirectEmail += 1;
    if (hasGuess) withGuessedEmail += 1;
    if (hasName) withNamedDm += 1;
    if (rs.has('CONTACT_FORM')) withForm += 1;
    if (rs.has('PHONE')) withPhone += 1;
    if (rs.has('BOOKING_LINK')) withBooking += 1;
    if (cs.length === 0 && rs.size === 0) noContact += 1;
  }

  // Per-source breakdown across ALL contact rows (not company-level).
  for (const c of contacts) {
    const key = c.source ?? 'unknown';
    bySource[key] = (bySource[key] ?? 0) + 1;
  }

  return {
    total: companies.length,
    withDirectEmail,
    withGuessedEmail,
    withNamedDm,
    withForm,
    withPhone,
    withBooking,
    noContact,
    bySource,
  };
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
  const campaign = score.campaign;
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
    primary_campaign: campaign.primary,
    campaign_scores_json: JSON.stringify(campaign.scores),
    campaign_reasons_json: JSON.stringify({
      reasons: campaign.reasons,
      trueRejectionReasons: campaign.trueRejectionReasons,
    }),
    primary_reason: campaign.primaryReason,
    suggested_investigation: campaign.suggestedInvestigation,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO lead_scores
       (id, company_id, rule_score, intent_score, final_score, priority,
        reasons_json, primary_campaign, campaign_scores_json,
        campaign_reasons_json, primary_reason, suggested_investigation,
        created_at)
     VALUES
       (@id, @company_id, @rule_score, @intent_score, @final_score, @priority,
        @reasons_json, @primary_campaign, @campaign_scores_json,
        @campaign_reasons_json, @primary_reason, @suggested_investigation,
        @created_at)`,
  ).run(row);
}

export function getLatestScore(
  companyId: string,
  db: Database = getDb(),
):
  | {
      rule_score: number;
      intent_score: number;
      final_score: number;
      priority: Priority;
      reasons_json: string;
      primary_campaign: string | null;
      campaign_scores_json: string | null;
      campaign_reasons_json: string | null;
      primary_reason: string | null;
      suggested_investigation: string | null;
      created_at: string;
    }
  | undefined {
  return db
    .prepare(
      `SELECT rule_score, intent_score, final_score, priority, reasons_json,
              primary_campaign, campaign_scores_json, campaign_reasons_json,
              primary_reason, suggested_investigation, created_at
         FROM lead_scores
        WHERE company_id = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(companyId) as
    | {
        rule_score: number;
        intent_score: number;
        final_score: number;
        priority: Priority;
        reasons_json: string;
        primary_campaign: string | null;
        campaign_scores_json: string | null;
        campaign_reasons_json: string | null;
        primary_reason: string | null;
        suggested_investigation: string | null;
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

// ---------------------------------------------------------------------------
// Phase 7 — Lead reviews + review metrics
// ---------------------------------------------------------------------------
export interface LeadReviewRow {
  id: string;
  company_id: string;
  review_type: string;
  previous_campaign: string | null;
  corrected_campaign: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface InsertLeadReviewInput {
  companyId: string;
  reviewType: string;
  previousCampaign?: string | null;
  correctedCampaign?: string | null;
  reviewerNotes?: string | null;
}

export function insertLeadReview(
  input: InsertLeadReviewInput,
  db: Database = getDb(),
): LeadReviewRow {
  const row: LeadReviewRow = {
    id: randomUUID(),
    company_id: input.companyId,
    review_type: input.reviewType,
    previous_campaign: input.previousCampaign ?? null,
    corrected_campaign: input.correctedCampaign ?? null,
    reviewer_notes: input.reviewerNotes ?? null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO lead_reviews
       (id, company_id, review_type, previous_campaign, corrected_campaign,
        reviewer_notes, created_at)
     VALUES (@id, @company_id, @review_type, @previous_campaign,
             @corrected_campaign, @reviewer_notes, @created_at)`,
  ).run(row);
  return row;
}

export function getLatestReviewByCompany(
  db: Database = getDb(),
): Map<string, LeadReviewRow> {
  const rows = db
    .prepare(
      `SELECT lr.*
         FROM lead_reviews lr
         JOIN (
           SELECT company_id, MAX(created_at) AS created_at
             FROM lead_reviews
            GROUP BY company_id
         ) latest
           ON latest.company_id = lr.company_id
          AND latest.created_at = lr.created_at`,
    )
    .all() as LeadReviewRow[];
  const map = new Map<string, LeadReviewRow>();
  for (const r of rows) map.set(r.company_id, r);
  return map;
}

export function countReviewsByType(
  db: Database = getDb(),
): Record<string, number> {
  const rows = db
    .prepare(
      'SELECT review_type, COUNT(*) AS n FROM lead_reviews GROUP BY review_type',
    )
    .all() as Array<{ review_type: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.review_type] = r.n;
  return out;
}

export interface InsertReviewMetricInput {
  metricType: string;
  value: number;
  source?: string | null;
}

export function insertReviewMetric(
  input: InsertReviewMetricInput,
  db: Database = getDb(),
): void {
  db.prepare(
    `INSERT INTO review_metrics (id, metric_type, value, source, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), input.metricType, input.value, input.source ?? null, now());
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
