import type {
  IntentScoreBreakdown,
  RawLead,
  RuleScoreBreakdown,
  ScoreReason,
} from '../types/index';
import type { Campaign, CampaignClassification } from './campaignTypes';

// Industries that are genuine non-fits — large-org targets that won't work
// for a small AI/dev agency regardless of digital state.
const HARD_REJECT_INDUSTRY_KEYWORDS = [
  'enterprise software',
  'big tech',
  'fortune 500',
  'pharmaceutical',
  'banking',
  'aerospace',
  'defense',
];

// Industries that are *low priority* but should not auto-reject. Restaurants,
// hospitality, etc. — the agency might still take a small web rebuild here.
const LOW_PRIORITY_INDUSTRY_KEYWORDS = [
  'restaurant',
  'cafe',
  'food service',
  'hospitality',
];

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function codes(reasons: ScoreReason[]): Set<string> {
  return new Set(reasons.map((r) => r.code));
}

function addReason(
  arr: ScoreReason[],
  code: string,
  label: string,
  delta: number,
): void {
  arr.push({ code, label, delta });
}

interface CampaignScore {
  score: number;
  reasons: ScoreReason[];
}

// ---------------------------------------------------------------------------
// Per-campaign scoring functions. Each reads from the rule + intent
// breakdowns (already computed) plus the raw lead, and returns a score
// 0–100 + the reasons that contributed to it.
// ---------------------------------------------------------------------------

function scoreAiAutomation(
  lead: RawLead,
  ruleCodes: Set<string>,
  rejCodes: Set<string>,
  intent: IntentScoreBreakdown,
): CampaignScore {
  const reasons: ScoreReason[] = [];
  let score = 0;

  if (ruleCodes.has('industry_target')) {
    score += 22;
    addReason(reasons, 'ai_target_industry', 'Target industry for automation', 22);
  }
  if (ruleCodes.has('verified_website_loads')) {
    score += 15;
    addReason(
      reasons,
      'ai_working_site',
      'Working website — automation has somewhere to plug in',
      15,
    );
  }
  if (
    ruleCodes.has('verified_manual_workflow') ||
    ruleCodes.has('verified_automation_fit')
  ) {
    score += 22;
    addReason(reasons, 'ai_manual_workflow_verified', 'Verified manual-workflow language', 22);
  }
  if (ruleCodes.has('ops_complexity') || ruleCodes.has('automatable_workload')) {
    score += 14;
    addReason(reasons, 'ai_ops_complexity', 'Operational complexity visible in source signals', 14);
  }
  if (ruleCodes.has('size_ideal') || ruleCodes.has('size_good')) {
    score += 10;
    addReason(reasons, 'ai_smb_size', 'SMB size — agency-fit headcount', 10);
  }
  if (ruleCodes.has('founder_reachable')) {
    score += 8;
    addReason(reasons, 'ai_founder_reachable', 'Founder / owner reachable', 8);
  }
  if (intent.components.automationFit >= 60) {
    score += 6;
    addReason(reasons, 'ai_high_fit_component', 'Intent: high automation-fit component', 6);
  }

  // Penalties — automation only lands on a working foundation.
  if (rejCodes.has('verified_website_failed')) {
    score -= 28;
    addReason(
      reasons,
      'ai_blocked_by_failed_site',
      'Website failed to load — needs rebuild before automation',
      -28,
    );
  }
  if (rejCodes.has('no_website') || !lead.websiteUrl) {
    score -= 35;
    addReason(reasons, 'ai_blocked_no_site', 'No website — route to Local Digital Upgrade first', -35);
  }
  if (rejCodes.has('verified_ai_provider')) {
    score -= 60;
    addReason(reasons, 'ai_competitor', 'Lead is itself an AI/automation provider', -60);
  }

  return { score: clamp(score), reasons };
}

