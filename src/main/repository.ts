import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppSettings,
  BeatorajaConfigSummary,
  DirectoryNode,
  ManagerState,
  PlayerProfile,
  TableChartRow,
  TableSummary
} from '../shared/types';
import { clearToStatus } from '../shared/domain';
import { loadTables, readSongList, type ParsedTableSong } from './tableParser';
import { openReadonlyDatabase, selectAll } from './sqlite';

interface SongDbRow {
  md5?: string;
  sha256?: string;
  title?: string;
  subtitle?: string;
  genre?: string;
  artist?: string;
  subartist?: string;
  path?: string;
  folder?: string;
  level?: number;
  difficulty?: number;
  mode?: number;
  notes?: number;
  charthash?: string;
}

interface SongInfoRow {
  sha256?: string;
  density?: number;
  mainbpm?: number;
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

export class ManagerRepository {
  private readonly settingsPath: string;

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
      return { settings, beatoraja, players, selectedPlayer, tables, rows, libraryRows, bmsRootNodes, diagnostics };
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

    return { settings, beatoraja, players, selectedPlayer, tables, rows, libraryRows, bmsRootNodes, diagnostics };
  }

  async loadSettings(): Promise<AppSettings> {
    try {
      const text = await fs.readFile(this.settingsPath, 'utf8');
      return { ...defaultSettings, ...JSON.parse(text) };
    } catch {
      return { ...defaultSettings };
    }
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.loadSettings();
    const next = { ...current, ...patch };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
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
        return selectAll<SongDbRow>(db, 'SELECT md5, sha256, title, subtitle, genre, artist, subartist, path, folder, level, difficulty, mode, notes, charthash FROM song');
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

function createLibraryRows(songs: SongDbRow[], infos: SongInfoRow[], scores: ScoreDbRow[]): TableChartRow[] {
  const infoBySha = new Map(infos.filter((info) => info.sha256).map((info) => [lower(info.sha256), info]));
  const scoreBySha = bestScoresBySha(scores);
  return songs
    .filter((song) => song.sha256 || song.md5)
    .map((song, index) => {
      const sha = lower(song.sha256);
      const info = sha ? infoBySha.get(sha) : undefined;
      const score = sha ? scoreBySha.get(sha) : undefined;
      const clear = numberOrNull(score?.clear);
      return {
        id: `library:${sha || lower(song.md5) || index}`,
        tableId: '__library',
        tableName: 'BMS Path',
        tableUrl: '',
        level: path.basename(path.dirname(String(song.path ?? ''))),
        title: String(song.title ?? ''),
        subtitle: String(song.subtitle ?? ''),
        artist: String(song.artist ?? ''),
        genre: String(song.genre ?? ''),
        md5: lower(song.md5),
        sha256: sha,
        orgMd5: '',
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
        folder: String(song.folder ?? '')
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
  const info = installedSha ? infoBySha.get(installedSha) : undefined;
  const score = installedSha ? scoreBySha.get(installedSha) : undefined;
  const clear = numberOrNull(score?.clear);
  const installed = Boolean(installedSong);
  const status = installed ? clearToStatus(clear) : 'NO SONG';

  return {
    id: `${tableId}:${folderIndex}:${chartIndex}:${sha256 || md5 || chart.title || chartIndex}`,
    tableId,
    tableName,
    tableUrl,
    level,
    title: String(installedSong?.title ?? chart.title ?? ''),
    subtitle: String(installedSong?.subtitle ?? chart.subtitle ?? ''),
    artist: String(installedSong?.artist ?? chart.artist ?? ''),
    genre: String(installedSong?.genre ?? chart.genre ?? ''),
    md5,
    sha256,
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

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function isPathUnderRoot(filePath: string, root: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}