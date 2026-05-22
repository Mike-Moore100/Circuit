// Phase 1 email confidence — top-level orchestrator. Runs every
// check in order, builds the EmailConfidenceResult, returns it.
// Pure-ish — DNS is the only side effect, and it's injectable.

import { detectCatchAllRisk } from './catchAllRisk';
import { isDisposableDomain, isFreeProviderDomain } from './disposableDomains';
import { lookupMxRecords, type DnsLookupOptions } from './emailDnsCheck';
import { buildResult, scoreEmailRisk } from './emailRiskScoring';
import { parseEmail, rootDomain } from './emailSyntax';
import {
  classifyEmailType,
  detectRoleEmail,
} from './roleEmailDetection';
import type {
  EmailConfidenceInputs,
  EmailConfidenceResult,
} from './emailTypes';

export interface VerifyOptions {
  // Skip DNS — used in tests + when the caller already knows the
  // domain. Result will carry status: 'UNKNOWN' if syntax passes.
  skipDns?: boolean;
  // DNS injection point.
  dnsOptions?: DnsLookupOptions;
}

/**
 * Verify a single email and return its confidence result.
 *
 * The orchestrator runs every validation layer the brief specifies:
 *   1. Syntax
 *   2. Domain normalisation
 *   3. DNS lookup
 *   4. MX record check
 *   5. Disposable detection
 *   6. Role-based classification
 *   7. Business-domain match
 *   8. Contact-source confidence
 *   9. Catch-all heuristic
 *  10. Final scoring
 */
export async function verifyEmail(
  inputs: EmailConfidenceInputs,
  options: VerifyOptions = {},
): Promise<EmailConfidenceResult> {
  // ---- 1-2. Syntax + parse -------------------------------------------
  const parsed = parseEmail(inputs.email);
  if (!parsed) {
    return buildResult(
      inputs.email,
      null,
      scoreEmailRisk({
        syntaxValid: false,
        hasMxRecords: null,
        mxLookupReason: null,
        isDisposable: false,
        isFreeProvider: false,
        emailType: 'UNKNOWN',
        isOnCompanyDomain: false,
        isCatchAllRisk: false,
        catchAllReason: null,
        isGuessed: inputs.emailStatus === 'guessed',
        fromWebsiteScrape: false,
      }),
      {
        emailType: 'UNKNOWN',
        isDisposable: false,
        isRoleBased: false,
        isCatchAllRisk: false,
        mxRecords: null,
        verificationMethod: 'syntax_only',
      },
    );
  }

  const { email, local, domain } = parsed;

  // ---- 5. Disposable + free provider -------------------------------
  const isDisposable = isDisposableDomain(domain);
  const isFreeProvider = isFreeProviderDomain(domain);

  // ---- 6. Role-based classification --------------------------------
  const role = detectRoleEmail(local);
  const emailType = classifyEmailType(local, {
    hasName: inputs.hasName,
    isGuessed: inputs.emailStatus === 'guessed',
  });

  // ---- 7. Business-domain match -----------------------------------
  // Compare the registrable roots so subdomain variations don't
  // wrongly fail the match.
  const emailRoot = rootDomain(domain);
  const companyRoot = rootDomain(inputs.companyDomain);
  const isOnCompanyDomain = !!(
    emailRoot && companyRoot && emailRoot === companyRoot
  );

  // ---- 9. Catch-all heuristic --------------------------------------
  // Without SMTP we can only flag based on persisted-guessed-email
  // density. The caller passes the rollup in via the input bundle.
  const catchAll = detectCatchAllRisk({
    domain,
    guessedEmailCount: inputs.domainHasPriorGuessedEmails ? 3 : 0,
    totalEmailCount: 0,
  });

  // ---- 3-4. DNS / MX (skipped in tests / when explicitly off) ------
  let hasMxRecords: boolean | null = null;
  let mxRecords: string[] | null = null;
  let mxLookupReason: string | null = null;
  let verificationMethod: 'syntax_only' | 'dns' | 'dns+smtp' | 'unchecked' = 'syntax_only';
  if (!options.skipDns) {
    const mx = await lookupMxRecords(domain, options.dnsOptions);
    hasMxRecords = mx.ok;
    mxRecords = mx.ok ? mx.records : null;
    mxLookupReason = mx.reason;
    verificationMethod = 'dns';
  }

  // ---- 10. Score -----------------------------------------------------
  const scoring = scoreEmailRisk({
    syntaxValid: true,
    hasMxRecords,
    mxLookupReason,
    isDisposable,
    isFreeProvider,
    emailType,
    isOnCompanyDomain,
    isCatchAllRisk: catchAll.isRisk,
    catchAllReason: catchAll.reason,
    isGuessed: inputs.emailStatus === 'guessed',
    fromWebsiteScrape: inputs.emailStatus === 'extracted',
  });

  return buildResult(email, domain, scoring, {
    emailType,
    isDisposable,
    isRoleBased: role.isRoleBased,
    isCatchAllRisk: catchAll.isRisk,
    mxRecords,
    verificationMethod,
  });
}
