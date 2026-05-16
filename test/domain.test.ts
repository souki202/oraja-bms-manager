import { describe, expect, it } from 'vitest';
import { buildSimilarSearchRows, clearToStatus, findSimilarRows, normalizeTitleBase } from '../src/shared/domain';
import type { TableChartRow } from '../src/shared/types';

describe('clearToStatus', () => {
  it('maps beatoraja clear ids to labels', () => {
    expect(clearToStatus(null)).toBe('NO PLAY');
    expect(clearToStatus(1)).toBe('FAILED');
    expect(clearToStatus(3)).toBe('ASSIST CLEAR');
    expect(clearToStatus(4)).toBe('EASY CLEAR');
    expect(clearToStatus(6)).toBe('HARD CLEAR');
    expect(clearToStatus(8)).toBe('FULL COMBO');
  });
});

describe('findSimilarRows', () => {
  it('includes the selected chart and prioritizes missing charts among matches', () => {
    const target = row('a', 'Song [A]', 'Artist', 'CLEAR');
    const installed = row('b', 'Song [H]', 'Artist', 'NO PLAY');
    const missing = row('c', 'Song [Another]', 'Artist', 'NO SONG');
    const unrelated = row('d', 'Other', 'Artist', 'NO SONG');
    const result = findSimilarRows(target, [target, installed, missing, unrelated]);

    expect(result.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(result[0].matchReason).toBe('selected chart');
    expect(result[1].matchReason).toBe('title + artist');
  });

  it('does not treat empty or tiny titles as broad partial matches', () => {
    const target = row('a', 'サンバランド [DP BEGINNER]', 'SAMBA MASTER', 'NO PLAY');
    const blank = row('b', '', 'Music : NODATA', 'NO SONG');
    const tiny = row('c', 'サ', 'SAMBA MASTER', 'NO SONG');
    const good = row('d', 'サンバランド [POROTHER]', 'SAMBA MASTER', 'NO SONG');

    expect(findSimilarRows(target, [target, blank, tiny, good]).map((item) => item.id)).toEqual(['a', 'd']);
  });

  it('matches titles after removing trailing difficulty names', () => {
    const target = row('a', 'galaxy fall -ANOTHER-', 'Artist', 'CLEAR');
    const same = row('b', 'galaxy fall', 'Artist', 'NO SONG');
    const other = row('c', 'Another Fall', 'Artist', 'NO SONG');

    expect(findSimilarRows(target, [target, same, other]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('matches titles that only differ by spacing before a difficulty suffix', () => {
    const target = row('a', 'FrostLand [MASTER]', 'Artist', 'CLEAR');
    const same = row('b', 'Frost Land', 'Artist', 'NO SONG');

    expect(findSimilarRows(target, [target, same]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('includes the selected chart even when it has no searchable title or hash', () => {
    const target = row('a', '', 'Artist', 'CLEAR', { sha256: '' });
    const blank = row('b', '', 'Artist', 'NO SONG', { sha256: '' });

    expect(findSimilarRows(target, [target, blank]).map((item) => item.id)).toEqual(['a']);
  });
});

describe('normalizeTitleBase', () => {
  it('keeps parenthesized title text when stripping a later suffix', () => {
    expect(normalizeTitleBase('tella Story(2012 Summer End Remix) [stella]')).toBe('tella story 2012 summer end remix');
    expect(normalizeTitleBase('Song (Remix)')).toBe('song remix');
  });

  it('strips supported trailing suffix wrappers', () => {
    expect(normalizeTitleBase('Title -ANOTHER-')).toBe('title');
    expect(normalizeTitleBase('Title [ANOTHER]')).toBe('title');
    expect(normalizeTitleBase('Title (ANOTHER)')).toBe('title');
    expect(normalizeTitleBase("Strawberry Mint Chocolate [v('ω')v]")).toBe('strawberry mint chocolate');
  });
});

describe('buildSimilarSearchRows', () => {
  it('adds BMS Path rows that are not already represented by table rows', () => {
    const table = row('table-a', 'Song', 'Artist', 'NO PLAY');
    const tableDuplicate = row('library-a', 'Song', 'Artist', 'NO PLAY', { tableName: 'BMS Path', level: 'folder', sha256: table.sha256 });
    const libraryOnly = row('library-b', 'Other Song', 'Artist', 'NO PLAY', { tableName: 'BMS Path', level: 'folder', sha256: 'library-only' });

    const result = buildSimilarSearchRows([table], [tableDuplicate, libraryOnly]);

    expect(result.map((item) => item.id)).toEqual(['table-a', 'library-b']);
    expect(result[1].tableName).toBe('BMS Path');
    expect(result[1].level).toBe('');
  });

  it('keeps the selected BMS Path chart even when its hash exists in a table', () => {
    const table = row('table-a', 'Song', 'Artist', 'NO PLAY', { sha256: 'same-hash' });
    const selectedLibrary = row('library-a', 'Song', 'Artist', 'NO PLAY', { tableName: 'BMS Path', level: 'folder', sha256: 'same-hash' });

    const result = buildSimilarSearchRows([table], [selectedLibrary], selectedLibrary);

    expect(result.map((item) => item.id)).toEqual(['library-a', 'table-a']);
    expect(result[0].level).toBe('');
  });
});

function row(
  id: string,
  title: string,
  artist: string,
  status: TableChartRow['status'],
  patch: Partial<TableChartRow> = {}
): TableChartRow {
  return {
    id,
    tableId: patch.tableId ?? 'table',
    tableName: patch.tableName ?? 'Table',
    tableUrl: '',
    level: patch.level ?? '★1',
    title,
    subtitle: '',
    artist,
    genre: '',
    md5: '',
    sha256: patch.sha256 ?? id,
    orgMd5: '',
    url1: '',
    url2: '',
    ipfs: '',
    appendIpfs: '',
    mode: 7,
    installed: status !== 'NO SONG',
    status,
    clear: null,
    notes: null,
    difficulty: null,
    songLevel: null,
    mainBpm: null,
    density: null,
    path: '',
    folder: ''
  };
}
