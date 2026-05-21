import type { RawLead, SourceConnector, SourceFetchOptions } from '../types/index';

// Placeholder. "Assisted" means human-in-the-loop ingestion (e.g. operator
// pastes a saved Sales Navigator URL set), NOT unauthenticated scraping.
export const linkedinAssistedSource: SourceConnector = {
  name: 'linkedin_assisted',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<RawLead[]> {
    throw new Error(
      'linkedinAssistedSource is not implemented yet (Phase 2). Keep this human-assisted to stay within LinkedIn ToS.',
    );
  },
};
