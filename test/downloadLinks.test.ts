import { describe, expect, it } from 'vitest';
import { hasAvailableDownloadUrl, isKnownBrokenDownloadUrl, resolveDownloadUrl } from '../src/shared/downloadLinks';

describe('download mirrors', () => {
  it.each([
    ['absolute.pv.land.to/uploader/src/up7207.rar', 'https://darksabun.github.io/mirror/absolute/uploader/up7207.rar'],
    ['absolute.pv.land.to/uploader/src/up123.zip?download=1#file', 'https://darksabun.github.io/mirror/absolute/uploader/up123.zip?download=1#file'],
    ['gnqg.rosx.net/upload/upload.cgi?get=1', 'https://bms.hexlataia.xyz/mirror/gnqg-upload/00001.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?get=5950', 'https://bms.hexlataia.xyz/mirror/gnqg-upload/05950.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?get=05950', 'https://bms.hexlataia.xyz/mirror/gnqg-upload/05950.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?get=6414', 'https://bms.hexlataia.xyz/mirror/gnqg-upload/06414.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?get=6415', 'https://darksabun.club/mirror/gnqg-upload/06415.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?get=6476', 'https://darksabun.club/mirror/gnqg-upload/06476.zip'],
    ['gnqg.rosx.net/upload/upload.cgi?foo=bar&get=5950#download', 'https://bms.hexlataia.xyz/mirror/gnqg-upload/05950.zip']
  ])('opens the mirror for %s and considers it available', (source, mirror) => {
    for (const prefix of ['', '//', 'http://', 'https://']) {
      const url = `${prefix}${source}`;
      expect(resolveDownloadUrl(url), url).toBe(mirror);
      expect(isKnownBrokenDownloadUrl(url), url).toBe(false);
      expect(hasAvailableDownloadUrl(url), url).toBe(true);
    }
    expect(resolveDownloadUrl(mirror)).toBe(mirror);
  });

  it('uses the same URL normalization for mirrors and broken-link detection', () => {
    const url = ' HTTPS://WWW.GNQG.ROSX.NET./upload/upload.cgi?get=5950 ';
    expect(resolveDownloadUrl(url)).toBe('https://bms.hexlataia.xyz/mirror/gnqg-upload/05950.zip');
    expect(isKnownBrokenDownloadUrl(url)).toBe(false);
  });

  it.each([
    'http://absolute.pv.land.to/',
    'http://absolute.pv.land.to/uploader/src/',
    'http://absolute.pv.land.to/uploader/up7207.rar',
    'http://absolute.pv.land.to/uploader/src/nested/up7207.rar',
    'http://gnqg.rosx.net/',
    'http://gnqg.rosx.net/other/upload.cgi?get=5950',
    'http://gnqg.rosx.net/upload/upload.cgi',
    'http://gnqg.rosx.net/upload/upload.cgi?get=',
    'http://gnqg.rosx.net/upload/upload.cgi?get=0',
    'http://gnqg.rosx.net/upload/upload.cgi?get=-1',
    'http://gnqg.rosx.net/upload/upload.cgi?get=6477',
    'http://gnqg.rosx.net/upload/upload.cgi?get=10000',
    'http://gnqg.rosx.net/upload/upload.cgi?get=5950.zip',
    'http://gnqg.rosx.net/upload/upload.cgi?get=5950.5',
    'http://gnqg.rosx.net/upload/upload.cgi?get=1e3'
  ])('keeps unsupported links broken without guessing a mirror: %s', (url) => {
    expect(resolveDownloadUrl(url)).toBe(url);
    expect(isKnownBrokenDownloadUrl(url)).toBe(true);
    expect(hasAvailableDownloadUrl(url)).toBe(false);
  });

  it.each([
    '',
    '   ',
    'http://',
    'not a URL',
    'ipfs://some-hash',
    'ftp://gnqg.rosx.net/upload/upload.cgi?get=5950',
    'https://example.com/song.zip',
    'https://gnqg.rosx.net.example.com/upload/upload.cgi?get=5950',
    'https://absolute.pv.land.to.example.com/uploader/src/up7207.rar',
    'https://mirror.example.com/?url=http://gnqg.rosx.net/upload/upload.cgi?get=5950'
  ])('preserves input without a matching mirror: %s', (url) => {
    expect(resolveDownloadUrl(url)).toBe(url);
  });
});

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
