import { normalizeText, normalizeTitleBase } from './domain';
import type { DroppedChartMetadata, ImportCandidate, TableChartRow } from './types';

interface ScoredRow {
  row: PreparedLibraryRow;
  score: number;
  reason: string;
}

export interface ImportMatcher {
  rank(dropped: DroppedChartMetadata): ImportCandidate[];
}

interface PreparedDroppedChart {
  full: string;
  fullKey: string;
  base: string;
  baseKey: string;
  artist: string;
  mode: number | null;
  md5: string;
  sha256: string;
  baseGrams: string[];
  baseGramCounts: Map<string, number>;
}

interface PreparedLibraryRow {
  row: TableChartRow;
  full: string;
  fullKey: string;
  base: string;
  baseKey: string;
  artist: string;
  mode: number | null;
  md5: string;
  sha256: string;
  directory: string;
  title: string;
}

interface ImportMatcherIndex {
  rowsBySha256: Map<string, PreparedLibraryRow[]>;
  rowsByMd5: Map<string, PreparedLibraryRow[]>;
  rowsByFullKey: Map<string, PreparedLibraryRow[]>;
  rowsByBaseKey: Map<string, PreparedLibraryRow[]>;
  rowsByBasePrefix: Map<string, PreparedLibraryRow[]>;
  rowsByDirectory: Map<string, PreparedLibraryRow[]>;
}

const prefixStages = [16, 12, 8, 5, 3, 2, 1];
const maxRowsToScore = 2500;

export function createImportMatcher(libraryRows: TableChartRow[]): ImportMatcher {
  const index = createImportMatcherIndex(libraryRows);
  return {
    rank(dropped) {
      return rankPreparedImportCandidates(prepareDropped(dropped), index);
    }
  };
}

export function rankImportCandidates(dropped: DroppedChartMetadata, libraryRows: TableChartRow[]): ImportCandidate[] {
  return createImportMatcher(libraryRows).rank(dropped);
}

function rankPreparedImportCandidates(prepared: PreparedDroppedChart, index: ImportMatcherIndex): ImportCandidate[] {
  const scoredByDirectory = new Map<string, ScoredRow[]>();
  const candidateRows = collectCandidateRows(prepared, index);

  for (const row of candidateRows) {
    const scored = scoreRow(prepared, row);
    if (scored.score < 32) continue;

    const directory = row.directory;
    if (!directory) continue;
    const scoredRows = scoredByDirectory.get(directory) ?? [];
    scoredRows.push(scored);
    scoredByDirectory.set(directory, scoredRows);
  }

  const candidateDirectories = new Set(scoredByDirectory.keys());
  const existingTitlesByDirectory = collectExistingTitles(index, candidateDirectories);
  const candidates: ImportCandidate[] = [];

  for (const [directory, scoredRows] of scoredByDirectory) {
    scoredRows.sort((a, b) => b.score - a.score);
    const best = scoredRows[0];
    const evidenceBonus = Math.min(10, Math.max(0, scoredRows.length - 1) * 2);
    const score = Math.min(200, best.score + evidenceBonus);
    candidates.push({
      id: directory,
      destinationDirectory: directory,
      score,
      confidence: Math.min(1, score / 160),
      matchReason: best.reason,
      matchedTitle: best.row.title,
      matchedArtist: best.row.row.artist,
      existingTitles: existingTitlesByDirectory.get(directory) ?? [],
      rowIds: scoredRows.slice(0, 12).map((item) => item.row.row.id)
    });
  }

  return candidates
    .sort((a, b) => {
      const score = b.score - a.score;
      if (score !== 0) return score;
      return a.destinationDirectory.localeCompare(b.destinationDirectory, 'ja', { numeric: true, sensitivity: 'base' });
    })
    .slice(0, 12);
}

function createImportMatcherIndex(libraryRows: TableChartRow[]): ImportMatcherIndex {
  const index: ImportMatcherIndex = {
    rowsBySha256: new Map(),
    rowsByMd5: new Map(),
    rowsByFullKey: new Map(),
    rowsByBaseKey: new Map(),
    rowsByBasePrefix: new Map(),
    rowsByDirectory: new Map()
  };

  for (const row of libraryRows) {
    const prepared = prepareLibraryRow(row);
    if (!prepared.directory) continue;

    addToMap(index.rowsBySha256, prepared.sha256, prepared);
    addToMap(index.rowsByMd5, prepared.md5, prepared);
    addToMap(index.rowsByFullKey, prepared.fullKey, prepared);
    addToMap(index.rowsByBaseKey, prepared.baseKey, prepared);
    addToMap(index.rowsByDirectory, prepared.directory, prepared);

    for (const key of prefixKeys(prepared.baseKey)) {
      addToMap(index.rowsByBasePrefix, key, prepared);
    }
  }

  return index;
}

