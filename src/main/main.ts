import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { ManagerRepository } from './repository';
import type { AppSettings, OpenPathPayload } from '../shared/types';

const appRoot = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(appRoot, 'data', 'electron-user-data'));

const repository = new ManagerRepository(appRoot);

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

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url) && !/^ipfs:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('shell:open-path', async (_event, payload: OpenPathPayload) => {
  const target = await repository.resolveOpenTarget(payload.path, payload.folder);
  if (!target) return false;
  await shell.openPath(target);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});