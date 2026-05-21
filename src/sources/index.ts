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

// Registry of available connectors. `mock` and `google_maps` are live;
// the rest are placeholders to be implemented in later phases.
export const sourceRegistry: Record<string, SourceConnector> = {
  mock: mockSourceConnector,
  google_maps: googleMapsSource,
  product_hunt: productHuntSource,
  job_board: jobBoardSource,
  linkedin_assisted: linkedinAssistedSource,
};

// `npm run pipeline` runs only the mock source by default to avoid burning
// API quota unintentionally. Use `npm run pipeline:google-maps` for the live
// source.
export const activeSources: SourceConnector[] = [mockSourceConnector];
