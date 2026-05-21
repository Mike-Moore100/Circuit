import type {
  PlaceCandidate,
  PlacesProvider,
  PlacesProviderSearchParams,
  PlacesProviderSearchResult,
} from './types';

// Places API (New) — Text Search endpoint. We rely on a field mask to only
// pull what we actually need, which keeps each request on the cheaper SKU.
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.types',
  'places.businessStatus',
].join(',');

// Loose shape — Google's response may omit any of these per record.
interface GooglePlacesResponseShape {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    rating?: number;
    userRatingCount?: number;
    types?: string[];
    businessStatus?: string;
  }>;
}

export interface GooglePlacesProviderOptions {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createGooglePlacesProvider(
  options: GooglePlacesProviderOptions,
): PlacesProvider {
  const { apiKey, timeoutMs = 15000, fetchImpl = fetch } = options;
  if (!apiKey) {
    throw new Error('createGooglePlacesProvider: apiKey is required');
  }

  return {
    name: 'google_places',
    async search(params: PlacesProviderSearchParams): Promise<PlacesProviderSearchResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Compose "<query> in <location>" — Google handles this idiomatically.
      const textQuery = `${params.query} in ${params.location}`.trim();

      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: Math.min(20, Math.max(1, params.maxResults)),
            languageCode: 'en',
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `Places API responded ${response.status}: ${body.slice(0, 240)}`,
          );
        }

        const data = (await response.json()) as GooglePlacesResponseShape;
        const places: PlaceCandidate[] = (data.places ?? []).map((p) => ({
          placeId: p.id ?? '',
          name: p.displayName?.text ?? '',
          websiteUrl: p.websiteUri ?? null,
          formattedAddress: p.formattedAddress ?? null,
          googleMapsUrl: p.googleMapsUri ?? null,
          phoneNumber: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          userRatingCount:
            typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
          types: p.types ?? [],
          businessStatus: p.businessStatus ?? null,
        }));

        return { places, apiCalls: 1 };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
