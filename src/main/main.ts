import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ManagerRepository } from './repository';
import { extractBokutachiChartId } from '../shared/ir';
import { convertAudioFolder, findAudioFolders, scanAudioFolders, sortAudioFolders } from './audioConversion';
import { cleanupBgaFolder, findBgaFolders, scanBgaFolders, sortBgaFolders } from './bgaCleanup';
import type { AppSettings, AudioFolderScanUpdate, BgaFolderScanUpdate, BokutachiResolvePayload, ChartImportPayload, DuplicateDirectoryMergePayload, ExportPayload, ExportResult, OpenPathPayload } from '../shared/types';

const appRoot = app.getAppPath();
const dataRoot = app.isPackaged ? app.getPath('userData') : path.join(appRoot, 'data');
if (!app.isPackaged) {
  app.setPath('userData', path.join(dataRoot, 'electron-user-data'));
}

const repository = new ManagerRepository(appRoot, dataRoot);
const audioScans = new Map<string, { cancelled: boolean }>();
const bgaScans = new Map<string, { cancelled: boolean }>();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#f2f4f7',
    webPreferences: {
      preload: path.join(appRoot, 'dist', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(appRoot, 'dist', 'renderer', 'index.html'));
  }
}

ipcMain.handle('state:load', () => repository.loadState());

ipcMain.handle('settings:save', async (_event, patch: Partial<AppSettings>) => {
  await repository.saveSettings(patch);
  return repository.loadState();
});

