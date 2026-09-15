import { describe, expect, it } from 'vitest';
import { chartRowClass, createColumnWidthState, isRowUnderRoot, sortRows, sortTables } from '../src/renderer/chartListModel';
import type { TableChartRow, TableSummary } from '../src/shared/types';

function row(id: string, overrides: Partial<TableChartRow> = {}): TableChartRow {
  return {
    id,
    tableId: 'table',
    tableName: 'Table',
    tableUrl: '',
    level: '',
    title: id,
    subtitle: '',
    artist: '',
    genre: '',
    md5: '',
    sha256: '',
    orgMd5: '',
    url1: '',
    url2: '',
    ipfs: '',
    appendIpfs: '',
    mode: 7,
    installed: true,
    status: 'NO PLAY',
    clear: null,
    notes: null,
    difficulty: null,
    songLevel: null,
    mainBpm: null,
    density: null,
    path: '',
    folder: '',
    ...overrides
  };
}

describe('chart list model', () => {
  it.each([
    ['', '', 'none'],
    ['  ', '  ', 'none'],
    ['https://example.com/song.zip', '', '1'],
    ['', 'https://example.com/chart.zip', '2'],
    ['https://example.com/song.zip', 'https://example.com/chart.zip', 'both'],
    ['http://www.ribbit.xyz/song.zip', '', 'none'],
    ['', 'http://www.freett.com/iidxbanzai/chart.zip', 'none'],
    ['http://www.ribbit.xyz/song.zip', 'http://www.freett.com/iidxbanzai/chart.zip', 'none'],
    ['http://www.ribbit.xyz/song.zip', 'https://example.com/chart.zip', '2'],
    ['https://example.com/song.zip', 'http://www.freett.com/iidxbanzai/chart.zip', '1'],
    ['http://absolute.pv.land.to/uploader/src/up7207.rar', '', '1'],
    ['', 'http://gnqg.rosx.net/upload/upload.cgi?get=5950', '2'],
    ['http://absolute.pv.land.to/uploader/src/up7207.rar', 'http://gnqg.rosx.net/upload/upload.cgi?get=6415', 'both'],
    ['http://www.ribbit.xyz/song.zip', 'http://gnqg.rosx.net/upload/upload.cgi?get=6476', '2'],
    ['', 'http://gnqg.rosx.net/upload/upload.cgi?get=6477', 'none']
  ])('selects the %s / %s row color as %s', (url1, url2, color) => {
    expect(chartRowClass(row('chart', { status: 'NO SONG', url1, url2 })))
      .toBe(`no-song-row no-song-url-${color}`);
  });

  it('does not apply missing-song colors to installed charts with broken links', () => {
    expect(chartRowClass(row('chart', { status: 'NO PLAY', url1: 'http://www.ribbit.xyz/' }))).toBe('');
    expect(chartRowClass(row('chart', { status: 'HARD CLEAR', url2: 'http://www.freett.com/iidxbanzai/' }))).toBe('');
  });

  it('sorts numeric and clear-status columns without mutating the source', () => {
    const source = [
      row('hard', { songLevel: 12, status: 'HARD CLEAR' }),
      row('easy', { songLevel: 3, status: 'FAILED' })
    ];

    expect(sortRows(source, { key: 'songLevel', direction: 'asc' }).map((item) => item.id)).toEqual(['easy', 'hard']);
    expect(sortRows(source, { key: 'status', direction: 'desc' }).map((item) => item.id)).toEqual(['hard', 'easy']);
    expect(source.map((item) => item.id)).toEqual(['hard', 'easy']);
  });

  it('matches Windows paths case-insensitively but respects directory boundaries', () => {
    const chart = row('chart', { path: 'C:\\BMS\\Pack\\song.bms' });
    expect(isRowUnderRoot(chart, 'c:/bms')).toBe(true);
    expect(isRowUnderRoot(chart, 'c:/bm')).toBe(false);
  });

  it('provides widths for every table column and naturally sorts table names', () => {
    const tables = [{ name: 'Table 10' }, { name: 'Table 2' }] as TableSummary[];
    expect(sortTables(tables).map((table) => table.name)).toEqual(['Table 2', 'Table 10']);
    expect(Object.keys(createColumnWidthState())).toHaveLength(10);
  });
});
