import { describe, expect, it } from 'vitest';
import { buildBmsPathExport, buildTableExport } from '../src/shared/exportTable';
import type { DirectoryNode, TableChartRow, TableSummary } from '../src/shared/types';
import packageJson from '../package.json';

const editorVersion = String(packageJson.version ?? '');

describe('buildTableExport', () => {
  it('creates BeMusicSeeker-style header and data payloads', () => {
    const table: TableSummary = {
      id: 'dystopia.bmt',
      name: 'Dystopia難易度表',
      url: 'https://example.test/header.json',
      tag: 'dy',
      fileName: 'dystopia.bmt',
      folderCount: 2,
      chartCount: 2,
      missingCount: 1
    };
    const rows = [
      row('a', 'LEVEL 0', '0', 'https://song.example', 'https://diff.example'),
      row('b', 'LEVEL ？', '？', '', 'https://diff2.example')
    ];

    const exported = buildTableExport(table, rows, '2026/05/14', editorVersion);

    expect(exported.header).toMatchObject({
      name: 'Dystopia難易度表',
      symbol: 'dy',
      level_order: ['0', '？'],
      folder_order: ['LEVEL 0', 'LEVEL ？'],
      data_url: 'https://example.test/header.json',
      compat_prefix: 'LEVEL ',
      last_update: '2026/05/14',
      editor_version: editorVersion,
      output_date: '2026/05/14'
    });
    expect(exported.data[0]).toMatchObject({
      md5: 'md5-a',
      sha256: 'sha-a',
      org_level: 0,
      title: 'Title 0',
      artist: 'Artist',
      folder: 'LEVEL 0',
      level: '0',
      url: 'https://song.example',
      url_diff: 'https://diff.example',
      org_md5s: ['parent-a'],
      org_md5: 'parent-a'
    });
    expect(exported.data[1].org_level).toBeNull();
  });
});

describe('buildBmsPathExport', () => {
  it('creates table-shaped payloads from BMS Path rows', () => {
    const root: DirectoryNode = {
      id: 'bms-root-0',
      name: 'F:\\Games\\LR2\\songs\\BMSをたくさん作るぜ',
      path: 'F:\\Games\\LR2\\songs\\BMSをたくさん作るぜ',
      isRoot: true
    };
    const rows = [
      libraryRow('14h', 'Golden Harvest [14key Hyper]', 'F:\\Games\\LR2\\songs\\BMSをたくさん作るぜ\\Golden_Harvest\\14H.bms', 'a87b4f225d0663a22fe7781ac94689b4', 10),
      libraryRow('7a', 'Golden Harvest [7key Another]', 'F:\\Games\\LR2\\songs\\BMSをたくさん作るぜ\\Golden_Harvest\\7A.bms', 'd756ea85107f332cb82d6c1a46b3f4ac', 12),
      libraryRow('other', 'Outside', 'F:\\Games\\LR2\\songs\\Other\\outside.bms', 'outside-md5', 1)
    ];

    const exported = buildBmsPathExport(root, rows, '2026/05/14', editorVersion);

    expect(exported.header).toMatchObject({
      name: 'BMSをたくさん作るぜ',
      level_order: [],
      folder_order: [],
      last_update: '2026/05/14',
      editor_version: editorVersion,
      output_date: '2026/05/14'
    });
    expect(exported.data).toHaveLength(2);
    expect(exported.data[1]).toMatchObject({
      md5: 'd756ea85107f332cb82d6c1a46b3f4ac',
      sha256: 'sha-7a',
      org_level: 12,
      title: 'Golden Harvest [7key Another]',
      artist: 'freesia',
      folder: '',
      level: '',
      url: '',
      url_diff: '',
      org_md5s: [
        'a87b4f225d0663a22fe7781ac94689b4',
        'd756ea85107f332cb82d6c1a46b3f4ac'
      ],
      org_md5: 'a87b4f225d0663a22fe7781ac94689b4',
      adddate: '2026/05/22'
    });
  });
});

function row(id: string, folder: string, level: string, url1: string, url2: string): TableChartRow {
  return {
    id,
    tableId: 'dystopia.bmt',
    tableName: 'Dystopia難易度表',
    tableUrl: 'https://example.test/header.json',
    level: folder,
    title: `Title ${level}`,
    subtitle: '',
    artist: 'Artist',
    genre: '',
    md5: `md5-${id}`,
    sha256: `sha-${id}`,
    orgMd5: `parent-${id}`,
    url1,
    url2,
    ipfs: '',
    appendIpfs: '',
    mode: 7,
    installed: false,
    status: 'NO SONG',
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

function libraryRow(id: string, title: string, filePath: string, md5: string, songLevel: number): TableChartRow {
  return {
    id,
    tableId: '__library',
    tableName: 'BMS Path',
    tableUrl: '',
    level: 'Golden_Harvest',
    title,
    subtitle: '',
    artist: 'freesia',
    genre: '',
    md5,
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
    songLevel,
    mainBpm: null,
    density: null,
    path: filePath,
    folder: '',
    addDate: 1779434395
  };
}
