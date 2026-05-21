import type {
  SourceConnector,
  SourceFetchOptions,
  SourceFetchResult,
} from '../types/index';

// Placeholder. Job posts are a strong intent signal for ops/automation work.
// Future phase should target Indeed/Workable/AngelList for SMB hiring.
export const jobBoardSource: SourceConnector = {
  name: 'job_board',
  async fetchLeads(_options: SourceFetchOptions = {}): Promise<SourceFetchResult> {
    return {
      leads: [],
      apiCalls: 0,
      errors: ['jobBoardSource is not implemented yet.'],
    };
  },
};
