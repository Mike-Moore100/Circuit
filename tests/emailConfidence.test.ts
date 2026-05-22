// Phase 1 email confidence — end-to-end pipeline tests. Covers the
// nine cases the brief lists, plus the regression-critical edges
// (disposable + catch-all + free-provider penalties).
//
// DNS is mocked via the resolveMxImpl injection point — we never
// touch the network from a unit test.

import { describe, it, expect } from 'vitest';
import { verifyEmail } from '../src/email/emailConfidence';
import {
  isDisposableDomain,
  isFreeProviderDomain,
} from '../src/email/disposableDomains';
import { detectRoleEmail } from '../src/email/roleEmailDetection';
import { isValidEmailSyntax, parseEmail, rootDomain } from '../src/email/emailSyntax';

// Fake DNS resolver — returns a fixed set of MX records for domains
// we register, or throws ENOTFOUND for the rest.
function fakeMxResolver(records: Record<string, Array<{ exchange: string; priority: number }>>) {
  return async (hostname: string) => {
    const found = records[hostname.toLowerCase()];
    if (!found) {
      const e = new Error('queryMx ENOTFOUND') as NodeJS.ErrnoException;
      e.code = 'ENOTFOUND';
      throw e;
    }
    return found;
  };
}

// ---------------------------------------------------------------------------
// 1. Syntax
// ---------------------------------------------------------------------------
describe('isValidEmailSyntax', () => {
  it.each([
    'jane@acme.test',
    'jane.smith@acme.test',
    'jane+work@acme.co.uk',
    'JANE@ACME.TEST',
  ])('accepts "%s"', (input) => {
    expect(isValidEmailSyntax(input)).toBe(true);
  });

  it.each([
    '',
    null,
    undefined,
    'no-at-sign.com',
    '@nolocal.com',
    'jane@',
    'jane@.com',
    'jane@acme',
    'jane..smith@acme.test',
    '.jane@acme.test',
    'jane@acme..test',
  ])('rejects "%s"', (input) => {
    expect(isValidEmailSyntax(input as string)).toBe(false);
  });
});

describe('parseEmail + rootDomain', () => {
  it('parses and lowercases', () => {
    expect(parseEmail('JANE@Acme.Test')).toEqual({
      email: 'jane@acme.test',
      local: 'jane',
      domain: 'acme.test',
    });
  });

  it('collapses sub-domains to the registrable root for UK', () => {
    expect(rootDomain('mail.acme.co.uk')).toBe('acme.co.uk');
    expect(rootDomain('acme.com')).toBe('acme.com');
    expect(rootDomain('mail.acme.com')).toBe('acme.com');
  });
});

