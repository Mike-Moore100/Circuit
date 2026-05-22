// GET /api/services/registry-status
//
// Safe environment diagnostic for the registry drawer. NEVER returns
// the key value — only presence + length + shape hints — so the
// response can be rendered in the UI without leaking the secret.

import { NextResponse } from 'next/server';
import { config } from '../../../../src/config/index';

export const dynamic = 'force-dynamic';

// Heuristic shape hint. We *can't* tell apart REST vs Stream keys from
// the value alone (Companies House issues both as UUIDs), but we can
// at least flag obvious shape problems — a key with stray whitespace,
// a key that's been base64-pasted, an empty key, etc.
function detectShape(rawKey: string | null | undefined): {
  shape: 'unknown' | 'uuid_like' | 'wrong_length' | 'whitespace' | 'empty';
  detail: string;
} {
  if (!rawKey) return { shape: 'empty', detail: 'key is empty' };
  if (rawKey !== rawKey.trim()) {
    return { shape: 'whitespace', detail: 'key has leading or trailing whitespace' };
  }
  const trimmed = rawKey.trim();
  // Companies House REST + Stream keys are both UUID-shaped (36 chars
  // including dashes). Anything dramatically shorter or longer is
  // almost certainly the wrong string.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { shape: 'uuid_like', detail: 'matches UUID v4 shape' };
  }
  if (trimmed.length < 30 || trimmed.length > 50) {
    return {
      shape: 'wrong_length',
      detail: `key length ${trimmed.length} doesn't look like a Companies House key (expected ~36 chars)`,
    };
  }
  return { shape: 'unknown', detail: 'unrecognised shape' };
}

export async function GET() {
  const raw = process.env.COMPANIES_HOUSE_API_KEY ?? '';
  const detected = detectShape(raw);
  return NextResponse.json({
    enabled: config.companiesHouse.enabled,
    enabledEnvRaw: process.env.COMPANIES_HOUSE_ENABLED ?? null,
    keyPresent: config.companiesHouse.apiKey.length > 0,
    keyLength: config.companiesHouse.apiKey.length,
    keyShape: detected.shape,
    keyShapeDetail: detected.detail,
    baseUrl: config.companiesHouse.baseUrl,
    cacheTtlDays: config.companiesHouse.cacheTtlDays,
  });
}
