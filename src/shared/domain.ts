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

export function findSimilarRows(target: TableChartRow, rows: TableChartRow[]): TableChartRow[] {
  const targetIdentity = songIdentity(target);
  const rowIdentities = new Map(rows.map((row) => [row, songIdentity(row)]));
  const relatedArtistKeys = relatedArtists(target, targetIdentity, rows, rowIdentities);
  const candidates: TableChartRow[] = [];

  for (const row of rows) {
    let confidence = 0;
    let matchReason = '';

    if (row.id === target.id) {
      confidence = 1;
      matchReason = 'selected chart';
    } else if (sameChartHash(target, row)) {
      confidence = 0.99;
      matchReason = 'same chart hash';
    } else if (hasParentHashRelationship(target, row)) {
      confidence = 0.98;
      matchReason = 'parent hash';
    } else {
      const rowIdentity = rowIdentities.get(row) ?? songIdentity(row);
      if (targetIdentity.titleKey && targetIdentity.titleKey === rowIdentity.titleKey) {
        if (sameSource(target, row)) {
          confidence = 0.93;
          matchReason = 'title + source';
        } else if (targetIdentity.artistKey && targetIdentity.artistKey === rowIdentity.artistKey) {
          confidence = targetIdentity.fullTitleKey === rowIdentity.fullTitleKey ? 0.95 : 0.92;
          matchReason = 'title + artist';
        } else if (rowIdentity.artistKey && relatedArtistKeys.has(rowIdentity.artistKey)) {
          confidence = 0.88;
          matchReason = 'title + related artist';
        } else if (!targetIdentity.artistKey && !rowIdentity.artistKey) {
          confidence = 0.78;
          matchReason = 'title (artist unavailable)';
        } else if (!targetIdentity.artistKey || !rowIdentity.artistKey) {
          confidence = 0.7;
          matchReason = 'title (one artist unavailable)';
        }
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

function sameChartHash(a: TableChartRow, b: TableChartRow): boolean {
  return Boolean(
    (a.sha256 && b.sha256 && a.sha256.toLowerCase() === b.sha256.toLowerCase())
    || (a.md5 && b.md5 && a.md5.toLowerCase() === b.md5.toLowerCase())
  );
}

function hasParentHashRelationship(a: TableChartRow, b: TableChartRow): boolean {
  const aMd5 = a.md5.toLowerCase();
  const bMd5 = b.md5.toLowerCase();
  const aParents = parentHashes(a);
  const bParents = parentHashes(b);
  if (aMd5 && bParents.has(aMd5)) return true;
  if (bMd5 && aParents.has(bMd5)) return true;
  if (a.tableName === 'BMS Path' || b.tableName === 'BMS Path') return false;
  const aPrimaryParents = primaryParentHashes(a);
  const bPrimaryParents = primaryParentHashes(b);
  return [...aPrimaryParents].some((hash) => bPrimaryParents.has(hash));
}

function parentHashes(row: TableChartRow): Set<string> {
  const values = [row.orgMd5, ...(row.orgMd5s ?? [])];
  const hashes = values.flatMap((value) => String(value ?? '').toLowerCase().match(/[a-f0-9]{32}/g) ?? []);
  return new Set(hashes);
}

function primaryParentHashes(row: TableChartRow): Set<string> {
  return new Set(String(row.orgMd5 ?? '').toLowerCase().match(/[a-f0-9]{32}/g) ?? []);
}

function relatedArtists(
  target: TableChartRow,
  targetIdentity: SongIdentity,
  rows: TableChartRow[],
  identities: Map<TableChartRow, SongIdentity>
): Set<string> {
  const artistKeys = new Set<string>();
  if (targetIdentity.artistKey) artistKeys.add(targetIdentity.artistKey);

  for (const row of rows) {
    const identity = identities.get(row);
    if (!identity?.artistKey || identity.titleKey !== targetIdentity.titleKey) continue;
    if (sameSource(target, row) || sameChartDirectory(target, row) || sameChartHash(target, row) || hasParentHashRelationship(target, row)) {
      artistKeys.add(identity.artistKey);
    }
  }
  return artistKeys;
}

function sameSource(a: TableChartRow, b: TableChartRow): boolean {
  const aKeys = sourceKeys(a);
  if (aKeys.size === 0) return false;
  return [...sourceKeys(b)].some((key) => aKeys.has(key));
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

function sameChartDirectory(a: TableChartRow, b: TableChartRow): boolean {
  const aDirectory = chartDirectory(a.path);
  return Boolean(aDirectory && aDirectory === chartDirectory(b.path));
}

function chartDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function rowHashKeys(row: TableChartRow): string[] {
  return [
    row.sha256 ? `sha256:${row.sha256}` : '',
    row.md5 ? `md5:${row.md5}` : ''
  ].filter(Boolean);
}
