// Phase 1 email confidence — role / generic mailbox detection.
//
// Two distinct things we look for:
//
//   1. Role-based addresses (info@, sales@, support@, hello@, etc.)
//      These are valid emails an operator can use, but they reach an
//      inbox, not a decision-maker. Score lower.
//
//   2. Specific role categories (SUPPORT / SALES / INFO / GENERAL) —
//      used to bucket the EmailType so the UI can show "Reaches the
//      sales inbox" rather than just "Role-based".
//
// Pure pattern matching on the local-part. No DNS, no I/O.

import type { EmailType } from './emailTypes';

interface RolePattern {
  pattern: RegExp;
  type: Exclude<EmailType, 'DIRECT_PERSON' | 'GUESS' | 'UNKNOWN'>;
}

const ROLE_PATTERNS: RolePattern[] = [
  { pattern: /^(info|enquiries?|enquiry|contact|hi|hey)$/i, type: 'INFO' },
  { pattern: /^(hello|welcome|hola|namaste)$/i, type: 'INFO' },
  { pattern: /^(sales|leads|opportunities)$/i, type: 'SALES' },
  { pattern: /^(support|help|helpdesk|service|customerservice|care)$/i, type: 'SUPPORT' },
  // Generic operations / corporate addresses.
  { pattern: /^(admin|administration|office|reception)$/i, type: 'GENERAL' },
  { pattern: /^(accounts?|billing|finance|invoices?|ar|ap)$/i, type: 'GENERAL' },
  { pattern: /^(hr|jobs|careers?|recruitment|hiring|talent)$/i, type: 'GENERAL' },
  { pattern: /^(marketing|press|media|pr|comms)$/i, type: 'GENERAL' },
  { pattern: /^(legal|compliance|privacy|gdpr|dpo)$/i, type: 'GENERAL' },
  { pattern: /^(team|crew|people|staff|everyone)$/i, type: 'GENERAL' },
  { pattern: /^(no[._-]?reply|donotreply|notifications?)$/i, type: 'GENERAL' },
  { pattern: /^(webmaster|postmaster|abuse|security)$/i, type: 'GENERAL' },
  { pattern: /^(iwanttowork|joinus|workhere)$/i, type: 'GENERAL' },
];

export interface RoleDetectionResult {
  isRoleBased: boolean;
  type: EmailType | null; // null when no role pattern matched
}

export function detectRoleEmail(localPart: string | null | undefined): RoleDetectionResult {
  if (!localPart) return { isRoleBased: false, type: null };
  const local = localPart.toLowerCase().trim();
  for (const rule of ROLE_PATTERNS) {
    if (rule.pattern.test(local)) {
      return { isRoleBased: true, type: rule.type };
    }
  }
  // Heuristic: if the local-part contains a +tag, strip it and re-test.
  // info+web@acme.test → still INFO.
  const plus = local.indexOf('+');
  if (plus > 0) {
    const stripped = local.slice(0, plus);
    for (const rule of ROLE_PATTERNS) {
      if (rule.pattern.test(stripped)) {
        return { isRoleBased: true, type: rule.type };
      }
    }
  }
  return { isRoleBased: false, type: null };
}

// Classify the EmailType for a single email. Combines role detection
// + heuristics about whether a personal name is present (named
// contacts → DIRECT_PERSON; everything else falls through).
export function classifyEmailType(
  localPart: string,
  options: { hasName: boolean; isGuessed: boolean },
): EmailType {
  if (options.isGuessed) return 'GUESS';
  const role = detectRoleEmail(localPart);
  if (role.isRoleBased && role.type) return role.type;
  if (options.hasName) return 'DIRECT_PERSON';
  return 'UNKNOWN';
}
