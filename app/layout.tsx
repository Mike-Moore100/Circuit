import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Sidebar } from './_components/Sidebar';
import { SystemStatusBanners } from './_components/SystemStatusBanners';
import { SectionSubNav } from './_components/SectionSubNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Circuit — Lead Intelligence',
  description: 'Internal monitoring dashboard for the Circuit lead sourcing pipeline.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <Sidebar />
          <main className="app-main">
            <SystemStatusBanners />
            {/* SectionSubNav uses useSearchParams which Next requires
               to be wrapped in Suspense at the layout level. */}
            <Suspense fallback={null}>
              <SectionSubNav />
            </Suspense>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
