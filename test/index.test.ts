import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import fc from 'fast-check';
import type { Place, Route, Suggestion } from '../src/index.ts';

const place: Place = {
  name: 'Made-up Café',
  address: '1 Example Street, Lisbon, Portugal',
  latitude: 38.71,
  longitude: -9.14,
  category: 'MKPOICategoryCafe',
  locality: 'Lisbon',
  subLocality: 'Baixa',
  region: 'Lisbon',
  country: 'Portugal',
  countryCode: 'PT',
  url: '',
};

const native = {
  suggest: mock.fn<(...args: unknown[]) => Promise<Suggestion[]>>(() =>
    Promise.resolve([{ id: 'a', title: 'Made-up Café', subtitle: 'Lisbon' }]),
  ),
  resolve: mock.fn<(...args: unknown[]) => Promise<Place[]>>(() => Promise.resolve([place])),
  search: mock.fn<(...args: unknown[]) => Promise<Place[]>>(() => Promise.resolve([place])),
  route: mock.fn<(...args: unknown[]) => Promise<Route | null>>(() =>
    Promise.resolve({ seconds: 60, meters: 80, points: [] }),
  ),
};

// shortcut: namedExports is deprecated on Node 26 in favour of `exports`, which Node 22 lacks.
// Switch when Node 22 leaves the support matrix; the weekly job on the newest Node will warn first.
mock.module('expo', {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  namedExports: { requireOptionalNativeModule: (name: string) => (name === 'ExpoMapKitSearch' ? native : null) },
});
const { isAvailable, suggestPlaces, resolveSuggestion, searchPlaces, findRoute, MapKitSearchError } =
  await import('../src/index.ts');

const rejectsWith = (code: string) => (error: unknown) => {
  assert.ok(error instanceof MapKitSearchError, `expected MapKitSearchError, got ${String(error)}`);
  assert.equal(error.code, code);
  return true;
};

const lisbon = { latitude: 38.72, longitude: -9.14 };
const porto = { latitude: 41.15, longitude: -8.61 };

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mock.resetCalls();
});

describe('isAvailable', () => {
  it('is true when the native module is built in', () => {
    assert.equal(isAvailable, true);
  });
});

describe('suggestPlaces', () => {
  it('passes the trimmed query, the area and the cities flag to Apple Maps', async () => {
    assert.deepEqual(await suggestPlaces('  café  ', { near: lisbon, citiesOnly: true }), [
      { id: 'a', title: 'Made-up Café', subtitle: 'Lisbon' },
    ]);
    assert.deepEqual(native.suggest.mock.calls[0]?.arguments, ['café', 38.72, -9.14, true]);
  });

  it('defaults to anywhere and all kinds of places', async () => {
    await suggestPlaces('café');
    assert.deepEqual(native.suggest.mock.calls[0]?.arguments, ['café', null, null, false]);
  });

  it('accepts a coordinate with extra fields, such as a map region', async () => {
    await suggestPlaces('café', { near: { ...lisbon, latitudeDelta: 0.1, longitudeDelta: 0.1 } as never });
    assert.deepEqual(native.suggest.mock.calls[0]?.arguments, ['café', 38.72, -9.14, false]);
  });

  it('resolves to [] for an empty or blank query without asking Apple', async () => {
    assert.deepEqual(await suggestPlaces(''), []);
    assert.deepEqual(await suggestPlaces(' \n\t '), []);
    assert.equal(native.suggest.mock.callCount(), 0);
  });

  it('accepts a query of exactly 200 characters and refuses a longer one', async () => {
    await suggestPlaces('é'.repeat(200));
    await assert.rejects(suggestPlaces('a'.repeat(201)), RangeError);
    assert.equal(native.suggest.mock.callCount(), 1);
  });

  it('refuses bad arguments before calling Apple', async () => {
    await assert.rejects(suggestPlaces(42 as never), TypeError);
    await assert.rejects(suggestPlaces('café', { radius: 5 } as never), /unknown option `radius`/);
    await assert.rejects(suggestPlaces('café', null as never), TypeError);
    await assert.rejects(suggestPlaces('café', { citiesOnly: 'yes' } as never), TypeError);
    await assert.rejects(suggestPlaces('café', { near: { latitude: 91, longitude: 0 } }), RangeError);
    await assert.rejects(suggestPlaces('café', { near: null as never }), RangeError);
    await assert.rejects(suggestPlaces('café', { near: { lat: 1, lng: 2 } as never }), RangeError);
    assert.equal(native.suggest.mock.callCount(), 0);
  });

  it('turns a native failure into SEARCH_FAILED and keeps the cause', async () => {
    const failure = Object.assign(new Error('The operation couldn’t be completed.'), { code: 'E_SEARCH_FAILED' });
    native.suggest.mock.mockImplementationOnce(() => Promise.reject(failure));
    await assert.rejects(suggestPlaces('café'), (error: unknown) => {
      rejectsWith('SEARCH_FAILED')(error);
      assert.equal((error as Error).cause, failure);
      return true;
    });
  });

  it('leaves the native code and Swift file out of the message, as older Expo SDKs add them', async () => {
    const failure = Object.assign(
      new Error('E_SEARCH_FAILED: The request timed out. (at ExpoModulesCore/Promise.swift:65)'),
      { code: 'E_SEARCH_FAILED' },
    );
    native.suggest.mock.mockImplementationOnce(() => Promise.reject(failure));
    await assert.rejects(suggestPlaces('café'), { message: 'Apple Maps request failed: The request timed out.' });
  });

  it('passes any valid coordinate through unchanged and refuses every invalid one', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        async (latitude, longitude) => {
          native.suggest.mock.resetCalls();
          await suggestPlaces('café', { near: { latitude, longitude } });
          const [, lat, lng] = native.suggest.mock.calls[0]?.arguments ?? [];
          assert.ok(Object.is(lat, latitude) && Object.is(lng, longitude));
        },
      ),
    );
    const outOfRange = fc.oneof(
      fc.double({ min: 90, minExcluded: true }),
      fc.double({ max: -90, maxExcluded: true }),
      fc.constant(Number.NaN),
    );
    await fc.assert(
      fc.asyncProperty(outOfRange, fc.double({ min: -180, max: 180, noNaN: true }), async (latitude, longitude) => {
        await assert.rejects(searchPlaces('café', { near: { latitude, longitude } }), RangeError);
        await assert.rejects(
          searchPlaces('café', { near: { latitude: longitude / 2, longitude: latitude * 2 } }),
          RangeError,
        );
      }),
    );
  });
});

