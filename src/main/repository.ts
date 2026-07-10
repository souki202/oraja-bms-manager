import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Stats } from 'node:fs';
import type {
  AppSettings,
  BeatorajaConfigSummary,
  ChartImportAnalysis,
  ChartImportPayload,
  ChartImportResult,
  DuplicateDirectoryMergePayload,
  DuplicateDirectoryMergeResult,
  DirectoryNode,
  DroppedChartMetadata,
  ManagerState,
  PlayerProfile,
  TableChartRow,
  TableSummary
} from '../shared/types';
import { clearToStatus } from '../shared/domain';
import { createImportMatcher, type ImportMatcher } from '../shared/importMatcher';
import { loadTables, readSongList, type ParsedTableSong } from './tableParser';
import { openReadonlyDatabase, selectAll, writeDatabase } from './sqlite';

interface SongDbRow {
  md5?: string;
  sha256?: string;
  title?: string;
  subtitle?: string;
  genre?: string;
  artist?: string;
  subartist?: string;
  parent?: string;
  path?: string;
  folder?: string;
  level?: number;
  difficulty?: number;
  mode?: number;
  notes?: number;
  adddate?: number;
  charthash?: string;
}

interface SongInfoRow {
  sha256?: string;
  density?: number;
  mainbpm?: number;
}

interface FolderDbRow {
  path?: string;
  parent?: string;
}

interface ScoreDbRow {
  sha256?: string;
  mode?: number;
  clear?: number;
  playcount?: number;
  clearcount?: number;
  combo?: number;
  maxcombo?: number;
  minbp?: number;
  notes?: number;
  date?: number;
}

const defaultSettings: AppSettings = {
  beatorajaRoot: '',
  selectedPlayerId: 'player1',
  searchText: '',
  selectedTableId: null
};

const chartFileExtensions = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);

export class ManagerRepository {
  private readonly settingsPath: string;
  private stateCache: ManagerState | null = null;
  private importMatcherCache: { libraryRows: TableChartRow[]; matcher: ImportMatcher } | null = null;
  private readonly backedUpDatabasePaths = new Set<string>();

  constructor(private readonly appRoot: string, dataRoot = path.join(appRoot, 'data')) {
    this.settingsPath = path.join(dataRoot, 'settings.json');
  }

  async loadState(): Promise<ManagerState> {
    const diagnostics: string[] = [];
    const settings = await this.loadSettings();
    const guessedRoot = path.dirname(this.appRoot);
    if (!settings.beatorajaRoot && await exists(path.join(guessedRoot, 'songdata.db'))) {
      settings.beatorajaRoot = guessedRoot;
    }

    let beatoraja: BeatorajaConfigSummary | null = null;
    let players: PlayerProfile[] = [];
    let selectedPlayer: PlayerProfile | null = null;
    let tables: TableSummary[] = [];
    let rows: TableChartRow[] = [];
    let libraryRows: TableChartRow[] = [];
    let bmsRootNodes: DirectoryNode[] = [];

    if (!settings.beatorajaRoot) {
      diagnostics.push('beatoraja root is not set.');
      return this.cacheState({ settings, beatoraja, players, selectedPlayer, tables, rows, libraryRows, bmsRootNodes, diagnostics });
    }

    try {
      beatoraja = await this.loadBeatorajaConfig(settings.beatorajaRoot);
      players = await this.loadPlayers(beatoraja.playerPath);
      selectedPlayer = players.find((player) => player.id === settings.selectedPlayerId) ?? players[0] ?? null;
      if (selectedPlayer && settings.selectedPlayerId !== selectedPlayer.id) {
        settings.selectedPlayerId = selectedPlayer.id;
      }
      const [songRows, songInfoRows, scoreRows, loadedTables] = await Promise.all([
        this.loadSongs(beatoraja.songDbPath, diagnostics),
        beatoraja.songInfoDbPath ? this.loadSongInfo(beatoraja.songInfoDbPath, diagnostics) : Promise.resolve([]),
        selectedPlayer ? this.loadScores(selectedPlayer.scoreDbPath, diagnostics) : Promise.resolve([]),
        loadTables(beatoraja.tablePath)
      ]);

      const hydrated = hydrateRows(loadedTables, songRows, songInfoRows, scoreRows);
      rows = hydrated.rows;
      tables = hydrated.tables;
      libraryRows = createLibraryRows(songRows, songInfoRows, scoreRows);
      bmsRootNodes = beatoraja.bmsRoots.map((root, index) => ({
        id: `bms-root-${index}`,
        name: root,
        path: root,
        isRoot: true,
        chartCount: libraryRows.filter((row) => isPathUnderRoot(row.path, root)).length
      }));
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }

    return this.cacheState({ settings, beatoraja, players, selectedPlayer, tables, rows, libraryRows, bmsRootNodes, diagnostics });
  }

  async loadSettings(): Promise<AppSettings> {
    try {
      const text = await fs.readFile(this.settingsPath, 'utf8');
      return { ...defaultSettings, ...JSON.parse(text) };
    } catch {
      return { ...defaultSettings };
    }
  }

