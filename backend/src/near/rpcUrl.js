// Validation of the NEAR RPC URL. The URL can carry an API key (in the path or
// the query), so errors never include it.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_URL_LENGTH = 2048;

// Returns the parsed URL or throws TypeError('invalid RPC URL').
// Only https is accepted. Plain http is accepted for loopback hosts when the
// caller (tests only) sets allowLoopbackHttp. Credentials, whitespace and
// fragments are never accepted.
export function parseRpcUrl(value, { allowLoopbackHttp = false } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_URL_LENGTH || /\s/.test(value)) {
    throw new TypeError('invalid RPC URL');
  }
  if (!/^https?:\/\/[^/\\]/i.test(value)) {
    throw new TypeError('invalid RPC URL');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('invalid RPC URL');
  }
  const secure = url.protocol === 'https:';
  const loopbackHttp =
    allowLoopbackHttp === true && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (
    (!secure && !loopbackHttp) ||
    url.hostname === '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('invalid RPC URL');
  }
  return url;
}
