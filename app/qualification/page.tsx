// Qualification — mid-pipeline processing. One unified processing table
// instead of three separate ones. The operator wants to see "where is
// the funnel narrowing?" at a glance, not three duplicated stat strips.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getQualificationPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

export default async function QualificationPage() {
  const { inspection, contacts, evidence, qualification } = getQualificationPageData();
  const inspOk = Math.max(0, inspection.inspected - inspection.failed);
  const processing = qualification.byStatus.PROCESSING ?? 0;

  return (
    <>
      <PageHeader
        title="Qualification"
        subtitle="Promoted candidates flow through inspection · contacts · evidence. Mid-funnel."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Active now',
              value: processing > 0 ? processing : 'idle',
              foot: 'qualification in flight',
              tone: processing > 0 ? 'accent' : 'default',
            },
            {
              label: 'Inspection success',
              value: pct(inspOk, inspection.inspected),
              foot: `${inspOk} of ${inspection.inspected}`,
            },
            {
              label: 'Direct emails',
              value: contacts.extractedEmail,
              foot: `of ${contacts.total} contacts`,
            },
            {
              label: 'Evidence captures',
              value: evidence.companies,
              foot: `${evidence.desktopShots + evidence.mobileShots} screenshots`,
            },
          ]}
        />
      </section>

      {/* One unified stage table. Each row is a qualification stage; the
          numbers show how many leads completed that stage. Lets the
          operator see exactly where the funnel narrows. */}
      <section className="section">
        <h2 className="section-title">Stage status</h2>
        <div className="panel">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Completed</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Website inspection</strong></td>
                <td className="num">{inspOk}</td>
                <td>
                  {inspection.failed} failed · {inspection.withContactForm} with form ·{' '}
                  {inspection.withBookingLink} with booking
                </td>
              </tr>
              <tr>
                <td><strong>Contact discovery</strong></td>
                <td className="num">{contacts.total}</td>
                <td>
                  {contacts.extractedEmail} extracted · {contacts.guessedEmail} guessed ·{' '}
                  {contacts.playwrightContacts} via Playwright
                </td>
              </tr>
              <tr>
                <td><strong>Evidence extraction</strong></td>
                <td className="num">{evidence.companies}</td>
                <td>
                  {evidence.visualIssues} visual issues · {evidence.operationalClues} operational clues
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
