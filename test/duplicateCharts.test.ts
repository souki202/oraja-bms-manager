import { describe, expect, it } from 'vitest';
import { countRedundantChartCopies, findDuplicateChartGroups } from '../src/shared/duplicateCharts';
import type { TableChartRow } from '../src/shared/types';

describe('findDuplicateChartGroups', () => {
  it('groups every installed location sharing SHA-256 or MD5', () => {
    const rows = [
      chart('a', 'C:\\BMS\\one\\chart.bms', 'a'.repeat(64), '1'.repeat(32)),
      chart('b', 'C:\\BMS\\two\\chart.bms', 'a'.repeat(64), '2'.repeat(32)),
      chart('c', 'C:\\BMS\\three\\chart.bms', 'c'.repeat(64), '2'.repeat(32)),
      chart('d', 'C:\\BMS\\other\\chart.bms', 'd'.repeat(64), '4'.repeat(32))
    ];

    const groups = findDuplicateChartGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].copies.map((row) => row.id)).toEqual(['a', 'c', 'b']);
    expect(groups[0].sharedSha256).toEqual(['a'.repeat(64)]);
    expect(groups[0].sharedMd5).toEqual(['2'.repeat(32)]);
    expect(countRedundantChartCopies(groups)).toBe(2);
  });

  it('does not count duplicate database rows for the same path as multiple locations', () => {
    const rows = [
      chart('a', 'C:\\BMS\\one\\chart.bms', 'a'.repeat(64), '1'.repeat(32)),
      chart('b', 'c:/bms/one/chart.bms', 'a'.repeat(64), '1'.repeat(32)),
      chart('c', 'C:\\BMS\\two\\chart.bms', 'a'.repeat(64), '1'.repeat(32))
    ];

    const groups = findDuplicateChartGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].copies).toHaveLength(2);
  });

  it('ignores missing and malformed hashes', () => {
    const rows = [
      chart('a', 'C:\\BMS\\one\\chart.bms', '', ''),
      chart('b', 'C:\\BMS\\two\\chart.bms', 'not-a-hash', 'not-a-hash')
    ];

    expect(findDuplicateChartGroups(rows)).toEqual([]);
  });
});

function chart(id: string, filePath: string, sha256: string, md5: string): TableChartRow {
  return {
    id,
    tableId: '__library',
    tableName: 'BMS Path',
    tableUrl: '',
    level: '',
    title: `Chart ${id}`,
    subtitle: '',
    artist: 'Artist',
    genre: '',
    md5,
    sha256,
    orgMd5: '',
    url1: '',
    url2: '',
    ipfs: '',
    appendIpfs: '',
    mode: 7,
    installed: true,
    status: 'NO PLAY',
    clear: null,
    notes: 1000,
    difficulty: 3,
    songLevel: 12,
    mainBpm: 150,
    density: 10,
    path: filePath,
    folder: ''
  };
}
