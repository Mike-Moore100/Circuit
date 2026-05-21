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

  const finalScore = clamp(Math.round(score));
  return {
    ruleScore: finalScore,
    pass: finalScore >= RULE_PASS_THRESHOLD,
    reasons,
    rejectionReasons,
  };
}
