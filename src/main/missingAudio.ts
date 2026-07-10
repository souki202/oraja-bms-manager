import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { MissingAudioChart } from '../shared/types';

const chartExtensions = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);
const audioExtensions = new Set(['.wav', '.ogg', '.mp3', '.flac', '.opus', '.m4a', '.aac']);
const concurrency = 8;

export interface MissingAudioProgress {
  charts: MissingAudioChart[];
  scannedDirectories: number;
  scannedCharts: number;
}

export async function scanMissingAudio(roots: string[], options: {
  isCancelled?(): boolean;
  onProgress?(progress: MissingAudioProgress): void;
} = {}): Promise<MissingAudioProgress> {
  let currentLevel = roots.map((root) => path.resolve(root));
  const results: MissingAudioChart[] = [];
  let scannedDirectories = 0;
  let scannedCharts = 0;

  while (currentLevel.length && !options.isCancelled?.()) {
    const nextLevel: string[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!options.isCancelled?.()) {
        const directory = currentLevel[next++];
        if (!directory) return;
      let entries: Dirent[];
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
      scannedDirectories++;
      for (const entry of entries) if (entry.isDirectory()) nextLevel.push(path.join(directory, entry.name));
      const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLocaleLowerCase()));
      const chartEntries = entries.filter((entry) => entry.isFile() && chartExtensions.has(path.extname(entry.name).toLowerCase()));
      const found = (await Promise.all(chartEntries.map((entry) => inspectChart(path.join(directory, entry.name), fileNames)))).filter((item): item is MissingAudioChart => item !== null);
      scannedCharts += chartEntries.length;
      results.push(...found);
      if (found.length || scannedDirectories % 25 === 0) options.onProgress?.({ charts: found, scannedDirectories, scannedCharts });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, currentLevel.length) }, worker));
    currentLevel = nextLevel;
  }
  return { charts: sortMissingAudioCharts(results), scannedDirectories, scannedCharts };
}

export function sortMissingAudioCharts(charts: MissingAudioChart[]): MissingAudioChart[] {
  return [...charts].sort((a, b) =>
    b.missingCount / b.definedCount - a.missingCount / a.definedCount
    || b.missingCount - a.missingCount
    || a.path.localeCompare(b.path, 'ja', { numeric: true })
  );
}

async function inspectChart(chartPath: string, files: Set<string>): Promise<MissingAudioChart | null> {
  const extension = path.extname(chartPath).toLowerCase();
  if (/_(?:tmp|temp)/i.test(path.basename(chartPath, extension))) return null;
  let text: string;
  try {
    const buffer = await fs.readFile(chartPath);
    text = new TextDecoder(extension === '.bmson' ? 'utf-8' : 'shift_jis').decode(buffer);
  } catch { return null; }
  let title = path.basename(chartPath, extension);
  let artist = '';
  let definitions: string[] = [];
  let noteCount = 0;
  if (extension === '.bmson') {
    try {
      const json = JSON.parse(text) as { info?: { title?: string; artist?: string }; sound_channels?: Array<{ name?: string; notes?: unknown[] }> };
      title = String(json.info?.title || title);
      artist = String(json.info?.artist || '');
      definitions = (json.sound_channels ?? []).map((channel) => String(channel.name ?? '').trim()).filter(Boolean);
      noteCount = (json.sound_channels ?? []).reduce((count, channel) => count + (Array.isArray(channel.notes) ? channel.notes.length : 0), 0);
    } catch { return null; }
  } else {
    const map = new Map<string, string>();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const wav = line.match(/^#WAV([0-9A-Z]{2})\s+(.+)$/i);
      if (wav) map.set(wav[1].toUpperCase(), stripQuotes(wav[2].trim()));
      else if (/^#TITLE\s/i.test(line)) title = line.replace(/^#TITLE\s+/i, '').trim();
      else if (/^#ARTIST\s/i.test(line)) artist = line.replace(/^#ARTIST\s+/i, '').trim();
      const sequence = line.match(/^#[0-9]{3}(?:1[1-9]|2[1-9]|5[1-9]|6[1-9]):([0-9A-Z]+)$/i);
      if (sequence) noteCount += countNonZeroObjects(sequence[1]);
    }
    definitions = [...map.values()];
  }
  if (noteCount <= 1) return null;
  definitions = [...new Set(definitions.map((name) => name.replace(/\\/g, '/').toLocaleLowerCase()))];
  if (!definitions.length) return null;
  const missing = definitions.filter((name) => !hasAudioFile(name, files));
  if (!missing.length) return null;
  return { path: chartPath, folder: path.dirname(chartPath), fileName: path.basename(chartPath), title, artist, definedCount: definitions.length, existingCount: definitions.length - missing.length, missingCount: missing.length, missingFiles: missing };
}

function hasAudioFile(name: string, files: Set<string>): boolean {
  if (files.has(name)) return true;
  const extension = path.extname(name);
  if (!audioExtensions.has(extension)) return false;
  const stem = name.slice(0, -extension.length);
  for (const alternative of audioExtensions) if (files.has(`${stem}${alternative}`)) return true;
  return false;
}

function stripQuotes(value: string): string { return value.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2'); }

function countNonZeroObjects(sequence: string): number {
  let count = 0;
  for (let index = 0; index + 1 < sequence.length; index += 2) {
    if (sequence[index] !== '0' || sequence[index + 1] !== '0') count++;
  }
  return count;
}
