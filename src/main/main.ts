import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ManagerRepository } from './repository';
import { extractBokutachiChartId } from '../shared/ir';
import type { AppSettings, BokutachiResolvePayload, ExportPayload, ExportResult, OpenPathPayload } from '../shared/types';

const appRoot = app.getAppPath();
const dataRoot = app.isPackaged ? app.getPath('userData') : path.join(appRoot, 'data');
if (!app.isPackaged) {
  app.setPath('userData', path.join(dataRoot, 'electron-user-data'));
}

const repository = new ManagerRepository(appRoot, dataRoot);

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
