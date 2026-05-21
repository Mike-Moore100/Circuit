// Canonical visual-issue codes — keep this list small and explicit so the
// dashboard can render badges and the operator can scan at a glance.
export const VISUAL_ISSUE_CODES = [
  'page_failed_to_load',
  'no_h1',
  'no_visible_cta',
  'no_contact_path',
  'no_meta_viewport',
  'mobile_horizontal_overflow',
  'no_trust_signals',
  'no_visible_form',
  'sparse_homepage', // very little text — placeholder / WIP site
  'outdated_visual_quality', // heuristic: no responsive meta + ancient copyright + no css framework hints
  'broken_rendering', // JS or page errors during render
] as const;

export type VisualIssueCode = (typeof VISUAL_ISSUE_CODES)[number];

export interface VisualIssue {
  code: VisualIssueCode;
  label: string;
  confidence: number;
  campaign: 'WEB_REBUILD' | 'FUNNEL_OPTIMIZATION' | 'AI_AUTOMATION' | 'ANY';
  detail?: string;
}

export const OPERATIONAL_CLUE_CODES = [
  'manual_intake_language',
  'admin_overhead_language',
  'recurring_reporting_cadence',
  'service_complexity',
  'no_automation_indicators',
  'repetitive_inquiry_flow',
] as const;

export type OperationalClueCode = (typeof OPERATIONAL_CLUE_CODES)[number];

export interface OperationalClue {
  code: OperationalClueCode;
  label: string;
  confidence: number;
  evidence: string[]; // short matched phrases
}

// What the screenshot pass collected via page.evaluate() on the live page.
export interface DomSnapshot {
  url: string;
  finalUrl: string;
  ok: boolean;
  title: string | null;
  htmlLength: number;
  hasMetaViewport: boolean;
  scrollWidth: number;
  viewportWidth: number;
  h1Count: number;
  buttonCount: number;
  ctaTexts: string[];
  formCount: number;
  hasEmailInput: boolean;
  hasMailto: boolean;
  hasTel: boolean;
  hasPhysicalAddressHint: boolean;
  hasCopyrightYear: number | null;
  visibleBodyText: string;
  consoleErrorCount: number;
}

export interface CaptureResult {
  url: string;
  desktopPath: string | null;
  mobilePath: string | null;
  desktop: DomSnapshot | null;
  mobile: DomSnapshot | null;
  errorMessage?: string;
  durationMs: number;
}

export interface LeadEvidence {
  companyId: string;
  capturedAt: string;
  desktopScreenshotPath: string | null;
  mobileScreenshotPath: string | null;
  visualIssues: VisualIssue[];
  operationalClues: OperationalClue[];
  evidenceConfidence: number; // 0-100
  campaign: string;
  errorMessage?: string;
  fromCache: boolean;
}

export interface PersistedEvidenceRow {
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
