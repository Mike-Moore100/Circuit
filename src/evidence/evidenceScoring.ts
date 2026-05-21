import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  clearLeadEvidence,
  getEvidenceForCompany,
  getLatestEvidenceTimestamp,
  insertLeadEvidence,
} from '../db/repository';
import {
  detectVisualIssues,
  summariseCtas,
} from './detectVisualIssues';
import { extractOperationalEvidence } from './extractOperationalEvidence';
import { capturePages } from './screenshotCapture';
import type {
  CaptureResult,
  LeadEvidence,
  OperationalClue,
  VisualIssue,
} from './evidenceTypes';

function isFresh(iso: string | null): boolean {
  if (!iso) return false;
  const ttlMs = config.evidence.cacheTtlDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(iso).getTime() < ttlMs;
}

function relativeScreenshotPath(absolute: string | null): string | null {
  if (!absolute) return null;
  // Persist relative to the configured screenshot dir's parent so the API
  // route can resolve it without leaking absolute paths.
  return path.relative(config.evidence.screenshotDir, absolute);
}

// Per-campaign confidence — boost issues that match the lead's campaign,
// soft-weight the rest. Combined with operational clues into a single 0-100.
function combineEvidenceConfidence(
  campaign: string,
  visualIssues: VisualIssue[],
  operationalClues: OperationalClue[],
): number {
  if (visualIssues.length === 0 && operationalClues.length === 0) return 0;
  const visualScore = visualIssues.reduce((acc, issue) => {
    const onCampaign = issue.campaign === campaign || issue.campaign === 'ANY';
    const w = onCampaign ? 1.0 : 0.55;
    return acc + issue.confidence * w;
  }, 0) / Math.max(1, visualIssues.length);
  const operationalScore = operationalClues.reduce((acc, c) => acc + c.confidence, 0) /
    Math.max(1, operationalClues.length);

  // Weighting per campaign: visual issues matter most for web-rebuild &
  // funnel; operational language matters most for ai-automation.
  let weighted = 0;
  if (campaign === 'AI_AUTOMATION') {
    weighted = 0.4 * visualScore + 0.6 * operationalScore;
  } else if (campaign === 'WEB_REBUILD' || campaign === 'LOCAL_DIGITAL_UPGRADE') {
    weighted = 0.8 * visualScore + 0.2 * operationalScore;
  } else if (campaign === 'FUNNEL_OPTIMIZATION') {
    weighted = 0.75 * visualScore + 0.25 * operationalScore;
  } else {
    weighted = 0.5 * visualScore + 0.5 * operationalScore;
  }
  return Math.max(0, Math.min(100, Math.round(weighted)));
}

function summariseVisualIssues(issues: VisualIssue[]): string {
  if (issues.length === 0) return 'No visual issues detected.';
  const top = issues.slice(0, 3).map((i) => i.label);
  return top.join(' · ');
}

function summariseOperationalClues(clues: OperationalClue[]): string {
  if (clues.length === 0) return 'No operational clues found in homepage copy.';
  const top = clues.slice(0, 3).map((c) => c.label);
  return top.join(' · ');
}

export interface ExtractEvidenceOptions {
  companyId: string;
  websiteUrl: string | null;
  campaign: string;
  force?: boolean;
  db?: Database;
}

