import { config } from '../config/index';
import type {
  RawLead,
  SourceConnector,
  SourceFetchOptions,
  SourceFetchResult,
  Signal,
} from '../types/index';
import { extractDomain } from '../db/repository';
import { createGooglePlacesProvider } from './providers/googlePlacesProvider';
import { mockPlacesProvider } from './providers/mockPlacesProvider';
import type { PlaceCandidate, PlacesProvider } from './providers/types';

// Default categories and locations come from the Phase 2 spec. We expose
// them so they can be overridden per-run via fetchLeads options without
// re-importing internals.
export const DEFAULT_CATEGORIES = [
  'recruitment agency',
  'marketing agency',
  'real estate agency',
  'accounting firm',
  'bookkeeping firm',
  'legal firm',
  'business consultant',
  'ecommerce agency',
  'web design agency',
] as const;

export const DEFAULT_LOCATIONS = [
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Bristol',
  'Liverpool',
  'Glasgow',
  'Edinburgh',
  'Cardiff',
  'Newcastle',
] as const;

export interface GoogleMapsRunOptions extends SourceFetchOptions {
  categories?: readonly string[];
  locations?: readonly string[];
  // Hard ceilings; default to the values from config (env-overridable).
  maxSearches?: number;
  maxResultsPerSearch?: number;
  maxLeads?: number;
}

export interface CreateGoogleMapsSourceOptions {
  provider?: PlacesProvider;
}

// Industry mapping → matches the `TARGET_INDUSTRIES` keywords used by the
// rule filter so leads sourced here land in the right scoring bucket.
const CATEGORY_TO_INDUSTRY: Record<string, string> = {
  'recruitment agency': 'recruitment',
  'marketing agency': 'marketing agency',
  'real estate agency': 'real estate',
  'accounting firm': 'accounting',
  'bookkeeping firm': 'bookkeeping',
  'legal firm': 'legal',
  'business consultant': 'consulting',
  'ecommerce agency': 'ecommerce',
  'web design agency': 'marketing',
};

function classifyIndustry(category: string): string {
  return CATEGORY_TO_INDUSTRY[category.toLowerCase()] ?? category.toLowerCase();
}

function buildSignals(place: PlaceCandidate, category: string): Signal[] {
  const signals: Signal[] = [
    { type: 'industry', value: classifyIndustry(category), confidence: 80 },
    { type: 'source', value: 'google_maps_listing', confidence: 90 },
  ];
  if (place.rating !== null) {
    signals.push({
      type: 'rating',
      value: `${place.rating.toFixed(1)} (${place.userRatingCount ?? 0} reviews)`,
      confidence: 70,
    });
  }
  if (place.userRatingCount !== null && place.userRatingCount >= 25) {
    signals.push({
      type: 'commercial',
      value: 'established review history',
      confidence: 75,
    });
  }
  if (place.phoneNumber) {
    signals.push({ type: 'contact', value: 'phone listed', confidence: 80 });
  }
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    signals.push({
      type: 'risk',
      value: `business status: ${place.businessStatus}`,
      confidence: 90,
    });
  }
  return signals;
}

function placeToRawLead(place: PlaceCandidate, category: string): RawLead {
  const notesParts: string[] = [`Google Maps category: ${category}.`];
  if (place.rating !== null) {
    notesParts.push(
      `Rating ${place.rating.toFixed(1)} from ${place.userRatingCount ?? 0} reviews.`,
    );
  }
  if (place.types.length > 0) {
    notesParts.push(`Types: ${place.types.slice(0, 5).join(', ')}.`);
  }

  return {
    companyName: place.name,
    websiteUrl: place.websiteUrl,
    industry: classifyIndustry(category),
    location: place.formattedAddress,
    sizeEstimate: null,
    source: 'google_maps',
    sourceUrl: place.googleMapsUrl,
    contactName: null,
    contactRole: null,
    contactEmail: null,
    linkedinUrl: null,
    notes: notesParts.join(' '),
    signals: buildSignals(place, category),
  };
}

