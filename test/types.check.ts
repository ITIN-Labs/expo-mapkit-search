// Checked by tsc, never run: fails the type check if the public types change shape.
import { expectTypeOf } from 'expect-type';
import {
  findRoute,
  isAvailable,
  MapKitSearchError,
  resolveSuggestion,
  searchPlaces,
  suggestPlaces,
  type Coordinate,
  type MapKitSearchErrorCode,
  type Place,
  type Route,
  type Suggestion,
} from '../src/index.ts';

expectTypeOf(isAvailable).toEqualTypeOf<boolean>();
expectTypeOf<Coordinate>().toEqualTypeOf<{ latitude: number; longitude: number }>();

expectTypeOf(suggestPlaces).parameters.toEqualTypeOf<
  [string, ({ near?: Coordinate; citiesOnly?: boolean } | undefined)?]
>();
expectTypeOf(suggestPlaces).returns.resolves.toEqualTypeOf<Suggestion[]>();
expectTypeOf<Suggestion>().toEqualTypeOf<{ id: string; title: string; subtitle: string }>();

expectTypeOf(resolveSuggestion).parameters.toEqualTypeOf<[string]>();
expectTypeOf(resolveSuggestion).returns.resolves.toEqualTypeOf<Place[]>();

expectTypeOf(searchPlaces).parameters.toEqualTypeOf<[string, ({ near?: Coordinate } | undefined)?]>();
expectTypeOf(searchPlaces).returns.resolves.toEqualTypeOf<Place[]>();

expectTypeOf(findRoute).parameters.toEqualTypeOf<[Coordinate, Coordinate, { mode: 'walking' | 'driving' }]>();
expectTypeOf(findRoute).returns.resolves.toEqualTypeOf<Route | null>();
expectTypeOf<Route>().toEqualTypeOf<{ seconds: number; meters: number; points: Coordinate[] }>();

expectTypeOf<Place>().toEqualTypeOf<{
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  locality: string;
  subLocality: string;
  region: string;
  country: string;
  countryCode: string;
  url: string;
}>();

expectTypeOf<MapKitSearchError['code']>().toEqualTypeOf<MapKitSearchErrorCode>();
expectTypeOf<MapKitSearchErrorCode>().toEqualTypeOf<'UNAVAILABLE' | 'UNKNOWN_SUGGESTION' | 'SEARCH_FAILED'>();

// @ts-expect-error mode is required
void findRoute({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }, {});
