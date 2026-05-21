import type { RawLead, SourceConnector, SourceFetchOptions } from '../types/index';

// Placeholder. Job posts are a strong intent signal for ops/automation work.
// Phase 2 should target Indeed/Workable/AngelList for SMB hiring.
export const jobBoardSource: SourceConnector = {
  name: 'job_board',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<RawLead[]> {
    throw new Error('jobBoardSource is not implemented yet (Phase 2).');
  },
};
