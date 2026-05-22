// Phase 1 email confidence — SMTP verifier INTERFACE ONLY.
//
// Intentionally not implemented. Aggressive SMTP probing is exactly
// the kind of behaviour we don't want Circuit to do — it gets IPs
// blocked, it triggers spam-trap signals, and at scale it shades
// into abusive scanning. If a future operator wants to plug in a
// per-domain, strict-rate-limited verifier, this is the shape they
// build against.
//
// Hard rules (enforced by the env gate + this stub):
//   - off by default (SMTP_VERIFICATION_ENABLED=0)
//   - never used as a primary signal — only to tilt confidence within
//     the existing scoring system
//   - the implementation MUST cache by domain + email, MUST enforce
//     a per-host concurrency cap, MUST back off on any 4xx/5xx code
//     other than 550, and MUST never emit DATA / a real message body

export interface SmtpVerificationResult {
  // True only if an SMTP HELO/MAIL FROM/RCPT TO dance was attempted.
  // False means "not configured" or "skipped" — the orchestrator
  // treats both the same way: no contribution to the score.
  performed: boolean;
  // 'accepted' | 'rejected' | 'catch_all_detected' | 'inconclusive'
  // | 'skipped'. Only 'accepted' / 'rejected' are scoreable signals.
  outcome:
    | 'accepted'
    | 'rejected'
    | 'catch_all_detected'
    | 'inconclusive'
    | 'skipped';
  // Free-form, operator-readable reason. Always present, even on skip.
  reason: string;
}

export interface SmtpVerifierConfig {
  enabled: boolean;
  // Per-second cap across all SMTP probes — the implementation must
  // throttle below this. Defaults to a paranoid 0.5 (1 every 2s).
  rateLimitPerSecond?: number;
  // Max concurrent SMTP sessions across the process. Defaults to 1.
  concurrency?: number;
  // Cache TTL (days). Defaults to 30.
  cacheTtlDays?: number;
}

export interface SmtpVerifier {
  enabled: boolean;
  verify(email: string): Promise<SmtpVerificationResult>;
}

// Factory — returns a verifier that *always* skips. Importing this
// is the supported way to take a future SMTP path; today every call
// returns 'skipped' without touching the network.
export function createSmtpVerifier(config: SmtpVerifierConfig): SmtpVerifier {
  const enabled = config.enabled === true;
  return {
    enabled,
    async verify(_email: string): Promise<SmtpVerificationResult> {
      if (!enabled) {
        return {
          performed: false,
          outcome: 'skipped',
          reason: 'SMTP_VERIFICATION_ENABLED=0 — verifier is the disabled stub',
        };
      }
      // When enabled is true but no real implementation is wired,
      // we still skip + report it honestly.
      return {
        performed: false,
        outcome: 'skipped',
        reason: 'SMTP verifier interface present but no implementation registered',
      };
    },
  };
}
