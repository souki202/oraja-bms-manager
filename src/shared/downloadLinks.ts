// Confirmed 404 / soft-404 destinations. Keep shared hosting rules scoped to
// the reported user directory. Known mirrors take precedence over these rules.
const knownBrokenDownloadSites = [
  { hostname: 'ribbit.xyz', path: '/' },
  { hostname: 'absolute.pv.land.to', path: '/' },
  { hostname: 'airlab.web.fc2.com', path: '/' },
  { hostname: 'geocities.jp', path: '/dsks5456' },
  { hostname: 'geocities.jp', path: '/hihihi4442' },
  { hostname: 'gnqg.rosx.net', path: '/' },
  { hostname: 'freett.com', path: '/iidxbanzai' },
  { hostname: 'akred.web.fc2.com', path: '/' },
  { hostname: 'tristan97.000webhostapp.com', path: '/' },
  { hostname: 'www.hyper-laner.com', path: '/' },
];

function parseDownloadUrl(rawUrl: string): URL | null {
  const value = rawUrl.trim();
  if (!value) return null;

  try {
    const absoluteUrl = value.startsWith('//') ? `https:${value}` : value;
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(absoluteUrl) ? absoluteUrl : `https://${absoluteUrl}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function downloadHostname(url: URL): string {
  return url.hostname.replace(/^www\./, '').replace(/\.$/, '');
}

function downloadMirror(url: URL): string | null {
  const hostname = downloadHostname(url);
  if (hostname === 'absolute.pv.land.to') {
    const file = /^\/uploader\/src\/([^/]+)$/.exec(url.pathname)?.[1];
    if (file) return `https://darksabun.github.io/mirror/absolute/uploader/${file}${url.search}${url.hash}`;
  }

  if (hostname === 'gnqg.rosx.net' && url.pathname === '/upload/upload.cgi') {
    const get = url.searchParams.get('get');
    if (!get || !/^\d+$/.test(get)) return null;
    const id = Number(get);
    if (id < 1 || id > 6476) return null;
    const base = id <= 6414 ? 'https://bms.hexlataia.xyz' : 'https://darksabun.club';
    return `${base}/mirror/gnqg-upload/${String(id).padStart(5, '0')}.zip`;
  }

  return null;
}

// Resolve only when opening; keep the source URL in table data and exports.
export function resolveDownloadUrl(rawUrl: string): string {
  const url = parseDownloadUrl(rawUrl);
  return (url && downloadMirror(url)) ?? rawUrl;
}

export function isKnownBrokenDownloadUrl(rawUrl: string): boolean {
  const url = parseDownloadUrl(rawUrl);
  if (!url || downloadMirror(url)) return false;
  const hostname = downloadHostname(url);
  return knownBrokenDownloadSites.some((site) => hostname === site.hostname && (
    site.path === '/' || url.pathname === site.path || url.pathname.startsWith(`${site.path}/`)
  ));
}

export function hasAvailableDownloadUrl(url: string): boolean {
  return Boolean(url.trim()) && !isKnownBrokenDownloadUrl(url);
}
