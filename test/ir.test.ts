import { describe, expect, it } from 'vitest';
import { bokutachiGameForMode, buildStaticIrUrl, canOpenBokutachi, extractBokutachiChartId, hasAnyIrTarget } from '../src/shared/ir';
import type { TableChartRow } from '../src/shared/types';

describe('IR helpers', () => {
  it('maps supported key modes to bokutachi games', () => {
    expect(bokutachiGameForMode(7)).toBe('bms-7k');
    expect(bokutachiGameForMode(14)).toBe('bms-14k');
    expect(bokutachiGameForMode(9)).toBe('pms-controller');
    expect(bokutachiGameForMode(5)).toBeNull();
    expect(bokutachiGameForMode(null)).toBeNull();
  });

  it('enables bokutachi only for supported modes with sha256 or md5', () => {
    expect(canOpenBokutachi(row({ mode: 7, sha256: 'a'.repeat(64) }))).toBe(true);
    expect(canOpenBokutachi(row({ mode: 14, md5: 'b'.repeat(32) }))).toBe(true);
    expect(canOpenBokutachi(row({ mode: 9, sha256: 'a'.repeat(64), md5: 'b'.repeat(32) }))).toBe(true);
    expect(canOpenBokutachi(row({ mode: 5, sha256: 'a'.repeat(64) }))).toBe(false);
    expect(canOpenBokutachi(row({ mode: 7 }))).toBe(false);
  });

  it('keeps the IR submenu available when any target can open', () => {
    expect(hasAnyIrTarget(row({ mode: 5, sha256: 'a'.repeat(64) }))).toBe(true);
    expect(hasAnyIrTarget(row({ mode: 7, md5: 'b'.repeat(32) }))).toBe(true);
    expect(hasAnyIrTarget(row({ mode: 5, md5: 'b'.repeat(32) }))).toBe(true);
    expect(hasAnyIrTarget(row({ mode: 5 }))).toBe(false);
  });

  it('builds static IR URLs from the hash required by each service', () => {
    const chart = row({ sha256: 'ABCDEF', md5: '751738DEA1169C5C39DB935ADFC9E85F' });
    expect(buildStaticIrUrl(chart, 'mocha')).toBe('https://mocha-repository.info/song.php?sha256=abcdef');
    expect(buildStaticIrUrl(chart, 'minir')).toBe('https://www.gaftalk.com/minir/#/viewer/song/abcdef/0');
    expect(buildStaticIrUrl(chart, 'bms-ir')).toBe('https://www.bms-ir.org/new/song?songmd5=751738dea1169c5c39db935adfc9e85f&client_view=all_clients');
    expect(buildStaticIrUrl(row({ sha256: 'ABCDEF' }), 'bms-ir')).toBe('');
  });

  it('extracts bokutachi chart ids from current and legacy-shaped API responses', () => {
    expect(extractBokutachiChartId({ body: { chart: { chartID: 'C19d35e1312b608ef54f' } } })).toBe('C19d35e1312b608ef54f');
    expect(extractBokutachiChartId({ chart: { chartID: 'legacy-shape' } })).toBe('legacy-shape');
    expect(extractBokutachiChartId({ success: false })).toBeNull();
  });
});

function row(patch: Partial<TableChartRow>): TableChartRow {
  return {
    id: 'id',
    tableId: 'table',
    tableName: 'Table',
    tableUrl: '',
    level: '',
    title: '',
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
    mode: null,
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
    ...patch
  };
}
