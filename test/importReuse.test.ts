import { describe, expect, it } from 'vitest';
import { automaticImportSuccessMessage, isSameSongImport, previousImportDestinationFor } from '../src/shared/importReuse';
import type { DroppedChartMetadata } from '../src/shared/types';

describe('isSameSongImport', () => {
  it('recognizes chart suffixes and appended chart authors', () => {
    expect(isSameSongImport(
      chart('Air -GAIA-', 'SHIKI obj:gaia'),
      chart('Air -GOD-', 'SHIKI')
    )).toBe(true);
  });

  it('does not reuse a destination for a different artist with the same title', () => {
    expect(isSameSongImport(chart('Same Song [A]', 'Artist A'), chart('Same Song [H]', 'Artist B'))).toBe(false);
  });
});

describe('previousImportDestinationFor', () => {
  it('returns the previous destination for another variation of the same song', () => {
    const previous = { dropped: chart('CHERRY DOLL [山梨]', 'Artist'), destinationDirectory: 'F:\\BMS\\Cherry' };
    expect(previousImportDestinationFor(chart('CHERRY DOLL(Imperial Rose)', 'Artist'), previous)).toBe('F:\\BMS\\Cherry');
  });

  it('does not return the destination for a different song', () => {
    const previous = { dropped: chart('Song A', 'Artist'), destinationDirectory: 'F:\\BMS\\SongA' };
    expect(previousImportDestinationFor(chart('Song B', 'Artist'), previous)).toBeNull();
  });
});

describe('automaticImportSuccessMessage', () => {
  it('describes an automatic import and its destination', () => {
    expect(automaticImportSuccessMessage({ ok: true, message: '', importedPaths: ['chart.bms'] }, 'F:\\BMS\\Song'))
      .toBe('Same song detected. Automatically imported 1 item to the previous destination: F:\\BMS\\Song');
  });

  it('describes files that were already present', () => {
    expect(automaticImportSuccessMessage({ ok: true, message: '', importedPaths: [], alreadyInPlace: true }, 'F:\\BMS\\Song'))
      .toBe('Same song detected. Files were already present in the previous destination: F:\\BMS\\Song');
  });
});

function chart(title: string, artist: string): DroppedChartMetadata {
  return {
    sourcePath: `F:\\Downloads\\${title}.bms`,
    fileName: `${title}.bms`,
    title,
    subtitle: '',
    artist,
    genre: '',
    md5: '',
    sha256: '',
    mode: 7
  };
}
