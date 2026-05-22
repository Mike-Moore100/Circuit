// Settings — currently houses the Integrations section. UI-only: no
// config is mutable here, but operators can verify external API
// credentials are loaded and test live connections without touching
// the terminal.

import { PageHeader } from '../_components/PageHeader';
import { CompaniesHouseIntegrationCard } from '../_components/CompaniesHouseIntegrationCard';
import { config } from '../../src/config/index';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  // Server-side snapshot of the env-derived config. We pass only the
  // safe shape down to the card (presence + length + shape), never
  // the key value itself.
  const apiKeyTrimmed = (process.env.COMPANIES_HOUSE_API_KEY ?? '').trim();
  const initialStatus = {
    enabled: config.companiesHouse.enabled,
    enabledEnvRaw: process.env.COMPANIES_HOUSE_ENABLED ?? null,
    keyPresent: apiKeyTrimmed.length > 0,
    keyLength: apiKeyTrimmed.length,
    keySource: '.env.local (server env)',
    baseUrl: config.companiesHouse.baseUrl,
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Integrations + system configuration. Read-only — values come from server env."
      />

      <section className="section">
        <h2 className="section-title">Integrations</h2>
        <p className="section-hint">
          External APIs Circuit can talk to. Each card shows whether the
          integration is enabled, whether the credential is loaded, and a
          live test you can run from here without opening a terminal.
        </p>

        <CompaniesHouseIntegrationCard initialStatus={initialStatus} />
      </section>
    </>
  );
}
