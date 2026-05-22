// POST /api/services/test-registry-connection
//
// Tiny, harmless test call against a well-known Companies House
// company number. Returns a structured status the UI can render
// without exposing the key.
//
// Why /company/00000006? It's the iconic first-ever UK-incorporated
// company (Marine and General Mutual Life Assurance Society — long
// since dissolved), used everywhere as a canonical test fixture.
// The endpoint exists, returns a small payload, and doesn't risk
// burning quota on a real lookup.

import { NextResponse } from 'next/server';
import { config } from '../../../../src/config/index';

export const dynamic = 'force-dynamic';

const TEST_COMPANY_NUMBER = '00000006';

export type ConnectionTestState =
  | 'connected'
  | 'missing_key'
  | 'unauthorized'
  | 'forbidden'
  | 'wrong_key_type_hint'
  | 'rate_limited'
  | 'network_error'
  | 'disabled'
  | 'unknown_error';

export interface ConnectionTestResult {
  state: ConnectionTestState;
  httpStatus: number | null;
  message: string;
  // The size in bytes of the response body — useful when the API
  // tarpits us with a redirect or HTML rather than JSON.
  responseBytes: number;
  // Total round-trip in ms (network only, not including JSON parsing).
  durationMs: number;
}

export async function POST() {
  const start = Date.now();

  if (!config.companiesHouse.enabled) {
    return NextResponse.json(
      {
        state: 'disabled',
        httpStatus: null,
        message:
          'COMPANIES_HOUSE_ENABLED is off. Set it to 1 in .env.local and restart the app.',
        responseBytes: 0,
        durationMs: Date.now() - start,
      } satisfies ConnectionTestResult,
      { status: 200 },
    );
  }

  // Pull the key directly off the env so we can detect whitespace
  // issues that config.companiesHouse.apiKey (already trimmed) would
  // hide. We use the trimmed version for the actual call.
  const rawKey = process.env.COMPANIES_HOUSE_API_KEY ?? '';
  const apiKey = rawKey.trim();
  if (apiKey.length === 0) {
    return NextResponse.json(
      {
        state: 'missing_key',
        httpStatus: null,
        message:
          'COMPANIES_HOUSE_API_KEY is not set. Add it to .env.local and restart the app.',
        responseBytes: 0,
        durationMs: Date.now() - start,
      } satisfies ConnectionTestResult,
      { status: 200 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.companiesHouse.requestTimeoutMs);
  try {
    // Basic auth: username=key, password=empty. Companies House is
    // explicit about this — both halves of the colon are required.
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    const authHeader = `Basic ${auth}`;

    // Server-side audit log — captures what we sent without exposing
    // the key. We log only: key presence, length, auth header prefix
    // (proves the Basic scheme), and the HTTP status we get back.
    // No key value, no full auth header, no body content.
    console.log(
      `[ch-test] key_present=${apiKey.length > 0} key_length=${apiKey.length} auth_prefix=${authHeader.slice(0, 6)} endpoint=/company/${TEST_COMPANY_NUMBER}`,
    );

    const res = await fetch(
      `${config.companiesHouse.baseUrl}/company/${TEST_COMPANY_NUMBER}`,
      {
        signal: controller.signal,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      },
    );
    const text = await res.text();
    const durationMs = Date.now() - start;
    const responseBytes = text.length;

    console.log(
      `[ch-test] response_status=${res.status} duration_ms=${durationMs} response_bytes=${responseBytes}`,
    );

    if (res.status === 200) {
      return NextResponse.json(
        {
          state: 'connected',
          httpStatus: 200,
          message: `Connected. Fetched /company/${TEST_COMPANY_NUMBER} (${responseBytes} bytes).`,
          responseBytes,
          durationMs,
        } satisfies ConnectionTestResult,
        { status: 200 },
      );
    }
    if (res.status === 401) {
      // Key looks UUID-shaped but is rejected → suggest it might be a
      // stream key or revoked. Otherwise the more generic "invalid"
      // message.
      const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKey);
      return NextResponse.json(
        {
          state: looksUuid ? 'wrong_key_type_hint' : 'unauthorized',
          httpStatus: 401,
          message: looksUuid
            ? 'Authorisation rejected (401). The key has the right shape but Companies House didn\'t accept it. Common causes: (1) it\'s a Streaming API key, not a REST API key — regenerate a REST key on the dev portal; (2) the key hasn\'t been activated yet; (3) the key was revoked.'
            : 'Authorisation rejected (401). Check the value in .env.local.',
          responseBytes,
          durationMs,
        } satisfies ConnectionTestResult,
        { status: 200 },
      );
    }
    if (res.status === 403) {
      return NextResponse.json(
        {
          state: 'forbidden',
          httpStatus: 403,
          message:
            'Forbidden (403). The key is recognised but lacks permission for this endpoint. Regenerate a REST API key on the Companies House dev portal.',
          responseBytes,
          durationMs,
        } satisfies ConnectionTestResult,
        { status: 200 },
      );
    }
    if (res.status === 429) {
      return NextResponse.json(
        {
          state: 'rate_limited',
          httpStatus: 429,
          message:
            'Rate limit hit (429). Companies House free tier is 600 requests / 5 minutes. Wait a few minutes before retrying.',
          responseBytes,
          durationMs,
        } satisfies ConnectionTestResult,
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        state: 'unknown_error',
        httpStatus: res.status,
        message: `Companies House returned HTTP ${res.status}. Body (truncated): ${text.slice(0, 200)}`,
        responseBytes,
        durationMs,
      } satisfies ConnectionTestResult,
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        state: 'network_error',
        httpStatus: null,
        message: `Network or timeout: ${msg}`,
        responseBytes: 0,
        durationMs: Date.now() - start,
      } satisfies ConnectionTestResult,
      { status: 200 },
    );
  } finally {
    clearTimeout(timer);
  }
}
