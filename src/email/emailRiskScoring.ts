// Phase 1 email confidence — risk scoring. Pure function over a
// flat bundle of pre-computed signals. Outputs the score, status,
// and the ordered list of reasons that produced them.

import type {
  EmailConfidenceResult,
  EmailRiskReason,
  EmailType,
  EmailVerificationStatus,
} from './emailTypes';

export interface RiskScoringInputs {
  syntaxValid: boolean;
  hasMxRecords: boolean | null;       // null when DNS lookup wasn't run
  mxLookupReason: string | null;
  isDisposable: boolean;
  isFreeProvider: boolean;
  emailType: EmailType;
  isOnCompanyDomain: boolean;
  isCatchAllRisk: boolean;
  catchAllReason: string | null;
  // Provenance from the contacts table.
  isGuessed: boolean;
  fromWebsiteScrape: boolean;
}

export interface RiskScoringResult {
  status: EmailVerificationStatus;
  confidence: number;
  reasons: EmailRiskReason[];
}

// ---------------------------------------------------------------------------
// Score weights — all centralised so future calibration is one diff.
// ---------------------------------------------------------------------------
const W = {
  syntaxValid: +25,
  syntaxInvalid: -100,           // hard zero out

  mxPresent: +30,
  mxMissing: -100,               // no MX → INVALID

  disposable: -80,
  freeProvider: -15,
  catchAllRisk: -20,

  // Email-type contributions on the BUSINESS domain.
  directPersonOnDomain: +30,
  roleBasedOnDomain: +8,
  generalOnDomain: +5,

  // Penalties for off-domain emails.
  notOnCompanyDomain: -10,

  // Provenance.
  fromWebsiteScrape: +10,
  guessedPenalty: -40,
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreEmailRisk(inputs: RiskScoringInputs): RiskScoringResult {
  const reasons: EmailRiskReason[] = [];
  let score = 0;

  // ---- Syntax --------------------------------------------------------
  if (!inputs.syntaxValid) {
    reasons.push({
      code: 'invalid_syntax',
      label: 'Email is not syntactically valid',
      delta: W.syntaxInvalid,
    });
    return {
      status: 'INVALID',
      confidence: 0,
      reasons,
    };
  }
  reasons.push({
    code: 'valid_syntax',
    label: 'Syntactically valid email',
    delta: W.syntaxValid,
  });
  score += W.syntaxValid;

  // ---- Disposable ----------------------------------------------------
  if (inputs.isDisposable) {
    reasons.push({
      code: 'disposable_domain',
      label: 'Disposable / throwaway email provider',
      delta: W.disposable,
    });
    score += W.disposable;
  }

  // ---- DNS / MX -----------------------------------------------------
  if (inputs.hasMxRecords === false) {
    reasons.push({
      code: 'no_mx',
      label: inputs.mxLookupReason ?? 'No MX records found for domain',
      delta: W.mxMissing,
    });
    return {
      status: 'INVALID',
      confidence: 0,
      reasons,
    };
  }
  if (inputs.hasMxRecords === true) {
    reasons.push({
      code: 'mx_present',
      label: 'Domain has MX records',
      delta: W.mxPresent,
    });
    score += W.mxPresent;
  }
  // hasMxRecords === null → DNS not run yet, leave it ambiguous

  // ---- Free provider -------------------------------------------------
  if (inputs.isFreeProvider) {
    reasons.push({
      code: 'free_provider',
      label: 'Free consumer mailbox provider (lower confidence for business outreach)',
      delta: W.freeProvider,
    });
    score += W.freeProvider;
  }

  // ---- Email type ----------------------------------------------------
  // We score the *combination* of type + on-domain because the same
  // type means different things on the company domain vs a free
  // provider.
  if (inputs.isOnCompanyDomain) {
    if (inputs.emailType === 'DIRECT_PERSON') {
      reasons.push({
        code: 'direct_person_business_domain',
        label: 'Named decision-maker on the business domain',
        delta: W.directPersonOnDomain,
      });
      score += W.directPersonOnDomain;
    } else if (inputs.emailType === 'ROLE_BASED' || inputs.emailType === 'INFO' || inputs.emailType === 'SALES' || inputs.emailType === 'SUPPORT') {
      reasons.push({
        code: 'role_based_business_domain',
        label: 'Role-based mailbox on the business domain',
        delta: W.roleBasedOnDomain,
      });
      score += W.roleBasedOnDomain;
    } else if (inputs.emailType === 'GENERAL') {
      reasons.push({
        code: 'general_business_domain',
        label: 'General mailbox on the business domain',
        delta: W.generalOnDomain,
      });
      score += W.generalOnDomain;
    }
  } else if (!inputs.isFreeProvider) {
    reasons.push({
      code: 'not_on_company_domain',
      label: 'Email is not on the company domain',
      delta: W.notOnCompanyDomain,
    });
    score += W.notOnCompanyDomain;
  }

  // ---- Catch-all risk -----------------------------------------------
  if (inputs.isCatchAllRisk) {
    reasons.push({
      code: 'catch_all_risk',
      label: inputs.catchAllReason ?? 'Domain may accept catch-all mail',
      delta: W.catchAllRisk,
    });
    score += W.catchAllRisk;
  }

  // ---- Provenance ----------------------------------------------------
  if (inputs.isGuessed) {
    reasons.push({
      code: 'guessed_email',
      label: 'Email was pattern-guessed, not extracted',
      delta: W.guessedPenalty,
    });
    score += W.guessedPenalty;
  }
  if (inputs.fromWebsiteScrape) {
    reasons.push({
      code: 'website_extracted',
      label: 'Email was extracted directly from the website',
      delta: W.fromWebsiteScrape,
    });
    score += W.fromWebsiteScrape;
  }

  const confidence = clamp(score);
  const status = pickStatus(confidence, inputs);

  return { status, confidence, reasons };
}

function pickStatus(
  confidence: number,
  inputs: RiskScoringInputs,
): EmailVerificationStatus {
  // Catch-all + guessed: never "VALID_LIKELY". Even if syntax + MX
  // pass, the operator cannot trust deliverability.
  if (inputs.isGuessed && inputs.isCatchAllRisk) return 'RISKY';
  if (inputs.isGuessed) return 'RISKY';
  if (inputs.isDisposable) return 'INVALID';
  if (inputs.hasMxRecords === false) return 'INVALID';

  // Catch-all alone is RISKY rather than UNKNOWN — we know the
  // domain is suspicious.
  if (inputs.isCatchAllRisk) return 'RISKY';

  if (inputs.hasMxRecords === null) {
    // DNS wasn't run — surface as UNKNOWN regardless of score.
    return 'UNKNOWN';
  }

  if (confidence >= 60) return 'VALID_LIKELY';
  if (confidence >= 35) return 'UNKNOWN';
  return 'RISKY';
}

// Helper used by the orchestrator: build the EmailConfidenceResult
// shape from the scoring output + the rest of the pipeline inputs.
export function buildResult(
  email: string,
  domain: string | null,
  scoring: RiskScoringResult,
  meta: {
    emailType: EmailType;
    isDisposable: boolean;
    isRoleBased: boolean;
    isCatchAllRisk: boolean;
    mxRecords: string[] | null;
    verificationMethod: 'syntax_only' | 'dns' | 'dns+smtp' | 'unchecked';
  },
): EmailConfidenceResult {
  return {
    email,
    domain,
    status: scoring.status,
    confidence: scoring.confidence,
    type: meta.emailType,
    isDisposable: meta.isDisposable,
    isRoleBased: meta.isRoleBased,
    isCatchAllRisk: meta.isCatchAllRisk,
    mxRecords: meta.mxRecords,
    verificationMethod: meta.verificationMethod,
    reasons: scoring.reasons,
    checkedAt: new Date().toISOString(),
  };
}
