import type { Release } from '@server/interfaces/api/manualSearchInterfaces';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SORT, nextSort, sortAndFilterReleases } from './releases';

const release = (
  title: string,
  seeders: number,
  size: number,
  ageDays: number
): Release =>
  ({
    guid: title,
    indexerId: 1,
    indexer: '1337x',
    title,
    size,
    seeders,
    leechers: 0,
    ageDays,
    categories: ['Movies/HD'],
  }) as Release;

const a = release('A', 50, 3_000, 10);
const b = release('B', 120, 1_000, 40);
const c = release('C', 5, 2_000, 1);
const titles = (releases: Release[]) => releases.map((r) => r.title);

describe('nextSort', () => {
  it('starts on most seeders first', () => {
    assert.deepEqual(DEFAULT_SORT, { key: 'seeders', direction: 'desc' });
  });

  it("switches to another key in that key's default direction", () => {
    assert.deepEqual(nextSort(DEFAULT_SORT, 'size'), {
      key: 'size',
      direction: 'asc',
    });
    assert.deepEqual(nextSort(DEFAULT_SORT, 'age'), {
      key: 'age',
      direction: 'asc',
    });
  });

  it('flips the direction when the active key is picked again', () => {
    const once = nextSort(DEFAULT_SORT, 'seeders');
    assert.deepEqual(once, { key: 'seeders', direction: 'asc' });
    assert.deepEqual(nextSort(once, 'seeders'), DEFAULT_SORT);
  });

  it('forgets a flipped direction after switching away and back', () => {
    const flipped = nextSort({ key: 'size', direction: 'asc' }, 'size');
    assert.deepEqual(nextSort(nextSort(flipped, 'age'), 'size'), {
      key: 'size',
      direction: 'asc',
    });
  });
});

describe('sortAndFilterReleases', () => {
  it('sorts by seeders either way', () => {
    assert.deepEqual(
      titles(
        sortAndFilterReleases(
          [a, b, c],
          { key: 'seeders', direction: 'desc' },
          ''
        )
      ),
      ['B', 'A', 'C']
    );
    assert.deepEqual(
      titles(
        sortAndFilterReleases(
          [a, b, c],
          { key: 'seeders', direction: 'asc' },
          ''
        )
      ),
      ['C', 'A', 'B']
    );
  });

  it('sorts by size either way', () => {
    assert.deepEqual(
      titles(
        sortAndFilterReleases([a, b, c], { key: 'size', direction: 'asc' }, '')
      ),
      ['B', 'C', 'A']
    );
    assert.deepEqual(
      titles(
        sortAndFilterReleases([a, b, c], { key: 'size', direction: 'desc' }, '')
      ),
      ['A', 'C', 'B']
    );
  });

  it('sorts by age, newest first or oldest first', () => {
    assert.deepEqual(
      titles(
        sortAndFilterReleases([a, b, c], { key: 'age', direction: 'asc' }, '')
      ),
      ['C', 'A', 'B']
    );
    assert.deepEqual(
      titles(
        sortAndFilterReleases([a, b, c], { key: 'age', direction: 'desc' }, '')
      ),
      ['B', 'A', 'C']
    );
  });

  it('filters before sorting', () => {
    assert.deepEqual(
      titles(sortAndFilterReleases([a, b, c], DEFAULT_SORT, 'a')),
      ['A']
    );
  });
});