function scoreWebRebuild(
  lead: RawLead,
  ruleCodes: Set<string>,
  rejCodes: Set<string>,
): CampaignScore {
  const reasons: ScoreReason[] = [];
  let score = 0;

  // Strongest signal: a real business with a broken website.
  if (rejCodes.has('verified_website_failed')) {
    score += 60;
    addReason(reasons, 'web_failed', 'Website failed to load — rebuild opportunity', 60);
  }
  if (rejCodes.has('verified_low_digital_maturity')) {
    score += 28;
    addReason(reasons, 'web_low_maturity', 'Verified low digital maturity', 28);
  }
  // Has site but it's thin (loads, but no contact / services / forms)
  if (
    ruleCodes.has('verified_website_loads') &&
    !ruleCodes.has('verified_services_page') &&
    !ruleCodes.has('verified_contact_form')
  ) {
    score += 18;
    addReason(reasons, 'web_thin_site', 'Site loads but lacks contact / services depth', 18);
  }
  if (ruleCodes.has('size_ideal') || ruleCodes.has('size_good')) {
    score += 10;
    addReason(reasons, 'web_smb_size', 'SMB size', 10);
  }
  if (ruleCodes.has('founder_reachable')) {
    score += 8;
    addReason(reasons, 'web_founder_reachable', 'Founder reachable to scope rebuild', 8);
  }
  if (lead.websiteUrl) {
    score += 4;
    addReason(reasons, 'web_has_url', 'Has a website URL (something to rebuild)', 4);
  } else {
    // No website at all — that's Local Digital Upgrade, not rebuild.
    score -= 35;
    addReason(reasons, 'web_no_url', 'No website URL — route to Local Digital Upgrade', -35);
  }

  return { score: clamp(score), reasons };
}

function scoreFunnelOptimization(
  lead: RawLead,
  ruleCodes: Set<string>,
  rejCodes: Set<string>,
): CampaignScore {
  const reasons: ScoreReason[] = [];
  let score = 0;

  if (!ruleCodes.has('verified_website_loads')) {
    // Can't optimize a funnel that doesn't exist / load.
    score -= 25;
    addReason(reasons, 'funnel_no_working_site', 'No working website to optimize', -25);
  } else {
    score += 18;
    addReason(reasons, 'funnel_working_site', 'Working website to optimize', 18);
  }
  if (ruleCodes.has('verified_website_loads') && !ruleCodes.has('verified_contact_form')) {
    score += 25;
    addReason(reasons, 'funnel_no_contact_form', 'No verified contact form on the site', 25);
  }
  if (ruleCodes.has('verified_website_loads') && !ruleCodes.has('verified_booking')) {
    score += 15;
    addReason(reasons, 'funnel_no_booking', 'No verified booking / scheduling link', 15);
  }
  if (ruleCodes.has('industry_target')) {
    score += 12;
    addReason(reasons, 'funnel_target_industry', 'Target industry', 12);
  }
  if (ruleCodes.has('verified_services_page')) {
    score += 8;
    addReason(reasons, 'funnel_has_services', 'Has services page (real offer exists)', 8);
  }
  if (rejCodes.has('verified_low_digital_maturity')) {
    score -= 10;
    addReason(reasons, 'funnel_low_maturity', 'Site is too thin to optimize — rebuild first', -10);
  }

  return { score: clamp(score), reasons };
}