function prepareDropped(dropped: DroppedChartMetadata): PreparedDroppedChart {
  const full = normalizeTitleFull(`${dropped.title} ${dropped.subtitle}`.trim());
  const base = normalizeTitleBase(`${dropped.title} ${dropped.subtitle}`.trim());
  const baseGrams = compact(base).length > 2 ? ngrams(compact(base)) : [];
  return {
    full,
    fullKey: compact(full),
    base,
    baseKey: compact(base),
    artist: normalizeText(dropped.artist),
    mode: dropped.mode,
    md5: dropped.md5,
    sha256: dropped.sha256,
    baseGrams,
    baseGramCounts: gramCounts(baseGrams)
  };
}

function prepareLibraryRow(row: TableChartRow): PreparedLibraryRow {
  const rawTitle = `${row.title} ${row.subtitle}`.trim();
  const full = normalizeTitleFull(rawTitle);
  const base = normalizeTitleBase(rawTitle);
  return {
    row,
    full,
    fullKey: compact(full),
    base,
    baseKey: compact(base),
    artist: normalizeText(row.artist),
    mode: row.mode,
    md5: row.md5,
    sha256: row.sha256,
    directory: row.path ? directoryName(row.path) : normalizedDirectory(row.folder),
    title: displayTitle(row)
  };
}

function collectCandidateRows(dropped: PreparedDroppedChart, index: ImportMatcherIndex): PreparedLibraryRow[] {
  const candidates = new Map<string, PreparedLibraryRow>();
  addCandidateRows(candidates, dropped.sha256 ? index.rowsBySha256.get(dropped.sha256) : undefined);
  addCandidateRows(candidates, dropped.md5 ? index.rowsByMd5.get(dropped.md5) : undefined);
  addCandidateRows(candidates, dropped.fullKey ? index.rowsByFullKey.get(dropped.fullKey) : undefined);
  addCandidateRows(candidates, dropped.baseKey ? index.rowsByBaseKey.get(dropped.baseKey) : undefined);

  if (dropped.baseKey) {
    for (const key of searchPrefixKeys(dropped.baseKey)) {
      addCandidateRows(candidates, index.rowsByBasePrefix.get(key));
      if (candidates.size >= maxRowsToScore) break;
    }
  }

  return [...candidates.values()];
}

function scoreRow(dropped: PreparedDroppedChart, row: PreparedLibraryRow): ScoredRow {
  let score = 0;
  const reasons: string[] = [];

  if (dropped.sha256 && dropped.sha256 === row.sha256) {
    score += 130;
    reasons.push('same SHA-256');
  } else if (dropped.md5 && dropped.md5 === row.md5) {
    score += 125;
    reasons.push('same MD5');
  }

  if (dropped.full && dropped.full === row.full) {
    score += 92;
    reasons.push('exact title');
  } else if (isPrefixTitleMatch(dropped.fullKey, row.fullKey)) {
    score += 62;
    reasons.push('title prefix');
  }

  if (shouldCheckBaseTitle(dropped.baseKey, row.baseKey)) {
    if (dropped.base && dropped.base === row.base) {
      score += 68;
      reasons.push('same base title');
    } else if (isPrefixTitleMatch(dropped.baseKey, row.baseKey)) {
      score += 48;
      reasons.push('base title prefix');
    } else if (shouldCheckSimilarity(dropped.baseKey, row.baseKey)) {
      const similarity = titleSimilarity(dropped, row.base);
      if (similarity >= 0.72) {
        score += Math.round(similarity * 58);
        reasons.push('similar title');
      }
    }
  }

  if (score > 0 && dropped.artist) {
    if (dropped.artist === row.artist) {
      score += 18;
      reasons.push('same artist');
    } else if (isMeaningfulContainment(dropped.artist, row.artist)) {
      score += 10;
      reasons.push('similar artist');
    }
  }

  if (score > 0 && dropped.mode != null && row.mode != null && dropped.mode === row.mode) {
    score += 6;
  }

  return {
    row,
    score,
    reason: reasons.length > 0 ? reasons.slice(0, 3).join(' + ') : 'similar metadata'
  };
}

