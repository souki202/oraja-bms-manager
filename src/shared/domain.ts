import type { ClearStatus, TableChartRow } from './types';

export function clearToStatus(clear: number | null | undefined): ClearStatus {
  if (clear == null || clear <= 0) return 'NO PLAY';
  if (clear >= 8) return 'FULL COMBO';
  if (clear === 7) return 'EX HARD CLEAR';
  if (clear === 6) return 'HARD CLEAR';
  if (clear === 5) return 'CLEAR';
  if (clear === 4) return 'EASY CLEAR';
  if (clear === 2 || clear === 3) return 'ASSIST CLEAR';
  return 'FAILED';
}

export function statusClass(status: ClearStatus): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[[\]【】()（）{}]/g, ' ')
    .replace(/\b(sp|dp|another|hyper|normal|insane|easy|hard|ex|mx|maniac|lunatic)\b/g, ' ')
    .replace(/[#★☆◆◇▼▽▲△◎○●]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitleBase(value: string): string {
  return normalizeText(
    value
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/【[^】]+】/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/（[^）]*）/g, ' ')
  );
}

export function rowMatchesSearch(row: TableChartRow, query: string): boolean {
  const normalized = normalizeText(query);
  if (!normalized) return true;
  const haystack = normalizeText([
    row.tableName,
    row.level,
    row.title,
    row.subtitle,
    row.artist,
    row.genre,
    row.md5,
    row.sha256,
    row.path,
    row.folder,
    row.status
  ].join(' '));
  return haystack.includes(normalized);
}

export function findSimilarRows(target: TableChartRow, rows: TableChartRow[]): TableChartRow[] {
  const targetTitle = normalizeTitleBase(target.title);
  const targetArtist = normalizeText(target.artist);
  const targetFull = normalizeText(`${targetTitle} ${targetArtist}`);
  const candidates: TableChartRow[] = [];

  for (const row of rows) {
    if (row.id === target.id) continue;

    let confidence = 0;
    let matchReason = '';

    if (target.orgMd5 && (row.md5 === target.orgMd5 || row.orgMd5 === target.orgMd5)) {
      confidence = 0.98;
      matchReason = 'parent hash';
    } else if (target.md5 && row.orgMd5 && row.orgMd5 === target.md5) {
      confidence = 0.96;
      matchReason = 'parent hash';
    } else {
      const rowTitle = normalizeTitleBase(row.title);
      const rowArtist = normalizeText(row.artist);
      const rowFull = normalizeText(`${rowTitle} ${rowArtist}`);

      if (targetFull && rowFull === targetFull) {
        confidence = 0.94;
        matchReason = 'title + artist';
      } else if (targetTitle && rowTitle === targetTitle && targetArtist && rowArtist.includes(targetArtist)) {
        confidence = 0.88;
        matchReason = 'title + artist';
      } else if (targetTitle.length > 4 && rowTitle === targetTitle) {
        confidence = 0.8;
        matchReason = 'title';
      } else if (targetTitle.length > 5 && (rowTitle.includes(targetTitle) || targetTitle.includes(rowTitle))) {
        confidence = 0.68;
        matchReason = 'partial title';
      }
    }

    if (confidence >= 0.65) {
      candidates.push({ ...row, confidence, matchReason });
    }
  }

  return candidates.sort((a, b) => {
    const score = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (score !== 0) return score;
    if (a.status === 'NO SONG' && b.status !== 'NO SONG') return -1;
    if (b.status === 'NO SONG' && a.status !== 'NO SONG') return 1;
    return a.title.localeCompare(b.title, 'ja');
  });
}