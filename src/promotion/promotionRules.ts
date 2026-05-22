// Promotion rule set. Each rule is a pure function over PromotionInput.
// No AI, no network, no DB lookups (DB-aware checks live in
// qualificationGate.ts on top of these).
//
// Rules either:
//   - VETO with veto:true → the gate composes those into a hard SKIP, or
//   - SCORE with veto:false → contributions sum into the signal threshold.

import type { PromotionInput, RuleResult } from './promotionTypes';

// ---------------------------------------------------------------------------
// Spam — obvious red flags in the title / snippet / business name. These
// veto immediately. The list is intentionally narrow; broader filtering
// belongs in upstream sources (we're not trying to do content moderation
// here).
// ---------------------------------------------------------------------------
const SPAM_PATTERNS: Array<{ rx: RegExp; label: string }> = [
  { rx: /\b(casino|poker|gambling|slots)\b/i, label: 'gambling / casino keyword' },
  { rx: /\b(viagra|cialis|cbd|kratom)\b/i, label: 'pharma / regulated-substance keyword' },
  { rx: /\b(porn|adult chat|escorts?)\b/i, label: 'adult / restricted-content keyword' },
  { rx: /\b(crypto signals|airdrops?|trading bot)\b/i, label: 'crypto-signals / pump-and-dump pattern' },
  { rx: /\b(buy followers|fake reviews|hack(?:ed)? accounts?)\b/i, label: 'fraud / dark-pattern offering' },
  { rx: /\b(click here|free money|earn \$\d)/i, label: 'classic SEO-spam phrasing' },
];

export function ruleSpam(input: PromotionInput): RuleResult {
  const corpus = `${input.title ?? ''} ${input.snippet ?? ''} ${input.businessName}`;
  for (const p of SPAM_PATTERNS) {
    if (p.rx.test(corpus)) {
      return {
        code: 'spam',
        label: `Spam veto: ${p.label}`,
        veto: true,
        score: -100,
      };
    }
  }
  return { code: 'spam', label: 'No spam markers', veto: false, score: 0 };
}

// ---------------------------------------------------------------------------
// Enterprise — keywords that suggest a procurement-heavy, RFP-driven buyer.
// We don't sell to those; veto the promotion rather than burn qualification
// cost on a no-fit lead.
// ---------------------------------------------------------------------------
const ENTERPRISE_PATTERNS: Array<{ rx: RegExp; label: string }> = [
  { rx: /\b(fortune\s*\d{2,3}|fortune 500|global 2000)\b/i, label: 'Fortune-list industry indicator' },
  { rx: /\b(enterprise (?:software|platform|saas))\b/i, label: 'enterprise software platform' },
  { rx: /\b(multinational|global (?:leader|player))\b/i, label: 'multinational / global-leader language' },
  { rx: /\b(public limited company|plc|nasdaq|nyse:)\b/i, label: 'publicly-listed indicator' },
];

export function ruleEnterprise(input: PromotionInput): RuleResult {
  const corpus = `${input.title ?? ''} ${input.snippet ?? ''} ${input.businessName}`;
  for (const p of ENTERPRISE_PATTERNS) {
    if (p.rx.test(corpus)) {
      return {
        code: 'enterprise',
        label: `Enterprise veto: ${p.label}`,
        veto: true,
        score: -50,
      };
    }
  }
  return { code: 'enterprise', label: 'No enterprise markers', veto: false, score: 0 };
}

// ---------------------------------------------------------------------------
// Domain shape — cheap junk-domain filter. Domains we want look like
// `acmedesign.co.uk`. Things we don't want: very long, lots of dashes/digits,
// .xyz / .top / .click etc. (common spam TLDs).
// ---------------------------------------------------------------------------
const JUNK_TLDS = new Set([
  'xyz',
  'top',
  'click',
  'work',
  'gq',
  'tk',
  'ml',
  'cf',
  'icu',
  'best',
]);

