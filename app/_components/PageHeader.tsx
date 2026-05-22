// Shared page header — consistent h1 + subtitle + optional stat strip
// pattern used by every operational page. Keeps page files terse.

import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  // Optional right-aligned actions / stats area.
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle && <div className="topbar-stats">{subtitle}</div>}
      </div>
      {right && <div className="topbar-right">{right}</div>}
    </header>
  );
}
