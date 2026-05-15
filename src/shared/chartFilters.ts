import { normalizeText } from './domain';
import type { ClearStatus, TableChartRow } from './types';

export type ChartFilterKey = 'level' | 'songLevel' | 'title' | 'artist' | 'url1' | 'url2' | 'status' | 'notes' | 'tableName' | 'path';
export type UrlFilterMode = 'all' | 'has' | 'none';

export interface ChartColumnFilter {
  text?: string;
  min?: string;
  max?: string;
  statuses?: ClearStatus[];
  urlMode?: UrlFilterMode;
}

export type ChartColumnFilters = Partial<Record<ChartFilterKey, ChartColumnFilter>>;

export interface PreparedChartColumnFilter {
  text: string;
  min: number | null;
  max: number | null;
  statuses: Set<ClearStatus>;
  urlMode: UrlFilterMode;
}

export type PreparedChartColumnFilters = Partial<Record<ChartFilterKey, PreparedChartColumnFilter>>;
export type ChartFilterCache = WeakMap<TableChartRow, CachedChartFilterValues>;

export const clearStatuses: ClearStatus[] = [
  'NO SONG',
  'NO PLAY',
  'FAILED',
  'ASSIST CLEAR',
  'EASY CLEAR',
  'CLEAR',
  'HARD CLEAR',
  'EX HARD CLEAR',
  'FULL COMBO'
];

export function prepareColumnFilters(filters: ChartColumnFilters): PreparedChartColumnFilters {
  const prepared: PreparedChartColumnFilters = {};
  for (const [key, filter] of Object.entries(filters) as [ChartFilterKey, ChartColumnFilter][]) {
    if (!isColumnFilterActive(key, filter)) continue;
    prepared[key] = {
      text: normalizeText(filter.text ?? ''),
      min: finiteNumberOrNull(filter.min),
      max: finiteNumberOrNull(filter.max),
      statuses: new Set(filter.statuses ?? []),
      urlMode: filter.urlMode ?? 'all'
    };
  }
  return prepared;
}

export function isColumnFilterActive(key: ChartFilterKey, filter: ChartColumnFilter | undefined): boolean {
  if (!filter) return false;
  if (key === 'status') {
    const count = filter.statuses?.length ?? 0;
    return count > 0 && count < clearStatuses.length;
  }
  if (key === 'songLevel' || key === 'notes') return Boolean(filter.min?.trim() || filter.max?.trim());
  if (key === 'url1' || key === 'url2') return Boolean(filter.text?.trim() || (filter.urlMode && filter.urlMode !== 'all'));
  return Boolean(filter.text?.trim());
}

export function countActiveColumnFilters(filters: ChartColumnFilters): number {
  return (Object.entries(filters) as [ChartFilterKey, ChartColumnFilter][])
    .filter(([key, filter]) => isColumnFilterActive(key, filter))
    .length;
}

export function matchesChartFilters(
  row: TableChartRow,
  normalizedSearch: string,
  filters: PreparedChartColumnFilters,
  cache: ChartFilterCache
): boolean {
  const values = cachedValues(row, cache);
  if (normalizedSearch && !values.search.includes(normalizedSearch)) return false;

  for (const [key, filter] of Object.entries(filters) as [ChartFilterKey, PreparedChartColumnFilter][]) {
    if (!matchesColumnFilter(row, values, key, filter)) return false;
  }

  return true;
}

export function normalizeSearchQuery(query: string): string {
  return normalizeText(query);
}

interface CachedChartFilterValues {
  search: string;
  level: string;
  title: string;
  artist: string;
  url1: string;
  url2: string;
  tableName: string;
  path: string;
}

function matchesColumnFilter(
  row: TableChartRow,
  values: CachedChartFilterValues,
  key: ChartFilterKey,
  filter: PreparedChartColumnFilter
): boolean {
  if (key === 'status') return filter.statuses.size === 0 || filter.statuses.has(row.status);
  if (key === 'songLevel' || key === 'notes') return matchesNumericFilter(numericValue(row, key), filter.min, filter.max);
  if (key === 'url1' || key === 'url2') return matchesUrlFilter(String(row[key] ?? ''), values[key], filter);
  return !filter.text || values[key].includes(filter.text);
}

function matchesNumericFilter(value: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function matchesUrlFilter(rawValue: string, normalizedValue: string, filter: PreparedChartColumnFilter): boolean {
  const hasUrl = rawValue.trim().length > 0;
  if (filter.urlMode === 'has' && !hasUrl) return false;
  if (filter.urlMode === 'none' && hasUrl) return false;
  return !filter.text || normalizedValue.includes(filter.text);
}

function numericValue(row: TableChartRow, key: ChartFilterKey): number | null {
  if (key === 'songLevel') return row.songLevel ?? row.difficulty ?? null;
  if (key === 'notes') return row.notes;
  return null;
}

function cachedValues(row: TableChartRow, cache: ChartFilterCache): CachedChartFilterValues {
  const cached = cache.get(row);
  if (cached) return cached;

  const values = {
    search: normalizeText([
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
    ].join(' ')),
    level: normalizeText(row.level),
    title: normalizeText(`${row.title} ${row.subtitle}`),
    artist: normalizeText(`${row.artist} ${row.genre}`),
    url1: normalizeText(row.url1),
    url2: normalizeText(row.url2),
    tableName: normalizeText(row.tableName),
    path: normalizeText(`${row.path} ${row.folder}`)
  } satisfies CachedChartFilterValues;
  cache.set(row, values);
  return values;
}

function finiteNumberOrNull(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}