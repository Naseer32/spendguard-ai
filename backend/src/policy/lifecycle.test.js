import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DECISION } from './reasonCodes.js';
import {
  STATUS,
  RESERVATION_EFFECT as E,
  LifecycleError,
  canTransition,
  transition,
  isTerminal,
  holdsBudget,
  initialState,
} from './lifecycle.js';

const S = STATUS;
const ALL = Object.values(STATUS);

// The complete list of legal transitions: [from, to, reservation effect].
const LEGAL = [
  [S.APPROVAL_REQUIRED, S.APPROVED, E.CREATE],
  [S.APPROVAL_REQUIRED, S.REJECTED, E.NONE],
  [S.APPROVAL_REQUIRED, S.EXPIRED, E.NONE],
  [S.APPROVAL_REQUIRED, S.BLOCKED, E.NONE],
  [S.APPROVED, S.SUBMITTED, E.HOLD],
  [S.APPROVED, S.EXPIRED, E.RELEASE],
  [S.APPROVED, S.CANCELLED, E.RELEASE],
  [S.SUBMITTED, S.EXECUTED, E.CONSUME],
  [S.SUBMITTED, S.FAILED, E.RELEASE],
  [S.SUBMITTED, S.MISMATCH, E.HOLD],
];

const key = (from, to) => `${from}>${to}`;
const legalMap = new Map(LEGAL.map(([f, t, e]) => [key(f, t), e]));
const next = (s) => ALL.filter((t) => canTransition(s, t));

describe('status constants', () => {
  it('defines ten unique statuses', () => {
    assert.equal(ALL.length, 10);
    assert.equal(new Set(ALL).size, 10);
    for (const [name, value] of Object.entries(STATUS)) {
      assert.equal(name, value);
    }
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(STATUS));
    assert.ok(Object.isFrozen(E));
  });
});

describe('initialState', () => {
  it('maps each engine decision to its first status', () => {
    assert.deepEqual(initialState(DECISION.BLOCKED), {
      status: S.BLOCKED,
      reservation: E.NONE,
    });
    assert.deepEqual(initialState(DECISION.APPROVAL_REQUIRED), {
      status: S.APPROVAL_REQUIRED,
      reservation: E.NONE,
    });
    assert.deepEqual(initialState(DECISION.APPROVED), {
      status: S.APPROVED,
      reservation: E.CREATE,
    });
  });

  it('never starts as EXECUTED or SUBMITTED', () => {
    for (const decision of Object.values(DECISION)) {
      const { status } = initialState(decision);
      assert.notEqual(status, S.EXECUTED);
      assert.notEqual(status, S.SUBMITTED);
    }
  });

  it('rejects unknown decisions', () => {
    for (const bad of ['EXECUTED', 'approved', '', null, undefined, 1, {}]) {
      assert.throws(() => initialState(bad), LifecycleError);
    }
  });

  it('returns frozen results', () => {
    assert.ok(Object.isFrozen(initialState(DECISION.APPROVED)));
  });
});

describe('transitions: exhaustive', () => {
  it('allows exactly the legal list and nothing else (all 100 pairs)', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const k = key(from, to);
        if (legalMap.has(k)) {
          assert.equal(canTransition(from, to), true, k);
          const t = transition(from, to);
          assert.equal(t.from, from);
          assert.equal(t.to, to);
          assert.equal(t.reservation, legalMap.get(k), k);
        } else {
          assert.equal(canTransition(from, to), false, k);
          assert.throws(() => transition(from, to), LifecycleError, k);
        }
      }
    }
  });

  it('has exactly ten legal transitions', () => {
    let count = 0;
    for (const from of ALL) count += next(from).length;
    assert.equal(count, 10);
  });

  it('returns frozen transition objects', () => {
    assert.ok(Object.isFrozen(transition(S.APPROVED, S.SUBMITTED)));
  });
});

describe('transitions: key safety rules', () => {
  const illegal = [
    [S.APPROVED, S.EXECUTED], // APPROVED must never mean EXECUTED
    [S.APPROVAL_REQUIRED, S.SUBMITTED],
    [S.APPROVAL_REQUIRED, S.EXECUTED],
    [S.BLOCKED, S.APPROVED], // blocked can never be approved
    [S.BLOCKED, S.APPROVAL_REQUIRED],
    [S.REJECTED, S.APPROVED],
    [S.EXPIRED, S.APPROVED],
    [S.CANCELLED, S.APPROVED],
    [S.FAILED, S.EXECUTED],
    [S.FAILED, S.SUBMITTED],
    [S.MISMATCH, S.EXECUTED],
    [S.EXECUTED, S.FAILED],
    [S.EXECUTED, S.APPROVED],
    [S.SUBMITTED, S.APPROVED],
    [S.SUBMITTED, S.CANCELLED], // once a hash is reported, no silent cancel
    [S.SUBMITTED, S.EXPIRED],
  ];

  it('rejects dangerous or backwards transitions', () => {
    for (const [from, to] of illegal) {
      assert.equal(canTransition(from, to), false, key(from, to));
      assert.throws(() => transition(from, to), LifecycleError, key(from, to));
    }
  });

  it('rejects self-transitions', () => {
    for (const s of ALL) {
      assert.equal(canTransition(s, s), false, s);
    }
  });

  it('EXECUTED is reachable only from SUBMITTED', () => {
    const sources = ALL.filter((s) => canTransition(s, S.EXECUTED));
    assert.deepEqual(sources, [S.SUBMITTED]);
  });

  it('SUBMITTED is reachable only from APPROVED', () => {
    const sources = ALL.filter((s) => canTransition(s, S.SUBMITTED));
    assert.deepEqual(sources, [S.APPROVED]);
  });

  it('only CREATE transitions enter APPROVED, and every CREATE enters APPROVED', () => {
    for (const [from, to, effect] of LEGAL) {
      if (to === S.APPROVED) assert.equal(effect, E.CREATE);
      if (effect === E.CREATE) assert.equal(to, S.APPROVED);
    }
    assert.equal(initialState(DECISION.APPROVED).reservation, E.CREATE);
  });

  it('only SUBMITTED to EXECUTED consumes a reservation', () => {
    const consumers = LEGAL.filter(([, , e]) => e === E.CONSUME);
    assert.deepEqual(consumers, [[S.SUBMITTED, S.EXECUTED, E.CONSUME]]);
  });
});

