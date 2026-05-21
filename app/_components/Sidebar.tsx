import { getDashboardData } from '../_lib/dashboardData';

// Inline minimal icon set so we don't pull in an icon library.
const icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  queue: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  sources: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
  inspect: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  rejected: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
};

interface NavItemProps {
  icon: keyof typeof icons;
  label: string;
  href: string;
  badge?: number | null;
  active?: boolean;
}

function NavItem({ icon, label, href, badge, active }: NavItemProps) {
  return (
    <a className={`nav-item${active ? ' nav-item-active' : ''}`} href={href}>
      <span className="nav-item-icon">{icons[icon]}</span>
      <span className="nav-item-label">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="nav-badge">{badge}</span>
      )}
    </a>
  );
}

export async function Sidebar() {
  const data = await getDashboardData().catch(() => null);
  const queueCount = data?.reviewQueue.length ?? 0;
  const rejectedCount = data?.rejected.length ?? 0;
  const sourcesCount = data ? new Set(data.sourceRuns.map((r) => r.source)).size : 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">C</div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">Circuit</div>
          <div className="sidebar-brand-sub">Lead intelligence</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Workspace</div>
        <nav className="nav-stack">
          <NavItem icon="dashboard" label="Overview" href="#overview" active />
          <NavItem
            icon="queue"
            label="Review queue"
            href="#review"
            badge={queueCount}
          />
          <NavItem icon="sources" label="Sources" href="#sources" badge={sourcesCount} />
          <NavItem icon="inspect" label="Inspection" href="#inspection" />
          <NavItem
            icon="rejected"
            label="Rejected"
            href="#rejected"
            badge={rejectedCount}
          />
        </nav>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">System</div>
        <nav className="nav-stack">
          <NavItem icon="settings" label="Settings" href="#settings" />
        </nav>
      </div>

      <div className="sidebar-foot">
        <div className="user-card">
          <div className="user-avatar">MM</div>
          <div className="user-text">
            <div className="user-name">Mike Moore</div>
            <div className="user-sub">Operator</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