function collectExistingTitles(index: ImportMatcherIndex, candidateDirectories: Set<string>): Map<string, string[]> {
  const titlesByDirectory = new Map<string, string[]>();
  for (const directory of candidateDirectories) {
    const rows = index.rowsByDirectory.get(directory) ?? [];
    const titles = titlesByDirectory.get(directory) ?? [];
    for (const row of rows) {
      if (titles.length >= 8) break;
      const title = row.title;
      if (title && !titles.includes(title)) titles.push(title);
    }
    titlesByDirectory.set(directory, titles);
  }
  return titlesByDirectory;
}

function addCandidateRows(candidates: Map<string, PreparedLibraryRow>, rows: PreparedLibraryRow[] | undefined): void {
  if (!rows) return;
  for (const row of rows) {
    candidates.set(row.row.id, row);
    if (candidates.size >= maxRowsToScore) return;
  }
}

function addToMap(map: Map<string, PreparedLibraryRow[]>, key: string, row: PreparedLibraryRow): void {
  if (!key) return;
  const rows = map.get(key) ?? [];
  rows.push(row);
  map.set(key, rows);
}

function prefixKeys(value: string): string[] {
  return prefixStages
    .filter((length) => value.length >= length)
    .map((length) => prefixKey(length, value.slice(0, length)));
}

function searchPrefixKeys(value: string): string[] {
  const keys = prefixKeys(value);
  if (keys.length > 0) return keys;
  return value ? [prefixKey(value.length, value)] : [];
}

function prefixKey(length: number, value: string): string {
  return `${length}:${value}`;
}

function normalizeTitleFull(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{}<>]/g, ' ')
    .replace(/[-_#:;,.+/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrefixTitleMatch(aKey: string, bKey: string): boolean {
  if (!aKey || !bKey || aKey === bKey) return false;
  const shorter = aKey.length <= bKey.length ? aKey : bKey;
  const longer = aKey.length <= bKey.length ? bKey : aKey;
  if (shorter.length <= 2) return longer.startsWith(shorter) && longer.length <= shorter.length + 5;
  return longer.startsWith(shorter);
}

function isMeaningfulContainment(aKey: string, bKey: string): boolean {
  if (!aKey || !bKey || aKey === bKey) return false;
  const shorter = aKey.length <= bKey.length ? aKey : bKey;
  const longer = aKey.length <= bKey.length ? bKey : aKey;
  return shorter.length >= 3 && longer.includes(shorter);
}

function shouldCheckSimilarity(aKey: string, bKey: string): boolean {
  if (aKey.length <= 2 || bKey.length <= 2) return false;
  const shortest = Math.min(aKey.length, bKey.length);
  const longest = Math.max(aKey.length, bKey.length);
  if (shortest / longest < 0.5) return false;
  return aKey[0] === bKey[0] || aKey.slice(-1) === bKey.slice(-1) || hasSharedBigram(aKey, bKey);
}

function shouldCheckBaseTitle(droppedBaseKey: string, rowBaseKey: string): boolean {
  if (!droppedBaseKey || !rowBaseKey) return false;
  if (droppedBaseKey.length <= 2) {
    return rowBaseKey === droppedBaseKey || (rowBaseKey.startsWith(droppedBaseKey) && rowBaseKey.length <= droppedBaseKey.length + 5);
  }
  return isPrefixTitleMatch(droppedBaseKey, rowBaseKey) || shouldCheckSimilarity(droppedBaseKey, rowBaseKey);
}

function titleSimilarity(dropped: PreparedDroppedChart, b: string): number {
  const aKey = dropped.baseKey;
  const bKey = compact(b);
  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;
  const gramsA = dropped.baseGrams;
  if (gramsA.length === 0) return 0;
  const gramsB = ngrams(bKey);
  const aCounts = new Map(dropped.baseGramCounts);
  let intersection = 0;
  for (const gram of gramsB) {
    const count = aCounts.get(gram) ?? 0;
    if (count === 0) continue;
    intersection += 1;
    aCounts.set(gram, count - 1);
  }
  return (2 * intersection) / (gramsA.length + gramsB.length);
}

function hasSharedBigram(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  for (let index = 0; index < shorter.length - 1; index += 1) {
    if (longer.includes(shorter.slice(index, index + 2))) return true;
  }
  return false;
}

function ngrams(value: string): string[] {
  if (value.length <= 2) return [value];
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function gramCounts(grams: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  return counts;
}

function directoryName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) return '';
  return filePath.slice(0, separator);
}

function normalizedDirectory(directory: string): string {
  return directory.replace(/[\\/]+$/, '');
}

function displayTitle(row: TableChartRow): string {
  return `${row.title}${row.subtitle ? ` ${row.subtitle}` : ''}`.trim();
}
