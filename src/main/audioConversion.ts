import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { AudioConversionResult, AudioConversionSkippedFile, AudioFolder } from '../shared/types';

const vorbisQuality = '10';
const conversionConcurrency = Math.max(1, Math.min(8, availableParallelism() - 1));
const scanConcurrency = 8;
const scanBatchSize = 50;
const scanFlushIntervalMs = 300;

export interface AudioFolderScanProgress {
  folders: AudioFolder[];
  scannedDirectories: number;
}

export interface AudioFolderScanOptions {
  isCancelled?(): boolean;
  onProgress?(progress: AudioFolderScanProgress): void;
}

export async function findAudioFolders(roots: string[]): Promise<AudioFolder[]> {
  const folders: AudioFolder[] = [];
  await scanAudioFolders(roots, {
    onProgress: (progress) => folders.push(...progress.folders)
  });
  return sortAudioFolders(folders);
}

export async function scanAudioFolders(roots: string[], options: AudioFolderScanOptions = {}): Promise<number> {
  let currentLevel = roots.map((root) => path.resolve(root));
  const pendingFolders: AudioFolder[] = [];
  let scannedDirectories = 0;
  let lastFlush = Date.now();

  const flush = (force = false, allowEmpty = false): void => {
    if (pendingFolders.length === 0 && !allowEmpty) return;
    const now = Date.now();
    if (!force && pendingFolders.length < scanBatchSize && now - lastFlush < scanFlushIntervalMs) return;
    const folders = pendingFolders.splice(0);
    lastFlush = now;
    options.onProgress?.({ folders, scannedDirectories });
  };

  while (currentLevel.length > 0 && !options.isCancelled?.()) {
    const nextLevel: string[] = [];
    let nextIndex = 0;
    const scanNext = async (): Promise<void> => {
      while (!options.isCancelled?.()) {
        const directory = currentLevel[nextIndex];
        nextIndex += 1;
        if (!directory) return;
        const result = await scanDirectory(directory);
        scannedDirectories += 1;
        if (result.hasWav) {
          pendingFolders.push({ path: directory, name: path.basename(directory) || directory });
        }
        flush(false, true);
        nextLevel.push(...result.childDirectories);
      }
    };

    const workers = Array.from({ length: Math.min(scanConcurrency, currentLevel.length) }, () => scanNext());
    await Promise.all(workers);
    currentLevel = nextLevel;
  }
  flush(true);
  return scannedDirectories;
}

export function sortAudioFolders(folders: AudioFolder[]): AudioFolder[] {
  return [...folders].sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true, sensitivity: 'base' }));
}

