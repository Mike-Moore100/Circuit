import type { SourceConnector } from '../types/index';
import { config } from '../config/index';
import { mockSourceConnector } from './mockSourceConnector';
import { googleMapsSource } from './googleMapsSource';
import { productHuntSource } from './productHuntSource';
import { jobBoardSource } from './jobBoardSource';
import { linkedinAssistedSource } from './linkedinAssistedSource';

// Sources known to use paid APIs. FREE_SOURCE_MODE=1 suppresses these
// from any caller that asks for "free-tier-only" discovery.
const PAID_SOURCES = new Set(['google_maps']);

export function isFreeSource(connector: SourceConnector): boolean {
  return !PAID_SOURCES.has(connector.name);
}

export function freeSources(): SourceConnector[] {
  return [
    mockSourceConnector,
    productHuntSource,
    jobBoardSource,
    linkedinAssistedSource,
  ];
}

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
// source. If FREE_SOURCE_MODE=1, the mock is also the default (paid sources
// would be skipped anyway).
export const activeSources: SourceConnector[] = config.freeSourceMode
  ? freeSources()
  : [mockSourceConnector];