function scoreLocalDigitalUpgrade(
  lead: RawLead,
  ruleCodes: Set<string>,
  rejCodes: Set<string>,
): CampaignScore {
  const reasons: ScoreReason[] = [];
  let score = 0;

  // Strong: real SMB with no website yet.
  if (!lead.websiteUrl) {
    score += 48;
    addReason(reasons, 'local_no_website', 'No website yet — starter site opportunity', 48);
  } else {
    // If there's already a working site, this campaign doesn't apply.
    score -= 25;
    addReason(reasons, 'local_already_online', 'Already has a website — not a starter case', -25);
  }
  if (ruleCodes.has('size_ideal') || ruleCodes.has('size_good')) {
    score += 18;
    addReason(reasons, 'local_smb_size', 'SMB size', 18);
  }
  if (ruleCodes.has('founder_reachable')) {
    score += 14;
    addReason(reasons, 'local_founder_reachable', 'Founder reachable', 14);
  }
  // Bonus for local-service-shaped business.
  const industry = (lead.industry ?? '').toLowerCase();
  if (
    industry.includes('local') ||
    industry.includes('services') ||
    industry.includes('salon') ||
    industry.includes('plumbing') ||
    industry.includes('cleaning')
  ) {
    score += 12;
    addReason(reasons, 'local_service_industry', 'Local service business industry', 12);
  }
  // Bonus for restaurant / cafe — they still need a starter web presence even
  // though they're lower-priority overall.
  if (LOW_PRIORITY_INDUSTRY_KEYWORDS.some((kw) => industry.includes(kw))) {
    score += 6;
    addReason(reasons, 'local_hospitality', 'Hospitality / food service local business', 6);
  }

  return { score: clamp(score), reasons };
}

function scoreLowPriorityNurture(
  lead: RawLead,
  ruleCodes: Set<string>,
  rejCodes: Set<string>,
): CampaignScore {
  const reasons: ScoreReason[] = [];
  let score = 28; // baseline so something is always selectable
  addReason(reasons, 'nurture_baseline', 'Default nurture pool', 28);

  const industry = (lead.industry ?? '').toLowerCase();
  if (LOW_PRIORITY_INDUSTRY_KEYWORDS.some((kw) => industry.includes(kw))) {
    score += 26;
    addReason(reasons, 'nurture_low_priority_industry', `Low-priority industry: ${industry}`, 26);
  }
  if (rejCodes.has('industry_irrelevant')) {
    score += 10;
    addReason(reasons, 'nurture_irrelevant_industry', 'Industry not in target list', 10);
  }
  if (rejCodes.has('heavy_compliance')) {
    score += 8;
    addReason(reasons, 'nurture_compliance', 'Heavy compliance — park for now', 8);
  }

  return { score: clamp(score), reasons };
}

// ---------------------------------------------------------------------------
// Hard disqualifier check — the only path to REJECT.
// ---------------------------------------------------------------------------
function hardRejectReasons(
  lead: RawLead,
  rejCodes: Set<string>,
): ScoreReason[] {
  const out: ScoreReason[] = [];

  if (rejCodes.has('enterprise')) {
    out.push({ code: 'enterprise', label: 'Enterprise scale — out of ICP', delta: 0 });
  }
  if (rejCodes.has('hobby_project')) {
    out.push({ code: 'hobby_project', label: 'Solo / hobby-scale operator', delta: 0 });
  }
  if (rejCodes.has('internal_automation_team')) {
    out.push({
      code: 'internal_automation_team',
      label: 'Lead has its own internal automation / platform team',
      delta: 0,
    });
  }
  // Hard-reject industries (big-corp signals only — NOT restaurants etc.)
  const industry = (lead.industry ?? '').toLowerCase();
  for (const kw of HARD_REJECT_INDUSTRY_KEYWORDS) {
    if (industry.includes(kw)) {
      out.push({
        code: 'industry_hard_reject',
        label: `Hard-reject industry match: ${kw}`,
        delta: 0,
      });
      break;
    }
  }
  return out;
}

function pickPrimary(scores: Record<Campaign, number>): Campaign {
  let best: Campaign = 'LOW_PRIORITY_NURTURE';
  let bestScore = scores.LOW_PRIORITY_NURTURE;
  for (const c of Object.keys(scores) as Campaign[]) {
    if (c === 'REJECT') continue;
    if (scores[c] > bestScore) {
      bestScore = scores[c];
      best = c;
    }
  }
  return best;
}

function summaryReasonFor(
  primary: Campaign,
  reasons: ScoreReason[],
): string {
  const top = [...reasons]
    .sort((a, b) => b.delta - a.delta)
    .find((r) => r.delta > 0);
  if (top) return top.label;
  return `Default ${primary.toLowerCase().replace(/_/g, ' ')} placement.`;
}

