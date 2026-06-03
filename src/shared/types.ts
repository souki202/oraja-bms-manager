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
  chartCount?: number;
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
  orgMd5s?: string[];
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
  addDate?: number | null;
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
  libraryRows: TableChartRow[];
  bmsRootNodes: DirectoryNode[];
  diagnostics: string[];
}

export interface OpenPathPayload {
  path: string;
  folder: string;
}

export interface BokutachiResolvePayload {
  game: 'bms-7k' | 'bms-14k' | 'pms-controller';
  sha256: string;
  md5: string;
}

export interface ExportPayload {
  header: Record<string, unknown>;
  data: Record<string, unknown>[];
}

export interface ExportResult {
  canceled: boolean;
  directory?: string;
  headerPath?: string;
  dataPath?: string;
}

export interface DroppedChartMetadata {
  sourcePath: string;
  fileName: string;
  title: string;
  subtitle: string;
  artist: string;
  genre: string;
  md5: string;
  sha256: string;
  mode: number | null;
}

export interface ImportCandidate {
  id: string;
  destinationDirectory: string;
  score: number;
  confidence: number;
  matchReason: string;
  matchedTitle: string;
  matchedArtist: string;
  existingTitles: string[];
  rowIds: string[];
}

export interface ChartImportAnalysis {
  ok: boolean;
  message: string;
  dropped: DroppedChartMetadata | null;
  candidates: ImportCandidate[];
  sourcePaths: string[];
  companionPaths: string[];
}

export interface ChartImportPayload {
  sourcePaths: string[];
  destinationDirectory: string;
}

export interface ChartImportResult {
  ok: boolean;
  message: string;
  targetPath?: string;
  importedPaths?: string[];
  skippedPaths?: string[];
  alreadyInPlace?: boolean;
}
