export const DECISION_MAKER_ROLES = [
  'founder',
  'co_founder',
  'owner',
  'ceo',
  'managing_director',
  'director',
  'operations_manager',
  'practice_manager',
  'principal',
  'partner',
  'unknown',
] as const;
export type DecisionMakerRole = (typeof DECISION_MAKER_ROLES)[number];

// Display ordering — higher index = more authoritative for SMB outreach.
export const ROLE_PRIORITY: Record<DecisionMakerRole, number> = {
  founder: 100,
  co_founder: 100,
  owner: 95,
  ceo: 92,
  managing_director: 90,
  principal: 82,
  director: 78,
  partner: 72,
  operations_manager: 70,
  practice_manager: 70,
  unknown: 0,
};

export const EMAIL_TYPES = [
  'personal',
  'role_based',
  'general',
  'support',
  'sales',
  'info',
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const EMAIL_STATUSES = ['extracted', 'guessed', 'verified'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const ROUTE_TYPES = [
  'EMAIL',
  'PHONE',
  'CONTACT_FORM',
  'BOOKING_LINK',
  'LINKEDIN',
  'GENERAL_CONTACT_PAGE',
] as const;
export type RouteType = (typeof ROUTE_TYPES)[number];

export interface DiscoveredContact {
  name: string | null;
  role: string | null;
  detectedRole: DecisionMakerRole;
  email: string | null;
  emailType: EmailType | null;
  emailStatus: EmailStatus | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  roleConfidence: number;
  emailConfidence: number;
  overallConfidence: number;
  isPrimary: boolean;
}

export interface DiscoveredRoute {
  type: RouteType;
  value: string;
  sourceUrl: string;
  confidence: number;
}

export interface ContactDiscoveryResult {
  companyId: string;
  contacts: DiscoveredContact[];
  routes: DiscoveredRoute[];
  contactabilityScore: number;
  pagesCrawled: number;
  fromCache: boolean;
  durationMs: number;
  errorMessage?: string;
}

// Email verification provider — interface only. No implementation in Phase 1.
// Future providers (Hunter, Prospeo, Apollo, NeverBounce, etc.) implement this.
export interface EmailVerificationProvider {
  name: string;
  verify(email: string): Promise<{
    status: 'valid' | 'invalid' | 'risky' | 'unknown';
    confidence: number;
  }>;
}
