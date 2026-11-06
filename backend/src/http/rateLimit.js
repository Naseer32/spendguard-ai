// In-memory fixed-window rate limiter. Single process only.
//
// - Each key has a window that starts at its first hit; at exactly windowMs
//   later a new window begins.
// - hit(key) consumes one unit. Denied hits do not extend the window.
// - peek(key) reports the state without consuming (for "failures only"
//   limiters: peek before checking credentials, hit on failure).
// - Memory is capped: expired entries are removed on every call (entries are
//   kept in window-start order, so expired ones are always at the front), and
//   when maxKeys is reached the oldest entry is evicted.
// - The clock is injectable for tests.

const OPTION_KEYS = ['limit', 'windowMs', 'maxKeys', 'now'];
const MAX_KEY_LENGTH = 256;

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function checkKey(key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(`key must be a string of 1 to ${MAX_KEY_LENGTH} characters`);
  }
}

export function createRateLimiter(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`unknown option ${key}`);
    }
  }
  const limit = requireInteger(options.limit, 'limit', 1, 1_000_000);
  const windowMs = requireInteger(options.windowMs, 'windowMs', 1, 86_400_000);
  const maxKeys = requireInteger(options.maxKeys ?? 10_000, 'maxKeys', 1, 1_000_000);
  const clock = options.now ?? Date.now;
  if (typeof clock !== 'function') {
    throw new TypeError('now must be a function');
  }

  // key -> { windowStart, count }, ordered by windowStart (oldest first)
  const entries = new Map();
  let evictions = 0;

  const isExpired = (entry, now) => now - entry.windowStart >= windowMs;

  function purge(now) {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (!isExpired(entry, now)) {
        break;
      }
      entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  function resetInMs(entry, now) {
    const elapsed = Math.max(0, now - entry.windowStart);
    return Math.max(0, windowMs - elapsed);
  }

  function result(allowed, count, entry, now) {
    const reset = entry === undefined ? 0 : resetInMs(entry, now);
    return Object.freeze({
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      resetInMs: reset,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(reset / 1000)),
    });
  }

  function liveEntry(key, now) {
    const entry = entries.get(key);
    if (entry !== undefined && isExpired(entry, now)) {
      entries.delete(key); // only possible if the clock went backwards earlier
      return undefined;
    }
    return entry;
  }

  return Object.freeze({
    // Consumes one unit for the key.
    hit(key) {
      checkKey(key);
      const now = clock();
      purge(now);
      let entry = liveEntry(key, now);
      if (entry === undefined) {
        if (entries.size >= maxKeys) {
          const oldest = entries.keys().next().value;
          entries.delete(oldest);
          evictions += 1;
        }
        entry = { windowStart: now, count: 0 };
        entries.set(key, entry);
      }
      if (entry.count >= limit) {
        return result(false, entry.count, entry, now);
      }
      entry.count += 1;
      return result(true, entry.count, entry, now);
    },

    // Reports the state without consuming anything.
    peek(key) {
      checkKey(key);
      const now = clock();
      purge(now);
      const entry = liveEntry(key, now);
      if (entry === undefined) {
        return result(true, 0, undefined, now);
      }
      return result(entry.count < limit, entry.count, entry, now);
    },

    reset(key) {
      checkKey(key);
      entries.delete(key);
    },

    // Removes expired entries now. Returns how many were removed.
    purgeExpired() {
      return purge(clock());
    },

    size() {
      return entries.size;
    },

    stats() {
      return Object.freeze({ size: entries.size, evictions, maxKeys, limit, windowMs });
    },
  });
}
