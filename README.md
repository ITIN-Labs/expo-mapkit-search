# @itin-labs/expo-mapkit-search

Place search, autocomplete and routes from Apple Maps, for Expo apps on iOS. It calls MapKit directly, so there's no API key, no billing account and no per-request charge.

```sh
npx expo install @itin-labs/expo-mapkit-search
```

```ts
import { isAvailable, resolveSuggestion, suggestPlaces } from '@itin-labs/expo-mapkit-search';

const lisbon = { latitude: 38.7223, longitude: -9.1393 };

if (isAvailable) {
  const suggestions = await suggestPlaces('pasteis de bel', { near: lisbon });
  // [{ id: '…', title: 'Pastéis de Belém', subtitle: 'Rua de Belém 84 a 92, 1300-085 Lisbon, Portugal' }, …]

  const [place] = await resolveSuggestion(suggestions[0].id);
  // { name: 'Pastéis de Belém', latitude: 38.6975, longitude: -9.2032, address: '…', … }
}
```

It's for Expo and React Native apps that need a search box for places or addresses on iOS, and would rather not sign up for Google Places to get one. It needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (`npx expo run:ios` or EAS Build), since Expo Go doesn't include it. It runs on iOS 16.4 and later. It has been run with Expo SDK 57 and 58.

## API

Coordinates are `{ latitude, longitude }` objects, as in react-native-maps, and extra fields are ignored, so a map `Region` works wherever a coordinate is expected.

### `isAvailable: boolean`

False on Android, on the web and in Expo Go. Every function rejects with `UNAVAILABLE` there, so check this to decide whether to show search at all.

### `suggestPlaces(query, options?): Promise<Suggestion[]>`

Autocomplete for what's been typed so far, from the same service as Apple Maps' own search box, so half-typed words work. Resolves to at most 8 suggestions, each `{ id, title, subtitle }`. A suggestion can be a place, an address, or a search such as "Coffee", which resolves to several places. A search's subtitle is Apple's prompt, such as "Search Nearby", in the device's language, so don't use it to tell searches apart. An empty or blank query resolves to `[]` without a request, which suits a search box being cleared.

| Option       | Type         | Default  | Meaning                                                                                           |
| ------------ | ------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `near`       | `Coordinate` | anywhere | Prefer places within about 20 km of here. Famous places and addresses elsewhere can still appear. |
| `citiesOnly` | `boolean`    | `false`  | Only suggest towns and cities. On iOS before 18 it suggests addresses, which include them.        |

### `resolveSuggestion(id): Promise<Place[]>`

The places a suggestion stands for: one for a place or address, up to 10 for a search. A search keeps to the `near` area of the `suggestPlaces` call it came from. Once the most recently started `suggestPlaces` call answers, only its suggestions can be resolved; an id from an earlier call rejects with `UNKNOWN_SUGGESTION`, even if that call answered last. A blank query or a failed call doesn't replace the list, so the previous suggestions still resolve after one. While someone types, show only the answer to the newest call.

### `searchPlaces(query, options?): Promise<Place[]>`

Free-text search, such as "Fushimi Inari, Kyoto". Resolves to at most 8 places, or `[]` when Apple finds nothing or the query is empty. Use it when you have a whole name or address rather than something being typed.

| Option | Type         | Default  | Meaning                                   |
| ------ | ------------ | -------- | ----------------------------------------- |
| `near` | `Coordinate` | anywhere | Prefer places within about 30 km of here. |

### `findRoute(from, to, options): Promise<Route | null>`

A walking or driving route between two points: `{ seconds, meters, points }`, where `points` is the line to draw, thinned to about 200 coordinates. Resolves to `null` when Apple has no route, such as across an ocean.

| Option | Type                     | Default  | Meaning        |
| ------ | ------------------------ | -------- | -------------- |
| `mode` | `'walking' \| 'driving'` | required | How to travel. |

### `Place`

Every field is always present; text fields are `''` when Apple doesn't know them.

| Field                    | Example                                             |
| ------------------------ | --------------------------------------------------- |
| `name`                   | `'Pastéis de Belém'`                                |
| `address`                | `'Rua de Belém 84-92, 1300-085 Lisbon, Portugal'`   |
| `latitude`, `longitude`  | `38.6975`, `-9.2032`                                |
| `category`               | `'MKPOICategoryBakery'`, `''` for a plain address   |
| `locality`               | `'Lisbon'` (town or city)                           |
| `subLocality`            | `'Belém'` (neighborhood)                            |
| `region`                 | `'Lisbon'`, or `'OR'` in the US (state or province) |
| `country`, `countryCode` | `'Portugal'`, `'PT'`                                |
| `url`                    | the place's website                                 |

### Errors

The functions are async, so bad arguments reject (rather than throw) before anything is sent: a `TypeError` for a wrong type or an unknown option, a `RangeError` for a coordinate out of range or a query over 200 characters. Arguments are checked before availability, so these show up in Expo Go too. Everything else rejects with a `MapKitSearchError` carrying a `code`:

