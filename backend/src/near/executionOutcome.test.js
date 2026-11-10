import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkExecution, EXECUTION_CODES as C } from './executionOutcome.js';
import { FIXTURE_FILES, loadFixture } from '../testing/nearFixtures.js';

// Synthetic data shaped like a NEAR `tx` RPC result. No fixture files.
const outcome = (status, receiptIds = []) => ({
  executor_id: 'someone.testnet',
  gas_burnt: 1,
  logs: [],
  receipt_ids: receiptIds,
  status,
});
const entry = (id, o) => ({ id, block_hash: 'BLOCK', outcome: o });
const SV = (v = '') => ({ SuccessValue: v });
const SR = (id) => ({ SuccessReceiptId: id });

// Same shape as a real native transfer: tx -> R1 (executes the transfer and
// produces a refund receipt) -> R2 (refund).
function transfer() {
  return {
    final_execution_status: 'FINAL',
    status: SV(),
    transaction: { hash: 'TX' },
    transaction_outcome: { id: 'TX', block_hash: 'BLOCK', outcome: outcome(SR('R1'), ['R1']) },
    receipts_outcome: [
      entry('R1', outcome(SV(), ['R2'])),
      entry('R2', outcome(SV())),
    ],
  };
}

function check(mutate) {
  const r = transfer();
  mutate(r);
  return checkExecution(r);
}

const assertFails = (res, code) => {
  assert.equal(res.ok, false);
  assert.equal(res.code, code);
};

describe('checkExecution: success', () => {
  it('accepts a transfer shaped like the real RPC response', () => {
    const res = checkExecution(transfer());
    assert.equal(res.ok, true);
    assert.equal(res.code, C.OK);
    assert.equal(res.receiptCount, 2);
  });

  it('does not require every outcome to be exactly SuccessValue ""', () => {
    const res = check((r) => {
      r.receipts_outcome[0].outcome.status = SV('aGVsbG8='); // non-empty payload
    });
    assert.equal(res.ok, true);
  });

  it('follows a SuccessReceiptId chain through every receipt', () => {
    const res = check((r) => {
      r.receipts_outcome = [
        entry('R1', outcome(SR('R2'), ['R2'])),
        entry('R2', outcome(SR('R3'), ['R3', 'R4'])),
        entry('R3', outcome(SV('abc'))),
        entry('R4', outcome(SV())),
      ];
    });
    assert.equal(res.ok, true);
    assert.equal(res.receiptCount, 4);
  });

  it('does not depend on the order of receipts_outcome', () => {
    const res = check((r) => {
      r.receipts_outcome.reverse();
    });
    assert.equal(res.ok, true);
  });

  it('does not mutate its input', () => {
    const r = transfer();
    const before = JSON.stringify(r);
    checkExecution(r);
    assert.equal(JSON.stringify(r), before);
  });
});

