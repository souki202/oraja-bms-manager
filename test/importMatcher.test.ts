import { describe, expect, it } from 'vitest';
import { rankImportCandidates } from '../src/shared/importMatcher';
import type { DroppedChartMetadata, TableChartRow } from '../src/shared/types';

describe('rankImportCandidates', () => {
  it('prioritizes an exact diff-title match over a base-title match', () => {
    const dropped = chart('F:\\Downloads\\Song [INSANE].bms', 'Song [INSANE]', 'Artist');
    const rows = [
      row('normal', 'Song', 'Artist', 'F:\\BMS\\Song\\normal.bms'),
      row('insane', 'Song [INSANE]', 'Artist', 'F:\\BMS\\SongInsane\\insane.bms')
    ];

    const candidates = rankImportCandidates(dropped, rows);

    expect(candidates[0].destinationDirectory).toBe('F:\\BMS\\SongInsane');
    expect(candidates[0].matchReason).toContain('exact title');
  });

  it('uses multiple close rows in the same folder as extra evidence', () => {
    const dropped = chart('F:\\Downloads\\Blue Moment [A].bms', 'Blue Moment [A]', 'Alpha');
    const rows = [
      row('a', 'Blue Moment [N]', 'Alpha', 'F:\\BMS\\BlueMoment\\normal.bms'),
      row('b', 'Blue Moment [H]', 'Alpha', 'F:\\BMS\\BlueMoment\\hyper.bms'),
      row('c', 'Blue Moon', 'Alpha', 'F:\\BMS\\BlueMoon\\blue.bms')
    ];

    const candidates = rankImportCandidates(dropped, rows);

    expect(candidates[0].destinationDirectory).toBe('F:\\BMS\\BlueMoment');
    expect(candidates[0].existingTitles).toEqual(['Blue Moment [N]', 'Blue Moment [H]']);
  });

  it('does not return candidates for one-character containment noise', () => {
    const dropped = chart('F:\\Downloads\\K.bms', 'K', 'Artist');
    const rows = [
      row('faraway', 'Faraway Sky', 'Other', 'F:\\BMS\\FarawaySky\\faraway.bms')
    ];

    expect(rankImportCandidates(dropped, rows)).toEqual([]);
  });

  it('does not use mid-title substring matches as import destinations', () => {
    const dropped = chart('F:\\Downloads\\Moment.bms', 'Moment', 'Alpha');
    const rows = [
      row('blue-moment', 'Blue Moment', 'Alpha', 'F:\\BMS\\BlueMoment\\normal.bms')
    ];

    expect(rankImportCandidates(dropped, rows)).toEqual([]);
  });

  it('still supports exact short titles and short base-title matches', () => {
    const oneLetter = chart('F:\\Downloads\\K.bms', 'K', 'Artist');
    const twoLetters = chart('F:\\Downloads\\AA.bms', 'AA [INSANE]', 'Artist');
    const rows = [
      row('k', 'K [HYPER]', 'Artist', 'F:\\BMS\\K\\k_h.bms'),
      row('aa', 'AA', 'Artist', 'F:\\BMS\\AA\\aa.bms')
    ];

    expect(rankImportCandidates(oneLetter, rows)[0].destinationDirectory).toBe('F:\\BMS\\K');
    expect(rankImportCandidates(twoLetters, rows)[0].destinationDirectory).toBe('F:\\BMS\\AA');
  });
});

function chart(sourcePath: string, title: string, artist: string): DroppedChartMetadata {
  return {
    sourcePath,
    fileName: sourcePath.split('\\').pop() ?? sourcePath,
    title,
    subtitle: '',
    artist,
    genre: '',
    md5: 'dropped-md5',
    sha256: 'dropped-sha',
    mode: 7
  };
}

function row(id: string, title: string, artist: string, filePath: string): TableChartRow {
  return {
    id,
    tableId: '__library',
    tableName: 'BMS Path',
    tableUrl: '',
    level: '',
    title,
    subtitle: '',
    artist,
    genre: '',
    md5: `md5-${id}`,
    sha256: `sha-${id}`,
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
    path: filePath,
    folder: ''
  };
}