// ---------------------------------------------------------------------------
// 2. Disposable / free provider
// ---------------------------------------------------------------------------
describe('disposable + free-provider detection', () => {
  it('flags mailinator + 10minutemail as disposable', () => {
    expect(isDisposableDomain('mailinator.com')).toBe(true);
    expect(isDisposableDomain('10minutemail.com')).toBe(true);
  });

  it('does NOT flag gmail as disposable (it is a free provider, not throwaway)', () => {
    expect(isDisposableDomain('gmail.com')).toBe(false);
    expect(isFreeProviderDomain('gmail.com')).toBe(true);
  });

  it('flags outlook + hotmail as free providers', () => {
    expect(isFreeProviderDomain('outlook.com')).toBe(true);
    expect(isFreeProviderDomain('hotmail.co.uk')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Role detection
// ---------------------------------------------------------------------------
describe('detectRoleEmail', () => {
  it.each([
    ['info', 'INFO'],
    ['hello', 'INFO'],
    ['sales', 'SALES'],
    ['leads', 'SALES'],
    ['support', 'SUPPORT'],
    ['help', 'SUPPORT'],
    ['admin', 'GENERAL'],
    ['hr', 'GENERAL'],
    ['legal', 'GENERAL'],
    ['no-reply', 'GENERAL'],
  ])('classifies %s → %s', (local, expected) => {
    const r = detectRoleEmail(local);
    expect(r.isRoleBased).toBe(true);
    expect(r.type).toBe(expected);
  });

  it('does NOT mark a personal name as role-based', () => {
    expect(detectRoleEmail('jane.smith').isRoleBased).toBe(false);
  });

  it('handles +tag local-parts', () => {
    expect(detectRoleEmail('info+web').isRoleBased).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Pipeline — MX exists / missing / disposable / guessed / business
// ---------------------------------------------------------------------------
describe('verifyEmail — pipeline integration', () => {
  it('returns VALID_LIKELY for a named DM on the business domain with MX records', async () => {
    const out = await verifyEmail(
      {
        email: 'jane@acme.test',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      {
        dnsOptions: {
          resolveMxImpl: fakeMxResolver({
            'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
          }),
        },
      },
    );
    expect(out.status).toBe('VALID_LIKELY');
    expect(out.confidence).toBeGreaterThanOrEqual(60);
    expect(out.type).toBe('DIRECT_PERSON');
    expect(out.mxRecords).toEqual(['mx.acme.test']);
    expect(out.verificationMethod).toBe('dns');
  });

  it('returns INVALID when no MX records exist', async () => {
    const out = await verifyEmail(
      {
        email: 'jane@nomx.test',
        emailStatus: 'extracted',
        companyDomain: 'nomx.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      { dnsOptions: { resolveMxImpl: fakeMxResolver({}) } },
    );
    expect(out.status).toBe('INVALID');
    expect(out.confidence).toBe(0);
    expect(out.reasons.some((r) => r.code === 'no_mx')).toBe(true);
  });

  it('returns INVALID for disposable domains', async () => {
    const out = await verifyEmail(
      {
        email: 'throwaway@mailinator.com',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      {
        dnsOptions: {
          resolveMxImpl: fakeMxResolver({
            'mailinator.com': [{ exchange: 'mx.mailinator.com', priority: 10 }],
          }),
        },
      },
    );
    expect(out.status).toBe('INVALID');
    expect(out.isDisposable).toBe(true);
    expect(out.reasons.some((r) => r.code === 'disposable_domain')).toBe(true);
  });

  it('rejects invalid syntax with INVALID + confidence 0', async () => {
    const out = await verifyEmail(
      {
        email: 'not-an-email',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: false,
        domainHasPriorGuessedEmails: false,
      },
      { skipDns: true },
    );
    expect(out.status).toBe('INVALID');
    expect(out.confidence).toBe(0);
  });

  it('keeps guessed emails RISKY even with MX + business domain', async () => {
    const out = await verifyEmail(
      {
        email: 'jane@acme.test',
        emailStatus: 'guessed',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      {
        dnsOptions: {
          resolveMxImpl: fakeMxResolver({
            'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
          }),
        },
      },
    );
    expect(out.status).toBe('RISKY');
    expect(out.type).toBe('GUESS');
    expect(out.reasons.some((r) => r.code === 'guessed_email')).toBe(true);
  });

  it('scores a direct business email higher than a generic role email on the same domain', async () => {
    const dns = {
      resolveMxImpl: fakeMxResolver({
        'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
      }),
    };
    const direct = await verifyEmail(
      {
        email: 'jane@acme.test',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      { dnsOptions: dns },
    );
    const role = await verifyEmail(
      {
        email: 'info@acme.test',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: false,
        domainHasPriorGuessedEmails: false,
      },
      { dnsOptions: dns },
    );
    expect(direct.confidence).toBeGreaterThan(role.confidence);
    expect(direct.type).toBe('DIRECT_PERSON');
    expect(role.type).toBe('INFO');
  });

  it('penalises free-provider emails for business outreach', async () => {
    const out = await verifyEmail(
      {
        email: 'jane.smith@gmail.com',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      {
        dnsOptions: {
          resolveMxImpl: fakeMxResolver({
            'gmail.com': [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }],
          }),
        },
      },
    );
    expect(out.reasons.some((r) => r.code === 'free_provider')).toBe(true);
    // Should NOT be on company domain — penalised but still a usable signal.
    expect(out.reasons.some((r) => r.code === 'direct_person_business_domain')).toBe(false);
  });

  it('marks domains with prior guessed emails as catch-all-risky', async () => {
    const out = await verifyEmail(
      {
        email: 'jane@acme.test',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: true,
      },
      {
        dnsOptions: {
          resolveMxImpl: fakeMxResolver({
            'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
          }),
        },
      },
    );
    expect(out.isCatchAllRisk).toBe(true);
    expect(out.status).toBe('RISKY');
  });

  it('returns UNKNOWN when DNS is skipped (syntax-only verification)', async () => {
    const out = await verifyEmail(
      {
        email: 'jane@acme.test',
        emailStatus: 'extracted',
        companyDomain: 'acme.test',
        hasName: true,
        domainHasPriorGuessedEmails: false,
      },
      { skipDns: true },
    );
    expect(out.status).toBe('UNKNOWN');
    expect(out.verificationMethod).toBe('syntax_only');
  });
});

// ---------------------------------------------------------------------------
// SMTP verifier — stays disabled.
// ---------------------------------------------------------------------------
describe('smtpVerifier', () => {
  it('returns skipped when the env flag is off', async () => {
    const { createSmtpVerifier } = await import('../src/email/smtpVerifier');
    const verifier = createSmtpVerifier({ enabled: false });
    expect(verifier.enabled).toBe(false);
    const out = await verifier.verify('jane@acme.test');
    expect(out.performed).toBe(false);
    expect(out.outcome).toBe('skipped');
  });

  it('still returns skipped when enabled because the implementation is stub-only', async () => {
    const { createSmtpVerifier } = await import('../src/email/smtpVerifier');
    const verifier = createSmtpVerifier({ enabled: true });
    expect(verifier.enabled).toBe(true);
    const out = await verifier.verify('jane@acme.test');
    expect(out.performed).toBe(false);
    expect(out.outcome).toBe('skipped');
    expect(out.reason).toMatch(/no implementation/i);
  });
});