| `code`               | When                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `UNAVAILABLE`        | Android, the web or Expo Go.                                                                                      |
| `UNKNOWN_SUGGESTION` | The id isn't from the most recently started `suggestPlaces` call.                                                 |
| `SEARCH_FAILED`      | Apple Maps returned an error: no network, too many requests, or a server problem. `cause` holds the native error. |

"Nothing found" is not an error: searches resolve to `[]` and routes to `null`.

```ts
import { MapKitSearchError, searchPlaces } from '@itin-labs/expo-mapkit-search';

try {
  setResults(await searchPlaces(text));
} catch (error) {
  if (error instanceof MapKitSearchError && error.code === 'SEARCH_FAILED') {
    setMessage("Couldn't reach Apple Maps. Check your connection and try again.");
  } else {
    throw error;
  }
}
```

## How it compares

The Google Places API, used directly or through [react-native-google-places-autocomplete](https://github.com/FaridSafi/react-native-google-places-autocomplete), works on iOS, Android and the web, and knows far more about each place: photos, ratings, opening hours, reviews. It needs an API key, a billing account, and a way to keep the key from being abused, and costs money past the free tier.

[expo-location](https://docs.expo.dev/versions/latest/sdk/location/)'s `geocodeAsync` and `reverseGeocodeAsync` also use the platform's own geocoder with no key, but only turn an address into coordinates and back. There's no autocomplete and no search for businesses or landmarks.

This package sits between them: free and keyless like expo-location, with the autocomplete and points of interest of Apple Maps. Where it loses:

- iOS only. On Android you need something else.
- Apple's coverage of businesses and landmarks is good in North America, Europe and much of Asia, and thinner elsewhere than Google's.
- Places come with a name, address, category and website, but no photos, ratings, hours or reviews.
- The search radius and result counts are fixed.

## Known limitations

- Only the most recently started `suggestPlaces` call's suggestions can be resolved. Two suggestion lists on screen at once would conflict.
- The `near` areas are fixed at about 20 km for suggestions and 30 km for search. For suggestions it's a preference: Apple still lists well-known places elsewhere, such as the Eiffel Tower when searching near Lisbon. Resolved suggestions and `searchPlaces` stay inside the area.
- Result counts are fixed at 8 suggestions, 10 places for a resolved suggestion and 8 for a search.
- Routes are walking or driving only, with Apple's expected travel time. No transit, cycling, departure times or traffic options.
- A suggestion request that gets no answer from Apple within 6 seconds rejects with `SEARCH_FAILED`.
- A `near` point at or very close to a pole makes a search area that doesn't mean much, so results come from anywhere.
- An unreachable route (across an ocean, or far from any road) is recognised from an undocumented detail of Apple's error, seen on macOS, iOS 26.5 and iOS 27. If a future iOS reports it differently, such a route rejects with `SEARCH_FAILED` instead of resolving to `null`.
- The package is ESM. Jest with `jest-expo` needs it added to `transformIgnorePatterns` so it gets transformed.

## Privacy

The package collects nothing itself and sends nothing anywhere but Apple. Each call sends Apple, through MapKit:

- `suggestPlaces` and `searchPlaces`: the query text, and the `near` coordinate if you pass one
- `resolveSuggestion`: the picked suggestion and the area of the call it came from
- `findRoute`: the two points

Apple handles these requests under its [Apple Maps privacy notice](https://www.apple.com/legal/privacy/data/en/apple-maps/). Like any network request, each one also carries the device's IP address, which gives an approximate location, and MapKit sends the device's language and region settings. The package never reads the device's location itself; whether MapKit adds it to requests when your app has location permission isn't documented, so assume it may. Since a typed query or a `near` coordinate can reveal where someone is or plans to go, mention Apple Maps in your app's privacy policy.

## Status and versioning

The JavaScript side has unit tests for every function, including bad input, error mapping and the unavailable path, with property-based tests for coordinate checks. They run on Node 22, 24 and 26 with the native module mocked. The Swift module isn't covered by automated tests. Every function, the error cases and overlapping autocomplete calls have been run by hand in an app built with Expo SDK 57 and 58 on the iOS 27.0 and 27.1 simulators, and in a release build with SDK 57 on an iPhone running iOS 26.5, on Wi-Fi, on cellular and offline. Offline, every call rejected within 50 ms with `SEARCH_FAILED`. It hasn't yet been run on iOS before 18, which takes different paths for `near` and `citiesOnly`. Xcode 27 can't install iOS 16, the oldest version it supports.

Versions are 0.x until the API has settled. A minor release (0.1 to 0.2) can change the API and says how in the changelog; a patch release won't. 1.0 will come when:

- CI builds an example app on macOS for every pull request, so the Swift code is compiled on each change
- it has shipped in at least two App Store apps for three months without an API change
- the fixed radius and result counts have either become options or been confirmed as fine by real use

## License

MIT
