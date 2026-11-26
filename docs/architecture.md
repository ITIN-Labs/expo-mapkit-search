# How it works

There are two halves. `ios/ExpoMapKitSearchModule.swift` is an Expo native module that wraps three MapKit classes, and `src/index.ts` is the JavaScript API on top of it. Expo's autolinking finds the module through `expo-module.config.json` at the package root and builds `ios/ExpoMapKitSearch.podspec` into the app, so there's nothing to configure.

Autocomplete uses `MKLocalSearchCompleter`, the service behind Apple Maps' own search box. It's designed to be fed keystrokes and answer through a delegate, so each `suggest` call creates a completer, keeps it and its delegate alive until the first answer arrives (or 6 seconds pass), and resolves the promise once. The results are `MKLocalSearchCompletion` objects, which can't cross the bridge, so the module keeps them in a dictionary under random ids and sends the ids instead. `resolve` looks the id up and runs an `MKLocalSearch` with it. Each id is stored with the area its call searched, so a picked search stays there. Answers arrive out of order while someone types, so a counter makes sure only the most recently started call replaces the dictionary; an older call still resolves its own promise, but its ids aren't kept. That keeps memory bounded without expiry logic, at the cost that only the newest list can be resolved.

Free-text search is a plain `MKLocalSearch` with a natural-language query, and routes use `MKDirections`, with the route's polyline thinned to about 200 points before it's sent.

Apple reports "nothing found" as an error: `placemarkNotFound` for searches, and for routes either `directionsNotFound` or, between unreachable points, `serverFailure` carrying a directions problem in its `userInfo`. That last key is undocumented; it was observed on macOS and on iOS 27, and it's marked as a shortcut in case a later iOS changes it. The module turns those into an empty list or `null`, since an empty result is a normal answer, and rejects with a code for everything else. The JavaScript side maps those codes to `MapKitSearchError`.

All native functions run on the main queue. The completer needs it, and it keeps the module's small amount of state single-threaded without locks.

## Choices

Input is validated in JavaScript, not Swift: it's where the caller's mistakes can produce useful `TypeError` and `RangeError` messages, and it keeps hostile input from reaching the bridge at all.

The native module is looked up once, when the package is imported, with `requireOptionalNativeModule`. That's a lookup, not a side effect, and it lets `isAvailable` be a plain boolean instead of a function.

The package is plain ESM compiled by `tsc`, without Expo's module build scripts. Metro reads ESM, and a package this small doesn't need the extra tooling. `main` is set alongside `exports` for Metro setups that have package exports turned off.

Fixed result counts and search radii keep the API small. They're marked as shortcuts in the Swift code, and become options when an app needs different values.