export function ruleDomainShape(input: PromotionInput): RuleResult {
  const d = input.domain.toLowerCase();
  // Bail if no domain (shouldn't reach the gate, but be safe).
  if (!d || !d.includes('.')) {
    return { code: 'domain', label: 'No usable domain', veto: true, score: -100 };
  }
  // Junk TLD veto
  const tld = d.split('.').pop() ?? '';
  if (JUNK_TLDS.has(tld)) {
    return {
      code: 'domain.junk_tld',
      label: `Junk TLD .${tld}`,
      veto: true,
      score: -100,
    };
  }
  // Excessive length (real SMB domains are usually < 32 chars before TLD)
  const labelLen = d.split('.')[0].length;
  if (labelLen > 38) {
    return {
      code: 'domain.too_long',
      label: `Domain label too long (${labelLen} chars)`,
      veto: true,
      score: -50,
    };
  }
  // Too many dashes — random-generated SEO domains pattern
  if ((d.match(/-/g) ?? []).length >= 4) {
    return {
      code: 'domain.too_many_dashes',
      label: 'Suspicious dash density',
      veto: true,
      score: -50,
    };
  }
  return { code: 'domain', label: 'Domain shape ok', veto: false, score: 4 };
}

// ---------------------------------------------------------------------------
// Positive signals (no veto, all score). Each one is a small confidence
// bump for promotion. The gate combines these into a signal threshold.
// ---------------------------------------------------------------------------
const TARGET_KEYWORDS = [
  'agency',
  'studio',
  'consultancy',
  'consulting',
  'firm',
  'practice',
  'clinic',
  'accountants',
  'solicitors',
  'lawyers',
  'design',
  'marketing',
  'recruitment',
  'estate agents',
  'plumbers',
  'electricians',
  'fitness',
  'wellness',
  'dental',
];

export function ruleIndustryFit(input: PromotionInput): RuleResult {
  const corpus = `${input.title ?? ''} ${input.snippet ?? ''} ${input.businessName}`.toLowerCase();
  const matched = TARGET_KEYWORDS.filter((k) => corpus.includes(k));
  if (matched.length === 0) {
    return {
      code: 'industry_fit',
      label: 'No target industry keyword in title/snippet/name',
      veto: false,
      score: 0,
    };
  }
  // Hitting multiple target keywords is a stronger signal but capped.
  const score = Math.min(12, matched.length * 6);
  return {
    code: 'industry_fit',
    label: `Industry keyword match: ${matched.slice(0, 3).join(', ')}`,
    veto: false,
    score,
  };
}

export function ruleHasPhone(input: PromotionInput): RuleResult {
  if (input.phone) {
    return { code: 'has_phone', label: 'Phone number captured at discovery', veto: false, score: 4 };
  }
  return { code: 'has_phone', label: 'No phone captured', veto: false, score: 0 };
}

export function ruleHasLocation(input: PromotionInput): RuleResult {
  if (input.location) {
    return { code: 'has_location', label: 'Location captured at discovery', veto: false, score: 4 };
  }
  return { code: 'has_location', label: 'No location captured', veto: false, score: 0 };
}

export function ruleHasSnippet(input: PromotionInput): RuleResult {
  // A snippet means the SERP / directory actually rendered description
  // text — proxy for "this is a real, indexed page".
  const len = (input.snippet ?? '').length;
  if (len >= 80) return { code: 'has_snippet', label: 'Substantive snippet', veto: false, score: 4 };
  if (len > 0) return { code: 'has_snippet', label: 'Short snippet', veto: false, score: 2 };
  return { code: 'has_snippet', label: 'No snippet', veto: false, score: 0 };
}

export const ALL_RULES = [
  ruleSpam,
  ruleEnterprise,
  ruleDomainShape,
  ruleIndustryFit,
  ruleHasPhone,
  ruleHasLocation,
  ruleHasSnippet,
];
