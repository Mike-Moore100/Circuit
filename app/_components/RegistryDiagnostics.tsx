'use client';

// Drawer-embedded diagnostics for Companies House. Lets the operator
// confirm whether the API key is loaded + valid without opening a
// terminal. Strictly informational; nothing here can change config.
//
// Surfaces:
//   - enabled (Y/N)
//   - key presence + length + shape hint
//   - "Test connection" button → calls the well-known test endpoint
//   - clear state read-out: connected / unauthorized / wrong key type /
//     missing key / network error / disabled

import { useState } from 'react';

interface StatusPayload {
  enabled: boolean;
  enabledEnvRaw: string | null;
  keyPresent: boolean;
  keyLength: number;
  keyShape: 'unknown' | 'uuid_like' | 'wrong_length' | 'whitespace' | 'empty';
  keyShapeDetail: string;
  baseUrl: string;
  cacheTtlDays: number;
}

interface TestPayload {
  state:
    | 'connected'
    | 'missing_key'
    | 'unauthorized'
    | 'forbidden'
    | 'wrong_key_type_hint'
    | 'rate_limited'
    | 'network_error'
    | 'disabled'
    | 'unknown_error';
  httpStatus: number | null;
  message: string;
  responseBytes: number;
  durationMs: number;
}

const STATE_TONE: Record<TestPayload['state'], 'ok' | 'warn' | 'err'> = {
  connected: 'ok',
  missing_key: 'warn',
  unauthorized: 'err',
  forbidden: 'err',
  wrong_key_type_hint: 'err',
  rate_limited: 'warn',
  network_error: 'warn',
  disabled: 'warn',
  unknown_error: 'err',
};

const STATE_LABEL: Record<TestPayload['state'], string> = {
  connected: 'Connected',
  missing_key: 'Missing key',
  unauthorized: 'Invalid / unauthorised',
  forbidden: 'Forbidden',
  wrong_key_type_hint: 'Wrong key type (likely)',
  rate_limited: 'Rate limited',
  network_error: 'Network error',
  disabled: 'Disabled',
  unknown_error: 'Unknown error',
};

export function RegistryDiagnostics() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [test, setTest] = useState<TestPayload | null>(null);
  const [loading, setLoading] = useState<'idle' | 'status' | 'test'>('idle');

  async function loadStatus() {
    setLoading('status');
    try {
      const res = await fetch('/api/services/registry-status');
      setStatus(await res.json());
    } finally {
      setLoading('idle');
    }
  }

  async function runTest() {
    setLoading('test');
    setTest(null);
    try {
      const res = await fetch('/api/services/test-registry-connection', {
        method: 'POST',
      });
      setTest(await res.json());
      // Refresh the status panel too — the key state may have
      // changed between renders.
      await loadStatus();
    } finally {
      setLoading('idle');
    }
  }

  return (
    <details className="drawer-collapsible registry-diagnostics">
      <summary
        className="drawer-collapsible-summary"
        onClick={() => {
          if (!status) void loadStatus();
        }}
      >
        Diagnostics
      </summary>

      {status && (
        <div className="registry-diag-grid">
          <DiagRow label="Enabled" value={status.enabled ? 'yes' : 'no'} tone={status.enabled ? 'ok' : 'warn'} />
          <DiagRow
            label="Key present"
            value={status.keyPresent ? 'yes' : 'no'}
            tone={status.keyPresent ? 'ok' : 'warn'}
          />
          <DiagRow
            label="Key length"
            value={String(status.keyLength)}
            tone={status.keyShape === 'uuid_like' ? 'ok' : status.keyShape === 'empty' ? 'warn' : 'muted'}
          />
          <DiagRow
            label="Shape"
            value={status.keyShape.replace(/_/g, ' ')}
            tone={
              status.keyShape === 'uuid_like'
                ? 'ok'
                : status.keyShape === 'whitespace' || status.keyShape === 'wrong_length'
                ? 'err'
                : 'muted'
            }
            hint={status.keyShapeDetail}
          />
          <DiagRow label="Base URL" value={status.baseUrl} tone="muted" />
          <DiagRow label="Cache TTL" value={`${status.cacheTtlDays}d`} tone="muted" />
        </div>
      )}

      <div className="registry-diag-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={runTest}
          disabled={loading !== 'idle'}
        >
          {loading === 'test' ? 'Testing…' : 'Test Companies House connection'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={loadStatus}
          disabled={loading !== 'idle'}
        >
          Refresh diagnostic
        </button>
      </div>

      {test && (
        <div className={`registry-test-result registry-test-${STATE_TONE[test.state]}`}>
          <div className="registry-test-head">
            <strong>{STATE_LABEL[test.state]}</strong>
            {test.httpStatus !== null && (
              <span className="registry-test-status">HTTP {test.httpStatus}</span>
            )}
            <span className="registry-test-duration">{test.durationMs}ms</span>
          </div>
          <p>{test.message}</p>
          {test.state === 'wrong_key_type_hint' && (
            <a
              href="https://developer.company-information.service.gov.uk/manage-applications"
              target="_blank"
              rel="noreferrer"
              className="registry-test-link"
            >
              Open the Companies House dev portal →
            </a>
          )}
        </div>
      )}

      <p className="registry-diag-foot">
        If you just edited <code>.env.local</code>, restart the app — env
        vars are read at boot, not on every request.
      </p>
    </details>
  );
}

function DiagRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'err' | 'muted';
  hint?: string;
}) {
  return (
    <div className="registry-diag-row" title={hint}>
      <span className="registry-diag-label">{label}</span>
      <span className={`registry-diag-value registry-diag-value-${tone}`}>{value}</span>
    </div>
  );
}
