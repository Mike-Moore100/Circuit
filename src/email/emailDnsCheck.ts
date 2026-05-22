// Phase 1 email confidence — DNS / MX lookup.
//
// Uses Node's built-in dns.promises module. No paid service, no
// external HTTP call. Every code path either returns a clean
// result or a null/empty fallback — DNS failures must never throw
// into the orchestrator.

import { promises as dns } from 'node:dns';

// Node's dns.promises.resolveMx returns rows shaped like this — we
// declare the type locally because the namespace export of
// MxRecord varies across @types/node versions and we don't want
// the typecheck to depend on that.
interface MxRecord {
  exchange: string;
  priority: number;
}

export interface MxLookupResult {
  ok: boolean;
  records: string[];                // MX hostnames, sorted by priority
  // Why the lookup failed when ok=false (timeout / NXDOMAIN / etc).
  reason: string | null;
  // Milliseconds the lookup took. Useful for debug + rate-limit
  // tuning when the operator runs a batch.
  durationMs: number;
}

export interface DnsLookupOptions {
  // Default 4s — DNS over the public internet can be slow but
  // anything past this is functionally a timeout.
  timeoutMs?: number;
  // Test injection — swap the resolver for a fake.
  resolveMxImpl?: (hostname: string) => Promise<MxRecord[]>;
}

export async function lookupMxRecords(
  domain: string,
  options: DnsLookupOptions = {},
): Promise<MxLookupResult> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const resolveMx = options.resolveMxImpl ?? dns.resolveMx.bind(dns);
  const start = Date.now();

  if (!domain) {
    return {
      ok: false,
      records: [],
      reason: 'no domain provided',
      durationMs: 0,
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race<MxRecord[]>([
      resolveMx(domain),
      new Promise<MxRecord[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns_timeout')), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    const records = result
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
    if (records.length === 0) {
      return {
        ok: false,
        records: [],
        reason: 'no_mx_records',
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      records,
      reason: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    if (timer) clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    // Common Node DNS error codes we want to distinguish in the UI.
    let reason = msg;
    if (/ENOTFOUND/.test(msg)) reason = 'domain_not_found';
    else if (/NODATA/.test(msg)) reason = 'no_mx_records';
    else if (/ESERVFAIL/.test(msg)) reason = 'dns_servfail';
    else if (/ETIMEOUT|dns_timeout/.test(msg)) reason = 'dns_timeout';
    return {
      ok: false,
      records: [],
      reason,
      durationMs: Date.now() - start,
    };
  }
}
