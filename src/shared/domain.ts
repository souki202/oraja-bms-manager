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

export function normalizeArtistBase(value: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const contributor = normalized.match(contributorCreditPattern);
  let artist = contributor ? normalized.slice(0, contributor.index).trim() : normalized;
  artist = artist.replace(sequenceCreditPattern, '').trim();
  const slashIndex = artist.indexOf('/');
  if (slashIndex >= 0) artist = artist.slice(0, slashIndex).trim();
  return normalizeIdentityText(artist);
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

export interface SameSongSearchIndex {
  readonly rowCount: number;
  find(target: TableChartRow): TableChartRow[];
}

export function createSameSongSearchIndex(
  tableRows: TableChartRow[],
  libraryRows: TableChartRow[]
): SameSongSearchIndex {
  return createSameSongSearchIndexFromRows(buildSimilarSearchRows(tableRows, libraryRows));
}

export function findSimilarRows(target: TableChartRow, rows: TableChartRow[]): TableChartRow[] {
  return createSameSongSearchIndexFromRows(rows).find(target);
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

interface PreparedSongRow {
  row: TableChartRow;
  identity: SongIdentity;
  sha256: string;
  md5: string;
  parentHashes: Set<string>;
  primaryParentHashes: Set<string>;
  sourceKeys?: Set<string>;
  directory?: string;
  isBmsPath: boolean;
}

interface SameSongIndexData {
  preparedByRow: WeakMap<TableChartRow, PreparedSongRow>;
  rowsById: Map<string, PreparedSongRow>;
  rowsByTitle: Map<string, PreparedSongRow[]>;
  rowsBySha256: Map<string, PreparedSongRow[]>;
  rowsByMd5: Map<string, PreparedSongRow[]>;
  rowsByParentHash: Map<string, PreparedSongRow[]>;
  rowsByPrimaryParentHash: Map<string, PreparedSongRow[]>;
}

function createSameSongSearchIndexFromRows(rows: TableChartRow[]): SameSongSearchIndex {
  const data: SameSongIndexData = {
    preparedByRow: new WeakMap(),
    rowsById: new Map(),
    rowsByTitle: new Map(),
    rowsBySha256: new Map(),
    rowsByMd5: new Map(),
    rowsByParentHash: new Map(),
    rowsByPrimaryParentHash: new Map()
  };

  for (const row of rows) {
    const prepared = prepareSongRow(row);
    data.preparedByRow.set(row, prepared);
    data.rowsById.set(row.id, prepared);
    addPreparedRow(data.rowsByTitle, prepared.identity.titleKey, prepared);
    addPreparedRow(data.rowsBySha256, prepared.sha256, prepared);
    addPreparedRow(data.rowsByMd5, prepared.md5, prepared);
    for (const hash of prepared.parentHashes) addPreparedRow(data.rowsByParentHash, hash, prepared);
    for (const hash of prepared.primaryParentHashes) addPreparedRow(data.rowsByPrimaryParentHash, hash, prepared);
  }

  return {
    rowCount: rows.length,
    find(target) {
      return findPreparedSimilarRows(target, data);
    }
  };
}

function findPreparedSimilarRows(target: TableChartRow, data: SameSongIndexData): TableChartRow[] {
  const targetPrepared = data.preparedByRow.get(target) ?? prepareSongRow(target);
  const selectedPrepared = data.rowsById.get(target.id) ?? targetPrepared;
  const titleRows = data.rowsByTitle.get(targetPrepared.identity.titleKey) ?? [];
  const rowsToCheck = new Set<PreparedSongRow>(titleRows);
  rowsToCheck.add(selectedPrepared);
  addPreparedRows(rowsToCheck, data.rowsBySha256.get(targetPrepared.sha256));
  addPreparedRows(rowsToCheck, data.rowsByMd5.get(targetPrepared.md5));
  addPreparedRows(rowsToCheck, data.rowsByParentHash.get(targetPrepared.md5));
  for (const hash of targetPrepared.parentHashes) addPreparedRows(rowsToCheck, data.rowsByMd5.get(hash));
  for (const hash of targetPrepared.primaryParentHashes) addPreparedRows(rowsToCheck, data.rowsByPrimaryParentHash.get(hash));

  const relatedArtistKeys = relatedPreparedArtists(targetPrepared, titleRows);
  const candidates: TableChartRow[] = [];
  for (const prepared of rowsToCheck) {
    const match = scorePreparedRow(targetPrepared, prepared, relatedArtistKeys);
    if (match.confidence < 0.65) continue;
    candidates.push({ ...prepared.row, ...match });
  }

  return candidates.sort(compareSimilarRows).slice(0, 500);
}

function scorePreparedRow(
  target: PreparedSongRow,
  candidate: PreparedSongRow,
  relatedArtistKeys: Set<string>
): { confidence: number; matchReason: string } {
  if (candidate.row.id === target.row.id) return { confidence: 1, matchReason: 'selected chart' };
  if (samePreparedChartHash(target, candidate)) return { confidence: 0.99, matchReason: 'same chart hash' };
  if (hasPreparedParentHashRelationship(target, candidate)) return { confidence: 0.98, matchReason: 'parent hash' };
  if (!target.identity.titleKey || target.identity.titleKey !== candidate.identity.titleKey) {
    return { confidence: 0, matchReason: '' };
  }
  if (samePreparedSource(target, candidate)) return { confidence: 0.93, matchReason: 'title + source' };
  if (target.identity.artistKey && target.identity.artistKey === candidate.identity.artistKey) {
    return {
      confidence: target.identity.fullTitleKey === candidate.identity.fullTitleKey ? 0.95 : 0.92,
      matchReason: 'title + artist'
    };
  }
  if (candidate.identity.artistKey && relatedArtistKeys.has(candidate.identity.artistKey)) {
    return { confidence: 0.88, matchReason: 'title + related artist' };
  }
  if (!target.identity.artistKey && !candidate.identity.artistKey) {
    return { confidence: 0.78, matchReason: 'title (artist unavailable)' };
  }
  if (!target.identity.artistKey || !candidate.identity.artistKey) {
    return { confidence: 0.7, matchReason: 'title (one artist unavailable)' };
  }
  return { confidence: 0, matchReason: '' };
}

function compareSimilarRows(a: TableChartRow, b: TableChartRow): number {
  const score = (b.confidence ?? 0) - (a.confidence ?? 0);
  if (score !== 0) return score;
  if (a.status === 'NO SONG' && b.status !== 'NO SONG') return -1;
  if (b.status === 'NO SONG' && a.status !== 'NO SONG') return 1;
  return a.title.localeCompare(b.title, 'ja');
}

interface SongIdentity {
  fullTitleKey: string;
  titleKey: string;
  artistKey: string;
}

const squareTitleSuffixPattern = /\s*(?:\[([^\r\n]+?)\]|【([^【】]+)】|\{([^{}]+)\}|〈([^〈〉]+)〉|《([^《》]+)》)\s*$/u;
const dashTitleSuffixPattern = /\s+[‐‑‒–—―-]\s*([^‐‑‒–—―-]+?)\s*[‐‑‒–—―-]\s*$/u;
const unwrappedDifficultyPattern = /\s+(?:(?:sp|dp)\s*)?(?:another|hyper|normal|insane|easy|hard|ex|extra|maniac|lunatic|beginner|light|master)\+?\s*$/iu;
const contributorCreditPattern = /(?:^|[\s/|;,[({#])(?:obj(?:ect(?:ed)?)?|noter|譜面|差分|bga|bgi|movie|illust(?:ration)?)(?=\s*(?::|：|\.|@|=|by\b)|\s|$)/iu;
const sequenceCreditPattern = /\s*(?:\+|\/)\s*[^+/]*\(\s*(?:sequence|obj(?:ect)?|noter|chart)\s*\)\s*$/iu;
const versionSuffixPattern = /\b(?:re?mix|mix|edit|version|ver\.?|arrange|bootleg|cover|original|radio|extended|live|vocal|instrumental|acoustic|short|long|full|club)\b/i;

function songIdentity(row: TableChartRow): SongIdentity {
  const fullTitle = `${row.title} ${row.subtitle}`.trim();
  return {
    fullTitleKey: titleKey(normalizeTitleText(fullTitle)),
    titleKey: titleKey(normalizeTitleBase(fullTitle)),
    artistKey: titleKey(normalizeArtistBase(row.artist))
  };
}

function stripTrailingDifficultyName(value: string): string {
  let title = value.normalize('NFKC').trim();
  while (true) {
    const squareSuffix = title.match(squareTitleSuffixPattern);
    if (squareSuffix) {
      const suffix = squareSuffix.slice(1).find(Boolean) ?? '';
      if (!versionSuffixPattern.test(normalizeTitleText(suffix))) {
        title = title.slice(0, squareSuffix.index).trim();
        continue;
      }
    }

    const parenthesized = title.match(/\s*\(([^()]*)\)\s*$/u);
    if (parenthesized && isRemovableChartSuffix(parenthesized[1])) {
      title = title.slice(0, parenthesized.index).trim();
      continue;
    }

    const dashed = title.match(dashTitleSuffixPattern);
    if (dashed && isLikelyDashedDifficultyName(dashed[1])) {
      title = title.slice(0, dashed.index).trim();
      continue;
    }

    const withoutUnwrappedDifficulty = title.replace(unwrappedDifficultyPattern, '').trim();
    if (withoutUnwrappedDifficulty !== title) {
      title = withoutUnwrappedDifficulty;
      continue;
    }
    break;
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

function isLikelyDashedDifficultyName(value: string): boolean {
  return isRemovableChartSuffix(value);
}

function isRemovableChartSuffix(value: string): boolean {
  const normalized = normalizeTitleText(value);
  return Boolean(normalized) && !versionSuffixPattern.test(normalized);
}

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[[\]【】()（）{}〈〉《》]/g, ' ')
    .replace(/[‐‑‒–—―_#:：;,.+\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prepareSongRow(row: TableChartRow): PreparedSongRow {
  return {
    row,
    identity: songIdentity(row),
    sha256: row.sha256.toLowerCase(),
    md5: row.md5.toLowerCase(),
    parentHashes: parentHashes(row),
    primaryParentHashes: primaryParentHashes(row),
    isBmsPath: row.tableName === 'BMS Path'
  };
}

function samePreparedChartHash(a: PreparedSongRow, b: PreparedSongRow): boolean {
  return Boolean((a.sha256 && a.sha256 === b.sha256) || (a.md5 && a.md5 === b.md5));
}

function hasPreparedParentHashRelationship(a: PreparedSongRow, b: PreparedSongRow): boolean {
  if (a.md5 && b.parentHashes.has(a.md5)) return true;
  if (b.md5 && a.parentHashes.has(b.md5)) return true;
  if (a.isBmsPath || b.isBmsPath) return false;
  return setsOverlap(a.primaryParentHashes, b.primaryParentHashes);
}

function parentHashes(row: TableChartRow): Set<string> {
  const values = [row.orgMd5, ...(row.orgMd5s ?? [])];
  const hashes = values.flatMap((value) => String(value ?? '').toLowerCase().match(/[a-f0-9]{32}/g) ?? []);
  return new Set(hashes);
}

function primaryParentHashes(row: TableChartRow): Set<string> {
  return new Set(String(row.orgMd5 ?? '').toLowerCase().match(/[a-f0-9]{32}/g) ?? []);
}

function relatedPreparedArtists(target: PreparedSongRow, rows: PreparedSongRow[]): Set<string> {
  const artistKeys = new Set<string>();
  if (target.identity.artistKey) artistKeys.add(target.identity.artistKey);

  for (const row of rows) {
    if (!row.identity.artistKey) continue;
    if (
      samePreparedSource(target, row)
      || samePreparedChartDirectory(target, row)
      || samePreparedChartHash(target, row)
      || hasPreparedParentHashRelationship(target, row)
    ) {
      artistKeys.add(row.identity.artistKey);
    }
  }
  return artistKeys;
}

function samePreparedSource(a: PreparedSongRow, b: PreparedSongRow): boolean {
  return setsOverlap(preparedSourceKeys(a), preparedSourceKeys(b));
}

function preparedSourceKeys(row: PreparedSongRow): Set<string> {
  return row.sourceKeys ??= sourceKeys(row.row);
}

function samePreparedChartDirectory(a: PreparedSongRow, b: PreparedSongRow): boolean {
  const aDirectory = preparedChartDirectory(a);
  return Boolean(aDirectory && aDirectory === preparedChartDirectory(b));
}

function preparedChartDirectory(row: PreparedSongRow): string {
  return row.directory ??= chartDirectory(row.row.path);
}

function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  return [...smaller].some((value) => larger.has(value));
}

function sourceKeys(row: TableChartRow): Set<string> {
  return new Set([row.url1, row.url2].flatMap(sourceUrlKeys));
}

function sourceUrlKeys(rawValue: string): string[] {
  if (!rawValue) return [];
  let value = rawValue.replace(/&amp;/gi, '&').trim();
  const archived = value.match(/^https?:\/\/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/i);
  if (archived) value = archived[1];

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const exact = `url:${host}${pathname}${url.search}`.toLowerCase();
    const keys = [exact];
    if (/\.(?:html?|shtml?)$/i.test(pathname)) {
      const separator = pathname.lastIndexOf('/');
      keys.push(`dir:${host}${pathname.slice(0, separator + 1)}`.toLowerCase());
    } else if (url.pathname.endsWith('/')) {
      keys.push(`dir:${host}${pathname}/`.toLowerCase());
    }
    return keys;
  } catch {
    return [];
  }
}

function chartDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function addPreparedRow(
  map: Map<string, PreparedSongRow[]>,
  key: string,
  row: PreparedSongRow
): void {
  if (!key) return;
  const rows = map.get(key) ?? [];
  rows.push(row);
  map.set(key, rows);
}

function addPreparedRows(target: Set<PreparedSongRow>, rows: PreparedSongRow[] | undefined): void {
  if (!rows) return;
  for (const row of rows) target.add(row);
}

function rowHashKeys(row: TableChartRow): string[] {
  return [
    row.sha256 ? `sha256:${row.sha256}` : '',
    row.md5 ? `md5:${row.md5}` : ''
  ].filter(Boolean);
}
