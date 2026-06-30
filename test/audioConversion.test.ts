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

  it('leaves unreadable WAV files in place and continues converting the rest of the folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bms-audio-'));
    try {
      const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      await fs.writeFile(path.join(root, 'good.wav'), makeSilentWav());
      await fs.writeFile(path.join(root, 'bad.wav'), 'not a real wav');

      const result = await convertAudioFolder(root, [root], ffmpegPath);

      await expect(fs.access(path.join(root, 'good.wav'))).rejects.toThrow();
      expect((await fs.stat(path.join(root, 'good.ogg'))).size).toBeGreaterThan(0);
      await expect(fs.readFile(path.join(root, 'bad.wav'), 'utf8')).resolves.toBe('not a real wav');
      await expect(fs.access(path.join(root, 'bad.ogg'))).rejects.toThrow();
      expect(result.ok).toBe(false);
      expect(result.convertedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedFiles).toEqual([{ fileName: 'bad.wav', error: expect.stringContaining('Error opening input') }]);
      expect(result.message).toContain('1 unreadable WAV skipped');
      expect(result.message).toContain('bad.wav');
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

function makeSilentWav(): Buffer {
  const sampleRate = 8000;
  const sampleCount = 800;
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
