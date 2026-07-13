import { describe, expect, it } from 'vitest';
import {
  buildSimilarSearchRows,
  clearToStatus,
  createSameSongSearchIndex,
  findSimilarRows,
  normalizeArtistBase,
  normalizeTitleBase
} from '../src/shared/domain';
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

  it('matches short titles after removing chart and visual credits from the artist', () => {
    const target = row('hexagon', 'ニニ [Hexagon]', 'テヅカ × Qayo BGA: inukoro / obj.hex', 'NO SONG');
    const original = row('original', 'ニニ', 'テヅカ × Qayo', 'CLEAR', { subtitle: '[SP ANOTHER]' });
    const etude = row('etude', 'ニニ [Etude]', 'テヅカ × Qayo BGA: inukoro obj: И', 'NO SONG');
    const differentArtist = row('different', 'ニニ [Another]', '別のアーティスト', 'NO SONG');

    expect(findSimilarRows(target, [target, original, etude, differentArtist]).map((item) => item.id))
      .toEqual(['hexagon', 'etude', 'original']);
  });

  it('does not mix songs that only share a title', () => {
    const target = row('a', 'Same Name [ANOTHER]', 'First Artist obj:aaa', 'CLEAR');
    const sameSong = row('b', 'Same Name [HYPER]', 'First Artist', 'NO SONG');
    const otherSong = row('c', 'Same Name', 'Second Artist', 'NO SONG');

    expect(findSimilarRows(target, [target, sameSong, otherSong]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('does not use title prefixes or remove music-version suffixes', () => {
    const target = row('a', 'hoge', 'Artist', 'CLEAR');
    const euroMix = row('b', 'hoge -euro mix-', 'Artist', 'NO SONG');
    const longerTitle = row('c', 'hoge extended journey', 'Artist', 'NO SONG');
    const chartVariant = row('d', 'hoge -ANOTHER-', 'Artist', 'NO SONG');

    expect(findSimilarRows(target, [target, euroMix, longerTitle, chartVariant]).map((item) => item.id))
      .toEqual(['a', 'd']);
  });

  it('keeps featured performers as part of the musical artist identity', () => {
    const target = row('a', 'Song [A]', 'Producer feat: 初音ミク obj:fuga', 'CLEAR');
    const same = row('b', 'Song [H]', 'Producer feat: 初音ミク', 'NO SONG');
    const differentSinger = row('c', 'Song [N]', 'Producer feat: 重音テト obj:bar', 'NO SONG');

    expect(findSimilarRows(target, [target, same, differentSinger]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('uses explicit parent hashes even when metadata differs', () => {
    const target = row('a', 'Renamed Difference', 'Chart Author', 'NO SONG', { orgMd5: '0123456789abcdef0123456789abcdef' });
    const parent = row('b', 'Original Song', 'Music Artist', 'CLEAR', { md5: '0123456789abcdef0123456789abcdef' });

    expect(findSimilarRows(target, [target, parent]).map((item) => item.id)).toEqual(['a', 'b']);
    expect(findSimilarRows(target, [target, parent])[1].matchReason).toBe('parent hash');
  });

  it('matches arbitrary dashed and unwrapped chart names without merging music mixes', () => {
    const target = row('gaia', 'Air -GAIA-', 'SHIKI / obj.ぶんぺ～', 'NO SONG');
    const god = row('god', 'Air -GOD-', 'SHIKI / black train', 'CLEAR');
    const another = row('another', 'Air ANOTHER', 'SHIKI / rio', 'NO PLAY');
    const original = row('original', 'Air', 'SHIKI', 'NO PLAY');
    const musicMix = row('mix', 'Air -euro mix-', 'SHIKI', 'NO SONG');
    const otherArtist = row('other', 'Air -HELL-', 'Other Artist', 'NO SONG');

    expect(findSimilarRows(target, [target, god, another, original, musicMix, otherArtist]).map((item) => item.id))
      .toEqual(['gaia', 'original', 'god', 'another']);
  });

  it('matches bracketed and parenthesized CHERRY DOLL chart names', () => {
    const target = row('yamanashi', 'CHERRY DOLL [山梨]', 'カラフル・サウンズ・ポート obj:IBARAGI_YOSHIMI', 'NO SONG');
    const imperial = row('imperial', 'CHERRY DOLL(Imperial Rose)', 'カラフル・サウンズ・ポート ＋ aya (Sequence)', 'CLEAR');
    const normal = row('normal', 'CHERRY DOLL(Normal)', 'カラフル・サウンズ・ポート', 'NO PLAY');

    expect(findSimilarRows(target, [target, imperial, normal]).map((item) => item.id))
      .toEqual(['yamanashi', 'imperial', 'normal']);
  });

  it('uses a shared source to bridge inconsistent artist metadata for the same base title', () => {
    const target = row('long', '3丁目14番地の仔猫 (5long+7keys+3mine)', '美月 正', 'NO SONG', {
      url1: 'http://web.archive.org/web/20130427145910/http://tsubu.ath.cx/~ssry/music.htm'
    });
    const original = row('original', '3丁目14番地の仔猫 (7key)', '篠螺悠那', 'NO SONG', {
      url1: 'http://tsubu.ath.cx/~ssry/'
    });
    const inferno = row('inferno', '3丁目14番地の仔猫 [INFERNO]', '篠螺悠那 / obj:M.H', 'NO SONG', {
      url1: 'https://example.com/inferno'
    });
    const unrelated = row('unrelated', '3丁目14番地の仔猫 [OTHER]', 'Unrelated Artist', 'NO SONG', {
      url1: 'https://example.com/other'
    });

    expect(findSimilarRows(target, [target, original, inferno, unrelated]).map((item) => item.id))
      .toEqual(['long', 'original', 'inferno']);
    expect(findSimilarRows(target, [target, original])[1].matchReason).toBe('title + source');
  });

  it('normalizes bare slash chart-author suffixes', () => {
    const target = row('custom', '☆Traveling Sunstar☆ [7key ミ★★]', 'HOUJIROU/yokosuka', 'NO SONG');
    const original = row('original', 'Traveling Sunstar [7key]', 'HOUJIROU', 'NO PLAY');

    expect(findSimilarRows(target, [target, original]).map((item) => item.id)).toEqual(['custom', 'original']);
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

  it('only strips dashed suffixes that look like chart names', () => {
    expect(normalizeTitleBase('ニニ -巫-')).toBe('ニニ');
    expect(normalizeTitleBase('Air -GAIA-')).toBe('air');
    expect(normalizeTitleBase('beyond the limit -abyss-')).toBe('beyond the limit');
    expect(normalizeTitleBase('hoge -euro mix-')).toBe('hoge euro mix');
    expect(normalizeTitleBase('hoge [2026 Remix]')).toBe('hoge 2026 remix');
  });

  it('strips arbitrary parenthesized chart names but keeps music versions', () => {
    expect(normalizeTitleBase('CHERRY DOLL(Imperial Rose)')).toBe('cherry doll');
    expect(normalizeTitleBase('3丁目14番地の仔猫 (5long+7keys+3mine)')).toBe('3丁目14番地の仔猫');
    expect(normalizeTitleBase('Air ANOTHER')).toBe('air');
    expect(normalizeTitleBase('Song (Acoustic Version)')).toBe('song acoustic version');
  });
});

describe('normalizeArtistBase', () => {
  it('removes chart, BGA, and illustration credits appended to an artist', () => {
    expect(normalizeArtistBase('テヅカ × Qayo BGA: inukoro / obj.hex')).toBe('テヅカ × qayo');
    expect(normalizeArtistBase('Artist/obj.matsu BGI: Visual')).toBe('artist');
    expect(normalizeArtistBase('Artist Illust: Helper')).toBe('artist');
    expect(normalizeArtistBase('SHIKI / black train')).toBe('shiki');
    expect(normalizeArtistBase('Syatten #obj air')).toBe('syatten');
    expect(normalizeArtistBase('カラフル・サウンズ・ポート ＋ aya (Sequence)')).toBe('カラフル・サウンズ・ポート');
  });

  it('does not remove musical featured-artist credits', () => {
    expect(normalizeArtistBase('Producer feat: 初音ミク obj:fuga')).toBe('producer feat 初音ミク');
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

describe('createSameSongSearchIndex', () => {
  it('reuses preprocessed rows while preserving a selected library chart omitted as a duplicate', () => {
    const table = row('table-a', 'Air -GOD-', 'Artist', 'NO SONG', { sha256: 'same-hash' });
    const library = row('library-a', 'Air -GAIA-', 'Artist obj:author', 'CLEAR', {
      tableName: 'BMS Path',
      sha256: 'same-hash'
    });
    const other = row('table-b', 'Air', 'Artist', 'NO SONG');
    const index = createSameSongSearchIndex([table, other], [library]);

    expect(index.rowCount).toBe(2);
    expect(index.find(library).map((item) => item.id)).toEqual(['library-a', 'table-a', 'table-b']);
    expect(index.find(other).map((item) => item.id)).toEqual(['table-b', 'table-a']);
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
    subtitle: patch.subtitle ?? '',
    artist,
    genre: '',
    md5: patch.md5 ?? '',
    sha256: patch.sha256 ?? id,
    orgMd5: patch.orgMd5 ?? '',
    url1: patch.url1 ?? '',
    url2: patch.url2 ?? '',
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
    path: patch.path ?? '',
    folder: ''
  };
}
