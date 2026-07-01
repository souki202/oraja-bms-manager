import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BgaCleanupFailedFile, BgaCleanupResult, BgaDuplicateFile, BgaFolder } from '../shared/types';

const scanConcurrency = 8;
const scanBatchSize = 50;
const scanFlushIntervalMs = 300;
const legacyBgaExtensions = new Set(['.mpg', '.mpeg', '.wmv']);

export interface BgaFolderScanProgress {
  folders: BgaFolder[];
  scannedDirectories: number;
}

export interface BgaFolderScanOptions {
  isCancelled?(): boolean;
  onProgress?(progress: BgaFolderScanProgress): void;
}

export async function findBgaFolders(roots: string[]): Promise<BgaFolder[]> {
  const folders: BgaFolder[] = [];
  await scanBgaFolders(roots, {
    onProgress: (progress) => folders.push(...progress.folders)
  });
  return sortBgaFolders(folders);
}

export async function scanBgaFolders(roots: string[], options: BgaFolderScanOptions = {}): Promise<number> {
  let currentLevel = roots.map((root) => path.resolve(root));
  const pendingFolders: BgaFolder[] = [];
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
        if (result.duplicates.length > 0) {
          pendingFolders.push({ path: directory, name: path.basename(directory) || directory, duplicates: result.duplicates });
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

export function sortBgaFolders(folders: BgaFolder[]): BgaFolder[] {
  return [...folders].sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true, sensitivity: 'base' }));
}

export async function cleanupBgaFolder(directory: string, roots: string[]): Promise<BgaCleanupResult> {
  const target = await fs.realpath(path.resolve(directory));
  const realRoots = await Promise.all(roots.map(async (root) => fs.realpath(path.resolve(root)).catch(() => path.resolve(root))));
  if (!realRoots.some((root) => isWithin(target, root))) throw new Error('The selected directory is outside the configured BMS paths.');

  const entries = await fs.readdir(target, { withFileTypes: true });
  const duplicates = findDuplicateBgaFiles(entries);
  const failedFiles: BgaCleanupFailedFile[] = [];
  let deletedCount = 0;

  for (const duplicate of duplicates) {
    try {
      await fs.rm(path.join(target, duplicate.legacyFileName));
      deletedCount += 1;
    } catch (error) {
      failedFiles.push({
        fileName: duplicate.legacyFileName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ok: failedFiles.length === 0,
    directory: target,
    deletedCount,
    failedCount: failedFiles.length,
    failedFiles,
    message: makeCleanupMessage(deletedCount, failedFiles)
  };
}

async function scanDirectory(directory: string): Promise<{ duplicates: BgaDuplicateFile[]; childDirectories: string[] }> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { duplicates: [], childDirectories: [] };
  }
  const childDirectories: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) childDirectories.push(path.join(directory, entry.name));
  }
  return { duplicates: findDuplicateBgaFiles(entries), childDirectories };
}

function findDuplicateBgaFiles(entries: Dirent[]): BgaDuplicateFile[] {
  const mp4NamesByStem = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== '.mp4') continue;
    mp4NamesByStem.set(baseNameKey(entry.name, extension), entry.name);
  }

  const duplicates: BgaDuplicateFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!legacyBgaExtensions.has(extension)) continue;
    const mp4FileName = mp4NamesByStem.get(baseNameKey(entry.name, extension));
    if (mp4FileName) duplicates.push({ legacyFileName: entry.name, mp4FileName });
  }
  return duplicates.sort((a, b) => a.legacyFileName.localeCompare(b.legacyFileName, 'ja', { numeric: true, sensitivity: 'base' }));
}

function baseNameKey(name: string, extension: string): string {
  return name.slice(0, name.length - extension.length).toLocaleLowerCase();
}

function makeCleanupMessage(deletedCount: number, failedFiles: BgaCleanupFailedFile[]): string {
  const parts = [`${deletedCount} duplicate BGA removed`];
  if (failedFiles.length) parts.push(`${failedFiles.length} failed`);
  let message = `${parts.join(', ')}.`;
  if (failedFiles.length) {
    const names = failedFiles.slice(0, 3).map((file) => file.fileName).join(', ');
    message += ` Failed files were left in place: ${names}${failedFiles.length > 3 ? ', ...' : ''}.`;
  }
  return message;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
