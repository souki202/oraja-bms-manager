import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertAudioFolder, findAudioFolders, scanAudioFolders } from '../src/main/audioConversion';

describe('audio conversion', () => {
  it('removes matching WAV files without reconverting or changing charts when OGG already exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-audio-'));
    try {
      await fs.writeFile(path.join(root, 'sound.wav'), 'wav');
      await fs.writeFile(path.join(root, 'sound.ogg'), 'ogg');
      await fs.writeFile(path.join(root, 'chart.bms'), '#WAV01 sound.wav\r\n');

      const result = await convertAudioFolder(root, [root], 'ffmpeg-not-needed.exe');

      await expect(fs.access(path.join(root, 'sound.wav'))).rejects.toThrow();
      await expect(fs.readFile(path.join(root, 'sound.ogg'), 'utf8')).resolves.toBe('ogg');
      await expect(fs.readFile(path.join(root, 'chart.bms'), 'utf8')).resolves.toBe('#WAV01 sound.wav\r\n');
      expect(result.convertedCount).toBe(0);
      expect(result.removedExistingCount).toBe(1);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it('lists folders once a WAV file is found without returning a count', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-audio-'));
    try {
      const child = path.join(root, 'song');
      await fs.mkdir(child);
      await fs.writeFile(path.join(child, 'a.wav'), 'wav');
      await fs.writeFile(path.join(child, 'b.wav'), 'wav');

      const folders = await findAudioFolders([root]);

      expect(folders).toEqual([{ path: child, name: 'song' }]);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it('emits every scan batch when more than 50 folders contain WAV files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-audio-'));
    try {
      for (let index = 0; index < 125; index += 1) {
        const child = path.join(root, `song-${String(index).padStart(3, '0')}`);
        await fs.mkdir(child);
        await fs.writeFile(path.join(child, 'sound.wav'), 'wav');
      }

      const batches: number[] = [];
      const folders: string[] = [];
      await scanAudioFolders([root], {
        onProgress: (progress) => {
          batches.push(progress.folders.length);
          folders.push(...progress.folders.map((folder) => folder.path));
        }
      });

      expect(batches.length).toBeGreaterThan(1);
      expect(folders).toHaveLength(125);
      expect(new Set(folders).size).toBe(125);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });
});
