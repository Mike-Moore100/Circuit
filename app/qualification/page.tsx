// Qualification — middle of the funnel. Inspection + contact discovery +
// evidence stats roll up here so the operator sees the cost-per-lead
// side of the system in one place.

import { PageHeader } from '../_components/PageHeader';
import { StatStrip } from '../_components/StatStrip';
import { getQualificationPageData } from '../_lib/pageData';

export const dynamic = 'force-dynamic';

export default async function QualificationPage() {
  const { inspection, contacts, evidence, qualification } = getQualificationPageData();
  const inspOk = Math.max(0, inspection.inspected - inspection.failed);
  const inspPct =
    inspection.inspected > 0 ? Math.round((inspOk / inspection.inspected) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Qualification"
        subtitle="Inspection · contacts · evidence. The expensive middle of the funnel — runs only on promoted candidates."
      />

      <section className="section">
        <StatStrip
          items={[
            {
              label: 'Inspected',
              value: `${inspOk}/${inspection.inspected || 0}`,
              foot: `${inspPct}% ok · ${inspection.failed} failed`,
              tone: 'accent',
            },
            {
              label: 'Contacts found',
              value: contacts.total,
              foot: `${contacts.extractedEmail} extracted email · ${contacts.guessedEmail} guessed`,
            },
            {
              label: 'Evidence captures',
              value: evidence.companies,
              foot: `${evidence.desktopShots} desktop · ${evidence.mobileShots} mobile screenshots`,
            },
            {
              label: 'Queue pending',
              value: qualification.byStatus.PENDING ?? 0,
              foot: `${qualification.byStatus.PROCESSING ?? 0} processing now`,
              tone: (qualification.byStatus.PENDING ?? 0) > 50 ? 'warning' : 'default',
            },
          ]}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Inspection results</h2>
        <div className="panel">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Working website</td><td className="num">{inspection.working ?? 0}</td></tr>
              <tr><td>Failed to load</td><td className="num">{inspection.failed}</td></tr>
              <tr><td>Has contact form</td><td className="num">{inspection.withContactForm ?? 0}</td></tr>
              <tr><td>Has booking link</td><td className="num">{inspection.withBookingLink ?? 0}</td></tr>
              <tr><td>Mentions AI / automation</td><td className="num">{inspection.aiProvider ?? 0}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Contact discovery</h2>
        <div className="panel">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Total contacts</td><td className="num">{contacts.total}</td></tr>
              <tr><td>With email</td><td className="num">{contacts.withEmail}</td></tr>
              <tr><td>Extracted (direct)</td><td className="num">{contacts.extractedEmail}</td></tr>
              <tr><td>Pattern-guessed</td><td className="num">{contacts.guessedEmail}</td></tr>
              <tr><td>From Playwright fallback</td><td className="num">{contacts.playwrightContacts}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Evidence extraction</h2>
        <div className="panel">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Companies with evidence</td><td className="num">{evidence.companies}</td></tr>
              <tr><td>Desktop screenshots</td><td className="num">{evidence.desktopShots}</td></tr>
              <tr><td>Mobile screenshots</td><td className="num">{evidence.mobileShots}</td></tr>
              <tr><td>Visual issues detected</td><td className="num">{evidence.visualIssues}</td></tr>
              <tr><td>Operational clues detected</td><td className="num">{evidence.operationalClues}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
