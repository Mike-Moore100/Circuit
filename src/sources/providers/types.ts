// Provider abstraction so googleMapsSource can stay testable without
// hitting Google. Anything that knows how to search "businesses near X"
// can satisfy this contract.

export interface PlaceCandidate {
  placeId: string;
  name: string;
  websiteUrl: string | null;
  formattedAddress: string | null;
  googleMapsUrl: string | null;
  phoneNumber: string | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  businessStatus: string | null;
}

export interface PlacesProviderSearchParams {
  query: string;
  // Free-text location hint (e.g. "London, UK"). Implementations decide
  // whether to merge it into `query` or pass through structured fields.
  location: string;
  maxResults: number;
}

export interface PlacesProviderSearchResult {
  places: PlaceCandidate[];
  // Number of underlying HTTP requests this search consumed. For Phase 2 we
  // make one request per (category, location) pair, so this is always 1 on
  // success and 0 on a short-circuit failure — but the field lets a paged
  // implementation report accurately later.
  apiCalls: number;
}

export interface PlacesProvider {
  name: string;
  search(params: PlacesProviderSearchParams): Promise<PlacesProviderSearchResult>;
}
