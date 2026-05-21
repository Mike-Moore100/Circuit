import type {
  SourceConnector,
  SourceFetchOptions,
  SourceFetchResult,
} from '../types/index';

// Placeholder. "Assisted" means human-in-the-loop ingestion (e.g. operator
// pastes a saved Sales Navigator URL set), NOT unauthenticated scraping.
export const linkedinAssistedSource: SourceConnector = {
  name: 'linkedin_assisted',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<SourceFetchResult> {
    return {
      leads: [],
      apiCalls: 0,
      errors: [
        'linkedinAssistedSource is not implemented yet. Keep this human-assisted to stay within LinkedIn ToS.',
      ],
    };
  },
};
