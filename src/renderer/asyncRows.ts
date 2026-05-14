import type { TableChartRow } from '../shared/types';

export async function buildRowsAsync(
  sourceRows: TableChartRow[],
  accepts: (row: TableChartRow) => boolean,
  sortRows: (rows: TableChartRow[]) => TableChartRow[],
  signal: AbortSignal
): Promise<TableChartRow[]> {
  const rows: TableChartRow[] = [];
  const batchSize = 2500;

  for (let index = 0; index < sourceRows.length; index += batchSize) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const batch = sourceRows.slice(index, index + batchSize);
    for (const row of batch) {
      if (accepts(row)) rows.push(row);
    }
    await yieldToUi();
  }

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return sortRows(rows);
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}