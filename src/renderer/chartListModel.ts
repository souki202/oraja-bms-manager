import type { ChartColumnFilter } from '../shared/chartFilters';
import type { TableChartRow, TableSummary } from '../shared/types';

export type SortKey = 'level' | 'songLevel' | 'title' | 'artist' | 'url1' | 'url2' | 'status' | 'notes' | 'tableName' | 'path';
export type SortDirection = 'asc' | 'desc';
export type SortState = { key: SortKey; direction: SortDirection };
export type TableColumn = { key: SortKey; label: string; width: number; minWidth: number };

export const defaultSort: SortState = { key: 'title', direction: 'asc' };

export const chartColumns: TableColumn[] = [
  { key: 'level', label: 'FOLDER', width: 120, minWidth: 86 },
  { key: 'songLevel', label: 'LEVEL', width: 62, minWidth: 54 },
  { key: 'title', label: 'TITLE', width: 300, minWidth: 190 },
  { key: 'artist', label: 'ARTIST', width: 230, minWidth: 160 },
  { key: 'url1', label: 'URL1', width: 52, minWidth: 46 },
  { key: 'url2', label: 'URL2', width: 52, minWidth: 46 },
  { key: 'status', label: 'CLEAR', width: 120, minWidth: 104 },
  { key: 'notes', label: 'NOTES', width: 78, minWidth: 66 },
  { key: 'tableName', label: 'TABLE', width: 180, minWidth: 130 },
  { key: 'path', label: 'PATH', width: 520, minWidth: 360 }
];

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const statusOrder = new Map<string, number>([
  ['NO SONG', 0],
  ['NO PLAY', 1],
  ['FAILED', 2],
  ['ASSIST CLEAR', 3],
  ['EASY CLEAR', 4],
  ['CLEAR', 5],
  ['HARD CLEAR', 6],
  ['EX HARD CLEAR', 7],
  ['FULL COMBO', 8]
]);

export function sortTables(tables: TableSummary[]): TableSummary[] {
  return [...tables].sort((a, b) => collator.compare(a.name, b.name));
}

export function sortRows(rows: TableChartRow[], sort: SortState): TableChartRow[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(sortValue(a, sort.key), sortValue(b, sort.key)) * direction);
}

export function isRowUnderRoot(row: TableChartRow, root: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  const candidates = [row.path, row.folder].map(normalizePath).filter(Boolean);
  return candidates.some((candidate) => candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`));
}

export function createColumnWidthState(): Record<SortKey, number> {
  return chartColumns.reduce<Record<SortKey, number>>((widths, column) => {
    widths[column.key] = column.width;
    return widths;
  }, Object.fromEntries(chartColumns.map((column) => [column.key, 0])) as Record<SortKey, number>);
}

export function emptyColumnFilter(): ChartColumnFilter {
  return { text: '', min: '', max: '', statuses: [], urlMode: 'all' };
}

function sortValue(row: TableChartRow, key: SortKey): string | number {
  if (key === 'songLevel') return row.songLevel ?? row.difficulty ?? -1;
  if (key === 'status') return statusOrder.get(row.status) ?? -1;
  if (key === 'notes') return row.notes ?? -1;
  return String(row[key] ?? '').toLowerCase();
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '/').toLowerCase();
}
