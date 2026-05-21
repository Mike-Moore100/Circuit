import { z } from 'zod';

// Canonical signal type identifiers. Anything written into the `signals`
// table from website inspection uses one of these strings as `type`, so the
// scorer can credit them without depending on free-text matching.
export const WEBSITE_SIGNAL = {
  WEBSITE_LOADS: 'verified.website_loads',
  WEBSITE_FAILED_TO_LOAD: 'verified.website_failed',
  HAS_CONTACT_PAGE: 'verified.has_contact_page',
  HAS_CONTACT_FORM: 'verified.has_contact_form',
  HAS_BOOKING_LINK: 'verified.has_booking_link',
  HAS_SERVICES_PAGE: 'verified.has_services_page',
  HAS_MULTIPLE_SERVICE_PAGES: 'verified.has_multiple_service_pages',
  HAS_CAREERS_PAGE: 'verified.has_careers_page',
  HAS_SUPPORT_OR_HELP: 'verified.has_support_or_help',
  HAS_ECOMMERCE_SIGNALS: 'verified.has_ecommerce_signals',
  HAS_MANUAL_WORKFLOW_LANGUAGE: 'verified.has_manual_workflow_language',
  HAS_AI_AUTOMATION_LANGUAGE: 'verified.has_ai_automation_language',
  LIKELY_SERVICE_BUSINESS: 'verified.likely_service_business',
  LIKELY_SAAS: 'verified.likely_saas',
  LIKELY_LOCAL_SMB: 'verified.likely_local_smb',
  LOW_DIGITAL_MATURITY: 'verified.low_digital_maturity',
  HIGH_AUTOMATION_FIT: 'verified.high_automation_fit',
} as const;

export type WebsiteSignalKey = keyof typeof WEBSITE_SIGNAL;
export type WebsiteSignalType = (typeof WEBSITE_SIGNAL)[WebsiteSignalKey];

// Per-page fingerprint produced by the inspector. The extractor consumes
// one or more of these to produce the final signal list.
export interface PageFingerprint {
  url: string;
  finalUrl: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  // Visible-ish text content, lowercased + whitespace-normalised.
  visibleText: string;
  // Discovered internal links: { href (absolute), text }.
  links: Array<{ href: string; text: string; rel: 'internal' | 'external' }>;
  // Crude form summary; we only need to know whether a form looks like a
  // contact form (has an email-like input).
  forms: Array<{ action: string | null; hasEmailInput: boolean; inputCount: number }>;
  // First N bytes of the raw HTML — useful when debugging extraction.
  rawHtmlPreview: string;
}

export type InspectionStatus = 'ok' | 'failed' | 'timeout' | 'skipped' | 'disabled' | 'cached';

export interface InspectionResult {
  url: string;
  domain: string | null;
  status: InspectionStatus;
  pages: PageFingerprint[];
  signals: VerifiedSignal[];
  fetchedAt: string;
  fromCache: boolean;
  errorMessage?: string;
  durationMs: number;
}

// Output signal — same triple as the existing Signal type but the schema
// matches against a known WEBSITE_SIGNAL key for downstream scoring.
export const VerifiedSignalSchema = z.object({
  type: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(100),
});
export type VerifiedSignal = z.infer<typeof VerifiedSignalSchema>;

// Persisted cache record.
export interface CachedInspection {
  id: string;
  company_id: string | null;
  url: string;
  domain: string | null;
  status: InspectionStatus;
  status_code: number | null;
  title: string | null;
  meta_description: string | null;
  content_length: number | null;
  signals_json: string;
  fingerprint_json: string | null;
  error_message: string | null;
  fetched_at: string;
}
