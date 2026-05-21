import type {
  SourceConnector,
  SourceFetchOptions,
  SourceFetchResult,
} from '../types/index';

// Placeholder for Product Hunt new-launch scraping. The Product Hunt API
// requires an OAuth token; do not commit credentials when implementing.
export const productHuntSource: SourceConnector = {
  name: 'product_hunt',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<SourceFetchResult> {
    return {
      leads: [],
      apiCalls: 0,
      errors: ['productHuntSource is not implemented yet.'],
    };
  },
};
