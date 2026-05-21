import type { RawLead, RuleScoreBreakdown, ScoreReason } from '../types/index';
import {
  BAD_FIT_INDUSTRIES,
  COMMERCIAL_INTENT_SIGNALS,
  FOUNDER_ROLE_KEYWORDS,
  OPERATIONAL_COMPLEXITY_SIGNALS,
  RULE_BASE_SCORE,
  RULE_PASS_THRESHOLD,
  RULE_WEIGHTS,
  TARGET_INDUSTRIES,
} from '../scoring/scoringConfig';

function includesAny(haystack: string | null | undefined, needles: readonly string[]): string | null {
  if (!haystack) return null;
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n;
  }
  return null;
}

function leadHaystack(lead: RawLead): string {
  return [
    lead.industry,
    lead.notes,
    lead.contactRole,
    ...lead.signals.map((s) => `${s.type}:${s.value}`),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function clamp(score: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, score));
}

export function evaluateRules(lead: RawLead): RuleScoreBreakdown {
  const reasons: ScoreReason[] = [];
  const rejectionReasons: ScoreReason[] = [];
  let score = RULE_BASE_SCORE;

  const hay = leadHaystack(lead);

  // ---- Size / headcount -------------------------------------------------
  const size = lead.sizeEstimate;
  if (size !== null && size !== undefined) {
    if (size >= 5 && size <= 25) {
      score += RULE_WEIGHTS.IDEAL_HEADCOUNT;
      reasons.push({
        code: 'size_ideal',
        label: `Ideal headcount (${size})`,
        delta: RULE_WEIGHTS.IDEAL_HEADCOUNT,
      });
    } else if (size >= 2 && size <= 50) {
      score += RULE_WEIGHTS.GOOD_HEADCOUNT;
      reasons.push({
        code: 'size_good',
        label: `Good SMB headcount (${size})`,
        delta: RULE_WEIGHTS.GOOD_HEADCOUNT,
      });
    } else if (size > 250) {
      score += RULE_WEIGHTS.ENTERPRISE_PENALTY;
      rejectionReasons.push({
        code: 'enterprise',
        label: `Enterprise size (~${size} employees)`,
        delta: RULE_WEIGHTS.ENTERPRISE_PENALTY,
      });
    } else if (size < 2) {
      score += RULE_WEIGHTS.HOBBY_PROJECT_PENALTY;
      rejectionReasons.push({
        code: 'hobby_project',
        label: 'Solo / hobby-scale operator',
        delta: RULE_WEIGHTS.HOBBY_PROJECT_PENALTY,
      });
    }
  }

  // ---- Industry ---------------------------------------------------------
  const matchedTarget = includesAny(lead.industry, TARGET_INDUSTRIES);
  const matchedBadFit = includesAny(lead.industry, BAD_FIT_INDUSTRIES);
  if (matchedTarget && !matchedBadFit) {
    score += RULE_WEIGHTS.TARGET_INDUSTRY;
    reasons.push({
      code: 'industry_target',
      label: `Target industry match: ${matchedTarget}`,
      delta: RULE_WEIGHTS.TARGET_INDUSTRY,
    });
  }
  if (matchedBadFit) {
    score += RULE_WEIGHTS.BAD_FIT_INDUSTRY_PENALTY;
    rejectionReasons.push({
      code: 'industry_bad_fit',
      label: `Bad-fit industry: ${matchedBadFit}`,
      delta: RULE_WEIGHTS.BAD_FIT_INDUSTRY_PENALTY,
    });
  }
  if (!matchedTarget && !matchedBadFit && lead.industry) {
    score += RULE_WEIGHTS.IRRELEVANT_INDUSTRY_PENALTY;
    rejectionReasons.push({
      code: 'industry_irrelevant',
      label: `Industry not in target list: ${lead.industry}`,
      delta: RULE_WEIGHTS.IRRELEVANT_INDUSTRY_PENALTY,
    });
  }

  // ---- Website ----------------------------------------------------------
  if (lead.websiteUrl) {
    score += RULE_WEIGHTS.HAS_WEBSITE;
    reasons.push({
      code: 'has_website',
      label: 'Has a public website',
      delta: RULE_WEIGHTS.HAS_WEBSITE,
    });
  } else {
    score += RULE_WEIGHTS.NO_WEBSITE_PENALTY;
    rejectionReasons.push({
      code: 'no_website',
      label: 'No public website / digital footprint',
      delta: RULE_WEIGHTS.NO_WEBSITE_PENALTY,
    });
  }

  // ---- Decision-maker access -------------------------------------------
  const role = lead.contactRole?.toLowerCase() ?? '';
  if (FOUNDER_ROLE_KEYWORDS.some((kw) => role.includes(kw))) {
    score += RULE_WEIGHTS.FOUNDER_REACHABLE;
    reasons.push({
      code: 'founder_reachable',
      label: `Founder/owner-level contact (${lead.contactRole})`,
      delta: RULE_WEIGHTS.FOUNDER_REACHABLE,
    });
  }

  // ---- Operational complexity ------------------------------------------
  if (includesAny(hay, OPERATIONAL_COMPLEXITY_SIGNALS)) {
    score += RULE_WEIGHTS.OPERATIONAL_COMPLEXITY;
    reasons.push({
      code: 'ops_complexity',
      label: 'Visible operational complexity / manual workflows',
      delta: RULE_WEIGHTS.OPERATIONAL_COMPLEXITY,
    });
  }

  // ---- Commercial intent -----------------------------------------------
  if (includesAny(hay, COMMERCIAL_INTENT_SIGNALS)) {
    score += RULE_WEIGHTS.COMMERCIAL_INTENT;
    reasons.push({
      code: 'commercial_intent',
      label: 'Has commercial intent surface (lead capture, pricing, demos)',
      delta: RULE_WEIGHTS.COMMERCIAL_INTENT,
    });
  }

  // ---- Automatable workload --------------------------------------------
  if (/support|admin|invoicing|scheduling|onboarding|data entry|reporting/.test(hay)) {
    score += RULE_WEIGHTS.AUTOMATABLE_WORKLOAD;
    reasons.push({
      code: 'automatable_workload',
      label: 'Repetitive workload that would benefit from automation',
      delta: RULE_WEIGHTS.AUTOMATABLE_WORKLOAD,
    });
  }

  // ---- Risks -----------------------------------------------------------
  if (/internal automation team|platform team|in-house ml/.test(hay)) {
    score += RULE_WEIGHTS.INTERNAL_AUTOMATION_TEAM_PENALTY;
    rejectionReasons.push({
      code: 'internal_automation_team',
      label: 'Has its own internal automation/platform team',
      delta: RULE_WEIGHTS.INTERNAL_AUTOMATION_TEAM_PENALTY,
    });
  }
  if (/heavy compliance|regulated|hipaa|pci|fda/.test(hay)) {
    score += RULE_WEIGHTS.HEAVY_COMPLIANCE_PENALTY;
    rejectionReasons.push({
      code: 'heavy_compliance',
      label: 'Heavy compliance burden — not an MVP-stage fit',
      delta: RULE_WEIGHTS.HEAVY_COMPLIANCE_PENALTY,
    });
  }
  if (/hobby|side project|no commercial intent/.test(hay)) {
    if (!rejectionReasons.some((r) => r.code === 'hobby_project')) {
      score += RULE_WEIGHTS.HOBBY_PROJECT_PENALTY;
      rejectionReasons.push({
        code: 'hobby_project',
        label: 'Hobby project / no commercial intent',
        delta: RULE_WEIGHTS.HOBBY_PROJECT_PENALTY,
      });
    }
  }

  // ---- Verified website signals ---------------------------------------
  // These are typed signals produced by the inspection module, so we credit
  // them by exact type rather than text matching to avoid double-counting
  // with the haystack heuristics above.
  const verifiedTypes = new Set(
    lead.signals.filter((s) => s.type.startsWith('verified.')).map((s) => s.type),
  );

  const verifiedRule = (
    type: string,
    weight: number,
    code: string,
    label: string,
    isRejection = false,
  ) => {
    if (!verifiedTypes.has(type)) return;
    score += weight;
    (isRejection ? rejectionReasons : reasons).push({ code, label, delta: weight });
  };

  verifiedRule(
    'verified.website_loads',
    RULE_WEIGHTS.VERIFIED_WEBSITE_LOADS,
    'verified_website_loads',
    'Verified: website loaded successfully',
  );
  verifiedRule(
    'verified.has_contact_page',
    RULE_WEIGHTS.VERIFIED_HAS_CONTACT_PAGE,
    'verified_contact_page',
    'Verified: dedicated contact page',
  );
  verifiedRule(
    'verified.has_contact_form',
    RULE_WEIGHTS.VERIFIED_HAS_CONTACT_FORM,
    'verified_contact_form',
    'Verified: contact form with email input',
  );
  verifiedRule(
    'verified.has_booking_link',
    RULE_WEIGHTS.VERIFIED_HAS_BOOKING_LINK,
    'verified_booking',
    'Verified: booking / scheduling surface',
  );
  verifiedRule(
    'verified.has_services_page',
    RULE_WEIGHTS.VERIFIED_HAS_SERVICES_PAGE,
    'verified_services_page',
    'Verified: services page',
  );
  verifiedRule(
    'verified.has_multiple_service_pages',
    RULE_WEIGHTS.VERIFIED_HAS_MULTIPLE_SERVICE_PAGES,
    'verified_multiple_services',
    'Verified: depth — multiple service pages',
  );
  verifiedRule(
    'verified.has_careers_page',
    RULE_WEIGHTS.VERIFIED_HAS_CAREERS_PAGE,
    'verified_careers',
    'Verified: careers / hiring page (growth signal)',
  );
  verifiedRule(
    'verified.has_support_or_help',
    RULE_WEIGHTS.VERIFIED_HAS_SUPPORT_OR_HELP,
    'verified_support',
    'Verified: support / help section (likely volume)',
  );
  verifiedRule(
    'verified.has_ecommerce_signals',
    RULE_WEIGHTS.VERIFIED_HAS_ECOMMERCE_SIGNALS,
    'verified_ecommerce',
    'Verified: ecommerce indicators',
  );
  verifiedRule(
    'verified.has_manual_workflow_language',
    RULE_WEIGHTS.VERIFIED_HAS_MANUAL_WORKFLOW_LANGUAGE,
    'verified_manual_workflow',
    'Verified: manual-workflow phrasing in copy',
  );
  verifiedRule(
    'verified.high_automation_fit',
    RULE_WEIGHTS.VERIFIED_HIGH_AUTOMATION_FIT,
    'verified_automation_fit',
    'Verified: high automation-fit phrasing',
  );
  verifiedRule(
    'verified.likely_service_business',
    RULE_WEIGHTS.VERIFIED_LIKELY_SERVICE_BUSINESS,
    'verified_service_business',
    'Verified: looks like a service business',
  );
  verifiedRule(
    'verified.likely_saas',
    RULE_WEIGHTS.VERIFIED_LIKELY_SAAS,
    'verified_saas',
    'Verified: looks like a SaaS',
  );
  verifiedRule(
    'verified.likely_local_smb',
    RULE_WEIGHTS.VERIFIED_LIKELY_LOCAL_SMB,
    'verified_local_smb',
    'Verified: looks like a local SMB',
  );

  // Penalties
  verifiedRule(
    'verified.website_failed',
    RULE_WEIGHTS.VERIFIED_WEBSITE_FAILED,
    'verified_website_failed',
    'Verified: website failed to load',
    true,
  );
  verifiedRule(
    'verified.has_ai_automation_language',
    RULE_WEIGHTS.VERIFIED_AI_AUTOMATION_PROVIDER_PENALTY,
    'verified_ai_provider',
    'Verified: IS an AI / automation provider (competitor, not buyer)',
    true,
  );
  verifiedRule(
    'verified.low_digital_maturity',
    RULE_WEIGHTS.VERIFIED_LOW_DIGITAL_MATURITY,
    'verified_low_digital_maturity',
    'Verified: low digital maturity (thin website)',
    true,
  );

  const finalScore = clamp(Math.round(score));
  return {
    ruleScore: finalScore,
    pass: finalScore >= RULE_PASS_THRESHOLD,
    reasons,
    rejectionReasons,
  };
}
