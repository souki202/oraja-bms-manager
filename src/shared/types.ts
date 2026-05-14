export interface AppSettings {
  beatorajaRoot: string;
  selectedPlayerId: string;
  searchText: string;
  selectedTableId: string | null;
}

export interface BeatorajaConfigSummary {
  root: string;
  configPath: string | null;
  songDbPath: string;
  songInfoDbPath: string | null;
  tablePath: string;
  playerPath: string;
  bmsRoots: string[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  lnmode: number;
  scoreDbPath: string;
}

export interface TableSummary {
  id: string;
  name: string;
  url: string;
  tag: string;
  fileName: string;
  folderCount: number;
  chartCount: number;
  missingCount: number;
}

export interface DirectoryNode {
  id: string;
  name: string;
  path: string;
  children?: DirectoryNode[];
  isRoot?: boolean;
}

export interface TableChartRow {
  id: string;
  tableId: string;
  tableName: string;
  tableUrl: string;
  level: string;
  title: string;
  subtitle: string;
  artist: string;
  genre: string;
  md5: string;
  sha256: string;
  orgMd5: string;
  url1: string;
  url2: string;
  ipfs: string;
  appendIpfs: string;
  mode: number | null;
  installed: boolean;
  status: ClearStatus;
  clear: number | null;
  notes: number | null;
  difficulty: number | null;
  songLevel: number | null;
  mainBpm: number | null;
  density: number | null;
  path: string;
  folder: string;
  matchReason?: string;
  confidence?: number;
}

export type ClearStatus =
  | 'NO SONG'
  | 'NO PLAY'
  | 'FAILED'
  | 'ASSIST CLEAR'
  | 'EASY CLEAR'
  | 'CLEAR'
  | 'HARD CLEAR'
  | 'EX HARD CLEAR'
  | 'FULL COMBO';

export interface ManagerState {
  settings: AppSettings;
  beatoraja: BeatorajaConfigSummary | null;
  players: PlayerProfile[];
  selectedPlayer: PlayerProfile | null;
  tables: TableSummary[];
  rows: TableChartRow[];
  bmsRootNodes: DirectoryNode[];
  diagnostics: string[];
}

export interface OpenPathPayload {
  path: string;
  folder: string;
}