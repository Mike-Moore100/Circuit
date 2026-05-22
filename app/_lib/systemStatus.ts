// Cross-cutting system status checks the root layout surfaces as
// non-dismissable banners. Each entry is one specific problem the
// operator can fix; we never show generic "something went wrong"
// banners here.

import { getDb } from '../../src/db/client';
import { config } from '../../src/config/index';

export type SystemBannerLevel = 'info' | 'warning' | 'critical';

export interface SystemBanner {
  code: string;
  level: SystemBannerLevel;
  title: string;
  body: string;
  helpHref?: string;
}

export function getSystemStatusBanners(): SystemBanner[] {
  const banners: SystemBanner[] = [];
  const db = getDb();

  // ---- Companies House auth banner -------------------------------------
  // Surfaces when any recent registry_enrichments row carries an auth
  // failure. We pick the most recent error rather than any error so a
  // stale 401 from a key that's since been fixed doesn't keep nagging
  // — fix the key, re-run enrichment, banner clears on next render.
  if (config.companiesHouse.enabled) {
    const row = db
      .prepare(
        `SELECT reason, fetched_at FROM registry_enrichments
          WHERE outcome = 'error'
          ORDER BY fetched_at DESC
          LIMIT 1`,
      )
      .get() as { reason: string; fetched_at: string } | undefined;
    if (row && /401|403|auth/i.test(row.reason)) {
      banners.push({
        code: 'companies_house_auth',
        level: 'critical',
        title: 'Companies House key is invalid or unauthorized',
        body: 'Regenerate a REST API key (not a stream key) at developer.company-information.service.gov.uk, set it in .env.local, and restart the app.',
        helpHref: 'https://developer.company-information.service.gov.uk/',
      });
    }
  }

  return banners;
}
