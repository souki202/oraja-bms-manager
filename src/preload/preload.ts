import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppSettings, AudioConversionResult, AudioFolder, AudioFolderScanUpdate, BokutachiResolvePayload, ChartImportAnalysis, ChartImportPayload, ChartImportResult, DirectoryNode, DuplicateDirectoryMergePayload, DuplicateDirectoryMergeResult, ExportPayload, ExportResult, ManagerState, OpenPathPayload } from '../shared/types';

contextBridge.exposeInMainWorld('managerApi', {
  loadState: (): Promise<ManagerState> => ipcRenderer.invoke('state:load'),
  saveSettings: (patch: Partial<AppSettings>): Promise<ManagerState> => ipcRenderer.invoke('settings:save', patch),
  chooseRoot: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-root'),
  listDirectories: (dirPath: string): Promise<DirectoryNode[]> => ipcRenderer.invoke('directory:list', dirPath),
  listAudioFolders: (): Promise<AudioFolder[]> => ipcRenderer.invoke('audio:list-folders'),
  startAudioFolderScan: (): Promise<string> => ipcRenderer.invoke('audio:scan-start'),
  cancelAudioFolderScan: (scanId: string): Promise<boolean> => ipcRenderer.invoke('audio:scan-cancel', scanId),
  onAudioFolderScanUpdate: (listener: (update: AudioFolderScanUpdate) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, update: AudioFolderScanUpdate): void => listener(update);
    ipcRenderer.on('audio:scan-update', wrapped);
    return () => ipcRenderer.off('audio:scan-update', wrapped);
  },
  convertAudioFolder: (directory: string): Promise<AudioConversionResult> => ipcRenderer.invoke('audio:convert-folder', directory),
  exportTable: (payload: ExportPayload): Promise<ExportResult> => ipcRenderer.invoke('table:export', payload),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  analyzeDroppedChart: (paths: string[]): Promise<ChartImportAnalysis> => ipcRenderer.invoke('chart-import:analyze', paths),
  importDroppedChart: (payload: ChartImportPayload): Promise<ChartImportResult> => ipcRenderer.invoke('chart-import:execute', payload),
  mergeDuplicateDirectories: (payload: DuplicateDirectoryMergePayload): Promise<DuplicateDirectoryMergeResult> => ipcRenderer.invoke('duplicates:merge-directories', payload),
  resolveBokutachiChartUrl: (payload: BokutachiResolvePayload): Promise<string | null> => ipcRenderer.invoke('ir:resolve-bokutachi', payload),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
  openPath: (payload: OpenPathPayload): Promise<boolean> => ipcRenderer.invoke('shell:open-path', payload)
});
