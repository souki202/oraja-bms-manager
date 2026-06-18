import type { DuplicateChartGroup, TableChartRow } from './types';

const sha256Pattern = /^[0-9a-f]{64}$/;
const md5Pattern = /^[0-9a-f]{32}$/;

export function findDuplicateChartGroups(rows: TableChartRow[]): DuplicateChartGroup[] {
  const parents = rows.map((_, index) => index);
  const firstRowByHash = new Map<string, number>();

  rows.forEach((row, index) => {
    for (const token of rowHashTokens(row)) {
      const firstIndex = firstRowByHash.get(token);
      if (firstIndex == null) firstRowByHash.set(token, index);
      else union(parents, firstIndex, index);
    }
  });

  const rowsByRoot = new Map<number, TableChartRow[]>();
  rows.forEach((row, index) => {
    if (rowHashTokens(row).length === 0) return;
    const root = find(parents, index);
    const groupRows = rowsByRoot.get(root) ?? [];
    groupRows.push(row);
    rowsByRoot.set(root, groupRows);
  });

  return [...rowsByRoot.values()]
    .map(uniqueCopies)
    .filter((copies) => copies.length > 1)
    .map(createDuplicateGroup)
    .sort(compareGroups);
}

export function countRedundantChartCopies(groups: DuplicateChartGroup[]): number {
  return groups.reduce((total, group) => total + group.copies.length - 1, 0);
}

function createDuplicateGroup(copies: TableChartRow[]): DuplicateChartGroup {
  const sharedSha256 = sharedHashes(copies.map((row) => normalizeSha256(row.sha256)));
  const sharedMd5 = sharedHashes(copies.map((row) => normalizeMd5(row.md5)));
  const representative = [...copies].sort(compareRepresentatives)[0];
  const sortedCopies = [...copies].sort((a, b) => displayPath(a).localeCompare(displayPath(b), 'ja', {
    numeric: true,
    sensitivity: 'base'
  }));
  const newestAddDate = copies.reduce<number | null>((newest, row) => {
    if (row.addDate == null) return newest;
    return newest == null ? row.addDate : Math.max(newest, row.addDate);
  }, null);
  const groupHash = sharedSha256[0] ?? sharedMd5[0] ?? rowHashTokens(representative)[0];

  return {
    id: `duplicate:${groupHash}`,
    title: displayTitle(representative) || '(untitled)',
    artist: representative.artist,
    copies: sortedCopies,
    sharedSha256,
    sharedMd5,
    newestAddDate
  };
}

function uniqueCopies(rows: TableChartRow[]): TableChartRow[] {
  const copies = new Map<string, TableChartRow>();
  for (const row of rows) {
    const key = locationKey(row);
    if (!copies.has(key)) copies.set(key, row);
  }
  return [...copies.values()];
}

function sharedHashes(hashes: string[]): string[] {
  const counts = new Map<string, number>();
  for (const hash of hashes) {
    if (hash) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([hash]) => hash)
    .sort();
}

function rowHashTokens(row: TableChartRow): string[] {
  const sha256 = normalizeSha256(row.sha256);
  const md5 = normalizeMd5(row.md5);
  return [
    ...(sha256 ? [`sha256:${sha256}`] : []),
    ...(md5 ? [`md5:${md5}`] : [])
  ];
}

function normalizeSha256(value: string): string {
  const hash = value.trim().toLowerCase();
  return sha256Pattern.test(hash) ? hash : '';
}

function normalizeMd5(value: string): string {
  const hash = value.trim().toLowerCase();
  return md5Pattern.test(hash) ? hash : '';
}

function locationKey(row: TableChartRow): string {
  const location = displayPath(row).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return location || `row:${row.id}`;
}

function displayPath(row: TableChartRow): string {
  return row.path || row.folder;
}

function displayTitle(row: TableChartRow): string {
  return `${row.title}${row.subtitle ? ` ${row.subtitle}` : ''}`.trim();
}

function compareRepresentatives(a: TableChartRow, b: TableChartRow): number {
  const titleDifference = Number(!displayTitle(a)) - Number(!displayTitle(b));
  if (titleDifference !== 0) return titleDifference;
  return displayPath(a).localeCompare(displayPath(b), 'ja', { numeric: true, sensitivity: 'base' });
}

function compareGroups(a: DuplicateChartGroup, b: DuplicateChartGroup): number {
  const copyDifference = b.copies.length - a.copies.length;
  if (copyDifference !== 0) return copyDifference;
  return a.title.localeCompare(b.title, 'ja', { numeric: true, sensitivity: 'base' });
}

function find(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root) root = parents[root];
  while (parents[index] !== index) {
    const parent = parents[index];
    parents[index] = root;
    index = parent;
  }
  return root;
}

function union(parents: number[], a: number, b: number): void {
  const rootA = find(parents, a);
  const rootB = find(parents, b);
  if (rootA !== rootB) parents[rootB] = rootA;
}
