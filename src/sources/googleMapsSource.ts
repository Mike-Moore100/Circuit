import type { RawLead, SourceConnector, SourceFetchOptions } from '../types/index';

// Placeholder. Live implementation belongs in Phase 2 and should use the
// official Google Places API (or a paid wrapper) with a strict cost ceiling.
export const googleMapsSource: SourceConnector = {
  name: 'google_maps',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<RawLead[]> {
    throw new Error(
      'googleMapsSource is not implemented yet. Wire this up in Phase 2 with a strict daily quota.',
    );
  },
};