  async loadBmsRoots(): Promise<string[]> {
    const settings = await this.loadSettings();
    let root = settings.beatorajaRoot;
    const guessedRoot = path.dirname(this.appRoot);
    if (!root && await exists(path.join(guessedRoot, 'songdata.db'))) root = guessedRoot;
    if (!root) return [];

    try {
      const config = await this.loadBeatorajaConfig(root);
      return config.bmsRoots;
    } catch {
      return [];
    }
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.loadSettings();
    const next = { ...current, ...patch };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
    this.stateCache = null;
    this.importMatcherCache = null;
    return next;
  }

  async listDirectories(dirPath: string): Promise<DirectoryNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: path.join(dirPath, entry.name),
        name: entry.name,
        path: path.join(dirPath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async resolveOpenTarget(rawPath: string, folderPath: string): Promise<string | null> {
    const settings = await this.loadSettings();
    const config = await this.loadBeatorajaConfig(settings.beatorajaRoot || path.dirname(this.appRoot));
    const candidates = uniqueStrings([
      rawPath,
      folderPath,
      rawPath ? path.dirname(rawPath) : '',
      ...config.bmsRoots.flatMap((root) => [
        rawPath ? path.join(root, rawPath) : '',
        folderPath ? path.join(root, folderPath) : '',
        rawPath ? path.dirname(path.join(root, rawPath)) : ''
      ])
    ]);

    for (const candidate of candidates) {
      if (candidate && await exists(candidate)) return candidate;
    }
    return null;
  }

  async analyzeDroppedChart(paths: string[]): Promise<ChartImportAnalysis> {
    const existingPaths = uniqueStrings(paths.filter(Boolean));
    const supportedPath = existingPaths.find((filePath) => chartFileExtensions.has(path.extname(filePath).toLowerCase()));
    const companionPaths = existingPaths.filter((filePath) => filePath !== supportedPath);

    if (!supportedPath) {
      return {
        ok: false,
        message: 'Drop a .bms, .bme, .bml, .pms, or .bmson chart file.',
        dropped: null,
        candidates: [],
        sourcePaths: existingPaths,
        companionPaths: existingPaths
      };
    }

    try {
      const stat = await fs.stat(supportedPath);
      if (!stat.isFile()) throw new Error('The dropped item is not a file.');
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        dropped: null,
        candidates: [],
        sourcePaths: existingPaths,
        companionPaths
      };
    }

    const buffer = await fs.readFile(supportedPath);
    const state = this.stateCache ?? await this.loadState();
    const importMatcher = this.getImportMatcher(state.libraryRows);
    const analyses = parseDroppedChartVariants(supportedPath, buffer)
      .map((dropped) => ({ dropped, candidates: importMatcher.rank(dropped) }))
      .sort((a, b) => (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0));
    const best = analyses[0];

    if (!best || best.candidates.length === 0) {
      return {
        ok: true,
        message: 'No likely destination was found. Try dropping a chart whose parent song is already installed.',
        dropped: best?.dropped ?? parseDroppedChart(supportedPath, buffer, decodeBuffer(buffer, 'utf-8')),
        candidates: [],
        sourcePaths: existingPaths,
        companionPaths
      };
    }

    return {
      ok: true,
      message: companionPaths.length > 0 ? `Using ${path.basename(supportedPath)} for matching; ${companionPaths.length} related item(s) will be imported together.` : '',
      dropped: best.dropped,
      candidates: best.candidates,
      sourcePaths: existingPaths,
      companionPaths
    };
  }