export async function convertAudioFolder(directory: string, roots: string[], ffmpegPath: string): Promise<AudioConversionResult> {
  const target = await fs.realpath(path.resolve(directory));
  const realRoots = await Promise.all(roots.map(async (root) => fs.realpath(path.resolve(root)).catch(() => path.resolve(root))));
  if (!realRoots.some((root) => isWithin(target, root))) throw new Error('The selected directory is outside the configured BMS paths.');

  const entries = await fs.readdir(target, { withFileTypes: true });
  const wavFiles = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.wav');
  const converted = new Set<string>();
  const existingOgg = new Set<string>();
  const skippedFiles: AudioConversionSkippedFile[] = [];
  const createdOggPaths: string[] = [];

  try {
    let nextIndex = 0;
    let conversionError: unknown = null;

    const convertNext = async (): Promise<void> => {
      while (!conversionError) {
        const entry = wavFiles[nextIndex];
        nextIndex += 1;
        if (!entry) return;

        const source = path.join(target, entry.name);
        const oggName = `${entry.name.slice(0, -4)}.ogg`;
        const destination = path.join(target, oggName);
        if (await exists(destination)) {
          existingOgg.add(entry.name.toLocaleLowerCase());
          continue;
        }

        const temporary = path.join(target, `.${oggName}.${process.pid}-${Date.now()}-${nextIndex}.tmp.ogg`);
        try {
          await runFfmpeg(ffmpegPath, source, temporary);
          await fs.rename(temporary, destination);
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
          if (error instanceof FfmpegInputError) {
            skippedFiles.push({ fileName: entry.name, error: error.message });
            continue;
          }
          conversionError ??= error;
          return;
        }
        createdOggPaths.push(destination);
        converted.add(entry.name.toLocaleLowerCase());
      }
    };

    const workers = Array.from({ length: Math.min(conversionConcurrency, wavFiles.length) }, async () => {
      try {
        await convertNext();
      } catch (error) {
        conversionError ??= error;
      }
    });
    await Promise.allSettled(workers);
    if (conversionError) throw conversionError;

    const removableWavs = new Set([...converted, ...existingOgg]);
    await Promise.all([...removableWavs].map(async (lowerName) => {
      const entry = wavFiles.find((item) => item.name.toLocaleLowerCase() === lowerName);
      if (entry) await fs.rm(path.join(target, entry.name));
    }));

    const convertedCount = converted.size;
    const removedExistingCount = existingOgg.size;
    const skippedCount = skippedFiles.length;
    return {
      ok: skippedCount === 0,
      directory: target,
      convertedCount,
      removedExistingCount,
      skippedCount,
      skippedFiles,
      message: makeConversionMessage(convertedCount, removedExistingCount, skippedFiles)
    };
  } catch (error) {
    await Promise.all(createdOggPaths.map((filePath) => fs.rm(filePath, { force: true })));
    throw error;
  }
}

async function scanDirectory(directory: string): Promise<{ hasWav: boolean; childDirectories: string[] }> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { hasWav: false, childDirectories: [] };
  }
  const childDirectories: string[] = [];
  let hasWav = false;
  for (const entry of entries) {
    if (!hasWav && entry.isFile() && isWavName(entry.name)) hasWav = true;
    if (entry.isDirectory()) childDirectories.push(path.join(directory, entry.name));
  }
  return { hasWav, childDirectories };
}

function runFfmpeg(ffmpegPath: string, source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-vn', '-c:a', 'libvorbis', '-q:a', vorbisQuality, destination], {
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || `FFmpeg exited with code ${code}.`;
      reject(isFfmpegInputError(message) ? new FfmpegInputError(source, message) : new Error(message));
    });
  });
}

class FfmpegInputError extends Error {
  constructor(readonly source: string, stderr: string) {
    super(summarizeFfmpegError(stderr));
    this.name = 'FfmpegInputError';
  }
}

function isFfmpegInputError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return normalized.includes('error opening input')
    || normalized.includes('invalid data found when processing input')
    || normalized.includes('error opening input file');
}

function summarizeFfmpegError(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? 'FFmpeg could not read this file.';
}

function makeConversionMessage(convertedCount: number, removedExistingCount: number, skippedFiles: AudioConversionSkippedFile[]): string {
  const parts = [`${convertedCount} WAV converted`];
  if (removedExistingCount) parts.push(`${removedExistingCount} duplicate WAV removed`);
  if (skippedFiles.length) parts.push(`${skippedFiles.length} unreadable WAV skipped`);
  let message = `${parts.join(', ')}.`;
  if (skippedFiles.length) {
    const names = skippedFiles.slice(0, 3).map((file) => file.fileName).join(', ');
    message += ` Skipped files were left in place: ${names}${skippedFiles.length > 3 ? ', ...' : ''}.`;
  }
  return message;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function isWavName(name: string): boolean {
  const length = name.length;
  return length >= 4
    && name.charCodeAt(length - 4) === 46
    && (name.charCodeAt(length - 3) | 32) === 119
    && (name.charCodeAt(length - 2) | 32) === 97
    && (name.charCodeAt(length - 1) | 32) === 118;
}
