import { describe, expect, it } from 'vitest';
import { automaticallyMergedDuplicateGroupIds, duplicateDirectories, filterDuplicateGroups, uniquePaths } from '../src/renderer/duplicateGroupModel';
import type { DuplicateChartGroup, TableChartRow } from '../src/shared/types';

const copy = (id: string, path: string): TableChartRow => ({ id, path, folder: '', title: id, subtitle: '', artist: 'artist' } as TableChartRow);
const group = (id: string, paths: string[]): DuplicateChartGroup => ({
  id,
  title: 'Song',
  artist: 'Artist',
  copies: paths.map((path, index) => copy(`${id}-${index}`, path)),
  sharedSha256: ['abcdef'],
  sharedMd5: [],
  newestAddDate: null
});

describe('duplicate group model', () => {
  it('groups copies by normalized parent directory', () => {
    const directories = duplicateDirectories(group('one', ['C:\\BMS\\Song\\a.bms', 'c:/bms/song/b.bms', 'C:\\BMS\\Other\\c.bms']));
    expect(directories.map((item) => item.copyCount).sort()).toEqual([1, 2]);
  });

  it('finds groups eliminated by a directory merge', () => {
    const groups = [
      group('merged', ['C:/BMS/A/a.bms', 'C:/BMS/B/b.bms']),
      group('remaining', ['C:/BMS/A/c.bms', 'C:/BMS/C/d.bms'])
    ];
    expect(automaticallyMergedDuplicateGroupIds(groups, 'C:/BMS/A', ['C:/BMS/A', 'C:/BMS/B'])).toEqual(['merged']);
  });

  it('filters all searchable fields and deduplicates paths case-insensitively', () => {
    const groups = [group('one', ['C:/BMS/Target/a.bms'])];
    expect(filterDuplicateGroups(groups, 'target')).toEqual(groups);
    expect(uniquePaths(['C:/BMS/A', 'c:\\bms\\a', 'C:/BMS/B'])).toEqual(['C:/BMS/A', 'C:/BMS/B']);
  });
});