export async function extractEvidenceForCompany(
  opts: ExtractEvidenceOptions,
): Promise<LeadEvidence> {
  const db = opts.db ?? getDb();
  const startedAt = new Date().toISOString();

  if (!config.evidence.enabled) {
    return emptyEvidence(opts.companyId, opts.campaign, startedAt, 'disabled');
  }
  if (!opts.websiteUrl) {
    return emptyEvidence(opts.companyId, opts.campaign, startedAt, 'no website');
  }

  // Cache check: if fresh evidence already exists, return it.
  if (!opts.force) {
    const ts = getLatestEvidenceTimestamp(opts.companyId, db);
    if (isFresh(ts)) {
      const rows = getEvidenceForCompany(opts.companyId, db);
      return rebuildFromRows(opts.companyId, opts.campaign, rows, true);
    }
  }

  // Capture
  const outputDir = path.join(config.evidence.screenshotDir, opts.companyId);
  let capture: CaptureResult;
  try {
    capture = await capturePages({
      url: opts.websiteUrl,
      outputDir,
      timeoutMs: config.evidence.timeoutMs,
    });
  } catch (err) {
    return emptyEvidence(
      opts.companyId,
      opts.campaign,
      startedAt,
      err instanceof Error ? err.message : String(err),
    );
  }

  const visualIssues = detectVisualIssues(capture);
  const operationalClues = extractOperationalEvidence(capture.desktop);
  const ctas = summariseCtas(capture.desktop);

  const evidenceConfidence = combineEvidenceConfidence(
    opts.campaign,
    visualIssues,
    operationalClues,
  );

  // Persist — wipe previous rows so the DB reflects the latest extraction.
  clearLeadEvidence(opts.companyId, db);

  const desktopRelative = relativeScreenshotPath(capture.desktopPath);
  const mobileRelative = relativeScreenshotPath(capture.mobilePath);

  // Always persist a "summary" row so the dashboard has the top-line score.
  insertLeadEvidence(
    {
      companyId: opts.companyId,
      evidenceType: 'summary',
      evidenceSummary: `${visualIssues.length} visual issue(s) · ${operationalClues.length} operational clue(s)`,
      confidence: evidenceConfidence,
      screenshotPath: desktopRelative,
      mobileScreenshotPath: mobileRelative,
      metadata: {
        campaign: opts.campaign,
        cta: ctas,
        captureError: capture.errorMessage ?? null,
        desktopOk: capture.desktop?.ok ?? false,
        mobileOk: capture.mobile?.ok ?? false,
      },
    },
    db,
  );

  for (const issue of visualIssues) {
    insertLeadEvidence(
      {
        companyId: opts.companyId,
        evidenceType: `visual.${issue.code}`,
        evidenceSummary: issue.label,
        confidence: issue.confidence,
        screenshotPath: null,
        mobileScreenshotPath: null,
        metadata: {
          campaign: issue.campaign,
          detail: issue.detail ?? null,
        },
      },
      db,
    );
  }
  for (const clue of operationalClues) {
    insertLeadEvidence(
      {
        companyId: opts.companyId,
        evidenceType: `operational.${clue.code}`,
        evidenceSummary: clue.label,
        confidence: clue.confidence,
        screenshotPath: null,
        mobileScreenshotPath: null,
        metadata: { evidence: clue.evidence },
      },
      db,
    );
  }

  return {
    companyId: opts.companyId,
    capturedAt: new Date().toISOString(),
    desktopScreenshotPath: desktopRelative,
    mobileScreenshotPath: mobileRelative,
    visualIssues,
    operationalClues,
    evidenceConfidence,
    campaign: opts.campaign,
    errorMessage: capture.errorMessage,
    fromCache: false,
  };
}

function emptyEvidence(
  companyId: string,
  campaign: string,
  capturedAt: string,
  errorMessage?: string,
): LeadEvidence {
  return {
    companyId,
    capturedAt,
    desktopScreenshotPath: null,
    mobileScreenshotPath: null,
    visualIssues: [],
    operationalClues: [],
    evidenceConfidence: 0,
    campaign,
    errorMessage,
    fromCache: false,
  };
}

function rebuildFromRows(
  companyId: string,
  campaign: string,
  rows: ReturnType<typeof getEvidenceForCompany>,
  fromCache: boolean,
): LeadEvidence {
  const summary = rows.find((r) => r.evidence_type === 'summary');
  const visualIssues: VisualIssue[] = [];
  const operationalClues: OperationalClue[] = [];
  for (const r of rows) {
    if (r.evidence_type.startsWith('visual.')) {
      const code = r.evidence_type.slice('visual.'.length) as VisualIssue['code'];
      let meta: { campaign?: VisualIssue['campaign']; detail?: string } = {};
      if (r.metadata_json) {
        try {
          meta = JSON.parse(r.metadata_json);
        } catch {
          /* ignore */
        }
      }
      visualIssues.push({
        code,
        label: r.evidence_summary ?? code,
        confidence: r.confidence,
        campaign: meta.campaign ?? 'ANY',
        detail: meta.detail,
      });
    } else if (r.evidence_type.startsWith('operational.')) {
      const code = r.evidence_type.slice('operational.'.length) as OperationalClue['code'];
      let meta: { evidence?: string[] } = {};
      if (r.metadata_json) {
        try {
          meta = JSON.parse(r.metadata_json);
        } catch {
          /* ignore */
        }
      }
      operationalClues.push({
        code,
        label: r.evidence_summary ?? code,
        confidence: r.confidence,
        evidence: meta.evidence ?? [],
      });
    }
  }
  return {
    companyId,
    capturedAt: summary?.created_at ?? new Date().toISOString(),
    desktopScreenshotPath: summary?.screenshot_path ?? null,
    mobileScreenshotPath: summary?.mobile_screenshot_path ?? null,
    visualIssues,
    operationalClues,
    evidenceConfidence: summary?.confidence ?? 0,
    campaign,
    fromCache,
  };
}
