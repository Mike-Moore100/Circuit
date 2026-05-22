// Single source of truth for top-level navigation.
//
// Three operator-intent groups (Opportunities / Pipeline /
// Intelligence) — and Settings as a low-key footer item. Sub-tabs
// inside each group map to the existing routes + query strings so
// the URL contract stays stable while the sidebar simplifies.
//
// Match rules (currentGroup / matchTab below):
//   - A path is "in" a group when it's listed in the group's
//     matchPaths array, OR when one of its tabs has that exact
//     (path, query) signature.
//   - Settings sits outside the group system — clicking it leaves
//     the group context, the sub-nav strip hides.

export type NavGroupKey = 'opportunities' | 'pipeline' | 'intelligence';

export interface NavTab {
  label: string;
  href: string;
  // Optional ?key=value the tab considers "its own" — used to flag
  // the active tab when multiple tabs share the same base path.
  matchQuery?: Record<string, string>;
  // When true, the tab is active only when matchQuery is absent on
  // the current URL. Used by the "All" tab on Opportunities.
  matchNoQuery?: boolean;
}

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  // Where clicking the top-level sidebar item lands.
  href: string;
  // Paths that count as "inside this group" for sidebar highlighting.
  // The check is path-prefix, not exact — `/opportunities/foo` still
  // counts as Opportunities.
  matchPaths: string[];
  tabs: NavTab[];
  // One-line subtitle shown when this group is active — sets the
  // operator's expectations for the surface they just opened.
  subtitle: string;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'opportunities',
    label: 'Opportunities',
    href: '/opportunities',
    matchPaths: ['/opportunities', '/review', '/campaigns'],
    subtitle: 'Ranked commercial leads. Tabs filter by campaign.',
    tabs: [
      { label: 'All Opportunities', href: '/opportunities', matchNoQuery: true },
      {
        label: 'AI Automation',
        href: '/opportunities?campaign=AI_AUTOMATION',
        matchQuery: { campaign: 'AI_AUTOMATION' },
      },
      {
        label: 'Web Rebuild',
        href: '/opportunities?campaign=WEB_REBUILD',
        matchQuery: { campaign: 'WEB_REBUILD' },
      },
      {
        label: 'Funnel Optimization',
        href: '/opportunities?campaign=FUNNEL_OPTIMIZATION',
        matchQuery: { campaign: 'FUNNEL_OPTIMIZATION' },
      },
      {
        label: 'Nurture',
        href: '/opportunities?campaign=LOW_PRIORITY_NURTURE',
        matchQuery: { campaign: 'LOW_PRIORITY_NURTURE' },
      },
      { label: 'Review Queue', href: '/review' },
    ],
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    href: '/discovery',
    matchPaths: ['/discovery', '/qualification', '/queue', '/sources'],
    subtitle: 'Top-of-funnel throughput + qualification flow.',
    tabs: [
      { label: 'Discovery', href: '/discovery' },
      { label: 'Qualification', href: '/qualification' },
      { label: 'Queue Health', href: '/queue' },
      { label: 'Sources', href: '/sources' },
      { label: 'Failures', href: '/queue?status=failed', matchQuery: { status: 'failed' } },
    ],
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    href: '/intelligence',
    matchPaths: ['/intelligence', '/calibration', '/validation'],
    subtitle: 'Scoring, calibration, and corpus quality.',
    tabs: [
      { label: 'Calibration', href: '/calibration' },
      { label: 'Patterns', href: '/intelligence' },
      // Corpus health currently lives on /discovery — keep linking to
      // it from Intelligence too via a hash anchor so the operator
      // can reach it from either side of the IA.
      { label: 'Corpus Health', href: '/discovery#corpus-health' },
      { label: 'Validation', href: '/validation' },
      // Signal performance lives on /calibration; the operator can
      // jump straight to that section via a hash.
      { label: 'Signal Performance', href: '/calibration#signal-performance' },
    ],
  },
];

// Returns the active group for a given pathname, or null when the
// path doesn't belong to any group (e.g. `/`, `/settings`).
export function currentGroup(pathname: string): NavGroup | null {
  for (const group of NAV_GROUPS) {
    for (const p of group.matchPaths) {
      if (pathname === p || pathname.startsWith(`${p}/`)) return group;
    }
  }
  return null;
}

// Returns the active tab for a given (pathname, search params)
// combination within a group. Returns null if no tab matches.
export function matchTab(
  group: NavGroup,
  pathname: string,
  searchParams: URLSearchParams,
): NavTab | null {
  // Strip the hash for the path compare (URLSearchParams already
  // excludes them, so this is mostly defensive).
  const path = pathname.split('#')[0];
  // First pass — exact (path, query) match.
  for (const tab of group.tabs) {
    const tabUrl = new URL(tab.href, 'http://x');
    if (tabUrl.pathname !== path) continue;
    if (tab.matchQuery) {
      const matches = Object.entries(tab.matchQuery).every(
        ([k, v]) => searchParams.get(k) === v,
      );
      if (matches) return tab;
      continue;
    }
    if (tab.matchNoQuery) {
      const meaningfulKeys = ['campaign', 'top', 'registry', 'status'];
      const hasMeaningfulKey = meaningfulKeys.some((k) => searchParams.has(k));
      if (!hasMeaningfulKey) return tab;
      continue;
    }
    // No matcher specified — the tab is on this path with no special
    // query requirements; consider it matching only when nothing more
    // specific has matched.
  }
  // Second pass — first tab whose path matches even if the query
  // doesn't (so a tab without any matcher still picks up the route).
  for (const tab of group.tabs) {
    const tabUrl = new URL(tab.href, 'http://x');
    if (tabUrl.pathname !== path) continue;
    if (!tab.matchQuery && !tab.matchNoQuery) return tab;
  }
  return null;
}
