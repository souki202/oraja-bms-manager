import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseDroppedChartVariants } from '../src/main/chartMetadata';

describe('dropped chart metadata', () => {
  it('extracts BMS metadata, mode, and content hashes', () => {
    const buffer = Buffer.from('#PLAYER 2\n#TITLE Example\n#SUBTITLE Another\n#ARTIST Artist\n#GENRE Genre\n');
    const [metadata] = parseDroppedChartVariants('example.bms', buffer);

    expect(metadata).toMatchObject({ title: 'Example', subtitle: 'Another', artist: 'Artist', genre: 'Genre', mode: 14 });
    expect(metadata.md5).toBe(crypto.createHash('md5').update(buffer).digest('hex'));
    expect(metadata.sha256).toBe(crypto.createHash('sha256').update(buffer).digest('hex'));
  });

  it('extracts BMSON metadata and uses the file name for invalid JSON', () => {
    const valid = Buffer.from(JSON.stringify({ info: { title: 'BMSON', artist: 'Artist', mode_hint: 'beat-7k' } }));
    expect(parseDroppedChartVariants('chart.bmson', valid)[0]).toMatchObject({ title: 'BMSON', artist: 'Artist', mode: 7 });

    expect(parseDroppedChartVariants('fallback.bmson', Buffer.from('{'))[0].title).toBe('fallback');
  });
});
