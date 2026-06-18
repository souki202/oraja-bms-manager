import fs from 'node:fs/promises';
import path from 'node:path';
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
});

async function createRepositoryFixture(): Promise<{ repository: ManagerRepository; root: string; songsRoot: string }> {
  const root = path.join(process.cwd(), '.tmp-tests', `merge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempRoots.push(root);
  const appRoot = path.join(root, 'app');
  const dataRoot = path.join(root, 'data');
  const beatorajaRoot = path.join(root, 'beatoraja');
  const songsRoot = path.join(root, 'songs');
  await fs.mkdir(appRoot, { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.mkdir(path.join(beatorajaRoot, 'table'), { recursive: true });
  await fs.mkdir(path.join(beatorajaRoot, 'player'), { recursive: true });
  await fs.mkdir(songsRoot, { recursive: true });
  await fs.writeFile(path.join(dataRoot, 'settings.json'), JSON.stringify({ beatorajaRoot }), 'utf8');
  await fs.writeFile(path.join(beatorajaRoot, 'songdata.db'), '', 'utf8');
  await fs.writeFile(path.join(beatorajaRoot, 'config_sys.json'), JSON.stringify({
    songpath: 'songdata.db',
    songinfopath: 'songinfo.db',
    tablepath: 'table',
    playerpath: 'player',
    bmsroot: [songsRoot]
  }), 'utf8');

  return { repository: new ManagerRepository(appRoot, dataRoot), root, songsRoot };
}