function nextStepFor(primary: Campaign, lead: RawLead): string {
  switch (primary) {
    case 'AI_AUTOMATION':
      return 'Manually inspect homepage + LinkedIn, draft a tailored automation pitch grounded in their workflow signals.';
    case 'WEB_REBUILD':
      return lead.websiteUrl
        ? `Pull up ${lead.websiteUrl}, document what is broken / outdated, draft a rebuild scope before contact.`
        : 'Investigate web presence further before pitching a rebuild.';
    case 'FUNNEL_OPTIMIZATION':
      return 'Audit the homepage flow: contact form, booking, CTAs. Identify the missing conversion surface, then frame outreach as a funnel fix.';
    case 'LOCAL_DIGITAL_UPGRADE':
      return 'Confirm the business is operating (Google Maps / phone), then approach with a starter-site + intake proposal.';
    case 'LOW_PRIORITY_NURTURE':
      return 'Park in the nurture list; revisit only if stronger signals appear.';
    case 'REJECT':
      return 'Skip — true disqualifier triggered.';
  }
}

export function classifyCampaign(
  lead: RawLead,
  rule: RuleScoreBreakdown,
  intent: IntentScoreBreakdown,
): CampaignClassification {
  const ruleCodes = codes(rule.reasons);
  const rejCodes = codes(rule.rejectionReasons);

  const trueRejectionReasons = hardRejectReasons(lead, rejCodes);

  if (trueRejectionReasons.length > 0) {
    const scores: Record<Campaign, number> = {
      AI_AUTOMATION: 0,
      WEB_REBUILD: 0,
      FUNNEL_OPTIMIZATION: 0,
      LOCAL_DIGITAL_UPGRADE: 0,
      LOW_PRIORITY_NURTURE: 0,
      REJECT: 100,
    };
    const reasons: Record<Campaign, ScoreReason[]> = {
      AI_AUTOMATION: [],
      WEB_REBUILD: [],
      FUNNEL_OPTIMIZATION: [],
      LOCAL_DIGITAL_UPGRADE: [],
      LOW_PRIORITY_NURTURE: [],
      REJECT: trueRejectionReasons,
    };
    return {
      primary: 'REJECT',
      scores,
      reasons,
      trueRejectionReasons,
      primaryReason: trueRejectionReasons[0].label,
      suggestedInvestigation: nextStepFor('REJECT', lead),
    };
  }

  const ai = scoreAiAutomation(lead, ruleCodes, rejCodes, intent);
  const web = scoreWebRebuild(lead, ruleCodes, rejCodes);
  const funnel = scoreFunnelOptimization(lead, ruleCodes, rejCodes);
  const local = scoreLocalDigitalUpgrade(lead, ruleCodes, rejCodes);
  const nurture = scoreLowPriorityNurture(lead, ruleCodes, rejCodes);

  const scores: Record<Campaign, number> = {
    AI_AUTOMATION: ai.score,
    WEB_REBUILD: web.score,
    FUNNEL_OPTIMIZATION: funnel.score,
    LOCAL_DIGITAL_UPGRADE: local.score,
    LOW_PRIORITY_NURTURE: nurture.score,
    REJECT: 0,
  };
  const reasons: Record<Campaign, ScoreReason[]> = {
    AI_AUTOMATION: ai.reasons,
    WEB_REBUILD: web.reasons,
    FUNNEL_OPTIMIZATION: funnel.reasons,
    LOCAL_DIGITAL_UPGRADE: local.reasons,
    LOW_PRIORITY_NURTURE: nurture.reasons,
    REJECT: [],
  };

  const primary = pickPrimary(scores);
  return {
    primary,
    scores,
    reasons,
    trueRejectionReasons: [],
    primaryReason: summaryReasonFor(primary, reasons[primary]),
    suggestedInvestigation: nextStepFor(primary, lead),
  };
}
