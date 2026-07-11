import { normalizeSearchQuery } from '../shared/chartFilters';
import type { DuplicateChartGroup, TableChartRow } from '../shared/types';

export function filterDuplicateGroups(groups: DuplicateChartGroup[], query: string): DuplicateChartGroup[] {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return groups;
  return groups.filter((group) => normalizeSearchQuery([
    group.title,
    group.artist,
    ...group.sharedSha256,
    ...group.sharedMd5,
    ...group.copies.flatMap((row) => [row.title, row.subtitle, row.artist, row.path, row.folder])
  ].join(' ')).includes(normalizedQuery));
}

export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

export function duplicateLocationDetails(row: TableChartRow): string {
  const details = [
    row.songLevel != null ? `Level ${row.songLevel}` : '',
    row.notes != null ? `${row.notes} notes` : '',
    row.mode != null ? `${row.mode} keys` : ''
  ].filter(Boolean);
  return details.join(' / ') || 'Right-click for chart actions';
}

export function duplicateDirectories(group: DuplicateChartGroup): { path: string; copyCount: number }[] {
  const directories = new Map<string, { path: string; copyCount: number }>();
  for (const row of group.copies) {
    const directory = chartDirectory(row);
    if (!directory) continue;
    const key = pathKey(directory);
    const current = directories.get(key);
    if (current) current.copyCount += 1;
    else directories.set(key, { path: directory, copyCount: 1 });
  }
  return [...directories.values()].sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true, sensitivity: 'base' }));
}

export function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = pathKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

export function samePathText(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = pathKey(a);
  const normalizedB = pathKey(b);
  return Boolean(normalizedA && normalizedB) && normalizedA === normalizedB;
}

export function automaticallyMergedDuplicateGroupIds(groups: DuplicateChartGroup[], targetDirectory: string, sourceDirectories: string[]): string[] {
  const sourceKeys = new Set(sourceDirectories.map(pathKey).filter(Boolean));
  const targetKey = pathKey(targetDirectory);
  if (!targetKey || sourceKeys.size < 2) return [];

  return groups
    .filter((group) => {
      const originalKeys = new Set(duplicateDirectories(group).map((directory) => pathKey(directory.path)).filter(Boolean));
      if (originalKeys.size < 2 || ![...originalKeys].some((key) => sourceKeys.has(key))) return false;
      return new Set([...originalKeys].map((key) => sourceKeys.has(key) ? targetKey : key)).size <= 1;
    })
    .map((group) => group.id);
}

function chartDirectory(row: TableChartRow): string {
  if (!row.path) return trimTrailingSeparators(row.folder);
  const trimmed = trimTrailingSeparators(row.path);
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slashIndex >= 0 ? trimmed.slice(0, slashIndex) : '';
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function pathKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}