describe('checkExecution: a handoff alone is never success', () => {
  it('rejects a SuccessReceiptId whose receipt is not in receipts_outcome', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome = [];
      }),
      C.RECEIPT_MISSING,
    );
  });

  it('rejects a receipt that hands off to a missing receipt', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome = [entry('R1', outcome(SR('R2'), ['R2']))];
      }),
      C.RECEIPT_MISSING,
    );
  });

  it('rejects a produced receipt that is missing even when the parent succeeded', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome = [entry('R1', outcome(SV(), ['R2']))];
      }),
      C.RECEIPT_MISSING,
    );
  });

  it('rejects a handoff naming a receipt the outcome did not produce', () => {
    assertFails(
      check((r) => {
        r.transaction_outcome.outcome.status = SR('R2');
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects a transaction that produced no receipts at all', () => {
    assertFails(
      check((r) => {
        r.transaction_outcome.outcome = outcome(SV());
        r.receipts_outcome = [];
      }),
      C.RECEIPT_MISSING,
    );
  });
});

describe('checkExecution: failures and unknown states', () => {
  it('rejects a failed receipt even when the overall status says success', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
      }),
      C.FAILED,
    );
  });

  it('rejects a failed refund receipt deeper in the chain', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome[1].outcome.status = { Failure: {} };
      }),
      C.FAILED,
    );
  });

  it('rejects a failed transaction outcome', () => {
    assertFails(
      check((r) => {
        r.transaction_outcome.outcome.status = { Failure: {} };
      }),
      C.FAILED,
    );
  });

  it('rejects an overall Failure status', () => {
    assertFails(
      check((r) => {
        r.status = { Failure: {} };
      }),
      C.FAILED,
    );
  });

  it('rejects receipts that are still Unknown / Started / NotStarted', () => {
    for (const s of ['Unknown', 'Started', 'NotStarted']) {
      assertFails(
        check((r) => {
          r.receipts_outcome[1].outcome.status = s;
        }),
        C.INCOMPLETE,
      );
    }
  });

  it('rejects an overall status that is not final', () => {
    for (const s of ['NotStarted', 'Started']) {
      assertFails(
        check((r) => {
          r.status = s;
        }),
        C.INCOMPLETE,
      );
    }
  });

  it('rejects an overall status that is a bare handoff', () => {
    assertFails(
      check((r) => {
        r.status = SR('R1');
      }),
      C.MALFORMED,
    );
  });

  it('rejects an unrecognised status shape', () => {
    const bad = [{}, { SuccessValue: 5 }, { SuccessReceiptId: '' }, { A: 1, B: 2 }, 'Nope', 7, null];
    for (const s of bad) {
      assertFails(
        check((r) => {
          r.receipts_outcome[1].outcome.status = s;
        }),
        C.MALFORMED,
      );
    }
  });
});

describe('checkExecution: finality', () => {
  it('requires FINAL', () => {
    for (const f of ['NONE', 'INCLUDED', 'INCLUDED_FINAL', 'EXECUTED', 'EXECUTED_OPTIMISTIC']) {
      assertFails(
        check((r) => {
          r.final_execution_status = f;
        }),
        C.NOT_FINAL,
      );
    }
  });

  it('rejects a missing or non-string finality', () => {
    assertFails(
      check((r) => {
        delete r.final_execution_status;
      }),
      C.MALFORMED,
    );
    assertFails(
      check((r) => {
        r.final_execution_status = 1;
      }),
      C.MALFORMED,
    );
  });
});

describe('checkExecution: receipt chain integrity', () => {
  it('rejects a receipt that is not part of the chain', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome.push(entry('ORPHAN', outcome(SV())));
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects duplicate receipt ids in receipts_outcome', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome.push(entry('R2', outcome(SV())));
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects a receipt listed twice by its producers', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome[0].outcome.receipt_ids = ['R2', 'R2'];
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects a receipt claimed by two parents', () => {
    assertFails(
      check((r) => {
        r.transaction_outcome.outcome.receipt_ids = ['R1', 'R2'];
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects a cycle without looping forever', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome = [
          entry('R1', outcome(SR('R2'), ['R2'])),
          entry('R2', outcome(SR('R1'), ['R1'])),
        ];
      }),
      C.CHAIN_INVALID,
    );
    assertFails(
      check((r) => {
        r.receipts_outcome = [entry('R1', outcome(SR('R1'), ['R1']))];
      }),
      C.CHAIN_INVALID,
    );
  });

  it('rejects malformed receipt entries and receipt_ids', () => {
    assertFails(
      check((r) => {
        r.receipts_outcome = [null];
      }),
      C.MALFORMED,
    );
    assertFails(
      check((r) => {
        r.receipts_outcome[0].id = '';
      }),
      C.MALFORMED,
    );
    assertFails(
      check((r) => {
        delete r.receipts_outcome[0].outcome.receipt_ids;
      }),
      C.MALFORMED,
    );
    assertFails(
      check((r) => {
        r.receipts_outcome[0].outcome.receipt_ids = [7];
      }),
      C.MALFORMED,
    );
  });
});

