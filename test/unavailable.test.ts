import assert from 'node:assert/strict';
import { it, mock } from 'node:test';

// Android, the web and Expo Go: the native module isn't there. namedExports: see index.test.ts.
// eslint-disable-next-line @typescript-eslint/no-deprecated
mock.module('expo', { namedExports: { requireOptionalNativeModule: () => null } });
const { isAvailable, suggestPlaces, resolveSuggestion, searchPlaces, findRoute, MapKitSearchError } =
  await import('../src/index.ts');

const unavailable = (error: unknown) => error instanceof MapKitSearchError && error.code === 'UNAVAILABLE';
const point = { latitude: 0, longitude: 0 };

it('reports that search is unavailable', () => {
  assert.equal(isAvailable, false);
});

it('rejects every call with UNAVAILABLE, even an empty query', async () => {
  await assert.rejects(suggestPlaces(''), unavailable);
  await assert.rejects(suggestPlaces('café'), unavailable);
  await assert.rejects(resolveSuggestion('a'), unavailable);
  await assert.rejects(searchPlaces('café'), unavailable);
  await assert.rejects(findRoute(point, point, { mode: 'walking' }), unavailable);
});

it('checks arguments before availability, so mistakes show up in Expo Go too', async () => {
  await assert.rejects(suggestPlaces(42 as never), TypeError);
  await assert.rejects(searchPlaces('café', { near: { latitude: 100, longitude: 0 } }), RangeError);
  await assert.rejects(resolveSuggestion(''), TypeError);
  await assert.rejects(findRoute(point, point, { mode: 'cycling' } as never), TypeError);
});
