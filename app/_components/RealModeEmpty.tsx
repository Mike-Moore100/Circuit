// Shared empty state for REAL-mode pages when no real data has flowed
// through yet. Tells the operator exactly what to do — never silently
// falls back to DEMO data.

export function RealModeEmpty({
  surface = 'leads',
}: {
  surface?: string;
}) {
  return (
    <div className="panel">
      <div className="real-mode-empty">
        <h3>No real {surface} processed yet</h3>
        <p>
          Run real discovery (<code>npm run run:discovery</code>) or a real
          pipeline source (<code>npm run pipeline:google-maps</code>), then
          promote with <code>npm run run:promotion -- --process</code>.
        </p>
        <p style={{ marginTop: 8 }}>
          To explore the app on seed data, set <code>DEMO_MODE=1 ALLOW_MOCK_DATA=1</code>{' '}
          and run <code>npm run seed:demo</code>.
        </p>
      </div>
    </div>
  );
}
