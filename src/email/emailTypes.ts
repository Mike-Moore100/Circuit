// Phase 1 email confidence — shared shapes.
//
// The verification pipeline produces ONE EmailConfidenceResult per
// address. The dashboard reads from it; the persistence layer
// upserts a flat row of its fields onto contacts.

export const EMAIL_VERIFICATION_STATUSES = [
  'VALID_LIKELY',
  'INVALID',
  'RISKY',
  'UNKNOWN',
  'UNCHECKED',
] as const;
export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

export const EMAIL_TYPES = [
  'DIRECT_PERSON',
  'ROLE_BASED',
  'GENERAL',
  'SUPPORT',
  'SALES',
  'INFO',
  'GUESS',
  'UNKNOWN',
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

// Each pipeline step appends a short reason — the dashboard renders
// these verbatim so the operator can see *why* an email scored the
// way it did.
export interface EmailRiskReason {
  code: string;       // stable identifier — e.g. 'no_mx_records'
  label: string;      // human-readable
  delta: number;      // signed contribution to the score
}

export interface EmailConfidenceResult {
  email: string;
  domain: string | null;
  // Final operator-facing fields.
  status: EmailVerificationStatus;
  confidence: number;            // 0–100
  type: EmailType;
  isDisposable: boolean;
  isRoleBased: boolean;
  isCatchAllRisk: boolean;
  // Provenance.
  mxRecords: string[] | null;     // null when DNS lookup wasn't run / failed
  verificationMethod: 'syntax_only' | 'dns' | 'dns+smtp' | 'unchecked';
  reasons: EmailRiskReason[];
  checkedAt: string;              // ISO timestamp
}

export interface EmailConfidenceInputs {
  email: string;
  // Source field on the original contact row — drives the GUESS penalty
  // because guessed addresses must never be marked verified.
  emailStatus: 'extracted' | 'guessed' | 'verified' | null | undefined;
  // The lead's own domain (companies.domain). Used to decide whether
  // the email lives on the business domain or a free provider.
  companyDomain: string | null;
  // Optional: whether the contact has a named decision-maker role.
  // Drives the DIRECT_PERSON classification when the email isn't a
  // recognised role pattern.
  hasName: boolean;
  // Domain-level history. Set by catchAllRisk.ts when a domain has
  // multiple prior guessed emails — heuristic only, no SMTP probing.
  domainHasPriorGuessedEmails: boolean;
}
