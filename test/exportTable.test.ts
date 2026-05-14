import { describe, expect, it } from 'vitest';
import { buildTableExport } from '../src/shared/exportTable';
import type { TableChartRow, TableSummary } from '../src/shared/types';

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

    const exported = buildTableExport(table, rows, '2026/05/14');

    expect(exported.header).toMatchObject({
      name: 'Dystopia難易度表',
      symbol: 'dy',
      level_order: ['0', '？'],
      folder_order: ['LEVEL 0', 'LEVEL ？'],
      data_url: 'https://example.test/header.json',
      compat_prefix: 'LEVEL ',
      output_date: '2026/05/14'
    });
    expect(exported.data[0]).toMatchObject({
      md5: 'md5-a',
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