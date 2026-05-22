import type {
  RawLead,
  SourceConnector,
  SourceFetchOptions,
  SourceFetchResult,
} from '../types/index';

// Realistic-looking mock leads covering the ICP, edge cases, and clear bad fits.
// Every lead carries enough signal for the rule filter and intent scorer to
// produce explainable scores.
export const MOCK_LEADS: RawLead[] = [
  // ---- Strong fits ------------------------------------------------------
  {
    companyName: 'Northbeam Talent',
    websiteUrl: 'https://northbeamtalent.com',
    industry: 'recruitment agency',
    location: 'Manchester, UK',
    sizeEstimate: 12,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/northbeam-talent',
    contactName: 'Sara Mahmood',
    contactRole: 'Co-Founder',
    contactEmail: 'sara@northbeamtalent.com',
    linkedinUrl: 'https://linkedin.com/in/sara-mahmood-recruit',
    notes: 'Specialist tech recruitment; manual sourcing on spreadsheets.',
    signals: [
      { type: 'workflow', value: 'manual data entry', confidence: 80 },
      { type: 'workflow', value: 'spreadsheets', confidence: 90 },
      { type: 'intent', value: 'contact form', confidence: 95 },
      { type: 'intent', value: 'book a call', confidence: 75 },
      { type: 'team', value: 'founder reachable', confidence: 90 },
    ],
  },
  {
    companyName: 'Lumen & Co Marketing',
    websiteUrl: 'https://lumenand.co',
    industry: 'marketing agency',
    location: 'Austin, TX',
    sizeEstimate: 18,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/lumen-co',
    contactName: 'Daniel Reyes',
    contactRole: 'Founder & CEO',
    contactEmail: 'daniel@lumenand.co',
    linkedinUrl: 'https://linkedin.com/in/danielreyes-lumen',
    notes: 'Full-service performance marketing; client reporting cadence weekly.',
    signals: [
      { type: 'workflow', value: 'reporting cadence', confidence: 85 },
      { type: 'workflow', value: 'admin overhead', confidence: 70 },
      { type: 'intent', value: 'demo request', confidence: 65 },
      { type: 'intent', value: 'lead capture form', confidence: 90 },
      { type: 'team', value: 'founder reachable', confidence: 95 },
    ],
  },
  {
    companyName: 'Cedar & Quill Bookkeeping',
    websiteUrl: 'https://cedarquill.com',
    industry: 'accounting',
    location: 'Toronto, ON',
    sizeEstimate: 8,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/cedar-quill',
    contactName: 'Priya Bhatt',
    contactRole: 'Owner',
    contactEmail: 'priya@cedarquill.com',
    linkedinUrl: 'https://linkedin.com/in/priya-bhatt-bookkeeper',
    notes: 'Small bookkeeping practice; heavy month-end close workload.',
    signals: [
      { type: 'workflow', value: 'manual data entry', confidence: 95 },
      { type: 'workflow', value: 'invoicing', confidence: 85 },
      { type: 'workflow', value: 'onboarding workflow', confidence: 70 },
      { type: 'intent', value: 'contact form', confidence: 80 },
      { type: 'team', value: 'founder reachable', confidence: 92 },
    ],
  },
  {
    companyName: 'Harborline Property Group',
    websiteUrl: 'https://harborlineproperty.com',
    industry: 'real estate',
    location: 'Brighton, UK',
    sizeEstimate: 22,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/harborline',
    contactName: 'Tom Ainsworth',
    contactRole: 'Managing Director',
    contactEmail: 'tom@harborlineproperty.com',
    linkedinUrl: 'https://linkedin.com/in/tom-ainsworth',
    notes: 'Residential lettings; lead intake from Rightmove/Zoopla.',
    signals: [
      { type: 'workflow', value: 'lead intake', confidence: 90 },
      { type: 'workflow', value: 'scheduling', confidence: 75 },
      { type: 'workflow', value: 'customer support volume', confidence: 70 },
      { type: 'intent', value: 'lead capture form', confidence: 85 },
      { type: 'team', value: 'founder reachable', confidence: 80 },
    ],
  },
  {
    companyName: 'Inkstream',
    websiteUrl: 'https://inkstream.io',
    industry: 'saas',
    location: 'Remote',
    sizeEstimate: 11,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/inkstream',
    contactName: 'Maya Okafor',
    contactRole: 'Founder',
    contactEmail: 'maya@inkstream.io',
    linkedinUrl: 'https://linkedin.com/in/maya-okafor',
    notes: 'B2B publishing workflow SaaS; small support team buried in tickets.',
    signals: [
      { type: 'workflow', value: 'customer support volume', confidence: 90 },
      { type: 'workflow', value: 'admin overhead', confidence: 65 },
      { type: 'intent', value: 'pricing page', confidence: 80 },
      { type: 'intent', value: 'demo request', confidence: 70 },
      { type: 'team', value: 'founder reachable', confidence: 92 },
    ],
  },
  {
    companyName: 'Boulder Bench Co',
    websiteUrl: 'https://boulderbench.com',
    industry: 'ecommerce',
    location: 'Denver, CO',
    sizeEstimate: 14,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/boulder-bench',
    contactName: 'Alex Park',
    contactRole: 'Owner',
    contactEmail: 'alex@boulderbench.com',
    linkedinUrl: 'https://linkedin.com/in/alex-park-boulder',
    notes: 'Outdoor furniture DTC brand; heavy returns + warranty support.',
    signals: [
      { type: 'workflow', value: 'customer support volume', confidence: 95 },
      { type: 'workflow', value: 'admin overhead', confidence: 85 },
      { type: 'workflow', value: 'reporting cadence', confidence: 60 },
      { type: 'intent', value: 'newsletter signup', confidence: 75 },
      { type: 'intent', value: 'contact form', confidence: 85 },
      { type: 'team', value: 'founder reachable', confidence: 85 },
    ],
  },
  // ---- Phase 6 — campaign-routing fixtures (NOT auto-reject) -----------
  {
    companyName: 'Northshore Plumbing',
    websiteUrl: null,
    industry: 'local services',
    location: 'Brighton, UK',
    sizeEstimate: 6,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/northshore-plumbing',
    contactName: 'Pete Marshall',
    contactRole: 'Owner',
    contactEmail: 'pete@northshore-plumbing.example',
    linkedinUrl: null,
    notes: 'Small plumbing service; takes calls but no website yet.',
    signals: [
      { type: 'industry', value: 'local services', confidence: 90 },
      { type: 'team', value: 'founder reachable', confidence: 95 },
      { type: 'workflow', value: 'scheduling', confidence: 70 },
    ],
  },
  {
    companyName: 'Riverwood Hair Salon',
    websiteUrl: 'https://riverwood-hair.example',
    industry: 'local services',
    location: 'Leeds, UK',
    sizeEstimate: 9,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/riverwood',
    contactName: 'Mia Chen',
    contactRole: 'Owner',
    contactEmail: 'mia@riverwood-hair.example',
    linkedinUrl: null,
    notes: 'Hair salon with a broken homepage; appointments handled via phone.',
    signals: [
      { type: 'industry', value: 'local services', confidence: 90 },
      { type: 'team', value: 'founder reachable', confidence: 92 },
      // Pretend inspection already happened so the classifier sees the
      // verified failure signal without needing a real fetch.
      { type: 'verified.website_failed', value: 'fetch failed', confidence: 95 },
    ],
  },

  // ---- Borderline cases -------------------------------------------------
  {
    companyName: 'Greenhill Legal',
    websiteUrl: 'https://greenhill-legal.co.uk',
    industry: 'legal',
    location: 'London, UK',
    sizeEstimate: 35,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/greenhill-legal',
    contactName: 'Helena Ward',
    contactRole: 'Partner',
    contactEmail: 'helena.ward@greenhill-legal.co.uk',
    linkedinUrl: 'https://linkedin.com/in/helena-ward-legal',
    notes: 'Mid-size firm; some compliance constraints around client data.',
    signals: [
      { type: 'workflow', value: 'manual data entry', confidence: 70 },
      { type: 'workflow', value: 'admin overhead', confidence: 75 },
      { type: 'risk', value: 'heavy compliance', confidence: 85 },
      { type: 'intent', value: 'contact form', confidence: 70 },
    ],
  },
  // ---- Bad fits ---------------------------------------------------------
  {
    companyName: 'La Tavola Rossa',
    websiteUrl: 'https://latavolarossa.com',
    industry: 'restaurant',
    location: 'Brooklyn, NY',
    sizeEstimate: 16,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/la-tavola',
    contactName: 'Gianni Russo',
    contactRole: 'Owner',
    contactEmail: 'gianni@latavolarossa.com',
    linkedinUrl: null,
    notes: 'Family-run trattoria; reservations via OpenTable.',
    signals: [
      { type: 'industry', value: 'restaurant', confidence: 99 },
      { type: 'intent', value: 'book a table', confidence: 80 },
    ],
  },
  {
    companyName: 'Hyperion Cloud Systems',
    websiteUrl: 'https://hyperioncloud.com',
    industry: 'enterprise software',
    location: 'San Francisco, CA',
    sizeEstimate: 4200,
    source: 'mock',
    sourceUrl: 'https://example.com/listings/hyperion-cloud',
    contactName: 'Karen Liu',
    contactRole: 'VP of Engineering',
    contactEmail: 'karen.liu@hyperioncloud.com',
    linkedinUrl: 'https://linkedin.com/in/karen-liu-vp',
    notes: 'Large enterprise SaaS with an internal platform team.',
    signals: [
      { type: 'size', value: 'enterprise', confidence: 99 },
      { type: 'team', value: 'internal automation team', confidence: 95 },
      { type: 'industry', value: 'enterprise software', confidence: 90 },
    ],
  },
  {
    companyName: 'pixeldoodle',
    websiteUrl: null,
    industry: null,
    location: 'GitHub',
    sizeEstimate: 1,
    source: 'mock',
    sourceUrl: 'https://github.com/example/pixeldoodle',
    contactName: 'Jordan Lee',
    contactRole: 'Maintainer',
    contactEmail: null,
    linkedinUrl: null,
    notes: 'Solo open-source experiment; no commercial intent.',
    signals: [
      { type: 'project', value: 'hobby project', confidence: 95 },
      { type: 'commercial', value: 'no commercial intent', confidence: 90 },
    ],
  },
];

export const mockSourceConnector: SourceConnector = {
  name: 'mock',
  // Phase 14.1 — mock data is DEMO-origin. Companies inserted via this
  // connector are filtered out of REAL-mode dashboard views.
  dataOrigin: 'DEMO',
  async fetchLeads(options: SourceFetchOptions = {}): Promise<SourceFetchResult> {
    let leads = MOCK_LEADS.slice();
    if (options.industry) {
      const q = options.industry.toLowerCase();
      leads = leads.filter((l) => (l.industry ?? '').toLowerCase().includes(q));
    }
    if (options.location) {
      const q = options.location.toLowerCase();
      leads = leads.filter((l) => (l.location ?? '').toLowerCase().includes(q));
    }
    if (options.limit) leads = leads.slice(0, options.limit);
    return { leads, apiCalls: 0, errors: [], params: options as Record<string, unknown> };
  },
};
