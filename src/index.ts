import { requireOptionalNativeModule } from 'expo';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** A place or address from Apple Maps. Text fields are '' when Apple doesn't know them. */
export interface Place {
  name: string;
  /** One line, such as "1 Rua Augusta, 1100-053 Lisbon, Portugal". */
  address: string;
  latitude: number;
  longitude: number;
  /** Apple's point-of-interest category, such as "MKPOICategoryRestaurant". '' for a plain address. */
  category: string;
  /** The town or city. */
  locality: string;
  /** The neighborhood. */
  subLocality: string;
  /** The state or province, such as "OR" or "Ontario". */
  region: string;
  country: string;
  /** ISO 3166-1 alpha-2, such as "PT". */
  countryCode: string;
  /** The place's own website. */
  url: string;
}

/** An autocomplete suggestion: a place, an address, or a search such as "Coffee". */
export interface Suggestion {
  /** Pass to resolveSuggestion. Valid until a later suggestPlaces call returns suggestions. */
  id: string;
  title: string;
  /**
   * The address or area. For a search, which resolves to several places, Apple's prompt such as
   * "Search Nearby". It's localized, so don't use it to tell searches apart.
   */
  subtitle: string;
}

export interface Route {
  /** Apple's expected travel time. */
  seconds: number;
  meters: number;
  /** The route's line, for drawing on a map. At most about 200 points. */
  points: Coordinate[];
}

export interface SuggestOptions {
  /** Prefer places within about 20 km of here. Famous places and addresses elsewhere can still appear. */
  near?: Coordinate;
  /** Only suggest towns and cities. On iOS before 18 it suggests addresses, which include them. Default false. */
  citiesOnly?: boolean;
}

export interface SearchOptions {
  /** Prefer places within about 30 km of here. */
  near?: Coordinate;
}

export interface RouteOptions {
  mode: 'walking' | 'driving';
}

export type MapKitSearchErrorCode = 'UNAVAILABLE' | 'UNKNOWN_SUGGESTION' | 'SEARCH_FAILED';

export class MapKitSearchError extends Error {
  readonly code: MapKitSearchErrorCode;

  constructor(code: MapKitSearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MapKitSearchError';
    this.code = code;
  }
}

interface NativeModule {
  suggest(query: string, latitude: number | null, longitude: number | null, citiesOnly: boolean): Promise<Suggestion[]>;
  resolve(id: string): Promise<Place[]>;
  search(query: string, latitude: number | null, longitude: number | null): Promise<Place[]>;
  route(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
    walking: boolean,
  ): Promise<Route | null>;
}

// A lookup, not a side effect: null on Android, on the web and in Expo Go, where the module isn't built in.
const native = requireOptionalNativeModule<NativeModule>('ExpoMapKitSearch');

/** False on Android, on the web and in Expo Go. Every function rejects with UNAVAILABLE there. */
export const isAvailable: boolean = native !== null;

/** Longest query accepted. Apple's own search box has no use for more, and it bounds what's sent. */
const MAX_QUERY = 200;

/** Autocomplete for what's been typed so far. Resolves to at most 8 suggestions; [] for an empty query. */
export async function suggestPlaces(query: string, options: SuggestOptions = {}): Promise<Suggestion[]> {
  checkOptions(options, ['near', 'citiesOnly'], 'suggestPlaces');
  const near = coordinate(options.near, 'suggestPlaces: `near`');
  if (options.citiesOnly !== undefined && typeof options.citiesOnly !== 'boolean') {
    throw new TypeError('suggestPlaces: `citiesOnly` must be a boolean.');
  }
  const text = checkQuery(query, 'suggestPlaces');
  const mapkit = available();
  if (text === '') return [];
  return call(mapkit.suggest(text, near?.latitude ?? null, near?.longitude ?? null, options.citiesOnly ?? false));
}

