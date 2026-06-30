/// <reference types="vite/client" />

import type { AppSettings, AudioConversionResult, AudioFolder, AudioFolderScanUpdate, BokutachiResolvePayload, ChartImportAnalysis, ChartImportPayload, ChartImportResult, DirectoryNode, DuplicateDirectoryMergePayload, DuplicateDirectoryMergeResult, ExportPayload, ExportResult, ManagerState, OpenPathPayload } from '../shared/types';

declare global {
  interface Window {
    managerApi: {
      loadState(): Promise<ManagerState>;
      saveSettings(patch: Partial<AppSettings>): Promise<ManagerState>;
      chooseRoot(): Promise<string | null>;
      listDirectories(dirPath: string): Promise<DirectoryNode[]>;
      listAudioFolders(): Promise<AudioFolder[]>;
      startAudioFolderScan(): Promise<string>;
      cancelAudioFolderScan(scanId: string): Promise<boolean>;
      onAudioFolderScanUpdate(listener: (update: AudioFolderScanUpdate) => void): () => void;
      convertAudioFolder(directory: string): Promise<AudioConversionResult>;
      exportTable(payload: ExportPayload): Promise<ExportResult>;
      getPathForFile(file: File): string;
      analyzeDroppedChart(paths: string[]): Promise<ChartImportAnalysis>;
      importDroppedChart(payload: ChartImportPayload): Promise<ChartImportResult>;
      mergeDuplicateDirectories(payload: DuplicateDirectoryMergePayload): Promise<DuplicateDirectoryMergeResult>;
      resolveBokutachiChartUrl(payload: BokutachiResolvePayload): Promise<string | null>;
      openExternal(url: string): Promise<boolean>;
      openPath(payload: OpenPathPayload): Promise<boolean>;
    };
  }
}

export {};
