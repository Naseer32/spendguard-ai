import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearToYocto as N, addYocto, subYocto } from '../money/yocto.js';
import { AGENT_STATUS, DECISION, REASON } from './reasonCodes.js';
import { evaluatePayment, isValidNearAccountId } from './engine.js';

// Defaults: budget 100 NEAR/day, per-tx limit 20, approval threshold 5,
// recipient on allowlist, nothing reserved yet, request of 1 NEAR.
function make(over = {}) {
  return {
    agent: {
      status: AGENT_STATUS.ACTIVE,
      dailyBudget: N('100'),
      perTxLimit: N('20'),
      approvalThreshold: N('5'),
      ...over.agent,
    },
    recipientLists: {
      onAllowlist: true,
      onBlocklist: false,
      ...over.recipientLists,
    },
    reservedToday: 'reservedToday' in over ? over.reservedToday : '0',
    request: {
      recipient: 'merchant.testnet',
      amount: N('1'),
      ...over.request,
    },
  };
}

function run(over) {
  return evaluatePayment(make(over));
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

describe('APPROVED', () => {
  it('approves a payment within all limits', () => {
    const r = run();
    assert.equal(r.decision, DECISION.APPROVED);
    assert.deepEqual(r.reasonCodes, [REASON.WITHIN_POLICY]);
    assert.equal(r.remainingBudget, N('100'));
  });

  it('reports remaining budget before the payment', () => {
    const r = run({ reservedToday: N('30') });
    assert.equal(r.decision, DECISION.APPROVED);
    assert.equal(r.remainingBudget, N('70'));
  });

  it('approves exactly at the approval threshold', () => {
    const r = run({ request: { amount: N('5') } });
    assert.equal(r.decision, DECISION.APPROVED);
  });

  it('approves exactly the remaining budget', () => {
    const r = run({
      agent: { dailyBudget: N('100'), perTxLimit: N('100'), approvalThreshold: N('100') },
      reservedToday: N('90'),
      request: { amount: N('10') },
    });
    assert.equal(r.decision, DECISION.APPROVED);
    assert.equal(r.remainingBudget, N('10'));
  });
});

describe('APPROVAL_REQUIRED', () => {
  it('requires approval one yocto above the threshold', () => {
    const r = run({ request: { amount: addYocto(N('5'), '1') } });
    assert.equal(r.decision, DECISION.APPROVAL_REQUIRED);
    assert.deepEqual(r.reasonCodes, [REASON.ABOVE_APPROVAL_THRESHOLD]);
  });

  it('requires approval for a recipient not on the allowlist', () => {
    const r = run({ recipientLists: { onAllowlist: false } });
    assert.equal(r.decision, DECISION.APPROVAL_REQUIRED);
    assert.deepEqual(r.reasonCodes, [REASON.RECIPIENT_NOT_ALLOWLISTED]);
  });

  it('reports both approval reasons together, in rule order', () => {
    const r = run({
      recipientLists: { onAllowlist: false },
      request: { amount: N('10') },
    });
    assert.equal(r.decision, DECISION.APPROVAL_REQUIRED);
    assert.deepEqual(r.reasonCodes, [
      REASON.RECIPIENT_NOT_ALLOWLISTED,
      REASON.ABOVE_APPROVAL_THRESHOLD,
    ]);
  });

  it('exactly at the per-tx limit is not blocked, only needs approval', () => {
    const r = run({ request: { amount: N('20') } });
    assert.equal(r.decision, DECISION.APPROVAL_REQUIRED);
    assert.ok(!r.reasonCodes.includes(REASON.EXCEEDS_TX_LIMIT));
  });
});

describe('BLOCKED: agent and recipient', () => {
  it('blocks a paused agent', () => {
    const r = run({ agent: { status: AGENT_STATUS.PAUSED } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.AGENT_PAUSED]);
  });

  it('blocks a blocklisted recipient', () => {
    const r = run({ recipientLists: { onBlocklist: true } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.RECIPIENT_BLOCKED]);
  });

  it('blocklist wins when a recipient is on both lists', () => {
    const r = run({ recipientLists: { onAllowlist: true, onBlocklist: true } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.RECIPIENT_BLOCKED]);
  });

  it('blocks invalid recipient account ids', () => {
    const bad = ['Alice.near', '', 'a', 'a b', '-a.near', 'a..near', 'a.near.', null, undefined, 42, 'x'.repeat(65)];
    for (const recipient of bad) {
      const r = run({ request: { recipient } });
      assert.equal(r.decision, DECISION.BLOCKED, String(recipient));
      assert.deepEqual(r.reasonCodes, [REASON.INVALID_RECIPIENT], String(recipient));
    }
  });
});

describe('BLOCKED: amounts', () => {
  it('blocks zero amounts', () => {
    const r = run({ request: { amount: '0' } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.ZERO_AMOUNT]);
  });

  it('blocks malformed amounts', () => {
    const bad = ['-1', '1.5', 'abc', '', '01', '1e24', ' 1', 5, 1.5, 10n, null, undefined, '1' + '0'.repeat(40)];
    for (const amount of bad) {
      const r = run({ request: { amount } });
      assert.equal(r.decision, DECISION.BLOCKED, String(amount));
      assert.deepEqual(r.reasonCodes, [REASON.INVALID_AMOUNT], String(amount));
    }
  });

  it('blocks one yocto above the per-tx limit', () => {
    const r = run({ request: { amount: addYocto(N('20'), '1') } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.EXCEEDS_TX_LIMIT]);
  });

  it('blocks one yocto above the remaining budget', () => {
    const r = run({
      agent: { dailyBudget: N('100'), perTxLimit: N('100'), approvalThreshold: N('100') },
      reservedToday: N('90'),
      request: { amount: addYocto(N('10'), '1') },
    });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.EXCEEDS_DAILY_BUDGET]);
  });

  it('blocks everything when the budget is fully used', () => {
    const r = run({ reservedToday: N('100'), request: { amount: '1' } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.EXCEEDS_DAILY_BUDGET]);
    assert.equal(r.remainingBudget, '0');
  });

  it('treats over-reserved budget (limits lowered) as zero remaining', () => {
    const r = run({ reservedToday: N('150'), request: { amount: '1' } });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.equal(r.remainingBudget, '0');
  });

  it('compares exactly above 2^53 (no float rounding)', () => {
    const r = run({
      agent: { perTxLimit: '9007199254740992', dailyBudget: N('100'), approvalThreshold: '1' },
      request: { amount: '9007199254740993' },
    });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.EXCEEDS_TX_LIMIT]);
  });

  it('handles 40-digit values', () => {
    const max = '9'.repeat(40);
    const r = run({
      agent: { dailyBudget: max, perTxLimit: max, approvalThreshold: max },
      request: { amount: subYocto(max, '1') },
    });
    assert.equal(r.decision, DECISION.APPROVED);
  });
});