  async importDroppedChart(payload: ChartImportPayload): Promise<ChartImportResult> {
    const sourcePaths = uniqueStrings(payload.sourcePaths.filter(Boolean));
    const destinationDirectory = payload.destinationDirectory;
    const primaryChartPath = sourcePaths.find((sourcePath) => chartFileExtensions.has(path.extname(sourcePath).toLowerCase()));
    if (!primaryChartPath) {
      return { ok: false, message: 'Unsupported chart file extension.' };
    }

    let sourceStats: { sourcePath: string; stats: Stats }[];
    try {
      const destinationStat = await fs.stat(destinationDirectory);
      if (!destinationStat.isDirectory()) return { ok: false, message: 'The selected destination is not a directory.' };
      sourceStats = await Promise.all(sourcePaths.map(async (sourcePath) => ({ sourcePath, stats: await fs.stat(sourcePath) })));
      const primary = sourceStats.find((source) => source.sourcePath === primaryChartPath);
      if (!primary?.stats.isFile()) return { ok: false, message: 'The source chart is not a file.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    const importedPaths: string[] = [];
    const skippedPaths: string[] = [];
    let primaryTargetPath = '';
    try {
      for (const source of sourceStats) {
        const targetPath = path.join(destinationDirectory, path.basename(source.sourcePath));
        if (samePath(source.sourcePath, targetPath) || await exists(targetPath)) {
          skippedPaths.push(source.sourcePath);
          if (source.sourcePath === primaryChartPath) primaryTargetPath = targetPath;
          continue;
        }

        if (source.stats.isDirectory()) {
          if (isPathInside(targetPath, source.sourcePath)) {
            return { ok: false, message: `Refusing to copy a folder into itself: ${source.sourcePath}` };
          }
          await fs.cp(source.sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
        } else if (source.stats.isFile()) {
          await fs.copyFile(source.sourcePath, targetPath);
        } else {
          skippedPaths.push(source.sourcePath);
          continue;
        }
        importedPaths.push(targetPath);
        if (source.sourcePath === primaryChartPath) primaryTargetPath = targetPath;
      }

      const importedText = importedPaths.length === 1 ? '1 item' : `${importedPaths.length} items`;
      const skippedText = skippedPaths.length > 0 ? `; ${skippedPaths.length} already existed or were skipped` : '';
      return {
        ok: true,
        message: importedPaths.length === 0 ? `${skippedPaths.length} item(s) already existed. Import treated as complete.` : `Imported ${importedText}${skippedText}.`,
        targetPath: primaryTargetPath || importedPaths[0],
        importedPaths,
        skippedPaths,
        alreadyInPlace: importedPaths.length === 0 && skippedPaths.length > 0
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async mergeDuplicateDirectories(payload: DuplicateDirectoryMergePayload): Promise<DuplicateDirectoryMergeResult> {
    if (!payload.targetDirectory.trim()) {
      return { ok: false, message: 'Merge target is empty.' };
    }
    const sourceDirectories = uniqueStrings(payload.sourceDirectories.filter((directory) => directory.trim()).map((directory) => path.resolve(directory)));
    const targetDirectory = path.resolve(payload.targetDirectory);
    if (sourceDirectories.length < 2) {
      return { ok: false, message: 'Select at least two directories to merge.' };
    }
    if (!sourceDirectories.some((directory) => samePath(directory, targetDirectory))) {
      return { ok: false, message: 'The merge target must be included in the selected directories.' };
    }

    try {
      const settings = await this.loadSettings();
      const config = await this.loadBeatorajaConfig(settings.beatorajaRoot || path.dirname(this.appRoot));
      const bmsRoots = config.bmsRoots.map((root) => path.resolve(resolveFromRoot(config.root, root)));
      if (bmsRoots.length === 0) {
        return { ok: false, message: 'No BMS root is configured.' };
      }

      const targetStat = await fs.stat(targetDirectory);
      if (!targetStat.isDirectory()) return { ok: false, message: `Merge target is not a directory: ${targetDirectory}` };

      for (const directory of sourceDirectories) {
        const stat = await fs.stat(directory);
        if (!stat.isDirectory()) return { ok: false, message: `Merge source is not a directory: ${directory}` };
        if (!isPathUnderAnyRoot(directory, bmsRoots)) {
          return { ok: false, message: `Refusing to merge a directory outside BMS roots: ${directory}` };
        }
        if (bmsRoots.some((root) => samePath(directory, root))) {
          return { ok: false, message: `Refusing to merge a BMS root directory directly: ${directory}` };
        }
      }

      const nonTargetSources = sourceDirectories.filter((directory) => !samePath(directory, targetDirectory));
      for (const source of nonTargetSources) {
        if (isPathInside(source, targetDirectory) || isPathInside(targetDirectory, source)) {
          return { ok: false, message: `Nested merge directories are not supported: ${source}` };
        }
      }

      for (let index = 0; index < sourceDirectories.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < sourceDirectories.length; otherIndex += 1) {
          const a = sourceDirectories[index];
          const b = sourceDirectories[otherIndex];
          if (samePath(a, b)) continue;
          if (isPathInside(a, b) || isPathInside(b, a)) {
            return { ok: false, message: `Nested merge directories are not supported: ${a} / ${b}` };
          }
        }
      }

      await this.ensureDatabaseBackups(config);
      await validateMergeDatabases(this.appRoot, config);

      const movedFiles: string[] = [];
      const skippedFiles: string[] = [];
      const deletedDirectories: string[] = [];
      const movedFilePairs: MovedFilePair[] = [];

      for (const source of nonTargetSources) {
        const result = await moveDirectoryContentsSkippingExisting(source, targetDirectory);
        movedFiles.push(...result.movedFiles);
        skippedFiles.push(...result.skippedFiles);
        movedFilePairs.push(...result.movedFilePairs);
      }

      const databaseUpdate = await updateMergedChartDatabases(this.appRoot, config, {
        targetDirectory,
        sourceDirectories: nonTargetSources,
        movedFilePairs
      });

      for (const source of nonTargetSources) {
        await fs.rm(source, { recursive: true, force: false });
        deletedDirectories.push(source);
      }

      this.stateCache = null;
      this.importMatcherCache = null;
      return {
        ok: true,
        message: `Merged ${nonTargetSources.length} director${nonTargetSources.length === 1 ? 'y' : 'ies'} into ${targetDirectory}. Moved ${movedFiles.length} file(s), skipped ${skippedFiles.length} existing file(s). Updated ${databaseUpdate.updatedSongs} song row(s), deleted ${databaseUpdate.deletedSongs} song row(s).`,
        targetDirectory,
        mergedDirectories: nonTargetSources,
        deletedDirectories,
        movedFiles,
        skippedFiles
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadBeatorajaConfig(root: string): Promise<BeatorajaConfigSummary> {
    const configPath = await firstExisting([path.join(root, 'config_sys.json'), path.join(root, 'config.json')]);
    if (!configPath) throw new Error(`No config_sys.json or config.json found under ${root}`);

    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
    const songDbPath = resolveFromRoot(root, String(config.songpath ?? 'songdata.db'));
    const songInfoDbPath = resolveFromRoot(root, String(config.songinfopath ?? 'songinfo.db'));
    const tablePath = resolveFromRoot(root, String(config.tablepath ?? 'table'));
    const playerPath = resolveFromRoot(root, String(config.playerpath ?? 'player'));
    const bmsRoots = Array.isArray(config.bmsroot) ? config.bmsroot.map(String) : [];

    if (!await exists(songDbPath)) throw new Error(`songdata database not found: ${songDbPath}`);
    if (!await exists(tablePath)) throw new Error(`table directory not found: ${tablePath}`);
    if (!await exists(playerPath)) throw new Error(`player directory not found: ${playerPath}`);

    return {
      root,
      configPath,
      songDbPath,
      songInfoDbPath: await exists(songInfoDbPath) ? songInfoDbPath : null,
      tablePath,
      playerPath,
      bmsRoots
    };
  }

  private async loadPlayers(playerPath: string): Promise<PlayerProfile[]> {
    const entries = await fs.readdir(playerPath, { withFileTypes: true });
    const players: PlayerProfile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(playerPath, entry.name, 'config_player.json');
      const scoreDbPath = path.join(playerPath, entry.name, 'score.db');
      if (!await exists(configPath) || !await exists(scoreDbPath)) continue;
      try {
        const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
        players.push({
          id: String(config.id ?? entry.name),
          name: String(config.name ?? entry.name),
          lnmode: Number(config.lnmode ?? 0),
          scoreDbPath
        });
      } catch {
        players.push({ id: entry.name, name: entry.name, lnmode: 0, scoreDbPath });
      }
    }
    return players.sort((a, b) => a.id.localeCompare(b.id, 'ja'));
  }

  private async loadSongs(dbPath: string, diagnostics: string[]): Promise<SongDbRow[]> {
    try {
      const db = await openReadonlyDatabase(dbPath, this.appRoot);
      try {
        return selectAll<SongDbRow>(db, 'SELECT md5, sha256, title, subtitle, genre, artist, subartist, parent, path, folder, level, difficulty, mode, notes, adddate, charthash FROM song');
      } finally {
        db.close();
      }
    } catch (error) {
      diagnostics.push(`Failed to read songdata.db: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async loadSongInfo(dbPath: string, diagnostics: string[]): Promise<SongInfoRow[]> {
    try {
      const db = await openReadonlyDatabase(dbPath, this.appRoot);
      try {
        return selectAll<SongInfoRow>(db, 'SELECT sha256, density, mainbpm FROM information');
      } finally {
        db.close();
      }
    } catch (error) {
      diagnostics.push(`Failed to read songinfo.db: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async loadScores(dbPath: string, diagnostics: string[]): Promise<ScoreDbRow[]> {
    try {
      const db = await openReadonlyDatabase(dbPath, this.appRoot);
      try {
        return selectAll<ScoreDbRow>(db, 'SELECT * FROM score');
      } finally {
        db.close();
      }
    } catch (error) {
      diagnostics.push(`Failed to read score.db: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private cacheState(state: ManagerState): ManagerState {
    this.stateCache = state;
    this.importMatcherCache = null;
    return state;
  }

  private getImportMatcher(libraryRows: TableChartRow[]): ImportMatcher {
    if (!this.importMatcherCache || this.importMatcherCache.libraryRows !== libraryRows) {
      this.importMatcherCache = { libraryRows, matcher: createImportMatcher(libraryRows) };
    }
    return this.importMatcherCache.matcher;
  }

  private async ensureDatabaseBackups(config: BeatorajaConfigSummary): Promise<void> {
    const databasePaths = uniqueStrings([
      config.songDbPath,
      config.songInfoDbPath ?? ''
    ]);

    for (const databasePath of databasePaths) {
      const resolvedPath = path.resolve(databasePath);
      if (this.backedUpDatabasePaths.has(resolvedPath)) continue;
      await createRotatedDatabaseBackup(resolvedPath);
      this.backedUpDatabasePaths.add(resolvedPath);
    }
  }
}

function hydrateRows(
  loadedTables: Awaited<ReturnType<typeof loadTables>>,
  songs: SongDbRow[],
  infos: SongInfoRow[],
  scores: ScoreDbRow[]
): { rows: TableChartRow[]; tables: TableSummary[] } {
  const songBySha = new Map(songs.filter((song) => song.sha256).map((song) => [lower(song.sha256), song]));
  const songByMd5 = new Map(songs.filter((song) => song.md5).map((song) => [lower(song.md5), song]));
  const infoBySha = new Map(infos.filter((info) => info.sha256).map((info) => [lower(info.sha256), info]));
  const scoreBySha = bestScoresBySha(scores);
  const rows: TableChartRow[] = [];
  const tables: TableSummary[] = [];

  for (const table of loadedTables) {
    const tableRows: TableChartRow[] = [];
    const tableName = table.data.name ?? table.fileName;
    const folders = table.data.folder ?? [];
    const courses = table.data.course ?? [];

    folders.forEach((folder, folderIndex) => {
      readSongList(folder).forEach((chart, chartIndex) => {
        tableRows.push(createRow(table.id, tableName, table.data.url ?? '', folder.name ?? '', chart, folderIndex, chartIndex, songBySha, songByMd5, infoBySha, scoreBySha));
      });
    });

    courses.forEach((course, courseIndex) => {
      readSongList(course).forEach((chart, chartIndex) => {
        tableRows.push(createRow(table.id, tableName, table.data.url ?? '', `COURSE: ${course.name ?? courseIndex + 1}`, chart, folders.length + courseIndex, chartIndex, songBySha, songByMd5, infoBySha, scoreBySha));
      });
    });

    rows.push(...tableRows);
    tables.push({
      id: table.id,
      name: tableName,
      url: table.data.url ?? '',
      tag: table.data.tag ?? '',
      fileName: table.fileName,
      folderCount: folders.length + courses.length,
      chartCount: tableRows.length,
      missingCount: tableRows.filter((row) => row.status === 'NO SONG').length
    });
  }

  return { rows, tables };
}

interface MovedFilePair {
  sourcePath: string;
  targetPath: string;
}

interface MergeDatabaseUpdateInput {
  targetDirectory: string;
  sourceDirectories: string[];
  movedFilePairs: MovedFilePair[];
}

interface MergeDatabaseUpdateSummary {
  updatedSongs: number;
  deletedSongs: number;
  updatedFolders: number;
  deletedFolders: number;
  deletedSongInfo: number;
}

async function updateMergedChartDatabases(
  appRoot: string,
  config: BeatorajaConfigSummary,
  input: MergeDatabaseUpdateInput
): Promise<MergeDatabaseUpdateSummary> {
  const songDb = await openReadonlyDatabase(config.songDbPath, appRoot);
  const summary: MergeDatabaseUpdateSummary = {
    updatedSongs: 0,
    deletedSongs: 0,
    updatedFolders: 0,
    deletedFolders: 0,
    deletedSongInfo: 0
  };

  const remainingSha256 = new Set<string>();
  const deletedSha256 = new Set<string>();

  try {
    const songs = selectAll<SongDbRow>(songDb, 'SELECT path, sha256 FROM song');
    const folders = tableExists(songDb, 'folder') ? selectAll<FolderDbRow>(songDb, 'SELECT path, parent FROM folder') : [];
    const movedTargetBySourceKey = new Map(input.movedFilePairs.map((pair) => [pathKey(pair.sourcePath), pair.targetPath]));
    const existingSongPathKeys = new Set(songs.map((song) => pathKey(String(song.path ?? ''))).filter(Boolean));
    const folderParentByKey = new Map<string, string>();
    const folderPathByKey = new Map<string, string>();

    for (const folder of folders) {
      const key = directoryPathKey(folder.path);
      if (!key) continue;
      folderPathByKey.set(key, String(folder.path ?? ''));
      if (folder.parent) folderParentByKey.set(key, String(folder.parent));
    }

    const folderUpdates: { oldPath: string; newPath: string }[] = [];
    const folderDeletes: string[] = [];
    const plannedFolderParentByKey = new Map(folderParentByKey);

    for (const folder of folders) {
      const oldPath = String(folder.path ?? '');
      if (!oldPath || !isPathUnderAnyRoot(oldPath, input.sourceDirectories)) continue;
      const mappedPath = mapMergedSourcePath(oldPath, input.sourceDirectories, input.targetDirectory, true);
      if (!mappedPath) continue;

      const mappedKey = directoryPathKey(mappedPath);
      if (!mappedKey || folderPathByKey.has(mappedKey)) {
        folderDeletes.push(oldPath);
        continue;
      }

      folderUpdates.push({ oldPath, newPath: mappedPath });
      if (folder.parent) plannedFolderParentByKey.set(mappedKey, String(folder.parent));
      folderPathByKey.set(mappedKey, mappedPath);
    }

    songDb.run('BEGIN TRANSACTION');
    try {
      for (const { oldPath, newPath } of folderUpdates) {
        songDb.run('UPDATE folder SET path = ? WHERE path = ?', [newPath, oldPath]);
        summary.updatedFolders += 1;
      }
      for (const oldPath of folderDeletes) {
        songDb.run('DELETE FROM folder WHERE path = ?', [oldPath]);
        summary.deletedFolders += 1;
      }

      for (const song of songs) {
        const oldPath = String(song.path ?? '');
        const oldPathKey = pathKey(oldPath);
        const sha256 = lower(song.sha256);
        if (!oldPath || !isPathUnderAnyRoot(oldPath, input.sourceDirectories)) {
          if (sha256) remainingSha256.add(sha256);
          continue;
        }

        const movedTargetPath = oldPathKey ? movedTargetBySourceKey.get(oldPathKey) : undefined;
        if (movedTargetPath) {
          const movedTargetPathKey = pathKey(movedTargetPath);
          if (movedTargetPathKey && movedTargetPathKey !== oldPathKey && existingSongPathKeys.has(movedTargetPathKey)) {
            songDb.run('DELETE FROM song WHERE path = ?', [oldPath]);
            summary.deletedSongs += 1;
            if (sha256) deletedSha256.add(sha256);
            continue;
          }

          const targetDirectory = path.dirname(movedTargetPath);
          const targetParent = plannedFolderParentByKey.get(directoryPathKey(targetDirectory));
          if (targetParent) {
            songDb.run('UPDATE song SET path = ?, parent = ? WHERE path = ?', [movedTargetPath, targetParent, oldPath]);
          } else {
            songDb.run('UPDATE song SET path = ? WHERE path = ?', [movedTargetPath, oldPath]);
          }
          summary.updatedSongs += 1;
          if (sha256) remainingSha256.add(sha256);
        } else {
          songDb.run('DELETE FROM song WHERE path = ?', [oldPath]);
          summary.deletedSongs += 1;
          if (sha256) deletedSha256.add(sha256);
        }
      }

      songDb.run('COMMIT');
    } catch (error) {
      songDb.run('ROLLBACK');
      throw error;
    }

    await writeDatabase(config.songDbPath, songDb);
  } finally {
    songDb.close();
  }

  const orphanedDeletedSha256 = [...deletedSha256].filter((sha256) => !remainingSha256.has(sha256));
  if (config.songInfoDbPath && orphanedDeletedSha256.length > 0) {
    summary.deletedSongInfo = await deleteSongInfoRows(appRoot, config.songInfoDbPath, orphanedDeletedSha256);
  }

  return summary;
}

async function validateMergeDatabases(appRoot: string, config: BeatorajaConfigSummary): Promise<void> {
  const songDb = await openReadonlyDatabase(config.songDbPath, appRoot);
  try {
    if (!tableExists(songDb, 'song')) throw new Error(`song table not found in ${config.songDbPath}`);
  } finally {
    songDb.close();
  }

  if (!config.songInfoDbPath) return;
  const songInfoDb = await openReadonlyDatabase(config.songInfoDbPath, appRoot);
  try {
    if (!tableExists(songInfoDb, 'information')) throw new Error(`information table not found in ${config.songInfoDbPath}`);
  } finally {
    songInfoDb.close();
  }
}

async function deleteSongInfoRows(appRoot: string, songInfoDbPath: string, sha256s: string[]): Promise<number> {
  const db = await openReadonlyDatabase(songInfoDbPath, appRoot);
  let deleted = 0;
  try {
    if (!tableExists(db, 'information')) return 0;
    db.run('BEGIN TRANSACTION');
    try {
      for (const sha256 of sha256s) {
        db.run('DELETE FROM information WHERE lower(sha256) = ?', [sha256]);
        deleted += db.getRowsModified();
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    await writeDatabase(songInfoDbPath, db);
    return deleted;
  } finally {
    db.close();
  }
}

function tableExists(db: Awaited<ReturnType<typeof openReadonlyDatabase>>, tableName: string): boolean {
  const result = db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${sqlStringLiteral(tableName)} LIMIT 1`);
  return Boolean(result[0]?.values.length);
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function createLibraryRows(songs: SongDbRow[], infos: SongInfoRow[], scores: ScoreDbRow[]): TableChartRow[] {
  const infoBySha = new Map(infos.filter((info) => info.sha256).map((info) => [lower(info.sha256), info]));
  const scoreBySha = bestScoresBySha(scores);
  const md5sByFolder = songMd5sByFolder(songs);
  return songs
    .filter((song) => song.sha256 || song.md5)
    .map((song, index) => {
      const sha = lower(song.sha256);
      const md5 = lower(song.md5);
      const info = sha ? infoBySha.get(sha) : undefined;
      const score = sha ? scoreBySha.get(sha) : undefined;
      const clear = numberOrNull(score?.clear);
      const folderMd5s = md5sByFolder.get(folderKey(String(song.path ?? ''))) ?? [];
      return {
        id: `library:${sha || md5 || 'chart'}:${index}`,
        tableId: '__library',
        tableName: 'BMS Path',
        tableUrl: '',
        level: path.basename(path.dirname(String(song.path ?? ''))),
        title: String(song.title ?? ''),
        subtitle: String(song.subtitle ?? ''),
        artist: String(song.artist ?? ''),
        subartist: String(song.subartist ?? ''),
        genre: String(song.genre ?? ''),
        md5,
        sha256: sha,
        orgMd5: folderMd5s[0] ?? lower(song.parent),
        orgMd5s: folderMd5s,
        url1: '',
        url2: '',
        ipfs: '',
        appendIpfs: '',
        mode: numberOrNull(song.mode),
        installed: true,
        status: clearToStatus(clear),
        clear,
        notes: numberOrNull(song.notes ?? score?.notes),
        difficulty: numberOrNull(song.difficulty),
        songLevel: numberOrNull(song.level),
        mainBpm: numberOrNull(info?.mainbpm),
        density: numberOrNull(info?.density),
        path: String(song.path ?? ''),
        folder: String(song.folder ?? ''),
        addDate: numberOrNull(song.adddate)
      } satisfies TableChartRow;
    });
}

function createRow(
  tableId: string,
  tableName: string,
  tableUrl: string,
  level: string,
  chart: ParsedTableSong,
  folderIndex: number,
  chartIndex: number,
  songBySha: Map<string, SongDbRow>,
  songByMd5: Map<string, SongDbRow>,
  infoBySha: Map<string, SongInfoRow>,
  scoreBySha: Map<string, ScoreDbRow>
): TableChartRow {
  const sha256 = lower(chart.sha256);
  const md5 = lower(chart.md5);
  const installedSong = (sha256 ? songBySha.get(sha256) : undefined) ?? (md5 ? songByMd5.get(md5) : undefined);
  const installedSha = lower(installedSong?.sha256) || sha256;
  const installedMd5 = lower(installedSong?.md5) || md5;
  const info = installedSha ? infoBySha.get(installedSha) : undefined;
  const score = installedSha ? scoreBySha.get(installedSha) : undefined;
  const clear = numberOrNull(score?.clear);
  const installed = Boolean(installedSong);
  const status = installed ? clearToStatus(clear) : 'NO SONG';

  return {
    id: `${tableId}:${folderIndex}:${chartIndex}:${installedSha || installedMd5 || chart.title || chartIndex}`,
    tableId,
    tableName,
    tableUrl,
    level,
    title: String(installedSong?.title ?? chart.title ?? ''),
    subtitle: String(installedSong?.subtitle ?? chart.subtitle ?? ''),
    artist: String(installedSong?.artist ?? chart.artist ?? ''),
    subartist: String(installedSong?.subartist ?? ''),
    genre: String(installedSong?.genre ?? chart.genre ?? ''),
    md5: installedMd5,
    sha256: installedSha,
    orgMd5: lower(chart.org_md5 ?? chart.orgMd5),
    url1: String(chart.url ?? ''),
    url2: String(chart.appendurl ?? chart.appendURL ?? chart.appendUrl ?? ''),
    ipfs: String(chart.ipfs ?? ''),
    appendIpfs: String(chart.appendIpfs ?? chart.appendipfs ?? ''),
    mode: numberOrNull(installedSong?.mode ?? chart.mode),
    installed,
    status,
    clear,
    notes: numberOrNull(installedSong?.notes ?? score?.notes),
    difficulty: numberOrNull(installedSong?.difficulty),
    songLevel: numberOrNull(installedSong?.level),
    mainBpm: numberOrNull(info?.mainbpm),
    density: numberOrNull(info?.density),
    path: String(installedSong?.path ?? ''),
    folder: String(installedSong?.folder ?? '')
  };
}

function bestScoresBySha(scores: ScoreDbRow[]): Map<string, ScoreDbRow> {
  const map = new Map<string, ScoreDbRow>();
  for (const score of scores) {
    const sha = lower(score.sha256);
    if (!sha) continue;
    const current = map.get(sha);
    if (!current || Number(score.clear ?? 0) > Number(current.clear ?? 0)) {
      map.set(sha, score);
    }
  }
  return map;
}

function resolveFromRoot(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const item of paths) {
    if (await exists(item)) return item;
  }
  return null;
}

async function createRotatedDatabaseBackup(databasePath: string): Promise<void> {
  const backupPrefix = `${path.basename(databasePath)}.manager-backup-`;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const backupPath = path.join(path.dirname(databasePath), `${backupPrefix}${timestamp}-${process.pid}`);
  await fs.copyFile(databasePath, backupPath);

  const entries = await fs.readdir(path.dirname(databasePath));
  const backups = entries
    .filter((entry) => entry.startsWith(backupPrefix))
    .sort((a, b) => a.localeCompare(b, 'en'));

  for (const oldBackup of backups.slice(0, Math.max(0, backups.length - 2))) {
    await fs.rm(path.join(path.dirname(databasePath), oldBackup), { force: true });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function songMd5sByFolder(songs: SongDbRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const song of songs) {
    const key = folderKey(String(song.path ?? ''));
    const md5 = lower(song.md5);
    if (!key || !md5) continue;
    const md5s = map.get(key) ?? [];
    md5s.push(md5);
    map.set(key, md5s);
  }
  return map;
}

function folderKey(filePath: string): string {
  const normalized = normalizePath(filePath);
  const separator = normalized.lastIndexOf('/');
  return separator >= 0 ? normalized.slice(0, separator) : normalized;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function pathKey(value: string | null | undefined): string {
  if (!value) return '';
  return normalizePath(path.resolve(value)).replace(/\/+$/, '');
}

function directoryPathKey(value: string | null | undefined): string {
  return pathKey(value);
}

function hasTrailingSeparator(value: string): boolean {
  return /[\\/]$/.test(value);
}

function withTrailingSeparator(value: string, shouldHaveTrailingSeparator: boolean): string {
  if (!shouldHaveTrailingSeparator) return value;
  return /[\\/]$/.test(value) ? value : `${value}${path.sep}`;
}

function mapMergedSourcePath(value: string, sourceDirectories: string[], targetDirectory: string, preserveTrailingSeparator: boolean): string | null {
  for (const sourceDirectory of sourceDirectories) {
    if (!samePath(value, sourceDirectory) && !isPathInside(value, sourceDirectory)) continue;
    const relativePath = path.relative(path.resolve(sourceDirectory), path.resolve(value));
    return withTrailingSeparator(path.join(targetDirectory, relativePath), preserveTrailingSeparator && hasTrailingSeparator(value));
  }
  return null;
}

function isPathUnderRoot(filePath: string, root: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function parseDroppedChartVariants(sourcePath: string, buffer: Buffer): DroppedChartMetadata[] {
  const variants = [
    parseDroppedChart(sourcePath, buffer, decodeBuffer(buffer, 'utf-8')),
    parseDroppedChart(sourcePath, buffer, decodeBuffer(buffer, 'shift_jis'))
  ];
  const seen = new Set<string>();
  return variants.filter((metadata) => {
    const key = `${metadata.title}\n${metadata.subtitle}\n${metadata.artist}\n${metadata.genre}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDroppedChart(sourcePath: string, buffer: Buffer, text: string): DroppedChartMetadata {
  const extension = path.extname(sourcePath).toLowerCase();
  const base = {
    sourcePath,
    fileName: path.basename(sourcePath),
    title: '',
    subtitle: '',
    artist: '',
    genre: '',
    md5: crypto.createHash('md5').update(buffer).digest('hex'),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    mode: extension === '.pms' ? 9 : null
  } satisfies DroppedChartMetadata;

  if (extension === '.bmson') return parseBmsonMetadata(text, base);
  return parseBmsMetadata(text, base);
}

function parseBmsMetadata(text: string, base: DroppedChartMetadata): DroppedChartMetadata {
  const metadata = { ...base };
  for (const rawLine of text.split(/\r?\n/).slice(0, 4000)) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) continue;
    const match = line.match(/^#([A-Z0-9_]+)\s+(.+)$/i);
    if (!match) continue;

    const key = match[1].toUpperCase();
    const value = match[2].trim();
    if (key === 'TITLE') metadata.title = value;
    else if (key === 'SUBTITLE') metadata.subtitle = value;
    else if (key === 'ARTIST') metadata.artist = value;
    else if (key === 'GENRE') metadata.genre = value;
    else if (key === 'PLAYER') metadata.mode = playerMode(value, base.mode);
  }
  return metadata.title ? metadata : { ...metadata, title: path.basename(base.fileName, path.extname(base.fileName)) };
}

function parseBmsonMetadata(text: string, base: DroppedChartMetadata): DroppedChartMetadata {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const info = data.info && typeof data.info === 'object' ? data.info as Record<string, unknown> : {};
    const modeHint = String(info.mode_hint ?? '');
    return {
      ...base,
      title: String(info.title ?? path.basename(base.fileName, path.extname(base.fileName))),
      subtitle: String(info.subtitle ?? ''),
      artist: String(info.artist ?? ''),
      genre: String(info.genre ?? ''),
      mode: modeHint.includes('9') ? 9 : modeHint.includes('14') ? 14 : modeHint.includes('7') ? 7 : base.mode
    };
  } catch {
    return { ...base, title: path.basename(base.fileName, path.extname(base.fileName)) };
  }
}

function decodeBuffer(buffer: Buffer, encoding: 'utf-8' | 'shift_jis'): string {
  return new TextDecoder(encoding, { fatal: false }).decode(buffer);
}

function playerMode(value: string, fallback: number | null): number | null {
  const player = Number(value);
  if (player === 1) return 7;
  if (player === 2) return 14;
  if (player === 3) return 9;
  return fallback;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isPathUnderAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => samePath(candidate, root) || isPathInside(candidate, root));
}

async function moveDirectoryContentsSkippingExisting(sourceDirectory: string, targetDirectory: string): Promise<{ movedFiles: string[]; skippedFiles: string[]; movedFilePairs: MovedFilePair[] }> {
  const movedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const movedFilePairs: MovedFilePair[] = [];
  await moveChildren(sourceDirectory, sourceDirectory, targetDirectory, movedFiles, skippedFiles, movedFilePairs);
  return { movedFiles, skippedFiles, movedFilePairs };
}

async function moveChildren(sourceRoot: string, currentSourceDirectory: string, targetRoot: string, movedFiles: string[], skippedFiles: string[], movedFilePairs: MovedFilePair[]): Promise<void> {
  const entries = await fs.readdir(currentSourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(currentSourceDirectory, entry.name);
    const relativePath = path.relative(sourceRoot, sourcePath);
    const targetPath = path.join(targetRoot, relativePath);

    if (entry.isDirectory()) {
      if (await exists(targetPath)) {
        const targetStat = await fs.stat(targetPath);
        if (!targetStat.isDirectory()) {
          skippedFiles.push(...await collectFilePaths(sourcePath));
          continue;
        }
      } else {
        await fs.mkdir(targetPath, { recursive: true });
      }
      await moveChildren(sourceRoot, sourcePath, targetRoot, movedFiles, skippedFiles, movedFilePairs);
      continue;
    }

    if (await hasExistingMergeEquivalent(targetPath)) {
      skippedFiles.push(sourcePath);
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await moveFileAcrossVolumes(sourcePath, targetPath);
    movedFiles.push(targetPath);
    movedFilePairs.push({ sourcePath, targetPath });
  }
}

async function moveFileAcrossVolumes(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
  }
}

async function collectFilePaths(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFilePaths(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function isCrossDeviceError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EXDEV';
}

async function hasExistingMergeEquivalent(targetPath: string): Promise<boolean> {
  if (await exists(targetPath)) return true;
  const audioEquivalent = audioEquivalentPath(targetPath);
  return audioEquivalent ? exists(audioEquivalent) : false;
}

function audioEquivalentPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.wav' && extension !== '.ogg') return null;
  const alternateExtension = extension === '.wav' ? '.ogg' : '.wav';
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${alternateExtension}`);
}
