import type { RawLead, SourceConnector, SourceFetchOptions } from '../types/index';

// Placeholder for Product Hunt new-launch scraping. The Product Hunt API
// requires an OAuth token; do not commit credentials when implementing.
export const productHuntSource: SourceConnector = {
  name: 'product_hunt',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<RawLead[]> {
    throw new Error('productHuntSource is not implemented yet (Phase 2).');
  },
};
