import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanMissingAudio, sortMissingAudioCharts } from '../src/main/missingAudio';

describe('missing audio scan', () => {
  it('reports missing definitions and accepts an OGG in place of a WAV', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-audio-'));
    try {
      await fs.writeFile(path.join(root, 'present.ogg'), 'audio');
      await fs.writeFile(path.join(root, 'chart.bms'), '#TITLE Test\r\n#ARTIST Artist\r\n#WAV01 present.wav\r\n#WAV02 absent.wav\r\n#00111:0102\r\n');
      const result = await scanMissingAudio([root], [{ path: path.join(root, 'chart.bms'), notes: 2 }]);
      expect(result.scannedCharts).toBe(1);
      expect(result.charts).toMatchObject([{ title: 'Test', artist: 'Artist', definedCount: 2, existingCount: 1, missingCount: 1, missingFiles: ['absent.wav'] }]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('resolves audio definitions in relative subdirectories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-audio-'));
    try {
      await fs.mkdir(path.join(root, 'ogg'));
      await fs.writeFile(path.join(root, 'ogg', 'bass_0032.ogg'), 'audio');
      await fs.writeFile(path.join(root, 'chart.bme'), '#WAV0Z ogg\\bass_0032.wav\r\n#00111:0Z0Z\r\n');

      const result = await scanMissingAudio([root], [{ path: path.join(root, 'chart.bme'), notes: 2 }]);

      expect(result.charts).toEqual([]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('reads bmson sound channels and ignores complete charts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-audio-'));
    try {
      await fs.writeFile(path.join(root, '音.ogg'), 'audio');
      await fs.writeFile(path.join(root, 'chart.bmson'), JSON.stringify({ info: { title: '日本語' }, sound_channels: [{ name: '音.ogg' }] }));
      const result = await scanMissingAudio([root], [{ path: path.join(root, 'chart.bmson'), notes: 2 }]);
      expect(result.scannedCharts).toBe(1);
      expect(result.charts).toEqual([]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it('sorts charts by missing ratio before the absolute missing count', () => {
    const chart = (path: string, definedCount: number, missingCount: number) => ({
      path, folder: '', fileName: path, title: path, artist: '', definedCount,
      existingCount: definedCount - missingCount, missingCount, missingFiles: []
    });

    expect(sortMissingAudioCharts([
      chart('many-missing.bms', 100, 50),
      chart('high-ratio.bms', 10, 8),
      chart('all-missing.bms', 2, 2)
    ]).map((item) => item.path)).toEqual([
      'all-missing.bms',
      'high-ratio.bms',
      'many-missing.bms'
    ]);
  });

  it('excludes zero/one-note charts and temporary file names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-audio-'));
    try {
      const header = '#WAV01 absent.wav\r\n';
      await fs.writeFile(path.join(root, 'zero.bms'), header);
      await fs.writeFile(path.join(root, 'one.bms'), `${header}#00111:01\r\n`);
      await fs.writeFile(path.join(root, 'chart_tmp.bms'), `${header}#00111:0101\r\n`);
      await fs.writeFile(path.join(root, 'chart_temp.bms'), `${header}#00111:0101\r\n`);
      await fs.writeFile(path.join(root, 'normal.bms'), `${header}#00111:0101\r\n`);

      const result = await scanMissingAudio([root], [
        { path: path.join(root, 'zero.bms'), notes: 0 },
        { path: path.join(root, 'one.bms'), notes: 1 },
        { path: path.join(root, 'chart_tmp.bms'), notes: 2 },
        { path: path.join(root, 'chart_temp.bms'), notes: 2 },
        { path: path.join(root, 'normal.bms'), notes: 2 }
      ]);

      expect(result.scannedCharts).toBe(3);
      expect(result.charts.map((chart) => chart.fileName)).toEqual(['normal.bms']);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
