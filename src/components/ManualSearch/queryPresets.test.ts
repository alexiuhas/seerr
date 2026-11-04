import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { queryPresets } from './queryPresets';

describe('queryPresets', () => {
  it('offers the English and Original titles for a foreign movie', () => {
    assert.deepEqual(
      queryPresets({ english: 'Parasite 2019', original: '기생충 2019' }),
      [
        { kind: 'english', query: 'Parasite 2019' },
        { kind: 'original', query: '기생충 2019' },
      ]
    );
  });

  it('offers no presets for a movie with only an English title', () => {
    assert.deepEqual(queryPresets({ english: 'Inception 2010' }), []);
  });

  it('offers the whole series, then each season, for TV', () => {
    assert.deepEqual(
      queryPresets({ english: 'Severance' }, [
        { query: 'Severance' },
        { season: 1, query: 'Severance S01' },
        { season: 2, query: 'Severance S02' },
      ]),
      [
        { kind: 'series', query: 'Severance' },
        { kind: 'season', season: 1, query: 'Severance S01' },
        { kind: 'season', season: 2, query: 'Severance S02' },
      ]
    );
  });

  it('offers no presets for a series with no regular seasons', () => {
    assert.deepEqual(
      queryPresets({ english: 'Pilot' }, [{ query: 'Pilot' }]),
      []
    );
  });
});
