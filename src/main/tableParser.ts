import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ParsedTableSong {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  md5?: string;
  sha256?: string;
  org_md5?: string;
  orgMd5?: string;
  url?: string;
  appendurl?: string;
  appendURL?: string;
  appendUrl?: string;
  ipfs?: string;
  appendIpfs?: string;
  appendipfs?: string;
  mode?: number;
}

export interface ParsedTableFolder {
  name?: string;
  songs?: ParsedTableSong[];
  song?: ParsedTableSong[];
  hash?: ParsedTableSong[];
}

export interface ParsedTableCourse {
  name?: string;
  songs?: ParsedTableSong[];
  song?: ParsedTableSong[];
  hash?: ParsedTableSong[];
}

export interface ParsedTableData {
  name?: string;
  url?: string;
  tag?: string;
  folder?: ParsedTableFolder[];
  course?: ParsedTableCourse[];
}

export interface LoadedTable {
  id: string;
  fileName: string;
  data: ParsedTableData;
}

export function parseTableBuffer(fileName: string, buffer: Buffer): ParsedTableData {
  const raw = fileName.toLowerCase().endsWith('.bmt') ? zlib.gunzipSync(buffer) : buffer;
  return JSON.parse(raw.toString('utf8')) as ParsedTableData;
}

export function readSongList(value: ParsedTableFolder | ParsedTableCourse): ParsedTableSong[] {
  return value.songs ?? value.song ?? value.hash ?? [];
}

export async function loadTables(tableDir: string): Promise<LoadedTable[]> {
  const entries = await fs.readdir(tableDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(bmt|json)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'ja'));

  const tables: LoadedTable[] = [];
  for (const fileName of files) {
    try {
      const filePath = path.join(tableDir, fileName);
      const data = parseTableBuffer(fileName, await fs.readFile(filePath));
      if (!data.name || (!data.folder?.length && !data.course?.length)) continue;
      tables.push({ id: fileName, fileName, data });
    } catch {
      // Ignore malformed or unsupported table files; the UI reports loaded counts instead.
    }
  }
  return tables;
}