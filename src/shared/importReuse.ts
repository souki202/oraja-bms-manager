import { normalizeArtistBase, normalizeTitleBase } from './domain';
import type { ChartImportResult, DroppedChartMetadata } from './types';

export interface PreviousChartImport {
  dropped: DroppedChartMetadata;
  destinationDirectory: string;
}

export function isSameSongImport(a: DroppedChartMetadata, b: DroppedChartMetadata): boolean {
  const aTitle = importTitleKey(a);
  const bTitle = importTitleKey(b);
  if (!aTitle || aTitle !== bTitle) return false;

  const aArtist = normalizeArtistBase(a.artist);
  const bArtist = normalizeArtistBase(b.artist);
  return !aArtist || !bArtist || aArtist === bArtist;
}

export function previousImportDestinationFor(
  dropped: DroppedChartMetadata,
  previous: PreviousChartImport | null
): string | null {
  return previous && isSameSongImport(dropped, previous.dropped)
    ? previous.destinationDirectory
    : null;
}

export function automaticImportSuccessMessage(result: ChartImportResult, destinationDirectory: string): string {
  const importedCount = result.importedPaths?.length ?? 0;
  if (importedCount === 0) {
    return `Same song detected. Files were already present in the previous destination: ${destinationDirectory}`;
  }
  const itemLabel = importedCount === 1 ? 'item' : 'items';
  return `Same song detected. Automatically imported ${importedCount} ${itemLabel} to the previous destination: ${destinationDirectory}`;
}

function importTitleKey(chart: DroppedChartMetadata): string {
  return normalizeTitleBase(`${chart.title} ${chart.subtitle}`.trim()).replace(/\s+/g, '');
}
