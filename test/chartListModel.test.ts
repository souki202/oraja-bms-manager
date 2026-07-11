import { describe, expect, it } from 'vitest';
import { createColumnWidthState, isRowUnderRoot, sortRows, sortTables } from '../src/renderer/chartListModel';
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