describe('combined rules', () => {
  it('returns all blocking reasons in rule order', () => {
    const r = run({
      agent: { status: AGENT_STATUS.PAUSED },
      recipientLists: { onBlocklist: true },
      request: { amount: N('200') },
    });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [
      REASON.AGENT_PAUSED,
      REASON.RECIPIENT_BLOCKED,
      REASON.EXCEEDS_TX_LIMIT,
      REASON.EXCEEDS_DAILY_BUDGET,
    ]);
  });

  it('blocking beats approval-required', () => {
    const r = run({
      recipientLists: { onAllowlist: false },
      request: { amount: N('30') },
    });
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.EXCEEDS_TX_LIMIT]);
  });
});

describe('fail closed', () => {
  it('never throws on garbage input and always blocks', () => {
    for (const input of [undefined, null, 42, 'x', [], {}, () => {}]) {
      const r = evaluatePayment(input);
      assert.equal(r.decision, DECISION.BLOCKED);
      assert.deepEqual(r.reasonCodes, [REASON.INVALID_AGENT_CONFIG]);
    }
  });

  it('blocks on invalid agent configuration', () => {
    const cases = [
      { status: 'ROGUE' },
      { status: undefined },
      { dailyBudget: '1.5' },
      { dailyBudget: 100 },
      { perTxLimit: undefined },
      { approvalThreshold: '-1' },
    ];
    for (const agent of cases) {
      const r = run({ agent });
      assert.equal(r.decision, DECISION.BLOCKED, JSON.stringify(agent));
      assert.deepEqual(r.reasonCodes, [REASON.INVALID_AGENT_CONFIG], JSON.stringify(agent));
      assert.equal(r.remainingBudget, null);
    }
  });

  it('blocks on invalid evaluation context', () => {
    const badReserved = ['-1', null, 5, undefined, '1.5'];
    for (const reservedToday of badReserved) {
      const r = run({ reservedToday });
      assert.equal(r.decision, DECISION.BLOCKED);
      assert.deepEqual(r.reasonCodes, [REASON.INVALID_CONTEXT]);
    }
    const noLists = { ...make(), recipientLists: undefined };
    assert.deepEqual(evaluatePayment(noLists).reasonCodes, [REASON.INVALID_CONTEXT]);
    const badFlags = { ...make(), recipientLists: { onAllowlist: 'yes', onBlocklist: false } };
    assert.deepEqual(evaluatePayment(badFlags).reasonCodes, [REASON.INVALID_CONTEXT]);
  });

  it('blocks with INTERNAL_ERROR if reading input throws', () => {
    const input = make();
    input.request = {
      recipient: 'merchant.testnet',
      get amount() {
        throw new Error('boom');
      },
    };
    const r = evaluatePayment(input);
    assert.equal(r.decision, DECISION.BLOCKED);
    assert.deepEqual(r.reasonCodes, [REASON.INTERNAL_ERROR]);
  });
});

describe('determinism and purity', () => {
  it('returns identical results for identical input', () => {
    assert.deepEqual(run(), run());
    const input = make({ request: { amount: N('10') } });
    assert.deepEqual(evaluatePayment(input), evaluatePayment(input));
  });

  it('does not mutate its input', () => {
    const input = deepFreeze(make());
    const r = evaluatePayment(input);
    assert.equal(r.decision, DECISION.APPROVED);
  });

  it('returns frozen results', () => {
    const r = run();
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.reasonCodes));
  });

  it('only ever returns one of the three decisions', () => {
    const allowed = new Set(Object.values(DECISION));
    const samples = [
      run(),
      run({ agent: { status: AGENT_STATUS.PAUSED } }),
      run({ recipientLists: { onAllowlist: false } }),
      evaluatePayment(undefined),
    ];
    for (const r of samples) assert.ok(allowed.has(r.decision));
  });
});

describe('isValidNearAccountId', () => {
  it('accepts valid ids', () => {
    const good = ['ab', 'alice.testnet', 'a1.b2.c3', 'sub-acct_1.alice.near', 'a'.repeat(64), 'a1b2c3d4'.repeat(8)];
    for (const id of good) assert.equal(isValidNearAccountId(id), true, id);
  });

  it('rejects invalid ids', () => {
    const bad = ['', 'a', 'A.near', 'a b', '.near', 'near.', 'a..b', '-a', 'a-', '_a.near', 'a.-b', 'a'.repeat(65), 'a\n', 5, null];
    for (const id of bad) assert.equal(isValidNearAccountId(id), false, String(id));
  });
});
