import { describe, expect, it } from 'vitest';
import { matchesChartFilters, matchesGlobalChartSearch, normalizeSearchQuery, prepareColumnFilters } from '../src/shared/chartFilters';
import type { ChartFilterCache } from '../src/shared/chartFilters';
import type { TableChartRow } from '../src/shared/types';

describe('chart filters', () => {
  it('matches multiple column filters at the same time', () => {
    const rows = [
      row({ id: 'a', title: 'Blue Moment', artist: 'Alpha', level: '★1', status: 'HARD CLEAR', notes: 1100 }),
      row({ id: 'b', title: 'Blue Moment', artist: 'Beta', level: '★2', status: 'EASY CLEAR', notes: 1200 }),
      row({ id: 'c', title: 'Red Moment', artist: 'Alpha', level: '★1', status: 'HARD CLEAR', notes: 900 })
    ];
    const filters = prepareColumnFilters({
      title: { text: 'blue' },
      artist: { text: 'alpha' },
      status: { statuses: ['HARD CLEAR'] },
      notes: { min: '1000' }
    });
    const cache: ChartFilterCache = new WeakMap();

    expect(rows.filter((item) => matchesChartFilters(item, '', filters, cache)).map((item) => item.id)).toEqual(['a']);
  });

  it('supports global search and URL availability filters', () => {
    const rows = [
      row({ id: 'a', title: 'Song A', tableName: 'Satellite', url1: 'https://example.test/a' }),
      row({ id: 'b', title: 'Song B', tableName: 'Satellite', url1: '' }),
      row({ id: 'c', title: 'Song C', tableName: 'Stella', url1: 'https://example.test/c' })
    ];
    const filters = prepareColumnFilters({ url1: { urlMode: 'has' } });
    const cache: ChartFilterCache = new WeakMap();
    const query = normalizeSearchQuery('satellite');

    expect(rows.filter((item) => matchesChartFilters(item, query, filters, cache)).map((item) => item.id)).toEqual(['a']);
  });

  it('searches global chart metadata by partial match', () => {
    const rows = [
      row({ id: 'title', title: 'Blue Moment' }),
      row({ id: 'subtitle', subtitle: 'Scarlet Mix' }),
      row({ id: 'artist', artist: 'Lime' }),
      row({ id: 'subartist', subartist: 'obj:Alice' }),
      row({ id: 'path', path: 'F:\\songs\\scarlet.bms' })
    ];

    expect(rows.filter((item) => matchesGlobalChartSearch(item, normalizeSearchQuery('scarlet'))).map((item) => item.id)).toEqual(['subtitle']);
    expect(rows.filter((item) => matchesGlobalChartSearch(item, normalizeSearchQuery('alice'))).map((item) => item.id)).toEqual(['subartist']);
  });
});

function row(patch: Partial<TableChartRow>): TableChartRow {
  return {
    id: patch.id ?? 'row',
    tableId: 'table',
    tableName: patch.tableName ?? 'Table',
    tableUrl: '',
    level: patch.level ?? '★1',
    title: patch.title ?? 'Title',
    subtitle: patch.subtitle ?? '',
    artist: patch.artist ?? 'Artist',
    subartist: patch.subartist ?? '',
    genre: '',
    md5: '',
    sha256: patch.sha256 ?? patch.id ?? 'sha',
    orgMd5: '',
    url1: patch.url1 ?? '',
    url2: patch.url2 ?? '',
    ipfs: '',
    appendIpfs: '',
    mode: 7,
    installed: true,
    status: patch.status ?? 'NO PLAY',
    clear: null,
    notes: patch.notes ?? null,
    difficulty: patch.difficulty ?? null,
    songLevel: patch.songLevel ?? null,
    mainBpm: null,
    density: null,
    path: patch.path ?? '',
    folder: patch.folder ?? ''
  };
}
