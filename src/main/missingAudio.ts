import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { MissingAudioChart } from '../shared/types';

const chartExtensions = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);
const audioExtensions = new Set(['.wav', '.ogg', '.mp3', '.flac', '.opus', '.m4a', '.aac']);
const concurrency = 8;

export interface RegisteredChart {
  path: string;
  notes: number | null;
}

export interface MissingAudioProgress {
  charts: MissingAudioChart[];
  scannedDirectories: number;
  scannedCharts: number;
}

export async function scanMissingAudio(roots: string[], registeredCharts: RegisteredChart[], options: {
  isCancelled?(): boolean;
  onProgress?(progress: MissingAudioProgress): void;
} = {}): Promise<MissingAudioProgress> {
  const results: MissingAudioChart[] = [];
  let scannedDirectories = 0;
  let scannedCharts = 0;
  const rootPaths = roots.map((root) => path.resolve(root));
  const chartsByDirectory = new Map<string, string[]>();
  for (const chart of registeredCharts) {
    if ((chart.notes != null && chart.notes <= 1) || !chart.path) continue;
    const chartPath = path.resolve(chart.path);
    if (!rootPaths.some((root) => isWithin(chartPath, root))) continue;
    if (!chartExtensions.has(path.extname(chartPath).toLowerCase())) continue;
    const directory = path.dirname(chartPath);
    const charts = chartsByDirectory.get(directory) ?? [];
    charts.push(chartPath);
    chartsByDirectory.set(directory, charts);
  }
  const directories = [...chartsByDirectory.keys()];

  for (let offset = 0; offset < directories.length && !options.isCancelled?.(); offset += concurrency) {
    const batch = directories.slice(offset, offset + concurrency);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!options.isCancelled?.()) {
        const directory = batch[next++];
        if (!directory) return;
        let entries: Dirent[];
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
        scannedDirectories++;
        const fileIndex = new DirectoryFileIndex(directory, entries);
        const chartPaths = chartsByDirectory.get(directory) ?? [];
        const found = (await Promise.all(chartPaths.map((chartPath) => inspectChart(chartPath, fileIndex)))).filter((item): item is MissingAudioChart => item !== null);
        scannedCharts += chartPaths.length;
        results.push(...found);
        if (found.length || scannedDirectories % 25 === 0) options.onProgress?.({ charts: found, scannedDirectories, scannedCharts });
      }
    };
    await Promise.all(Array.from({ length: batch.length }, worker));
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

async function inspectChart(chartPath: string, files: DirectoryFileIndex): Promise<MissingAudioChart | null> {
  const extension = path.extname(chartPath).toLowerCase();
  if (/_(?:tmp|temp)/i.test(path.basename(chartPath, extension))) return null;
  let text: string;
  try {
    const buffer = await fs.readFile(chartPath);
    text = new TextDecoder(extension === '.bmson' ? 'utf-8' : 'shift_jis').decode(buffer);
  } catch { return null; }
  let title = path.basename(chartPath, extension);
  let artist = '';
  let definitions: string[];
  if (extension === '.bmson') {
    try {
      const json = JSON.parse(text) as { info?: { title?: string; artist?: string }; sound_channels?: Array<{ name?: string }> };
      title = String(json.info?.title || title);
      artist = String(json.info?.artist || '');
      definitions = (json.sound_channels ?? []).map((channel) => String(channel.name ?? '').trim()).filter(Boolean);
    } catch { return null; }
  } else {
    const map = new Map<string, string>();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const wav = line.match(/^#WAV([0-9A-Z]{2})\s+(.+)$/i);
      if (wav) map.set(wav[1].toUpperCase(), stripQuotes(wav[2].trim()));
      else if (/^#TITLE\s/i.test(line)) title = line.replace(/^#TITLE\s+/i, '').trim();
      else if (/^#ARTIST\s/i.test(line)) artist = line.replace(/^#ARTIST\s+/i, '').trim();
    }
    definitions = [...map.values()];
  }
  const normalizedDefinitions = [...new Set(definitions.map((name) => name.replace(/\\/g, '/').toLocaleLowerCase()))];
  if (!normalizedDefinitions.length) return null;
  const existence = await Promise.all(normalizedDefinitions.map((name) => files.hasAudioFile(name)));
  const missing = normalizedDefinitions.filter((_name, index) => !existence[index]);
  if (!missing.length) return null;
  return { path: chartPath, folder: path.dirname(chartPath), fileName: path.basename(chartPath), title, artist, definedCount: normalizedDefinitions.length, existingCount: normalizedDefinitions.length - missing.length, missingCount: missing.length, missingFiles: missing };
}

class DirectoryFileIndex {
  private readonly cache = new Map<string, Promise<Set<string>>>();

  constructor(private readonly root: string, rootEntries: Dirent[]) {
    this.cache.set('', Promise.resolve(fileNameSet(rootEntries)));
  }

  async hasAudioFile(relativeName: string): Promise<boolean> {
    const normalized = path.posix.normalize(relativeName.replace(/\\/g, '/'));
    if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return false;
    const directory = path.posix.dirname(normalized) === '.' ? '' : path.posix.dirname(normalized);
    const name = path.posix.basename(normalized).toLocaleLowerCase();
    const files = await this.filesIn(directory);
    if (files.has(name)) return true;
    const extension = path.extname(name);
    if (!audioExtensions.has(extension)) return false;
    const stem = name.slice(0, -extension.length);
    for (const alternative of audioExtensions) if (files.has(`${stem}${alternative}`)) return true;
    return false;
  }

  private filesIn(relativeDirectory: string): Promise<Set<string>> {
    let cached = this.cache.get(relativeDirectory);
    if (!cached) {
      cached = fs.readdir(path.join(this.root, ...relativeDirectory.split('/')), { withFileTypes: true })
        .then(fileNameSet)
        .catch(() => new Set<string>());
      this.cache.set(relativeDirectory, cached);
    }
    return cached;
  }
}

function fileNameSet(entries: Dirent[]): Set<string> {
  return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLocaleLowerCase()));
}

function stripQuotes(value: string): string { return value.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2'); }

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
