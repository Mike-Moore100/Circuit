import { describe, it, expect } from 'vitest';
import { createGoogleMapsSource } from '../src/sources/googleMapsSource';
import { mockPlacesProvider } from '../src/sources/providers/mockPlacesProvider';
import type {
  PlaceCandidate,
  PlacesProvider,
  PlacesProviderSearchParams,
} from '../src/sources/providers/types';

function trackingProvider(places: PlaceCandidate[]): PlacesProvider & { calls: number } {
  const state = { calls: 0 };
  const provider: PlacesProvider & { calls: number } = {
    name: 'tracking',
    get calls() {
      return state.calls;
    },
    async search(_params: PlacesProviderSearchParams) {
      state.calls += 1;
      return { places, apiCalls: 1 };
    },
  };
  return provider;
}

const goodPlace: PlaceCandidate = {
  placeId: 'p1',
  name: 'Northwind Recruitment',
  websiteUrl: 'https://northwind.example',
  formattedAddress: '1 Oxford Street, London, UK',
  googleMapsUrl: 'https://maps.example/p1',
  phoneNumber: '+44 20 0000 0000',
  rating: 4.6,
  userRatingCount: 51,
  types: ['employment_agency'],
  businessStatus: 'OPERATIONAL',
};

const noWebsitePlace: PlaceCandidate = { ...goodPlace, placeId: 'p2', websiteUrl: null };

const closedPlace: PlaceCandidate = {
  ...goodPlace,
  placeId: 'p3',
  websiteUrl: 'https://closed.example',
  businessStatus: 'CLOSED_PERMANENTLY',
};

describe('googleMapsSource', () => {
  it('falls back to mock provider when no API key is set and emits a warning', async () => {
    // No GOOGLE_PLACES_API_KEY in test env → default provider is mock.
    const source = createGoogleMapsSource();
    const result = await source.fetchLeads({
      categories: ['recruitment agency'],
      locations: ['London'],
      maxSearches: 1,
    });
    expect(result.leads.length).toBeGreaterThan(0);
    expect(
      result.errors.some((e) => /mock|API key/i.test(e)),
    ).toBe(true);
  });

  it('respects maxSearches cap regardless of category × location plan size', async () => {
    const provider = trackingProvider([goodPlace]);
    const source = createGoogleMapsSource({ provider });
    await source.fetchLeads({
      categories: ['a', 'b', 'c'],
      locations: ['x', 'y', 'z'],
      maxSearches: 4,
      maxResultsPerSearch: 20,
      maxLeads: 100,
    });
    expect(provider.calls).toBe(4);
  });

  it('respects maxLeads cap and stops calling the provider once reached', async () => {
    const provider = trackingProvider(
      Array.from({ length: 5 }, (_, i): PlaceCandidate => ({
        ...goodPlace,
        placeId: `p${i}`,
        websiteUrl: `https://example-${i}.com`,
      })),
    );
    const source = createGoogleMapsSource({ provider });
    const result = await source.fetchLeads({
      categories: ['recruitment agency'],
      locations: ['London', 'Manchester'],
      maxSearches: 5,
      maxResultsPerSearch: 20,
      maxLeads: 3,
    });
    expect(result.leads.length).toBe(3);
    expect(result.errors.some((e) => /maxLeads/i.test(e))).toBe(true);
  });

  it('drops places that have no website BEFORE deeper processing', async () => {
    const provider = trackingProvider([goodPlace, noWebsitePlace]);
    const source = createGoogleMapsSource({ provider });
    const result = await source.fetchLeads({
      categories: ['recruitment agency'],
      locations: ['London'],
      maxSearches: 1,
    });
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].websiteUrl).toBe(goodPlace.websiteUrl);
  });

  it('drops non-operational businesses', async () => {
    const provider = trackingProvider([closedPlace, goodPlace]);
    const source = createGoogleMapsSource({ provider });
    const result = await source.fetchLeads({
      categories: ['recruitment agency'],
      locations: ['London'],
      maxSearches: 1,
    });
    expect(result.leads.map((l) => l.companyName)).toEqual([goodPlace.name]);
  });

  it('dedupes by place_id across multiple searches', async () => {
    const provider = trackingProvider([goodPlace]);
    const source = createGoogleMapsSource({ provider });
    const result = await source.fetchLeads({
      categories: ['recruitment agency', 'marketing agency'],
      locations: ['London'],
      maxSearches: 4,
      maxResultsPerSearch: 20,
      maxLeads: 100,
    });
    expect(result.leads).toHaveLength(1);
    expect(provider.calls).toBeGreaterThan(1);
  });

  it('records errors per failing query and keeps the rest of the run going', async () => {
    let call = 0;
    const provider: PlacesProvider = {
      name: 'flaky',
      async search() {
        call += 1;
        if (call === 1) throw new Error('Places API responded 429: Too Many Requests');
        return { places: [goodPlace], apiCalls: 1 };
      },
    };
    const source = createGoogleMapsSource({ provider });
    const result = await source.fetchLeads({
      categories: ['recruitment agency'],
      locations: ['London', 'Manchester'],
      maxSearches: 2,
    });
    expect(result.leads).toHaveLength(1);
    expect(result.errors.some((e) => /429/.test(e))).toBe(true);
    expect(result.apiCalls).toBe(1);
  });

  it('counts apiCalls returned by the provider', async () => {
    const source = createGoogleMapsSource({ provider: mockPlacesProvider });
    const result = await source.fetchLeads({
      categories: ['legal firm'],
      locations: ['London', 'Manchester'],
      maxSearches: 2,
    });
    expect(result.apiCalls).toBe(2);
  });

  it('classifies each lead industry against the rule filter target list', async () => {
    const source = createGoogleMapsSource({ provider: mockPlacesProvider });
    const result = await source.fetchLeads({
      categories: ['accounting firm'],
      locations: ['London'],
      maxSearches: 1,
    });
    expect(result.leads.length).toBeGreaterThan(0);
    expect(result.leads[0].industry).toBe('accounting');
    expect(result.leads[0].source).toBe('google_maps');
    expect(result.leads[0].sourceUrl).toMatch(/^https?:\/\//);
  });
});
