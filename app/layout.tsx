import type { Metadata } from 'next';
import { Sidebar } from './_components/Sidebar';
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
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
