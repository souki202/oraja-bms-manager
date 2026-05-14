import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseTableBuffer, readSongList } from '../src/main/tableParser';

describe('table parser', () => {
  it('reads beatoraja bmt gzip json', () => {
    const source = {
      name: 'Sample Table',
      folder: [
        {
          name: '★1',
          songs: [{ title: 'Example', sha256: 'abc' }]
        }
      ]
    };
    const parsed = parseTableBuffer('sample.bmt', zlib.gzipSync(Buffer.from(JSON.stringify(source), 'utf8')));

    expect(parsed.name).toBe('Sample Table');
    expect(readSongList(parsed.folder![0])[0].title).toBe('Example');
  });

  it('accepts course hash arrays from json tables', () => {
    const parsed = parseTableBuffer('default.json', Buffer.from(JSON.stringify({
      name: 'Course Table',
      course: [{ name: 'Course', hash: [{ title: 'Course Song', md5: 'def' }] }]
    }), 'utf8'));

    expect(readSongList(parsed.course![0])[0].md5).toBe('def');
  });
});