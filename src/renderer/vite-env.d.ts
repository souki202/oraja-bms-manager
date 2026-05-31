/// <reference types="vite/client" />

import type { AppSettings, BokutachiResolvePayload, DirectoryNode, ExportPayload, ExportResult, ManagerState, OpenPathPayload } from '../shared/types';

declare global {
  interface Window {
    managerApi: {
      loadState(): Promise<ManagerState>;
      saveSettings(patch: Partial<AppSettings>): Promise<ManagerState>;
      chooseRoot(): Promise<string | null>;
      listDirectories(dirPath: string): Promise<DirectoryNode[]>;
      exportTable(payload: ExportPayload): Promise<ExportResult>;
      resolveBokutachiChartUrl(payload: BokutachiResolvePayload): Promise<string | null>;
      openExternal(url: string): Promise<boolean>;
      openPath(payload: OpenPathPayload): Promise<boolean>;
    };
  }
}

export {};
