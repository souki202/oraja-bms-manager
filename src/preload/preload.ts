import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, DirectoryNode, ExportPayload, ExportResult, ManagerState, OpenPathPayload } from '../shared/types';

contextBridge.exposeInMainWorld('managerApi', {
  loadState: (): Promise<ManagerState> => ipcRenderer.invoke('state:load'),
  saveSettings: (patch: Partial<AppSettings>): Promise<ManagerState> => ipcRenderer.invoke('settings:save', patch),
  chooseRoot: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-root'),
  listDirectories: (dirPath: string): Promise<DirectoryNode[]> => ipcRenderer.invoke('directory:list', dirPath),
  exportTable: (payload: ExportPayload): Promise<ExportResult> => ipcRenderer.invoke('table:export', payload),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
  openPath: (payload: OpenPathPayload): Promise<boolean> => ipcRenderer.invoke('shell:open-path', payload)
});