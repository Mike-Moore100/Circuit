// Compact registry status pill for opportunity cards / tables. Maps
// the enrichment outcome (plus optional company status) to a one-word
// label + colour. The drawer carries the full detail.

import type { RegistryRowSummary } from '../_lib/dashboardData';

export interface RegistryBadgeInfo {
  // Short label rendered on the pill.
  label: string;
  // Colour tone — drives the CSS class.
  tone: 'idle' | 'ok' | 'warn' | 'err' | 'muted';
  // Tooltip text — fuller explanation for hover.
  title: string;
  // The canonical outcome key — used by the filter.
  filterKey: 'enriched' | 'missing' | 'error' | 'non_uk' | 'no_match' | 'not_configured' | 'not_checked';
}

export function registryBadgeFor(reg: RegistryRowSummary | null | undefined): RegistryBadgeInfo {
  if (!reg) {
    return {
      label: 'Not checked',
      tone: 'idle',
      title: 'No Companies House lookup has run for this lead yet.',
      filterKey: 'not_checked',
    };
  }
  switch (reg.outcome) {
    case 'enriched':
    case 'skipped_cache_hit_fresh': {
      const status = (reg.status ?? '').toLowerCase();
      // Dissolved / liquidation / administration are real signals an
      // operator must see at-a-glance.
      if (status === 'dissolved') {
        return {
          label: 'Dissolved',
          tone: 'err',
          title: 'Companies House shows this company as dissolved.',
          filterKey: 'enriched',
        };
      }
      if (status === 'liquidation' || status === 'administration') {
        return {
          label: status === 'liquidation' ? 'Liquidation' : 'Administration',
          tone: 'warn',
          title: `Companies House shows this company in ${status}.`,
          filterKey: 'enriched',
        };
      }
      if (status === 'active') {
        const age = reg.ageYears !== null ? ` · ${reg.ageYears}y` : '';
        return {
          label: `Active${age}`,
          tone: 'ok',
          title: `Active on the UK register${
            reg.confidence ? ` · ${reg.confidence} confidence` : ''
          }.`,
          filterKey: 'enriched',
        };
      }
      return {
        label: reg.status ?? 'Match',
        tone: 'muted',
        title: 'Companies House record present.',
        filterKey: 'enriched',
      };
    }
    case 'skipped_non_uk':
      return {
        label: 'Non-UK',
        tone: 'muted',
        title: 'Skipped — lead is not UK-shaped. Force-run from the drawer if needed.',
        filterKey: 'non_uk',
      };
    case 'skipped_no_match':
      return {
        label: 'No match',
        tone: 'warn',
        title: 'Companies House search returned no match for this name.',
        filterKey: 'no_match',
      };
    case 'skipped_no_key':
    case 'skipped_disabled':
      return {
        label: 'Not configured',
        tone: 'warn',
        title: 'Companies House is not configured — set the API key in .env.local.',
        filterKey: 'not_configured',
      };
    case 'error':
      return {
        label: 'Error',
        tone: 'err',
        title: 'Companies House lookup failed — see the drawer for details.',
        filterKey: 'error',
      };
    default:
      return {
        label: reg.outcome,
        tone: 'muted',
        title: reg.outcome,
        filterKey: 'not_checked',
      };
  }
}

interface Props {
  registry: RegistryRowSummary | null | undefined;
  // When true, render compact form (no label icon, smaller padding).
  // Default = full.
  size?: 'sm' | 'md';
}

export function RegistryBadge({ registry, size = 'sm' }: Props) {
  const info = registryBadgeFor(registry);
  return (
    <span
      className={`registry-badge registry-badge-${info.tone} registry-badge-${size}`}
      title={info.title}
      data-registry-state={info.filterKey}
    >
      {info.label}
    </span>
  );
}
