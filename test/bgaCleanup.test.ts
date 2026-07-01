import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupBgaFolder, findBgaFolders } from '../src/main/bgaCleanup';

describe('BGA cleanup', () => {
  it('removes legacy BGA files when matching MP4 exists without changing charts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-bga-'));
    try {
      await fs.writeFile(path.join(root, '_bga.mpg'), 'mpg');
      await fs.writeFile(path.join(root, '_bga.mp4'), 'mp4');
      await fs.writeFile(path.join(root, 'movie.mpeg'), 'mpeg');
      await fs.writeFile(path.join(root, 'movie.mp4'), 'movie mp4');
      await fs.writeFile(path.join(root, 'clip.wmv'), 'wmv');
      await fs.writeFile(path.join(root, 'clip.mp4'), 'clip mp4');
      await fs.writeFile(path.join(root, 'keep.mpg'), 'no mp4');
      await fs.writeFile(path.join(root, 'chart.bms'), '#BMP01 _bga.mpg\r\n');

      const result = await cleanupBgaFolder(root, [root]);

      await expect(fs.access(path.join(root, '_bga.mpg'))).rejects.toThrow();
      await expect(fs.access(path.join(root, 'movie.mpeg'))).rejects.toThrow();
      await expect(fs.access(path.join(root, 'clip.wmv'))).rejects.toThrow();
      await expect(fs.readFile(path.join(root, '_bga.mp4'), 'utf8')).resolves.toBe('mp4');
      await expect(fs.readFile(path.join(root, 'keep.mpg'), 'utf8')).resolves.toBe('no mp4');
      await expect(fs.readFile(path.join(root, 'chart.bms'), 'utf8')).resolves.toBe('#BMP01 _bga.mpg\r\n');
      expect(result.ok).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.failedCount).toBe(0);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it('lists only folders with legacy BGA files backed by matching MP4 files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-bga-'));
    try {
      const duplicate = path.join(root, 'duplicate');
      const clean = path.join(root, 'clean');
      await fs.mkdir(duplicate);
      await fs.mkdir(clean);
      await fs.writeFile(path.join(duplicate, '_bga.mpg'), 'mpg');
      await fs.writeFile(path.join(duplicate, '_bga.mp4'), 'mp4');
      await fs.writeFile(path.join(clean, 'other.mpg'), 'mpg');

      const folders = await findBgaFolders([root]);

      expect(folders).toEqual([{
        path: duplicate,
        name: 'duplicate',
        duplicates: [{ legacyFileName: '_bga.mpg', mp4FileName: '_bga.mp4' }]
      }]);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });
});
