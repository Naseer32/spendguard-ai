// Validation of the backend address typed into Settings.
//
// The owner token travels in every request, so plain http:// is only allowed
// for this device and private networks (local development). Anything on the
// public internet must use https://.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Only a real IPv4 literal can be a private address. Names such as "10.evil.com" must not match.
function isPrivateIpv4(host) {
  const m = IPV4_RE.exec(host);
  if (m === null) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || isPrivateIpv4(host);
}

/**
 * Returns { ok: true, value } where value is '' (same origin, e.g. the Vite
 * dev proxy) or an origin like "https://api.example.com" (no trailing slash),
 * or { ok: false, error }.
 */
export function validateBaseUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: true, value: '' };

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Enter a full address such as https://api.example.com, or leave it empty.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'The address must start with https:// or http://.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'The address must not contain a username or password.' };
  }
  if (url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, error: 'Enter only the server address, without a path. The app adds /api itself.' };
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    return { ok: false, error: 'Use https:// for servers on the internet. Plain http:// is only allowed for this device or a private network.' };
  }
  return { ok: true, value: url.origin };
}
