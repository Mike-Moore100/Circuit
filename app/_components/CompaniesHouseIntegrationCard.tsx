'use client';

// Companies House integration card — Settings → Integrations. Lets
// the operator verify env state and run a live auth test against the
// canonical /company/00000006 endpoint without dropping into a shell.
//
// IMPORTANT: this card never displays the API key itself. The
// server-side endpoints (run-registry-enrichment / test-registry-
// connection / registry-status) never return the key value — only
// presence + length + shape — so even a leaky screen capture won't
// expose the secret.

import { useState } from 'react';

interface InitialStatus {
  enabled: boolean;
  enabledEnvRaw: string | null;
  keyPresent: boolean;
  keyLength: number;
  keySource: string;
  baseUrl: string;
}

interface TestResult {
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

const STATE_TONE: Record<TestResult['state'], 'ok' | 'warn' | 'err'> = {
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

const STATE_LABEL: Record<TestResult['state'], string> = {
  connected: 'Connected',
  missing_key: 'Missing key',
  unauthorized: 'Invalid / unauthorised',
  forbidden: 'Forbidden',
  wrong_key_type_hint: 'Invalid REST key (or env not reloaded)',
  rate_limited: 'Rate limited',
  network_error: 'Network error',
  disabled: 'Disabled',
  unknown_error: 'Unknown error',
};

interface Props {
  initialStatus: InitialStatus;
}

export function CompaniesHouseIntegrationCard({ initialStatus }: Props) {
  const [test, setTest] = useState<TestResult | null>(null);
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runTest() {
    setRunning(true);
    setTest(null);
    try {
      const res = await fetch('/api/services/test-registry-connection', {
        method: 'POST',
      });
      const body = (await res.json()) as TestResult;
      setTest(body);
      setTestedAt(new Date().toISOString());
    } catch (err) {
      setTest({
        state: 'network_error',
        httpStatus: null,
        message: err instanceof Error ? err.message : String(err),
        responseBytes: 0,
        durationMs: 0,
      });
      setTestedAt(new Date().toISOString());
    } finally {
      setRunning(false);
    }
  }

  const lastStateLabel = test ? STATE_LABEL[test.state] : 'Not tested yet';
  const lastStateTone = test ? STATE_TONE[test.state] : 'muted';

  return (
    <div className="integration-card">
      <header className="integration-card-head">
        <div className="integration-card-title-block">
          <h3 className="integration-card-title">Companies House</h3>
          <p className="integration-card-sub">
            UK registry enrichment. Strictly optional — does not gate
            discovery, qualification, or scoring.
          </p>
        </div>
        <span
          className={`integration-card-state integration-card-state-${
            initialStatus.enabled && initialStatus.keyPresent ? 'ok' : 'warn'
          }`}
        >
          {initialStatus.enabled && initialStatus.keyPresent ? 'Configured' : 'Needs setup'}
        </span>
      </header>

      <dl className="integration-card-fields">
        <Field label="Enabled" value={initialStatus.enabled ? 'true' : 'false'} tone={initialStatus.enabled ? 'ok' : 'warn'} />
        <Field label="Key present" value={initialStatus.keyPresent ? 'true' : 'false'} tone={initialStatus.keyPresent ? 'ok' : 'warn'} />
        <Field label="Trimmed key length" value={String(initialStatus.keyLength)} tone={initialStatus.keyLength === 36 ? 'ok' : 'muted'} />
        <Field label="Key source" value={initialStatus.keySource} tone="muted" />
        <Field label="Base URL" value={initialStatus.baseUrl} tone="muted" />
        <Field label="Last test" value={lastStateLabel} tone={lastStateTone} />
        {test && test.httpStatus !== null && (
          <Field label="HTTP status" value={String(test.httpStatus)} tone={lastStateTone} />
        )}
        {testedAt && <Field label="Tested at" value={fmtTime(testedAt)} tone="muted" />}
      </dl>

      {test && test.state !== 'connected' && (
        <div className={`integration-card-error integration-card-error-${lastStateTone}`}>
          <strong>{lastStateLabel}.</strong>
          <span>{test.message}</span>
          {test.state === 'wrong_key_type_hint' && (
            <span>
              Generate a <strong>REST API key</strong> (not a Streaming
              key) at{' '}
              <a
                href="https://developer.company-information.service.gov.uk/manage-applications"
                target="_blank"
                rel="noreferrer"
              >
                developer.company-information.service.gov.uk
              </a>
              .
            </span>
          )}
        </div>
      )}

      <div className="integration-card-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={runTest}
          disabled={running}
        >
          {running ? 'Testing connection…' : 'Test connection'}
        </button>
      </div>

      <p className="integration-card-foot">
        <strong>Restart required:</strong> environment variables are read
        when the Next.js server boots. After editing{' '}
        <code>.env.local</code>, stop the dev server and run{' '}
        <code>npm run dev</code> again — otherwise the "Test connection"
        button will continue to use the old key.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'err' | 'muted';
}) {
  return (
    <div className={`integration-field integration-field-${tone}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
