// Compile an IntelligenceInputs bundle for one company. This is the only
// place that touches the DB — keeps every scorer pure.
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  getContactRoutesForCompany,
  getContactsForCompany,
  getEvidenceForCompany,
} from '../db/repository';
import type { Campaign } from '../scoring/campaignTypes';
import type {
  IntelligenceContactInput,
  IntelligenceInputs,
  IntelligenceOperationalClue,
  IntelligenceVerifiedSignal,
  IntelligenceVisualIssue,
} from './intelligenceTypes';

interface BuildContext {
  companyId: string;
  companyName: string;
  industry: string | null;
  location: string | null;
  websiteUrl: string | null;
  sizeEstimate: number | null;
  ruleScore: number;
  intentScore: number;
  finalScore: number;
  primaryCampaign: Campaign;
}

// Map detected role strings out of contacts.role / contacts.name when we
// only have the surfaced display label (no detected_role column).
const ROLE_FROM_LABEL: Array<[RegExp, string]> = [
  [/\bco[-\s]?founder\b/i, 'co_founder'],
  [/\bfounder\b/i, 'founder'],
  [/\bowner\b/i, 'owner'],
  [/\bceo\b/i, 'ceo'],
  [/\bmanaging director\b/i, 'managing_director'],
  [/\bprincipal\b/i, 'principal'],
  [/\bdirector\b/i, 'director'],
  [/\bpartner\b/i, 'partner'],
  [/\boperations manager\b/i, 'operations_manager'],
  [/\bpractice manager\b/i, 'practice_manager'],
];

function detectedRoleFor(role: string | null): string {
  if (!role) return 'unknown';
  for (const [rx, code] of ROLE_FROM_LABEL) {
    if (rx.test(role)) return code;
  }
  return 'unknown';
}

export function buildIntelligenceInputs(
  ctx: BuildContext,
  db: Database = getDb(),
): IntelligenceInputs {
  // Inspection — single row per domain
  const inspectionRow = db
    .prepare(
      `SELECT status, signals_json FROM website_inspections
       WHERE company_id = ?
       ORDER BY fetched_at DESC LIMIT 1`,
    )
    .get(ctx.companyId) as { status: string; signals_json: string } | undefined;
  const inspectionAttempted = !!inspectionRow;
  const inspectionOk = inspectionRow?.status === 'ok';
  let verifiedSignals: IntelligenceVerifiedSignal[] = [];
  if (inspectionRow?.signals_json) {
    try {
      const parsed = JSON.parse(inspectionRow.signals_json) as IntelligenceVerifiedSignal[];
      verifiedSignals = Array.isArray(parsed) ? parsed : [];
    } catch {
      verifiedSignals = [];
    }
  }

  // Contacts + routes
  const rawContacts = getContactsForCompany(ctx.companyId, db);
  const contacts: IntelligenceContactInput[] = rawContacts.map((c) => ({
    name: c.name,
    role: c.role,
    email: c.email,
    // Legacy Phase-1 contacts (source = 'source-feed') were ingested with
    // a real email but null email_status. Treat them as 'extracted' so
    // the scorers don't double-discount them.
    emailStatus: c.email_status ?? (c.email ? 'extracted' : null),
    source: c.source,
    detectedRole: detectedRoleFor(c.role),
    isPrimary: Boolean(c.is_primary),
  }));

  const routes = getContactRoutesForCompany(ctx.companyId, db);
  const hasPhone = routes.some((r) => r.route_type === 'PHONE');
  const hasContactForm = routes.some((r) => r.route_type === 'CONTACT_FORM');
  const hasBookingLink = routes.some((r) => r.route_type === 'BOOKING_LINK');
  const hasLinkedIn = routes.some((r) => r.route_type === 'LINKEDIN');

  // Evidence
  const evidenceRows = getEvidenceForCompany(ctx.companyId, db);
  const summaryRow = evidenceRows.find((r) => r.evidence_type === 'summary');
  const visualIssues: IntelligenceVisualIssue[] = [];
  const operationalClues: IntelligenceOperationalClue[] = [];
  for (const r of evidenceRows) {
    if (r.evidence_type.startsWith('visual.')) {
      let campaign = 'ANY';
      try {
        if (r.metadata_json) {
          const m = JSON.parse(r.metadata_json) as { campaign?: string };
          campaign = m.campaign ?? 'ANY';
        }
      } catch {
        /* ignore */
      }
      visualIssues.push({
        code: r.evidence_type.slice('visual.'.length),
        confidence: r.confidence,
        campaign,
      });
    } else if (r.evidence_type.startsWith('operational.')) {
      let evidence: string[] = [];
      try {
        if (r.metadata_json) {
          const m = JSON.parse(r.metadata_json) as { evidence?: string[] };
          evidence = m.evidence ?? [];
        }
      } catch {
        /* ignore */
      }
      operationalClues.push({
        code: r.evidence_type.slice('operational.'.length),
        confidence: r.confidence,
        evidence,
      });
    }
  }

  return {
    companyId: ctx.companyId,
    companyName: ctx.companyName,
    industry: ctx.industry,
    location: ctx.location,
    websiteUrl: ctx.websiteUrl,
    sizeEstimate: ctx.sizeEstimate,
    ruleScore: ctx.ruleScore,
    intentScore: ctx.intentScore,
    finalScore: ctx.finalScore,
    primaryCampaign: ctx.primaryCampaign,
    inspectionAttempted,
    inspectionOk,
    verifiedSignals,
    contacts,
    hasPhone,
    hasContactForm,
    hasBookingLink,
    hasLinkedIn,
    hasDesktopScreenshot: !!summaryRow?.screenshot_path,
    hasMobileScreenshot: !!summaryRow?.mobile_screenshot_path,
    visualIssues,
    operationalClues,
    evidenceComputedAt: summaryRow?.created_at ?? null,
  };
}
