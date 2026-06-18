import fs from 'node:fs/promises';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagerRepository } from '../src/main/repository';

const tempRoots: string[] = [];

describe('ManagerRepository.mergeDuplicateDirectories', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('moves selected directory contents into the target, skips existing files, and deletes source directories', async () => {
    const { repository, songsRoot } = await createRepositoryFixture();
    const target = path.join(songsRoot, 'target');
    const sourceA = path.join(songsRoot, 'source-a');
    const sourceB = path.join(songsRoot, 'source-b');
    await fs.mkdir(path.join(target, 'sub'), { recursive: true });
    await fs.mkdir(path.join(sourceA, 'sub'), { recursive: true });
    await fs.mkdir(sourceB, { recursive: true });
    await fs.writeFile(path.join(target, 'keep.wav'), 'target', 'utf8');
    await fs.writeFile(path.join(sourceA, 'keep.wav'), 'source', 'utf8');
    await fs.writeFile(path.join(sourceA, 'move.bms'), 'chart', 'utf8');
    await fs.writeFile(path.join(sourceA, 'sub', 'nested.ogg'), 'nested', 'utf8');
    await fs.writeFile(path.join(sourceB, 'extra.png'), 'extra', 'utf8');

    const result = await repository.mergeDuplicateDirectories({
      targetDirectory: target,
      sourceDirectories: [target, sourceA, sourceB]
    });

    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(target, 'keep.wav'), 'utf8')).toBe('target');
    expect(await fs.readFile(path.join(target, 'move.bms'), 'utf8')).toBe('chart');
    expect(await fs.readFile(path.join(target, 'sub', 'nested.ogg'), 'utf8')).toBe('nested');
    expect(await fs.readFile(path.join(target, 'extra.png'), 'utf8')).toBe('extra');
    await expect(fs.stat(sourceA)).rejects.toThrow();
    await expect(fs.stat(sourceB)).rejects.toThrow();
    expect(result.movedFiles).toHaveLength(3);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.deletedDirectories).toEqual([sourceA, sourceB]);
  });

  it('skips wav and ogg files with the same base name as merge-equivalent audio', async () => {
    const { repository, songsRoot } = await createRepositoryFixture();
    const target = path.join(songsRoot, 'target');
    const source = path.join(songsRoot, 'source');
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(target, 'sound.ogg'), 'target audio', 'utf8');
    await fs.writeFile(path.join(source, 'sound.wav'), 'source audio', 'utf8');
    await fs.writeFile(path.join(source, 'other.wav'), 'other audio', 'utf8');

    const result = await repository.mergeDuplicateDirectories({
      targetDirectory: target,
      sourceDirectories: [target, source]
    });

    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(target, 'sound.ogg'), 'utf8')).toBe('target audio');
    await expect(fs.stat(path.join(target, 'sound.wav'))).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'other.wav'), 'utf8')).toBe('other audio');
    expect(result.movedFiles).toEqual([path.join(target, 'other.wav')]);
    expect(result.skippedFiles).toEqual([path.join(source, 'sound.wav')]);
  });

  it('refuses to merge directories outside configured BMS roots', async () => {
    const { repository, root, songsRoot } = await createRepositoryFixture();
    const target = path.join(songsRoot, 'target');
    const outside = path.join(root, 'outside');
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(outside, { recursive: true });

    const result = await repository.mergeDuplicateDirectories({
      targetDirectory: target,
      sourceDirectories: [target, outside]
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('outside BMS roots');
    await expect(fs.stat(outside)).resolves.toBeTruthy();
  });

  it('updates songdata and songinfo for moved and removed charts', async () => {
    const { repository, beatorajaRoot, songsRoot } = await createRepositoryFixture();
    const target = path.join(songsRoot, 'target');
    const source = path.join(songsRoot, 'source');
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(target, 'duplicate.bms'), 'target duplicate', 'utf8');
    await fs.writeFile(path.join(source, 'duplicate.bms'), 'source duplicate', 'utf8');
    await fs.writeFile(path.join(source, 'move.bms'), 'source move', 'utf8');
    await writeSongDatabases(beatorajaRoot, {
      songRows: [
        { path: path.join(target, 'duplicate.bms'), sha256: 'a'.repeat(64), parent: 'target-parent' },
        { path: path.join(source, 'duplicate.bms'), sha256: 'a'.repeat(64), parent: 'source-parent' },
        { path: path.join(source, 'move.bms'), sha256: 'b'.repeat(64), parent: 'source-parent' }
      ],
      folderRows: [
        { path: `${target}${path.sep}`, parent: 'target-parent' },
        { path: `${source}${path.sep}`, parent: 'source-parent' }
      ],
      informationSha256s: ['a'.repeat(64), 'b'.repeat(64)]
    });

    const result = await repository.mergeDuplicateDirectories({
      targetDirectory: target,
      sourceDirectories: [target, source]
    });

    expect(result.ok).toBe(true);
    const songRows = await readRows(beatorajaRoot, 'songdata.db', 'SELECT path, sha256, parent FROM song ORDER BY path');
    expect(songRows).toEqual([
      [path.join(target, 'duplicate.bms'), 'a'.repeat(64), 'target-parent'],
      [path.join(target, 'move.bms'), 'b'.repeat(64), 'target-parent']
    ]);
    const folderRows = await readRows(beatorajaRoot, 'songdata.db', 'SELECT path, parent FROM folder ORDER BY path');
    expect(folderRows).toEqual([[`${target}${path.sep}`, 'target-parent']]);
    const infoRows = await readRows(beatorajaRoot, 'songinfo.db', 'SELECT sha256 FROM information ORDER BY sha256');
    expect(infoRows).toEqual([['a'.repeat(64)], ['b'.repeat(64)]]);
  });

  it('creates one rotated backup per database per repository instance before DB updates', async () => {
    const { repository, beatorajaRoot, songsRoot } = await createRepositoryFixture();
    await fs.writeFile(path.join(beatorajaRoot, 'songdata.db.manager-backup-20000101T000000Z-1'), 'old', 'utf8');
    await fs.writeFile(path.join(beatorajaRoot, 'songdata.db.manager-backup-20010101T000000Z-1'), 'older', 'utf8');
    await createMergePair(songsRoot, 'first');
    await createMergePair(songsRoot, 'second');

    const first = await repository.mergeDuplicateDirectories({
      targetDirectory: path.join(songsRoot, 'first-target'),
      sourceDirectories: [path.join(songsRoot, 'first-target'), path.join(songsRoot, 'first-source')]
    });
    const second = await repository.mergeDuplicateDirectories({
      targetDirectory: path.join(songsRoot, 'second-target'),
      sourceDirectories: [path.join(songsRoot, 'second-target'), path.join(songsRoot, 'second-source')]
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const entries = await fs.readdir(beatorajaRoot);
    expect(entries.filter((entry) => entry.startsWith('songdata.db.manager-backup-')).sort()).toHaveLength(2);
    expect(entries.filter((entry) => entry.startsWith('songinfo.db.manager-backup-')).sort()).toHaveLength(1);
  });
});

async function createRepositoryFixture(): Promise<{ repository: ManagerRepository; root: string; beatorajaRoot: string; songsRoot: string }> {
  const root = path.join(process.cwd(), '.tmp-tests', `merge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempRoots.push(root);
  const appRoot = process.cwd();
  const dataRoot = path.join(root, 'data');
  const beatorajaRoot = path.join(root, 'beatoraja');
  const songsRoot = path.join(root, 'songs');
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.mkdir(path.join(beatorajaRoot, 'table'), { recursive: true });
  await fs.mkdir(path.join(beatorajaRoot, 'player'), { recursive: true });
  await fs.mkdir(songsRoot, { recursive: true });
  await fs.writeFile(path.join(dataRoot, 'settings.json'), JSON.stringify({ beatorajaRoot }), 'utf8');
  await writeSongDatabases(beatorajaRoot);
  await fs.writeFile(path.join(beatorajaRoot, 'config_sys.json'), JSON.stringify({
    songpath: 'songdata.db',
    songinfopath: 'songinfo.db',
    tablepath: 'table',
    playerpath: 'player',
    bmsroot: [songsRoot]
  }), 'utf8');

  return { repository: new ManagerRepository(appRoot, dataRoot), root, beatorajaRoot, songsRoot };
}

async function createMergePair(songsRoot: string, name: string): Promise<void> {
  const target = path.join(songsRoot, `${name}-target`);
  const source = path.join(songsRoot, `${name}-source`);
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, `${name}.txt`), name, 'utf8');
}

async function writeSongDatabases(
  beatorajaRoot: string,
  data: {
    songRows?: { path: string; sha256: string; parent: string }[];
    folderRows?: { path: string; parent: string }[];
    informationSha256s?: string[];
  } = {}
): Promise<void> {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file) });
  const songData = new SQL.Database();
  songData.run('CREATE TABLE song (md5 TEXT NOT NULL, sha256 TEXT NOT NULL, title TEXT, subtitle TEXT, genre TEXT, artist TEXT, subartist TEXT, tag TEXT, path TEXT, folder TEXT, stagefile TEXT, banner TEXT, backbmp TEXT, preview TEXT, parent TEXT, level INTEGER, difficulty INTEGER, maxbpm INTEGER, minbpm INTEGER, length INTEGER, mode INTEGER, judge INTEGER, feature INTEGER, content INTEGER, date INTEGER, favorite INTEGER, adddate INTEGER, notes INTEGER, charthash TEXT, PRIMARY KEY(path))');
  songData.run('CREATE TABLE folder (title TEXT, subtitle TEXT, command TEXT, path TEXT, type INTEGER, banner TEXT, parent TEXT, date INTEGER, max INTEGER, adddate INTEGER, PRIMARY KEY(path))');
  for (const row of data.songRows ?? []) {
    songData.run('INSERT INTO song (md5, sha256, title, path, parent) VALUES (?, ?, ?, ?, ?)', ['0'.repeat(32), row.sha256, path.basename(row.path), row.path, row.parent]);
  }
  for (const row of data.folderRows ?? []) {
    songData.run('INSERT INTO folder (title, path, parent) VALUES (?, ?, ?)', [path.basename(row.path.replace(/[\\/]+$/, '')), row.path, row.parent]);
  }
  await fs.writeFile(path.join(beatorajaRoot, 'songdata.db'), Buffer.from(songData.export()));
  songData.close();

  const songInfo = new SQL.Database();
  songInfo.run('CREATE TABLE information (sha256 TEXT NOT NULL, density REAL, mainbpm REAL, PRIMARY KEY(sha256))');
  for (const sha256 of data.informationSha256s ?? []) {
    songInfo.run('INSERT INTO information (sha256, density, mainbpm) VALUES (?, 1, 120)', [sha256]);
  }
  await fs.writeFile(path.join(beatorajaRoot, 'songinfo.db'), Buffer.from(songInfo.export()));
  songInfo.close();
}

async function readRows(beatorajaRoot: string, databaseName: string, sql: string): Promise<unknown[][]> {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file) });
  const db = new SQL.Database(await fs.readFile(path.join(beatorajaRoot, databaseName)));
  try {
    return db.exec(sql)[0]?.values ?? [];
  } finally {
    db.close();
  }
}