// Pick the right provider:
//   - explicit override (used by tests)
//   - mock when forced via env
//   - mock when no API key (so the pipeline degrades gracefully)
//   - real Google Places provider otherwise
function defaultProvider(): { provider: PlacesProvider; usedMock: boolean; warning?: string } {
  const { apiKey, forceMock, requestTimeoutMs } = config.googleMaps;
  if (forceMock) {
    return {
      provider: mockPlacesProvider,
      usedMock: true,
      warning: 'GOOGLE_MAPS_FORCE_MOCK=1 — using mock places provider.',
    };
  }
  if (!apiKey) {
    return {
      provider: mockPlacesProvider,
      usedMock: true,
      warning:
        'GOOGLE_PLACES_API_KEY is not set — falling back to mock places provider. No live data will be fetched.',
    };
  }
  return {
    provider: createGooglePlacesProvider({ apiKey, timeoutMs: requestTimeoutMs }),
    usedMock: false,
  };
}

export function createGoogleMapsSource(
  opts: CreateGoogleMapsSourceOptions = {},
): SourceConnector {
  return {
    name: 'google_maps',
    async fetchLeads(rawOptions: SourceFetchOptions = {}): Promise<SourceFetchResult> {
      const options = rawOptions as GoogleMapsRunOptions;
      const categories = options.categories ?? DEFAULT_CATEGORIES;
      const locations = options.locations ?? DEFAULT_LOCATIONS;
      const maxSearches = options.maxSearches ?? config.googleMaps.maxSearchesPerRun;
      const maxResultsPerSearch =
        options.maxResultsPerSearch ?? config.googleMaps.maxResultsPerSearch;
      const maxLeads = options.maxLeads ?? config.googleMaps.maxLeadsPerRun;

      // Resolve provider. If the caller passed one, use that — otherwise
      // fall through to env-based selection.
      let provider: PlacesProvider;
      let providerWarning: string | undefined;
      if (opts.provider) {
        provider = opts.provider;
      } else {
        const selected = defaultProvider();
        provider = selected.provider;
        providerWarning = selected.warning;
      }

      // Build (category, location) query plan. Interleave so partial runs
      // still see breadth across cities.
      const queries: Array<{ category: string; location: string }> = [];
      const maxAxis = Math.max(categories.length, locations.length);
      for (let i = 0; i < maxAxis; i++) {
        for (let j = 0; j < Math.max(categories.length, locations.length); j++) {
          const category = categories[(i + j) % categories.length];
          const location = locations[j % locations.length];
          queries.push({ category, location });
        }
      }
      // De-duplicate query plan and trim to the search cap.
      const seenQuery = new Set<string>();
      const plan: Array<{ category: string; location: string }> = [];
      for (const q of queries) {
        const key = `${q.category}::${q.location}`;
        if (seenQuery.has(key)) continue;
        seenQuery.add(key);
        plan.push(q);
        if (plan.length >= maxSearches) break;
      }

      const errors: string[] = [];
      if (providerWarning) errors.push(providerWarning);

      // In-run dedupe: by place_id first (cheap), then by domain.
      const seenPlaceIds = new Set<string>();
      const seenDomains = new Set<string>();
      const leads: RawLead[] = [];
      let apiCalls = 0;

      for (const { category, location } of plan) {
        if (leads.length >= maxLeads) {
          errors.push(`Reached maxLeads (${maxLeads}); stopping early.`);
          break;
        }
        try {
          const result = await provider.search({
            query: category,
            location,
            maxResults: maxResultsPerSearch,
          });
          apiCalls += result.apiCalls;

          for (const place of result.places) {
            if (leads.length >= maxLeads) break;
            if (place.placeId && seenPlaceIds.has(place.placeId)) continue;
            if (place.placeId) seenPlaceIds.add(place.placeId);

            // Drop businesses without a website BEFORE deeper processing —
            // they can't be scored meaningfully in Phase 1's model.
            if (!place.websiteUrl) continue;

            const domain = extractDomain(place.websiteUrl);
            if (domain && seenDomains.has(domain)) continue;
            if (domain) seenDomains.add(domain);

            // Filter clearly inoperative businesses.
            if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;

            leads.push(placeToRawLead(place, category));
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err ?? 'unknown error');
          errors.push(`${category} / ${location}: ${message}`);
        }
      }

      return {
        leads,
        apiCalls,
        errors,
        params: {
          provider: provider.name,
          categories,
          locations,
          maxSearches,
          maxResultsPerSearch,
          maxLeads,
          plannedQueries: plan.length,
        },
      };
    },
  };
}

// Default-exported singleton uses env-selected provider.
export const googleMapsSource: SourceConnector = createGoogleMapsSource();
