import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { AudioConversionResult, AudioConversionSkippedFile, AudioFolder } from '../shared/types';

const vorbisQuality = '10';
const conversionConcurrency = Math.max(1, Math.min(4, availableParallelism() - 1));
const conversionBatchSize = 32;
const scanConcurrency = 8;
const scanBatchSize = 50;
const scanFlushIntervalMs = 300;

interface AudioConversionTask {
  entry: Dirent;
  source: string;
  destination: string;
  temporary: string;
}

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
  const oggNames = new Set(entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.ogg')
    .map((entry) => entry.name.toLocaleLowerCase()));
  const converted = new Set<string>();
  const existingOgg = new Set<string>();
  const skippedFiles: AudioConversionSkippedFile[] = [];
  const createdOggPaths: string[] = [];

  try {
    const tasks: AudioConversionTask[] = [];
    for (const entry of wavFiles) {
      const oggName = `${entry.name.slice(0, -4)}.ogg`;
      if (oggNames.has(oggName.toLocaleLowerCase())) {
        existingOgg.add(entry.name.toLocaleLowerCase());
        continue;
      }

      tasks.push({
        entry,
        source: path.join(target, entry.name),
        destination: path.join(target, oggName),
        temporary: path.join(target, `.${oggName}.${process.pid}-${Date.now()}-${tasks.length}.tmp.ogg`)
      });
    }

    const batches = chunkTasks(tasks, conversionBatchSize);
    let nextIndex = 0;
    let conversionError: unknown = null;

    const convertNext = async (): Promise<void> => {
      while (!conversionError) {
        const batch = batches[nextIndex];
        nextIndex += 1;
        if (!batch) return;

        try {
          await convertBatch(ffmpegPath, batch);
          await commitBatch(batch, converted, createdOggPaths);
        } catch (error) {
          if (error instanceof FfmpegInputError) {
            await Promise.all(batch.map((task) => fs.rm(task.temporary, { force: true }).catch(() => undefined)));
            const fallbackError = await convertBatchIndividually(ffmpegPath, batch, converted, skippedFiles, createdOggPaths);
            if (!fallbackError) continue;
            conversionError ??= fallbackError;
          } else {
            conversionError ??= error;
          }
          await Promise.all(batch.map((task) => fs.rm(task.temporary, { force: true }).catch(() => undefined)));
          return;
        }
      }
    };

    const workers = Array.from({ length: Math.min(conversionConcurrency, batches.length) }, async () => {
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

async function convertBatch(ffmpegPath: string, tasks: AudioConversionTask[]): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  for (const task of tasks) args.push('-i', task.source);
  tasks.forEach((task, index) => {
    args.push('-map', `${index}:a:0`, '-vn', '-c:a', 'libvorbis', '-q:a', vorbisQuality, task.temporary);
  });
  await runFfmpeg(ffmpegPath, args, tasks[0]?.source ?? '');
}

async function convertBatchIndividually(
  ffmpegPath: string,
  tasks: AudioConversionTask[],
  converted: Set<string>,
  skippedFiles: AudioConversionSkippedFile[],
  createdOggPaths: string[]
): Promise<unknown | null> {
  for (const task of tasks) {
    try {
      await convertOne(ffmpegPath, task);
      await commitTask(task, converted, createdOggPaths);
    } catch (error) {
      await fs.rm(task.temporary, { force: true }).catch(() => undefined);
      if (error instanceof FfmpegInputError) {
        skippedFiles.push({ fileName: task.entry.name, error: error.message });
        continue;
      }
      return error;
    }
  }
  return null;
}

async function convertOne(ffmpegPath: string, task: AudioConversionTask): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    task.source,
    '-vn',
    '-c:a',
    'libvorbis',
    '-q:a',
    vorbisQuality,
    task.temporary
  ], task.source);
}

async function commitBatch(tasks: AudioConversionTask[], converted: Set<string>, createdOggPaths: string[]): Promise<void> {
  for (const task of tasks) await commitTask(task, converted, createdOggPaths);
}

async function commitTask(task: AudioConversionTask, converted: Set<string>, createdOggPaths: string[]): Promise<void> {
  await fs.rename(task.temporary, task.destination);
  createdOggPaths.push(task.destination);
  converted.add(task.entry.name.toLocaleLowerCase());
}

function chunkTasks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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

function runFfmpeg(ffmpegPath: string, args: string[], sourceForError: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || `FFmpeg exited with code ${code}.`;
      reject(isFfmpegInputError(message) ? new FfmpegInputError(sourceForError, message) : new Error(message));
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

function isWavName(name: string): boolean {
  const length = name.length;
  return length >= 4
    && name.charCodeAt(length - 4) === 46
    && (name.charCodeAt(length - 3) | 32) === 119
    && (name.charCodeAt(length - 2) | 32) === 97
    && (name.charCodeAt(length - 1) | 32) === 118;
}
