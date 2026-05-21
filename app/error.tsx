'use client';

import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the real error to the dev console so we can diagnose instead of
    // showing Next.js's generic "missing required error components" fallback.
    console.error('[circuit] route error:', error);
  }, [error]);

  return (
    <div className="app-shell" style={{ padding: '48px 24px' }}>
      <div className="panel" style={{ padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Something broke.</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          The dashboard threw while rendering. Details below — full stack is in the dev
          server console.
        </p>
        <pre
          style={{
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 16,
            overflowX: 'auto',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
