/// <reference types="vite/client" />

import type { AppSettings, DirectoryNode, ManagerState, OpenPathPayload } from '../shared/types';

declare global {
  interface Window {
    managerApi: {
      loadState(): Promise<ManagerState>;
      saveSettings(patch: Partial<AppSettings>): Promise<ManagerState>;
      chooseRoot(): Promise<string | null>;
      listDirectories(dirPath: string): Promise<DirectoryNode[]>;
      openExternal(url: string): Promise<boolean>;
      openPath(payload: OpenPathPayload): Promise<boolean>;
    };
  }
}

export {};