describe('terminal statuses', () => {
  const terminal = [
    S.BLOCKED, S.REJECTED, S.EXPIRED, S.CANCELLED,
    S.EXECUTED, S.FAILED, S.MISMATCH,
  ];
  const active = [S.APPROVAL_REQUIRED, S.APPROVED, S.SUBMITTED];

  it('classifies terminal and non-terminal statuses', () => {
    for (const s of terminal) assert.equal(isTerminal(s), true, s);
    for (const s of active) assert.equal(isTerminal(s), false, s);
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const s of terminal) {
      assert.deepEqual(next(s), [], s);
    }
  });

  it('non-terminal statuses all have outgoing transitions', () => {
    for (const s of active) {
      assert.ok(next(s).length > 0, s);
    }
  });

  it('isTerminal throws on unknown statuses', () => {
    for (const bad of ['PENDING', '', null, undefined, 5, {}]) {
      assert.throws(() => isTerminal(bad), LifecycleError);
    }
  });
});

describe('graph properties', () => {
  it('every status is reachable from some initial state', () => {
    const seen = new Set();
    const queue = Object.values(DECISION).map((d) => initialState(d).status);
    while (queue.length > 0) {
      const s = queue.shift();
      if (seen.has(s)) continue;
      seen.add(s);
      queue.push(...next(s));
    }
    assert.deepEqual([...seen].sort(), [...ALL].sort());
  });

  it('has no cycles (a request can never be revived)', () => {
    const state = new Map(); // 1 = visiting, 2 = done
    const visit = (s) => {
      if (state.get(s) === 1) return true;
      if (state.get(s) === 2) return false;
      state.set(s, 1);
      for (const t of next(s)) {
        if (visit(t)) return true;
      }
      state.set(s, 2);
      return false;
    };
    for (const s of ALL) {
      assert.equal(visit(s), false, s);
    }
  });
});

describe('budget holding', () => {
  it('holds budget exactly for APPROVED, SUBMITTED, EXECUTED and MISMATCH', () => {
    const holders = ALL.filter((s) => holdsBudget(s)).sort();
    assert.deepEqual(
      holders,
      [S.APPROVED, S.EXECUTED, S.MISMATCH, S.SUBMITTED].sort(),
    );
  });

  it('reservation effects match budget holding on every transition', () => {
    for (const [from, to, effect] of LEGAL) {
      const before = holdsBudget(from);
      const after = holdsBudget(to);
      const k = key(from, to);
      switch (effect) {
        case E.CREATE:
          assert.deepEqual([before, after], [false, true], k);
          break;
        case E.HOLD:
        case E.CONSUME:
          assert.deepEqual([before, after], [true, true], k);
          break;
        case E.RELEASE:
          assert.deepEqual([before, after], [true, false], k);
          break;
        case E.NONE:
          assert.deepEqual([before, after], [false, false], k);
          break;
        default:
          assert.fail(`unexpected effect for ${k}`);
      }
    }
  });

  it('initial reservation effect matches budget holding', () => {
    for (const decision of Object.values(DECISION)) {
      const { status, reservation } = initialState(decision);
      assert.equal(reservation === E.CREATE, holdsBudget(status), decision);
    }
  });

  it('terminal failure states release or never held budget', () => {
    for (const s of [S.BLOCKED, S.REJECTED, S.EXPIRED, S.CANCELLED, S.FAILED]) {
      assert.equal(holdsBudget(s), false, s);
    }
  });

  it('holdsBudget throws on unknown statuses', () => {
    for (const bad of ['PENDING', '', null, undefined, 5]) {
      assert.throws(() => holdsBudget(bad), LifecycleError);
    }
  });
});

describe('input safety', () => {
  it('rejects prototype keys and non-string inputs', () => {
    const weird = [
      '__proto__', 'constructor', 'toString', 'hasOwnProperty',
      '', null, undefined, 1, {}, [], Symbol('x'),
    ];
    for (const bad of weird) {
      assert.equal(canTransition(bad, S.APPROVED), false);
      assert.equal(canTransition(S.APPROVAL_REQUIRED, bad), false);
      assert.throws(() => transition(bad, S.APPROVED), LifecycleError);
      assert.throws(() => transition(S.APPROVAL_REQUIRED, bad), LifecycleError);
    }
  });

  it('is case sensitive', () => {
    assert.equal(canTransition('approval_required', 'approved'), false);
    assert.equal(canTransition('Approved', 'Submitted'), false);
  });
});
