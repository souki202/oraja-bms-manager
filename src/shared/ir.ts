import type { TableChartRow } from './types';

export type IrTarget = 'bokutachi' | 'mocha' | 'minir';
export type BokutachiGame = 'bms-7k' | 'bms-14k' | 'pms-controller';

export function bokutachiGameForMode(mode: number | null): BokutachiGame | null {
  if (mode === 7) return 'bms-7k';
  if (mode === 14) return 'bms-14k';
  if (mode === 9) return 'pms-controller';
  return null;
}

export function canOpenBokutachi(row: TableChartRow): boolean {
  return Boolean(bokutachiGameForMode(row.mode) && (row.sha256 || row.md5));
}

export function hasAnyIrTarget(row: TableChartRow): boolean {
  return Boolean(row.sha256 || canOpenBokutachi(row));
}

export function buildStaticIrUrl(row: TableChartRow, target: Exclude<IrTarget, 'bokutachi'>): string {
  const hash = row.sha256.trim().toLowerCase();
  if (!hash) return '';
  if (target === 'mocha') return `https://mocha-repository.info/song.php?sha256=${hash}`;
  return `https://www.gaftalk.com/minir/#/viewer/song/${hash}/0`;
}

export function extractBokutachiChartId(responseBody: unknown): string | null {
  const root = asRecord(responseBody);
  const chart = asRecord(root?.chart) ?? asRecord(asRecord(root?.body)?.chart);
  const chartId = chart?.chartID;
  return typeof chartId === 'string' || typeof chartId === 'number' ? String(chartId) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