describe('resolveSuggestion', () => {
  it('resolves a suggestion to places', async () => {
    assert.deepEqual(await resolveSuggestion('a'), [place]);
    assert.deepEqual(native.resolve.mock.calls[0]?.arguments, ['a']);
  });

  it('turns an id Apple no longer has into UNKNOWN_SUGGESTION', async () => {
    native.resolve.mock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('gone'), { code: 'E_UNKNOWN_SUGGESTION' })),
    );
    await assert.rejects(resolveSuggestion('old'), rejectsWith('UNKNOWN_SUGGESTION'));
  });

  it('refuses an id that is not a non-empty string of at most 100 characters', async () => {
    await assert.rejects(resolveSuggestion(''), TypeError);
    await assert.rejects(resolveSuggestion(7 as never), TypeError);
    await assert.rejects(resolveSuggestion('x'.repeat(101)), TypeError);
    assert.equal(native.resolve.mock.callCount(), 0);
  });
});

describe('searchPlaces', () => {
  it('searches near a point, or anywhere', async () => {
    assert.deepEqual(await searchPlaces('Fushimi Inari, Kyoto', { near: lisbon }), [place]);
    await searchPlaces('Fushimi Inari, Kyoto');
    assert.deepEqual(
      native.search.mock.calls.map((c) => c.arguments),
      [
        ['Fushimi Inari, Kyoto', 38.72, -9.14],
        ['Fushimi Inari, Kyoto', null, null],
      ],
    );
  });

  it('resolves to [] for an empty query and refuses unknown options', async () => {
    assert.deepEqual(await searchPlaces(''), []);
    await assert.rejects(searchPlaces('x', { citiesOnly: true } as never), TypeError);
    assert.equal(native.search.mock.callCount(), 0);
  });

  it('turns a rejection without an Error into SEARCH_FAILED', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- native bridges can reject with anything
    native.search.mock.mockImplementationOnce(() => Promise.reject('offline'));
    await assert.rejects(
      searchPlaces('x'),
      (error: unknown) => rejectsWith('SEARCH_FAILED')(error) && /offline/.test((error as Error).message),
    );
  });
});

describe('native rejections without an Error', () => {
  it('become SEARCH_FAILED for null and undefined too', async () => {
    for (const value of [null, undefined]) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- native bridges can reject with anything
      native.route.mock.mockImplementationOnce(() => Promise.reject(value));
      await assert.rejects(findRoute(lisbon, porto, { mode: 'driving' }), (error: unknown) => {
        rejectsWith('SEARCH_FAILED')(error);
        assert.match((error as Error).message, /^Apple Maps request failed/);
        return true;
      });
    }
  });
});

describe('findRoute', () => {
  it('asks for a walking or a driving route', async () => {
    assert.deepEqual(await findRoute(lisbon, porto, { mode: 'walking' }), { seconds: 60, meters: 80, points: [] });
    await findRoute(lisbon, porto, { mode: 'driving' });
    assert.deepEqual(
      native.route.mock.calls.map((c) => c.arguments),
      [
        [38.72, -9.14, 41.15, -8.61, true],
        [38.72, -9.14, 41.15, -8.61, false],
      ],
    );
  });

  it('resolves to null when Apple has no route', async () => {
    native.route.mock.mockImplementationOnce(() => Promise.resolve(null));
    assert.equal(await findRoute(lisbon, porto, { mode: 'driving' }), null);
  });

  it('refuses missing or invalid points and modes', async () => {
    await assert.rejects(findRoute(undefined as never, porto, { mode: 'walking' }), TypeError);
    await assert.rejects(findRoute(lisbon, { latitude: 0, longitude: 181 }, { mode: 'walking' }), RangeError);
    await assert.rejects(findRoute(lisbon, porto, { mode: 'cycling' } as never), TypeError);
    await assert.rejects(findRoute(lisbon, porto, undefined as never), /`mode` is required/);
    await assert.rejects(findRoute(lisbon, porto, { mode: 'walking', avoidTolls: true } as never), TypeError);
    assert.equal(native.route.mock.callCount(), 0);
  });

  it('turns a native failure into SEARCH_FAILED', async () => {
    native.route.mock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('throttled'), { code: 'E_SEARCH_FAILED' })),
    );
    await assert.rejects(findRoute(lisbon, porto, { mode: 'driving' }), rejectsWith('SEARCH_FAILED'));
  });
});
