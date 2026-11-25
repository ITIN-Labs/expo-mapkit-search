# Threat model

The package runs inside an iOS app and passes search requests from the app's JavaScript to Apple's MapKit framework, which sends them to Apple Maps' servers and returns the results.

## What's trusted

The app's own code, Apple's MapKit framework and servers, and Expo's native module bridge. A bug in MapKit or Expo is reported to them.

## What isn't

The arguments. A query usually comes straight from a text field, so it can be any length and contain anything, and coordinates can come from anywhere in the app.

What Apple returns is treated as data, never as code.

## Risks and defences

Hostile or huge input. A pasted megabyte of text or a malformed coordinate could crash the bridge or send Apple more than intended. Defences: queries must be strings of at most 200 characters after trimming, coordinates must be finite numbers within range, ids at most 100 characters, and options objects reject unknown keys. All of this is checked in JavaScript before anything crosses to native code, and none of the checks uses a regular expression, so there's nothing to backtrack on.

Sending Apple more than the app meant to. Defence: each function sends only the fields listed in the README's Privacy section. The package never reads the device's location, contacts or anything else; `Contacts` is imported only to format a postal address Apple returns.

A request that never finishes leaves a promise waiting forever. Defence: suggestions settle after 6 seconds at most; searches and routes rely on MapKit's own timeouts.

Error messages leaking what someone typed. Defence: messages never include the query or coordinates. The native error is kept as `cause`, where its text is Apple's.

Supply chain. No runtime dependencies (Expo and React Native are peers the app already has), a committed lockfile, `npm ci` in CI, `npm audit`, CodeQL, Dependabot, actions pinned to commit SHAs, no install scripts, and publishing through npm trusted publishing with provenance.

## What leaves the device

The query text, the `near` coordinate, the picked suggestion and route endpoints, sent to Apple by MapKit as the README's Privacy section lists, along with what every MapKit request carries: the device's IP address and its language and region settings. Whether MapKit adds the device's location when the app has location permission isn't documented. Nothing goes to anyone but Apple, and there's no telemetry.
