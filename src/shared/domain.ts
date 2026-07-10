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
  return normalizeTitleText(stripTrailingDifficultyName(value));
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
    row.subartist,
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
  const targetTitle = normalizedTitle(target.title);
  const targetArtist = normalizeText(target.artist);
  const targetFull = `${targetTitle.text} ${targetArtist}`.trim();
  const candidates: TableChartRow[] = [];
  const canMatchOtherRows = Boolean(targetTitle.text || target.orgMd5 || target.md5);

  for (const row of rows) {
    let confidence = 0;
    let matchReason = '';

    if (row.id === target.id) {
      confidence = 1;
      matchReason = 'selected chart';
    } else if (!canMatchOtherRows) {
      confidence = 0;
    } else if (target.orgMd5 && (row.md5 === target.orgMd5 || row.orgMd5 === target.orgMd5)) {
      confidence = 0.98;
      matchReason = 'parent hash';
    } else if (target.md5 && row.orgMd5 && row.orgMd5 === target.md5) {
      confidence = 0.96;
      matchReason = 'parent hash';
    } else {
      const rowTitle = normalizedTitle(row.title);
      const rowArtist = normalizeText(row.artist);
      const rowFull = `${rowTitle.text} ${rowArtist}`.trim();

      if (!rowTitle.text) {
        confidence = 0;
      } else if (targetFull && rowFull === targetFull) {
        confidence = 0.94;
        matchReason = 'title + artist';
      } else if (sameNormalizedTitle(targetTitle, rowTitle) && targetArtist && rowArtist.includes(targetArtist)) {
        confidence = 0.88;
        matchReason = 'title + artist';
      } else if (targetTitle.text.length > 4 && sameNormalizedTitle(targetTitle, rowTitle)) {
        confidence = 0.8;
        matchReason = 'title';
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
  }).slice(0, 500);
}

export function buildSimilarSearchRows(
  tableRows: TableChartRow[],
  libraryRows: TableChartRow[],
  target?: TableChartRow
): TableChartRow[] {
  const tableHashes = new Set(tableRows.flatMap(rowHashKeys));
  const libraryOnlyRows = libraryRows
    .filter((row) => !rowHashKeys(row).some((hash) => tableHashes.has(hash)))
    .map((row) => ({ ...row, level: '' }));
  const rows = [...tableRows, ...libraryOnlyRows];

  if (target && !rows.some((row) => row.id === target.id)) {
    const targetRow = target.tableName === 'BMS Path' ? { ...target, level: '' } : target;
    return [targetRow, ...rows];
  }

  return rows;
}

interface NormalizedTitle {
  text: string;
  key: string;
}

const wrappedDifficultyPatterns = [
  /\s*(?:\[[^\]]+\]|【[^】]+】)\s*$/,
  /\s+[‐‑‒–—―-]\s*[^‐‑‒–—―-]+\s*[‐‑‒–—―-]\s*$/
];

function normalizedTitle(value: string): NormalizedTitle {
  const text = normalizeTitleBase(value);
  return { text, key: titleKey(text) };
}

function sameNormalizedTitle(a: NormalizedTitle, b: NormalizedTitle): boolean {
  return a.text === b.text || (!!a.key && a.key === b.key);
}

function stripTrailingDifficultyName(value: string): string {
  let title = value.normalize('NFKC').trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of wrappedDifficultyPatterns) {
      const next = title.replace(pattern, '').trim();
      if (next !== title) {
        title = next;
        changed = true;
      }
    }
  }

  const parenthesized = title.match(/\s*\(([^()]*)\)\s*$/);
  if (parenthesized && isLikelyDifficultyName(parenthesized[1])) {
    title = title.slice(0, parenthesized.index).trim();
  }

  return title;
}

function normalizeTitleText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[[\]【】()（）{}]/g, ' ')
    .replace(/[‐‑‒–—―-]/g, ' ')
    .replace(/[#★☆◆◇▼▽▲△◎○●]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleKey(value: string): string {
  return value.replace(/\s+/g, '');
}

function isLikelyDifficultyName(value: string): boolean {
  const normalized = normalizeTitleText(value);
  if (!normalized) return false;
  if (/^(sp|dp|another|hyper|normal|insane|easy|hard|ex|mx|maniac|lunatic|beginner|master|stella|sl|sabun)\b/.test(normalized)) {
    return true;
  }
  if (/^(a|h|n|e|b|i|l|ex)$/i.test(value.trim())) return true;
  return !/\s/.test(normalized) && normalized.length <= 16 && !/^[a-z0-9]+$/i.test(normalized);
}

function rowHashKeys(row: TableChartRow): string[] {
  return [
    row.sha256 ? `sha256:${row.sha256}` : '',
    row.md5 ? `md5:${row.md5}` : ''
  ].filter(Boolean);
}
