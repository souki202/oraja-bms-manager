import crypto from 'node:crypto';
import path from 'node:path';
import type { DroppedChartMetadata } from '../shared/types';

export function parseDroppedChartVariants(sourcePath: string, buffer: Buffer): DroppedChartMetadata[] {
  const variants = [
    parseDroppedChart(sourcePath, buffer, decodeBuffer(buffer, 'utf-8')),
    parseDroppedChart(sourcePath, buffer, decodeBuffer(buffer, 'shift_jis'))
  ];
  const seen = new Set<string>();
  return variants.filter((metadata) => {
    const key = `${metadata.title}\n${metadata.subtitle}\n${metadata.artist}\n${metadata.genre}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDroppedChart(sourcePath: string, buffer: Buffer, text: string): DroppedChartMetadata {
  const extension = path.extname(sourcePath).toLowerCase();
  const base = {
    sourcePath,
    fileName: path.basename(sourcePath),
    title: '',
    subtitle: '',
    artist: '',
    genre: '',
    md5: crypto.createHash('md5').update(buffer).digest('hex'),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    mode: extension === '.pms' ? 9 : null
  } satisfies DroppedChartMetadata;

  if (extension === '.bmson') return parseBmsonMetadata(text, base);
  return parseBmsMetadata(text, base);
}

function parseBmsMetadata(text: string, base: DroppedChartMetadata): DroppedChartMetadata {
  const metadata = { ...base };
  for (const rawLine of text.split(/\r?\n/).slice(0, 4000)) {
    const match = rawLine.trim().match(/^#([A-Z0-9_]+)\s+(.+)$/i);
    if (!match) continue;
    const key = match[1].toUpperCase();
    const value = match[2].trim();
    if (key === 'TITLE') metadata.title = value;
    else if (key === 'SUBTITLE') metadata.subtitle = value;
    else if (key === 'ARTIST') metadata.artist = value;
    else if (key === 'GENRE') metadata.genre = value;
    else if (key === 'PLAYER') metadata.mode = playerMode(value, base.mode);
  }
  return metadata.title ? metadata : { ...metadata, title: path.basename(base.fileName, path.extname(base.fileName)) };
}

function parseBmsonMetadata(text: string, base: DroppedChartMetadata): DroppedChartMetadata {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const info = data.info && typeof data.info === 'object' ? data.info as Record<string, unknown> : {};
    const modeHint = String(info.mode_hint ?? '');
    return {
      ...base,
      title: String(info.title ?? path.basename(base.fileName, path.extname(base.fileName))),
      subtitle: String(info.subtitle ?? ''),
      artist: String(info.artist ?? ''),
      genre: String(info.genre ?? ''),
      mode: modeHint.includes('9') ? 9 : modeHint.includes('14') ? 14 : modeHint.includes('7') ? 7 : base.mode
    };
  } catch {
    return { ...base, title: path.basename(base.fileName, path.extname(base.fileName)) };
  }
}

function decodeBuffer(buffer: Buffer, encoding: 'utf-8' | 'shift_jis'): string {
  return new TextDecoder(encoding, { fatal: false }).decode(buffer);
}

function playerMode(value: string, fallback: number | null): number | null {
  const player = Number(value);
  if (player === 1) return 7;
  if (player === 2) return 14;
  if (player === 3) return 9;
  return fallback;
}
