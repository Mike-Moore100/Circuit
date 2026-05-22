// Overview — the one-glance read of the pipeline. Three stages, one
// bottleneck callout (if any), one strip of recent activity. Everything
// else lives on its own dedicated page.

import Link from 'next/link';
import { PageHeader } from './_components/PageHeader';
import { PipelineFlow } from './_components/PipelineFlow';
import { RealModeEmpty } from './_components/RealModeEmpty';
import { getOverviewData } from './_lib/pageData';
import { getDb } from '../src/db/client';
import { currentDataMode } from '../src/db/dataMode';

export const dynamic = 'force-dynamic';

interface ActivityEvent {
  when: string;
  kind: 'discovery' | 'qualification' | 'review' | 'failure';
  message: string;
}

function recentActivity(): ActivityEvent[] {
  const db = getDb();
  const events: ActivityEvent[] = [];

  // Most recent discovery run
  const lastDiscovery = db
    .prepare(
      `SELECT source, completed_at, valid_domains, raw_found FROM discovery_runs
       WHERE completed_at IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as
    | { source: string; completed_at: string; valid_domains: number; raw_found: number }
    | undefined;
  if (lastDiscovery) {
    events.push({
      when: lastDiscovery.completed_at,
      kind: 'discovery',
      message: `Discovery run — ${lastDiscovery.valid_domains} valid of ${lastDiscovery.raw_found} raw (${lastDiscovery.source})`,
    });
  }

  // Most recent qualification queue transition
  const lastQual = db
    .prepare(
      `SELECT status, domain, updated_at FROM qualification_queue
       WHERE status IN ('PROMOTED','FAILED')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get() as { status: string; domain: string; updated_at: string } | undefined;
  if (lastQual) {
    events.push({
      when: lastQual.updated_at,
      kind: lastQual.status === 'FAILED' ? 'failure' : 'qualification',
      message: `${lastQual.domain} — qualification ${lastQual.status.toLowerCase()}`,
    });
  }

  // Most recent reviewer feedback
  const lastReview = db
    .prepare(
      `SELECT lr.review_type, c.name, lr.created_at
       FROM lead_reviews lr JOIN companies c ON c.id = lr.company_id
       ORDER BY lr.created_at DESC LIMIT 1`,
    )
    .get() as { review_type: string; name: string; created_at: string } | undefined;
  if (lastReview) {
    events.push({
      when: lastReview.created_at,
      kind: 'review',
      message: `${lastReview.name} — operator marked "${lastReview.review_type.replace(/_/g, ' ')}"`,
    });
  }

  return events.sort((a, b) => b.when.localeCompare(a.when)).slice(0, 5);
}

function bottleneck(data: ReturnType<typeof getOverviewData>): {
  message: string;
  href: string;
} | null {
  const pending = data.qualification.byStatus.PENDING ?? 0;
  const failed = data.qualification.byStatus.FAILED ?? 0;
  if (failed > 0) {
    return {
      message: `${failed} qualification failure${failed === 1 ? '' : 's'} need investigation`,
      href: '/queue',
    };
  }
  if (pending > 30) {
    return {
      message: `${pending} domains waiting in the qualification queue`,
      href: '/queue',
    };
  }
  if (data.inspection.failed > 0 && data.inspection.failed > data.inspection.inspected / 2) {
    return {
      message: `${data.inspection.failed}/${data.inspection.inspected} inspections failing — source or network issue?`,
      href: '/qualification',
    };
  }
  return null;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function OverviewPage() {
  const data = getOverviewData();
  const pending = data.qualification.byStatus.PENDING ?? 0;
  const processing = data.qualification.byStatus.PROCESSING ?? 0;
  const failed = data.qualification.byStatus.FAILED ?? 0;
  const top = bottleneck(data);
  const activity = recentActivity();
  const mode = currentDataMode();

  // Real-mode + nothing in the system — show one clean empty state.
  if (mode === 'REAL' && data.totalCompanies === 0) {
    return (
      <>
        <PageHeader
          title="Overview"
          subtitle="Real mode — no demo data is being shown."
        />
        <section className="section">
          <RealModeEmpty />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${data.totalCompanies} companies · ${data.reviewQueue} in review queue · ${mode} mode`}
      />

      {/* ---- Pipeline flow — 3 core stages -------------------------- */}
      <section className="section">
        <PipelineFlow
          stages={[
            {
              href: '/discovery',
              label: 'Discovery',
              value: data.discovery.validToday,
              sub: `${data.discovery.domainsToday} raw / 24h`,
            },
            {
              href: '/qualification',
              label: 'Qualification',
              value: pending + processing > 0 ? pending + processing : 'idle',
              sub: `${pending} pending · ${processing} processing`,
              alert: failed > 0,
            },
            {
              href: '/opportunities',
              label: 'Opportunities',
              value: data.reviewQueue,
              sub: data.topOpps[0]
                ? `top: ${data.topOpps[0].opportunity_score}/100`
                : 'no scored leads yet',
            },
          ]}
        />
      </section>

      {/* ---- Bottleneck callout (only if there is one) ------------- */}
      {top && (
        <section className="section">
          <Link href={top.href} className="bottleneck-callout">
            <span className="bottleneck-icon" aria-hidden>
              !
            </span>
            <span className="bottleneck-text">{top.message}</span>
            <span className="bottleneck-arrow" aria-hidden>
              →
            </span>
          </Link>
        </section>
      )}

      {/* ---- Top opportunities (compact) --------------------------- */}
      {data.topOpps.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Top opportunities</h2>
            <Link href="/opportunities" className="section-link">
              See all →
            </Link>
          </div>
          <div className="panel">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Priority</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {data.topOpps.map((o) => (
                  <tr key={o.company_id}>
                    <td className="num">{o.opportunity_score}</td>
                    <td>
                      <span className={`attention-pill attention-${o.human_attention_priority}`}>
                        {o.human_attention_priority}
                      </span>
                    </td>
                    <td>{o.likely_project_type.replace(/_/g, ' ').toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Recent activity --------------------------------------- */}
      {activity.length > 0 && (
        <section className="section">
          <h2 className="section-title">Recent activity</h2>
          <ul className="activity-feed">
            {activity.map((e, i) => (
              <li key={i} className={`activity-item activity-${e.kind}`}>
                <span className="activity-when">{fmtRelative(e.when)}</span>
                <span className="activity-message">{e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
