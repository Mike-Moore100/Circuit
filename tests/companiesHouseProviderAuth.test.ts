// Phase 1 — pin the Companies House Basic-auth construction. The 401
// the operator sees in the UI is a real registry rejection, NOT a
// client-side bug, and these tests prove the auth header we send is
// shaped exactly the way the API expects.

import { describe, it, expect } from 'vitest';
import { createCompaniesHouseProvider } from '../src/enrichment/companiesHouseProvider';

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
}

// A fetch stub that records the request and returns a configurable
// response. We never hit the network from a unit test.
function makeFakeFetch(
  status: number,
  body: unknown = { items: [] },
): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    calls.push({ url, headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }) as unknown as Response;
  };
  return { fetchImpl, calls };
}

describe('Companies House Basic auth construction', () => {
  it('sends Basic auth with the API key as username and empty password', async () => {
    const { fetchImpl, calls } = makeFakeFetch(200, { items: [] });
    const provider = createCompaniesHouseProvider({
      apiKey: 'test-key-123',
      fetchImpl,
    });
    await provider.searchByName('anything');
    expect(calls).toHaveLength(1);
    // "test-key-123:" → base64
    const expected =
      'Basic ' + Buffer.from('test-key-123:').toString('base64');
    expect(calls[0].headers.Authorization).toBe(expected);
  });

  it('trims whitespace + newlines from the API key before constructing the header', async () => {
    const { fetchImpl, calls } = makeFakeFetch(200, { items: [] });
    const provider = createCompaniesHouseProvider({
      apiKey: '  test-key-123\n',
      fetchImpl,
    });
    await provider.searchByName('anything');
    const expected =
      'Basic ' + Buffer.from('test-key-123:').toString('base64');
    expect(calls[0].headers.Authorization).toBe(expected);
  });

  it('sets Accept: application/json on every call', async () => {
    const { fetchImpl, calls } = makeFakeFetch(200, {});
    const provider = createCompaniesHouseProvider({
      apiKey: 'k',
      fetchImpl,
    });
    await provider.searchByName('any');
    expect(calls[0].headers.Accept).toBe('application/json');
  });

  it('records 401 in lastStatus + lastError without throwing', async () => {
    const { fetchImpl } = makeFakeFetch(401, { error: 'Invalid Authorization' });
    const provider = createCompaniesHouseProvider({
      apiKey: 'k',
      fetchImpl,
    });
    const hits = await provider.searchByName('any');
    expect(hits).toEqual([]);
    expect(provider.lastStatus).toBe(401);
    expect(provider.lastError).toMatch(/401|key/i);
  });

  it('records 429 with a rate-limit message', async () => {
    const { fetchImpl } = makeFakeFetch(429, {});
    const provider = createCompaniesHouseProvider({
      apiKey: 'k',
      fetchImpl,
    });
    await provider.searchByName('any');
    expect(provider.lastStatus).toBe(429);
    expect(provider.lastError).toMatch(/rate/i);
  });

  it('reports enabled=false when the key is empty', () => {
    const provider = createCompaniesHouseProvider({ apiKey: '' });
    expect(provider.enabled).toBe(false);
  });

  it('reports enabled=false when the key is only whitespace', () => {
    const provider = createCompaniesHouseProvider({ apiKey: '   \n  ' });
    expect(provider.enabled).toBe(false);
  });
});