describe('checkExecution: bad input', () => {
  it('fails closed, without throwing, on non-objects', () => {
    for (const v of [undefined, null, 0, 'x', [], true]) {
      assertFails(checkExecution(v), C.MALFORMED);
    }
  });

  it('rejects a missing transaction_outcome or receipts_outcome', () => {
    assertFails(
      check((r) => {
        delete r.transaction_outcome;
      }),
      C.MALFORMED,
    );
    assertFails(
      check((r) => {
        r.receipts_outcome = 'nope';
      }),
      C.MALFORMED,
    );
  });

  it('never throws on hostile input', () => {
    const hostile = transfer();
    Object.defineProperty(hostile, 'receipts_outcome', {
      get() {
        throw new Error('boom');
      },
    });
    assertFails(checkExecution(hostile), C.MALFORMED);
  });
});

describe('checkExecution: real testnet fixtures', () => {
  const plain = () => structuredClone(loadFixture(FIXTURE_FILES.success));
  const withReceipts = () => structuredClone(loadFixture(FIXTURE_FILES.successReceipts));
  const ids = (r) => {
    const [firstId] = r.transaction_outcome.outcome.receipt_ids;
    const first = r.receipts_outcome.find((x) => x.id === firstId);
    return { firstId, refundId: first.outcome.receipt_ids[0] };
  };

  it('accepts the real successful transfer', () => {
    const r = plain();
    assert.deepEqual(Object.keys(r.transaction_outcome.outcome.status), ['SuccessReceiptId']);
    const res = checkExecution(r);
    assert.equal(res.ok, true);
    assert.equal(res.code, C.OK);
    assert.equal(res.receiptCount, 2);
  });

  it('accepts the real transfer from the receipts lookup', () => {
    const res = checkExecution(withReceipts());
    assert.equal(res.ok, true);
    assert.equal(res.receiptCount, 2);
  });

  it('rejects the real transfer without its transfer receipt', () => {
    const r = plain();
    const { firstId } = ids(r);
    r.receipts_outcome = r.receipts_outcome.filter((x) => x.id !== firstId);
    assert.deepEqual(checkExecution(r), { ok: false, code: C.RECEIPT_MISSING });
  });

  it('rejects the real transfer without its refund receipt', () => {
    const r = plain();
    const { refundId } = ids(r);
    r.receipts_outcome = r.receipts_outcome.filter((x) => x.id !== refundId);
    assert.deepEqual(checkExecution(r), { ok: false, code: C.RECEIPT_MISSING });
  });

  it('rejects the real transfer when its refund receipt failed', () => {
    const r = plain();
    const { refundId } = ids(r);
    r.receipts_outcome.find((x) => x.id === refundId).outcome.status = { Failure: { ActionError: {} } };
    assert.deepEqual(checkExecution(r), { ok: false, code: C.FAILED });
  });

  it('rejects the real transfer when it is not final', () => {
    const r = plain();
    r.final_execution_status = 'EXECUTED';
    assert.deepEqual(checkExecution(r), { ok: false, code: C.NOT_FINAL });
  });
});

describe('checkExecution: captured RPC timeout (HANDLER_ERROR / TIMEOUT_ERROR / NOT_OBSERVED)', () => {
  // No result exists, so execution is unknown. It must never be reported as
  // success (ok: true) or as a transaction failure (FAILED).
  const response = loadFixture(FIXTURE_FILES.rpcTimeout);

  for (const [label, input] of [['envelope', response], ['error object', response.error], ['null result', null]]) {
    it(`is never success or FAILED: ${label}`, () => {
      const res = checkExecution(input);
      assert.equal(res.ok, false);
      assert.notEqual(res.code, C.OK);
      assert.notEqual(res.code, C.FAILED);
      assert.equal(res.code, C.MALFORMED);
    });
  }
});