ipcMain.handle('settings:choose-root', async () => {
  const result = await dialog.showOpenDialog({
    title: 'beatoraja directory',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('directory:list', (_event, dirPath: string) => repository.listDirectories(dirPath));

ipcMain.handle('audio:list-folders', async () => {
  return findAudioFolders(await repository.loadBmsRoots());
});

ipcMain.handle('audio:scan-start', async (event): Promise<string> => {
  const roots = await repository.loadBmsRoots();
  const scanId = randomUUID();
  const scan = { cancelled: false };
  const folders: AudioFolderScanUpdate['folders'] = [];
  audioScans.set(scanId, scan);

  const sendUpdate = (update: Omit<AudioFolderScanUpdate, 'scanId'>): void => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('audio:scan-update', { scanId, ...update } satisfies AudioFolderScanUpdate);
  };

  setImmediate(() => {
    void scanAudioFolders(roots, {
      isCancelled: () => scan.cancelled || event.sender.isDestroyed(),
      onProgress: (progress) => {
        folders.push(...progress.folders);
        sendUpdate({ folders: [], scannedDirectories: progress.scannedDirectories, done: false });
      }
    }).then((scannedDirectories) => {
      if (!scan.cancelled) sendUpdate({ folders: sortAudioFolders(folders), scannedDirectories, done: true });
    }).catch((error: unknown) => {
      sendUpdate({ folders: [], scannedDirectories: 0, done: true, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      audioScans.delete(scanId);
    });
  });

  return scanId;
});

ipcMain.handle('audio:scan-cancel', (_event, scanId: string): boolean => {
  const scan = audioScans.get(scanId);
  if (!scan) return false;
  scan.cancelled = true;
  audioScans.delete(scanId);
  return true;
});

ipcMain.handle('audio:convert-folder', async (_event, directory: string) => {
  const roots = await repository.loadBmsRoots();
  const ffmpegPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg.exe')
    : path.join(appRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  return convertAudioFolder(directory, roots, ffmpegPath);
});

ipcMain.handle('bga:list-folders', async () => {
  return findBgaFolders(await repository.loadBmsRoots());
});

ipcMain.handle('bga:scan-start', async (event): Promise<string> => {
  const roots = await repository.loadBmsRoots();
  const scanId = randomUUID();
  const scan = { cancelled: false };
  const folders: BgaFolderScanUpdate['folders'] = [];
  bgaScans.set(scanId, scan);

  const sendUpdate = (update: Omit<BgaFolderScanUpdate, 'scanId'>): void => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('bga:scan-update', { scanId, ...update } satisfies BgaFolderScanUpdate);
  };

  setImmediate(() => {
    void scanBgaFolders(roots, {
      isCancelled: () => scan.cancelled || event.sender.isDestroyed(),
      onProgress: (progress) => {
        folders.push(...progress.folders);
        sendUpdate({ folders: [], scannedDirectories: progress.scannedDirectories, done: false });
      }
    }).then((scannedDirectories) => {
      if (!scan.cancelled) sendUpdate({ folders: sortBgaFolders(folders), scannedDirectories, done: true });
    }).catch((error: unknown) => {
      sendUpdate({ folders: [], scannedDirectories: 0, done: true, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      bgaScans.delete(scanId);
    });
  });

  return scanId;
});

ipcMain.handle('bga:scan-cancel', (_event, scanId: string): boolean => {
  const scan = bgaScans.get(scanId);
  if (!scan) return false;
  scan.cancelled = true;
  bgaScans.delete(scanId);
  return true;
});

ipcMain.handle('bga:cleanup-folder', async (_event, directory: string) => {
  return cleanupBgaFolder(directory, await repository.loadBmsRoots());
});

ipcMain.handle('table:export', async (_event, payload: ExportPayload): Promise<ExportResult> => {
  const result = await dialog.showOpenDialog({
    title: 'Export table',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const directory = result.filePaths[0];
  const headerPath = path.join(directory, 'header.json');
  const dataPath = path.join(directory, 'data.json');
  await fs.writeFile(headerPath, `${JSON.stringify(payload.header, null, 2)}\n`, 'utf8');
  await fs.writeFile(dataPath, `${JSON.stringify(payload.data, null, 2)}\n`, 'utf8');
  return { canceled: false, directory, headerPath, dataPath };
});

ipcMain.handle('chart-import:analyze', (_event, paths: string[]) => repository.analyzeDroppedChart(paths));

ipcMain.handle('chart-import:execute', (_event, payload: ChartImportPayload) => repository.importDroppedChart(payload));

ipcMain.handle('duplicates:merge-directories', (_event, payload: DuplicateDirectoryMergePayload) => repository.mergeDuplicateDirectories(payload));

ipcMain.handle('ir:resolve-bokutachi', async (_event, payload: BokutachiResolvePayload): Promise<string | null> => {
  const game = validateBokutachiGame(payload.game);
  if (!game) return null;

  const identifiers = [payload.sha256, payload.md5]
    .map((hash) => hash.trim().toLowerCase())
    .filter((hash) => /^[0-9a-f]{32}$/.test(hash) || /^[0-9a-f]{64}$/.test(hash));

  for (const identifier of identifiers) {
    const chartId = await resolveBokutachiChartId(game, identifier);
    if (chartId) return `https://boku.tachi.ac/games/${game}/charts/${encodeURIComponent(chartId)}`;
  }

  return null;
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^ipfs:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('shell:open-path', async (_event, payload: OpenPathPayload) => {
  const target = await repository.resolveOpenTarget(payload.path, payload.folder);
  if (!target) return false;
  try {
    const stats = await fs.stat(target);
    if (stats.isDirectory()) {
      await shell.openPath(target);
    } else {
      shell.showItemInFolder(target);
    }
  } catch {
    return false;
  }
  return true;
});

function validateBokutachiGame(game: string): BokutachiResolvePayload['game'] | null {
  if (game === 'bms-7k' || game === 'bms-14k' || game === 'pms-controller') return game;
  return null;
}

async function resolveBokutachiChartId(game: BokutachiResolvePayload['game'], identifier: string): Promise<string | null> {
  try {
    const response = await fetch(`https://boku.tachi.ac/api/v1/games/${game}/charts/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchType: 'bmsChartHash', identifier })
    });
    if (!response.ok) return null;

    return extractBokutachiChartId(await response.json());
  } catch (error) {
    console.error('Failed to resolve bokutachi chart', error);
    return null;
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
