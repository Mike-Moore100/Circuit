'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[circuit] global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f5f6f8',
          color: '#0b1220',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '64px auto',
            padding: 24,
            background: 'white',
            border: '1px solid #e6e8ec',
            borderRadius: 10,
          }}
        >
          <h1 style={{ marginTop: 0 }}>Circuit — fatal error</h1>
          <p style={{ color: '#5b6470' }}>
            The app shell itself failed to render. Stack in the dev console.
          </p>
          <pre
            style={{
              background: '#f4f5f7',
              border: '1px solid #e6e8ec',
              borderRadius: 4,
              padding: 16,
              overflowX: 'auto',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
