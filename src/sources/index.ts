import type { SourceConnector } from '../types/index';
import { mockSourceConnector } from './mockSourceConnector';
import { googleMapsSource } from './googleMapsSource';
import { productHuntSource } from './productHuntSource';
import { jobBoardSource } from './jobBoardSource';
import { linkedinAssistedSource } from './linkedinAssistedSource';

export { mockSourceConnector } from './mockSourceConnector';
export { googleMapsSource } from './googleMapsSource';
export { productHuntSource } from './productHuntSource';
export { jobBoardSource } from './jobBoardSource';
export { linkedinAssistedSource } from './linkedinAssistedSource';

// Registry of available connectors. Only `mock` is active in Phase 1.
export const sourceRegistry: Record<string, SourceConnector> = {
  mock: mockSourceConnector,
  google_maps: googleMapsSource,
  product_hunt: productHuntSource,
  job_board: jobBoardSource,
  linkedin_assisted: linkedinAssistedSource,
};

export const activeSources: SourceConnector[] = [mockSourceConnector];
