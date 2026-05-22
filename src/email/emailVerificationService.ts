// Phase 1 email confidence — service-layer orchestrator. The API
// route is a thin wrapper around this; CLI scripts can call it
// directly too. Reads contacts + company from DB, runs the
// emailConfidence pipeline, persists the result.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  countGuessedEmailsOnDomain,
  persistEmailConfidence,
} from '../db/repository';
import { verifyEmail } from './emailConfidence';
import type { EmailConfidenceResult } from './emailTypes';

interface ContactRow {
  id: string;
  company_id: string;
  name: string | null;
  email: string;
  email_status: string | null;
  company_domain: string | null;
}

export interface VerifyContactResult extends EmailConfidenceResult {
  contactId: string;
  companyId: string;
}

export async function verifyContactEmail(
  contactId: string,
  options: { skipDns?: boolean; db?: Database } = {},
): Promise<VerifyContactResult | null> {
  const db = options.db ?? getDb();
  const row = db
    .prepare(
      `SELECT c.id, c.company_id, c.name, c.email, c.email_status,
              co.domain AS company_domain
         FROM contacts c
         JOIN companies co ON co.id = c.company_id
        WHERE c.id = ?`,
    )
    .get(contactId) as ContactRow | undefined;
  if (!row || !row.email) return null;

  // Catch-all heuristic input — count guessed emails already on the
  // same domain so the orchestrator can flag suspect domains.
  const emailDomain = row.email.split('@')[1]?.toLowerCase() ?? '';
  const domainHistory = emailDomain
    ? countGuessedEmailsOnDomain(emailDomain, db)
    : { guessed: 0, total: 0 };

  const result = await verifyEmail(
    {
      email: row.email,
      emailStatus: (row.email_status as 'extracted' | 'guessed' | null) ?? null,
      companyDomain: row.company_domain,
      hasName: !!row.name,
      domainHasPriorGuessedEmails: domainHistory.guessed >= 3,
    },
    { skipDns: options.skipDns },
  );

  persistEmailConfidence(
    {
      contactId: row.id,
      status: result.status,
      confidence: result.confidence,
      reasonsJson: JSON.stringify(result.reasons),
      mxRecordsJson: result.mxRecords ? JSON.stringify(result.mxRecords) : null,
      checkedAt: result.checkedAt,
      isDisposable: result.isDisposable,
      isRoleBased: result.isRoleBased,
      isCatchAllRisk: result.isCatchAllRisk,
      verificationMethod: result.verificationMethod,
    },
    db,
  );

  return { ...result, contactId: row.id, companyId: row.company_id };
}

export interface VerifyCompanyResult {
  companyId: string;
  attempted: number;
  ok: number;
  errors: string[];
  results: VerifyContactResult[];
}

export async function verifyEmailsForCompany(
  companyId: string,
  options: { skipDns?: boolean; db?: Database; max?: number } = {},
): Promise<VerifyCompanyResult> {
  const db = options.db ?? getDb();
  const rows = db
    .prepare(
      `SELECT id FROM contacts
        WHERE company_id = ? AND email IS NOT NULL AND email <> ''
        ORDER BY is_primary DESC, COALESCE(overall_confidence, confidence, 0) DESC
        LIMIT ?`,
    )
    .all(companyId, options.max ?? 25) as Array<{ id: string }>;

  const results: VerifyContactResult[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const result = await verifyContactEmail(r.id, { skipDns: options.skipDns, db });
      if (result) results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${r.id}: ${msg}`);
    }
  }

  return {
    companyId,
    attempted: rows.length,
    ok: results.length,
    errors,
    results,
  };
}
