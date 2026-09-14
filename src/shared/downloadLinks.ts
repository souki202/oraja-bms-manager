// Confirmed 404 / soft-404 destinations. Keep shared hosting rules scoped to
// the reported user directory, and retain the original URLs for inspection.
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

export function isKnownBrokenDownloadUrl(rawUrl: string): boolean {
  const value = rawUrl.trim();
  if (!value) return false;

  try {
    const absoluteUrl = value.startsWith('//') ? `https:${value}` : value;
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(absoluteUrl) ? absoluteUrl : `https://${absoluteUrl}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    return knownBrokenDownloadSites.some((site) => hostname === site.hostname && (
      site.path === '/' || url.pathname === site.path || url.pathname.startsWith(`${site.path}/`)
    ));
  } catch {
    return false;
  }
}

export function hasAvailableDownloadUrl(url: string): boolean {
  return Boolean(url.trim()) && !isKnownBrokenDownloadUrl(url);
}
