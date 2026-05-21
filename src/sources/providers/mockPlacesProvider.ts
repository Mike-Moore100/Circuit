import type {
  PlaceCandidate,
  PlacesProvider,
  PlacesProviderSearchParams,
  PlacesProviderSearchResult,
} from './types';

// Deterministic fixture generator. Returns 3 plausible candidates per
// (query, location) pair, including one without a website so tests can
// verify the "drop sites without a website" rule.
function fixturesFor(query: string, location: string): PlaceCandidate[] {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stem = `${slug(query)}-${slug(location)}`;
  return [
    {
      placeId: `mock-${stem}-1`,
      name: `${capitalise(query)} Co (${location})`,
      websiteUrl: `https://${stem}-1.example.com`,
      formattedAddress: `1 High Street, ${location}, UK`,
      googleMapsUrl: `https://maps.google.com/?q=${encodeURIComponent(query)}+${encodeURIComponent(location)}+1`,
      phoneNumber: '+44 20 0000 0001',
      rating: 4.6,
      userRatingCount: 42,
      types: [query.replace(/\s+/g, '_'), 'establishment'],
      businessStatus: 'OPERATIONAL',
    },
    {
      placeId: `mock-${stem}-2`,
      name: `${capitalise(location)} ${capitalise(query)} Partners`,
      websiteUrl: `https://${stem}-2.example.com`,
      formattedAddress: `22 Market Square, ${location}, UK`,
      googleMapsUrl: `https://maps.google.com/?q=${encodeURIComponent(query)}+${encodeURIComponent(location)}+2`,
      phoneNumber: '+44 20 0000 0002',
      rating: 4.2,
      userRatingCount: 18,
      types: [query.replace(/\s+/g, '_')],
      businessStatus: 'OPERATIONAL',
    },
    {
      // No website on purpose — should be filtered out by googleMapsSource.
      placeId: `mock-${stem}-3`,
      name: `${capitalise(query)} Walk-In ${capitalise(location)}`,
      websiteUrl: null,
      formattedAddress: `Unit 3, Side Street, ${location}, UK`,
      googleMapsUrl: `https://maps.google.com/?q=${encodeURIComponent(query)}+${encodeURIComponent(location)}+3`,
      phoneNumber: null,
      rating: 3.8,
      userRatingCount: 4,
      types: [query.replace(/\s+/g, '_')],
      businessStatus: 'OPERATIONAL',
    },
  ];
}

function capitalise(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const mockPlacesProvider: PlacesProvider = {
  name: 'mock_places',
  async search(params: PlacesProviderSearchParams): Promise<PlacesProviderSearchResult> {
    const places = fixturesFor(params.query, params.location).slice(0, params.maxResults);
    return { places, apiCalls: 1 };
  },
};
