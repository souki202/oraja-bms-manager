import { describe, expect, it } from 'vitest';
import { hasAvailableDownloadUrl, isKnownBrokenDownloadUrl } from '../src/shared/downloadLinks';

describe('known broken download links', () => {
  it.each([
    'www.ribbit.xyz/',
    'absolute.pv.land.to/',
    'airlab.web.fc2.com',
    'www.geocities.jp/dsks5456',
    'gnqg.rosx.net/',
    'www.freett.com/iidxbanzai/'
  ])('recognizes %s and its descendants over HTTP and HTTPS', (destination) => {
    const base = destination.replace(/\/$/, '');
    for (const prefix of ['', '//', 'http://', 'https://']) {
      for (const suffix of ['', '/', '/bms/song.zip?download=1#download']) {
        const url = `${prefix}${base}${suffix}`;
        expect(isKnownBrokenDownloadUrl(url), url).toBe(true);
        expect(hasAvailableDownloadUrl(url), url).toBe(false);
      }
    }
  });

  it.each([
    ' HTTPS://WWW.RIBBIT.XYZ/song.zip ',
    'https://ribbit.xyz./song.zip',
    'https://geocities.jp/dsks5456?download=1',
    'https://freett.com/iidxbanzai#download'
  ])('normalizes hostname and URL formatting: %s', (url) => {
    expect(isKnownBrokenDownloadUrl(url)).toBe(true);
  });

  it.each([
    'https://www.geocities.jp/',
    'https://www.geocities.jp/another-user/song.zip',
    'https://www.geocities.jp/dsks54560/song.zip',
    'https://www.geocities.jp/DSKS5456/song.zip',
    'https://www.freett.com/',
    'https://www.freett.com/another-user/song.zip',
    'https://www.freett.com/iidxbanzai-backup/song.zip',
    'https://another-user.web.fc2.com/song.zip',
    'https://another-user.pv.land.to/song.zip',
    'https://another-user.rosx.net/song.zip',
    'https://www.ribbit.xyz.example.com/song.zip',
    'https://mirror.example.com/www.ribbit.xyz/song.zip',
    'https://mirror.example.com/?url=http://www.ribbit.xyz/',
    'https://web.archive.org/web/20200101000000/http://www.ribbit.xyz/',
    'https://example.com/song.zip'
  ])('keeps unrelated destinations available: %s', (url) => {
    expect(isKnownBrokenDownloadUrl(url)).toBe(false);
    expect(hasAvailableDownloadUrl(url)).toBe(true);
  });

  it('handles empty or malformed input without reporting a confirmed broken site', () => {
    for (const url of ['', '   ', 'http://', 'not a URL', 'ftp://www.ribbit.xyz/song.zip']) {
      expect(isKnownBrokenDownloadUrl(url)).toBe(false);
    }
    expect(hasAvailableDownloadUrl('')).toBe(false);
    expect(hasAvailableDownloadUrl('   ')).toBe(false);
  });
});
