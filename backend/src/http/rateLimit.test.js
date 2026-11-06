import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rateLimit.js';

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set(value) { t = value; },
    advance(ms) { t += ms; },
  };
}

function make(over = {}) {
  const clock = makeClock();
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now, ...over });
  return { clock, limiter };
}

describe('options', () => {
  it('rejects invalid options', () => {
    const bad = [
      undefined, null, 'x', 5,
      { windowMs: 1000 }, { limit: 3 },
      { limit: 0, windowMs: 1000 }, { limit: 1.5, windowMs: 1000 }, { limit: '5', windowMs: 1000 },
      { limit: 1_000_001, windowMs: 1000 }, { limit: -1, windowMs: 1000 },
      { limit: 3, windowMs: 0 }, { limit: 3, windowMs: 1.5 }, { limit: 3, windowMs: 86_400_001 },
      { limit: 3, windowMs: 1000, maxKeys: 0 }, { limit: 3, windowMs: 1000, maxKeys: 1.5 },
      { limit: 3, windowMs: 1000, maxKeys: 1_000_001 },
      { limit: 3, windowMs: 1000, now: 'x' }, { limit: 3, windowMs: 1000, extra: 1 },
    ];
    bad.forEach((options, i) => {
      assert.throws(() => createRateLimiter(options), TypeError, `options #${i}`);
    });
  });

  it('works with the real clock by default', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, false);
  });

  it('rejects invalid keys', () => {
    const { limiter } = make();
    for (const key of ['', 5, null, undefined, {}, 'x'.repeat(257)]) {
      assert.throws(() => limiter.hit(key), TypeError, String(key));
      assert.throws(() => limiter.peek(key), TypeError, String(key));
      assert.throws(() => limiter.reset(key), TypeError, String(key));
    }
    assert.equal(limiter.hit('x'.repeat(256)).allowed, true);
    assert.equal(limiter.hit('x').allowed, true);
  });
});

describe('hit boundaries', () => {
  it('allows exactly `limit` hits per window', () => {
    const { limiter } = make();
    const results = [limiter.hit('a'), limiter.hit('a'), limiter.hit('a'), limiter.hit('a')];
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
    assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0]);
    assert.equal(results[0].limit, 3);
    assert.equal(results[0].retryAfterSeconds, 0);
    assert.equal(results[3].retryAfterSeconds, 1);
  });

  it('starts a new window at exactly windowMs, not before', () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 3; i += 1) limiter.hit('a');
    clock.set(999);
    assert.equal(limiter.hit('a').allowed, false);
    clock.set(1000);
    const fresh = limiter.hit('a');
    assert.equal(fresh.allowed, true);
    assert.equal(fresh.remaining, 2);
    assert.equal(limiter.hit('a').remaining, 1);
  });

  it('anchors the window at the first hit', () => {
    const { clock, limiter } = make();
    clock.set(400);
    for (let i = 0; i < 3; i += 1) limiter.hit('a');
    clock.set(1399);
    assert.equal(limiter.hit('a').allowed, false);
    clock.set(1400);
    assert.equal(limiter.hit('a').allowed, true);
  });

  it('does not extend or penalize the window for denied hits', () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 3; i += 1) limiter.hit('a');
    clock.set(500);
    for (let i = 0; i < 50; i += 1) assert.equal(limiter.hit('a').allowed, false);
    clock.set(1000);
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.size(), 1);
  });

  it('keeps keys independent', () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i += 1) limiter.hit('a');
    assert.equal(limiter.hit('a').allowed, false);
    assert.equal(limiter.hit('b').allowed, true);
    assert.equal(limiter.hit('b').remaining, 1);
  });

  it('rounds retry-after up to whole seconds', () => {
    const { clock, limiter } = make({ limit: 1, windowMs: 60000 });
    limiter.hit('a');
    clock.set(1);
    assert.equal(limiter.hit('a').retryAfterSeconds, 60); // 59999 ms left
    clock.set(59000);
    assert.equal(limiter.hit('a').retryAfterSeconds, 1); // 1000 ms left
    clock.set(59001);
    assert.equal(limiter.hit('a').retryAfterSeconds, 1); // 999 ms left
    clock.set(59999);
    const last = limiter.hit('a');
    assert.equal(last.retryAfterSeconds, 1);
    assert.equal(last.resetInMs, 1);
  });

  it('allows limit 1', () => {
    const { clock, limiter } = make({ limit: 1 });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, false);
    clock.set(1000);
    assert.equal(limiter.hit('a').allowed, true);
  });

  it('returns frozen results', () => {
    const { limiter } = make();
    assert.ok(Object.isFrozen(limiter.hit('a')));
    assert.ok(Object.isFrozen(limiter.peek('a')));
    assert.ok(Object.isFrozen(limiter.stats()));
    assert.ok(Object.isFrozen(limiter));
  });
});

