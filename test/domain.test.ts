import { describe, expect, it } from 'vitest';
import { clearToStatus, findSimilarRows } from '../src/shared/domain';
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
  it('prioritizes missing charts with matching title and artist', () => {
    const target = row('a', 'Song [A]', 'Artist', 'CLEAR');
    const installed = row('b', 'Song [H]', 'Artist', 'NO PLAY');
    const missing = row('c', 'Song [Another]', 'Artist', 'NO SONG');
    const unrelated = row('d', 'Other', 'Artist', 'NO SONG');
    const result = findSimilarRows(target, [target, installed, missing, unrelated]);

    expect(result.map((item) => item.id)).toEqual(['c', 'b']);
    expect(result[0].matchReason).toBe('title + artist');
  });

  it('does not treat empty or tiny titles as broad partial matches', () => {
    const target = row('a', 'サンバランド [DP BEGINNER]', 'SAMBA MASTER', 'NO PLAY');
    const blank = row('b', '', 'Music : NODATA', 'NO SONG');
    const tiny = row('c', 'サ', 'SAMBA MASTER', 'NO SONG');
    const good = row('d', 'サンバランド [POROTHER]', 'SAMBA MASTER', 'NO SONG');

    expect(findSimilarRows(target, [target, blank, tiny, good]).map((item) => item.id)).toEqual(['d']);
  });
});

function row(id: string, title: string, artist: string, status: TableChartRow['status']): TableChartRow {
  return {
    id,
    tableId: 'table',
    tableName: 'Table',
    tableUrl: '',
    level: '★1',
    title,
    subtitle: '',
    artist,
    genre: '',
    md5: '',
    sha256: id,
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