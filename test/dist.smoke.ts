// Run after the build (CI's package job): the published file loads and exports the API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it, mock } from 'node:test';
import { pathToFileURL } from 'node:url';

// The real expo can't load in Node, so mock it by the URL dist/index.js will import it from.
const expo = pathToFileURL(createRequire(import.meta.url).resolve('expo')).href;
// eslint-disable-next-line @typescript-eslint/no-deprecated -- see test/index.test.ts
mock.module(expo, { namedExports: { requireOptionalNativeModule: () => null } });

it('loads the built package and exports the API', async () => {
  // A variable, so tsc doesn't need dist/ to exist when it checks this file.
  const built = '../dist/index.js';
  const api = (await import(built)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(api).sort(), [
    'MapKitSearchError',
    'findRoute',
    'isAvailable',
    'resolveSuggestion',
    'searchPlaces',
    'suggestPlaces',
  ]);
  assert.equal(api.isAvailable, false);
});