describe('peek', () => {
  it('reports without consuming', () => {
    const { limiter } = make({ limit: 2 });
    for (let i = 0; i < 5; i += 1) {
      const p = limiter.peek('a');
      assert.equal(p.allowed, true);
      assert.equal(p.remaining, 2);
    }
    assert.equal(limiter.size(), 0); // peeking never creates entries
    limiter.hit('a');
    assert.equal(limiter.peek('a').remaining, 1);
    limiter.hit('a');
    const blocked = limiter.peek('a');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterSeconds, 1);
  });

  it('supports a failures-only pattern', () => {
    const { clock, limiter } = make({ limit: 3, windowMs: 60000 });
    const attemptFailsAuth = () => {
      if (!limiter.peek('ip').allowed) return 'blocked';
      limiter.hit('ip'); // record the failure
      return 'failed';
    };
    assert.deepEqual([1, 2, 3, 4, 5].map(attemptFailsAuth), ['failed', 'failed', 'failed', 'blocked', 'blocked']);
    clock.set(59999);
    assert.equal(limiter.peek('ip').allowed, false);
    clock.set(60000);
    assert.equal(limiter.peek('ip').allowed, true);
  });

  it('treats an expired window as empty', () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 3; i += 1) limiter.hit('a');
    clock.set(1000);
    const p = limiter.peek('a');
    assert.equal(p.allowed, true);
    assert.equal(p.remaining, 3);
  });
});

describe('reset', () => {
  it('clears one key only', () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i += 1) {
      limiter.hit('a');
      limiter.hit('b');
    }
    limiter.reset('a');
    assert.equal(limiter.hit('a').remaining, 2);
    assert.equal(limiter.hit('b').allowed, false);
    limiter.reset('missing'); // no error
  });
});

describe('cleanup of expired entries', () => {
  it('purges every expired entry on the next call', () => {
    const { clock, limiter } = make();
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    assert.equal(limiter.size(), 3);
    clock.set(1000);
    limiter.hit('d');
    assert.equal(limiter.size(), 1);
    assert.equal(limiter.stats().evictions, 0);
  });

  it('keeps entries that are still inside their window', () => {
    const { clock, limiter } = make();
    limiter.hit('a'); // t = 0, expires at 1000
    clock.set(500);
    limiter.hit('b'); // expires at 1500
    clock.set(1000);
    limiter.hit('c');
    assert.equal(limiter.size(), 2); // b and c
    assert.equal(limiter.peek('b').remaining, 2);
    assert.equal(limiter.peek('a').remaining, 3);
  });

  it('purgeExpired removes expired entries and reports the count', () => {
    const { clock, limiter } = make();
    limiter.hit('a');
    clock.set(500);
    limiter.hit('b');
    assert.equal(limiter.purgeExpired(), 0);
    clock.set(1000);
    assert.equal(limiter.purgeExpired(), 1);
    assert.equal(limiter.size(), 1);
    clock.set(1500);
    assert.equal(limiter.purgeExpired(), 1);
    assert.equal(limiter.size(), 0);
  });

  it('cleans up on peek as well', () => {
    const { clock, limiter } = make();
    limiter.hit('a');
    limiter.hit('b');
    clock.set(1000);
    limiter.peek('c');
    assert.equal(limiter.size(), 0);
  });
});

describe('memory cap', () => {
  it('evicts the oldest entry when full', () => {
    const { limiter } = make({ limit: 5, maxKeys: 3 });
    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    assert.equal(limiter.size(), 3);
    limiter.hit('d');
    assert.equal(limiter.size(), 3);
    assert.equal(limiter.stats().evictions, 1);
    assert.equal(limiter.peek('a').remaining, 5); // evicted
    assert.equal(limiter.peek('b').remaining, 4);
    assert.equal(limiter.peek('c').remaining, 4);
    assert.equal(limiter.peek('d').remaining, 4);
  });

  it('prefers purging expired entries over evicting live ones', () => {
    const { clock, limiter } = make({ maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    clock.set(1000);
    limiter.hit('c');
    assert.equal(limiter.stats().evictions, 0);
    assert.equal(limiter.size(), 1);
  });

  it('evicts by window start, even after a key starts a new window', () => {
    const { clock, limiter } = make({ limit: 5, maxKeys: 2 });
    limiter.hit('a'); // window starts at 0
    clock.set(1);
    limiter.hit('b'); // window starts at 1
    clock.set(1000);
    limiter.hit('a'); // a expired and starts a new window at 1000 (now after b)
    assert.equal(limiter.size(), 2);
    limiter.hit('c'); // full: the oldest window (b) is evicted
    assert.equal(limiter.stats().evictions, 1);
    assert.equal(limiter.peek('b').remaining, 5);
    assert.equal(limiter.peek('a').remaining, 4);
    assert.equal(limiter.peek('c').remaining, 4);
  });

  it('never grows beyond maxKeys under a flood of unique keys', () => {
    const { limiter } = make({ maxKeys: 100 });
    for (let i = 0; i < 10_000; i += 1) {
      limiter.hit(`key-${i}`);
      assert.ok(limiter.size() <= 100);
    }
    assert.equal(limiter.size(), 100);
    assert.equal(limiter.stats().evictions, 9_900);
    assert.equal(limiter.stats().maxKeys, 100);
  });

  it('does not grow when hits are denied', () => {
    const { limiter } = make({ limit: 1 });
    limiter.hit('a');
    for (let i = 0; i < 1000; i += 1) limiter.hit('a');
    assert.equal(limiter.size(), 1);
  });

  it('works with a single slot', () => {
    const { limiter } = make({ maxKeys: 1 });
    limiter.hit('a');
    limiter.hit('b');
    assert.equal(limiter.size(), 1);
    assert.equal(limiter.peek('a').remaining, 3);
    assert.equal(limiter.peek('b').remaining, 2);
  });
});

describe('clock behaviour', () => {
  it('stays safe if the clock goes backwards', () => {
    const { clock, limiter } = make();
    clock.set(1000);
    limiter.hit('a');
    clock.set(500);
    const r = limiter.hit('a');
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 1);
    assert.ok(r.resetInMs <= 1000);
    limiter.hit('a');
    const denied = limiter.hit('a');
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= 1);
  });
});