/** The places a suggestion stands for: one for a place or address, up to 10 for a search. */
export async function resolveSuggestion(id: string): Promise<Place[]> {
  if (typeof id !== 'string' || id === '' || id.length > 100) {
    throw new TypeError('resolveSuggestion: pass the `id` of a suggestion from suggestPlaces.');
  }
  return call(available().resolve(id));
}

/** Free-text search, such as "Fushimi Inari, Kyoto". Resolves to at most 8 places; [] for an empty query. */
export async function searchPlaces(query: string, options: SearchOptions = {}): Promise<Place[]> {
  checkOptions(options, ['near'], 'searchPlaces');
  const near = coordinate(options.near, 'searchPlaces: `near`');
  const text = checkQuery(query, 'searchPlaces');
  const mapkit = available();
  if (text === '') return [];
  return call(mapkit.search(text, near?.latitude ?? null, near?.longitude ?? null));
}

/** A walking or driving route. Resolves to null when Apple has no route between the two points. */
export async function findRoute(from: Coordinate, to: Coordinate, options: RouteOptions): Promise<Route | null> {
  const start = coordinate(from, 'findRoute: `from`');
  const end = coordinate(to, 'findRoute: `to`');
  if (!start || !end) throw new TypeError('findRoute: `from` and `to` are required.');
  // The type says options can't be missing; plain JavaScript callers can still leave it out.
  if ((options as RouteOptions | undefined) === undefined) {
    throw new TypeError("findRoute: `mode` is required. Pass { mode: 'walking' } or { mode: 'driving' }.");
  }
  checkOptions(options, ['mode'], 'findRoute');
  const mode: unknown = options.mode;
  if (mode !== 'walking' && mode !== 'driving') {
    throw new TypeError("findRoute: `mode` must be 'walking' or 'driving'.");
  }
  const walking = mode === 'walking';
  return call(available().route(start.latitude, start.longitude, end.latitude, end.longitude, walking));
}

function available(): NativeModule {
  if (native === null) {
    throw new MapKitSearchError(
      'UNAVAILABLE',
      'Apple Maps search only works in an iOS development or production build, not on Android, the web or Expo Go.',
    );
  }
  return native;
}

/** Native rejections become MapKitSearchErrors; the native error stays as the cause. */
async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if ((error as { code?: unknown } | null | undefined)?.code === 'E_UNKNOWN_SUGGESTION') {
      throw new MapKitSearchError(
        'UNKNOWN_SUGGESTION',
        'That suggestion is no longer available. Suggestions are replaced when a newer suggestPlaces call returns; ask again.',
        { cause: error },
      );
    }
    // Older Expo SDKs put the native code in front of the message and the Swift file after it.
    const reason = (error instanceof Error ? error.message : String(error))
      .replace(/^E_[A-Z_]+: /, '')
      .replace(/ \(at [^()]*\)$/, '');
    throw new MapKitSearchError('SEARCH_FAILED', `Apple Maps request failed: ${reason}`, { cause: error });
  }
}

function checkQuery(query: unknown, where: string): string {
  if (typeof query !== 'string') throw new TypeError(`${where}: the query must be a string.`);
  const text = query.trim();
  if (text.length > MAX_QUERY) {
    throw new RangeError(`${where}: the query is longer than ${String(MAX_QUERY)} characters.`);
  }
  return text;
}

/** Checks a coordinate's numbers. Other fields are ignored, so a react-native-maps Region works too. */
function coordinate(value: unknown, what: string): Coordinate | undefined {
  if (value === undefined) return undefined;
  const { latitude, longitude } = (value ?? {}) as Partial<Record<keyof Coordinate, unknown>>;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !(latitude >= -90 && latitude <= 90) ||
    !(longitude >= -180 && longitude <= 180)
  ) {
    throw new RangeError(`${what} must have a latitude from -90 to 90 and a longitude from -180 to 180.`);
  }
  return { latitude, longitude };
}

function checkOptions(value: unknown, allowed: string[], where: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: options must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `${where}: unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}. Allowed: ${allowed.join(', ')}.`,
    );
  }
}
