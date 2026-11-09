import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UsageError,
  buildTxParams,
  fixtureUrl,
  parseInspectArgs,
  shapeLines,
} from './inspect.js';

const HASH = 'FHk3J8cVqwZ2bX9mYtP7nRaLdE4sUoQxWgCvB6iKj1Hy';
const SENDER = 'steephat8707.testnet';

describe('parseInspectArgs', () => {
  it('parses status', () => {
    assert.deepEqual({ ...parseInspectArgs(['status']) }, { command: 'status' });
  });

  it('parses tx with defaults', () => {
    assert.deepEqual({ ...parseInspectArgs(['tx', HASH, SENDER]) }, {
      command: 'tx', txHash: HASH, sender: SENDER, method: 'tx', params: 'object', save: null,
    });
  });

  it('parses every option in any order', () => {
    const args = parseInspectArgs([
      'tx', '--save', 'transfer.json', HASH, '--method', 'EXPERIMENTAL_tx_status', SENDER, '--params', 'array',
    ]);
    assert.equal(args.method, 'EXPERIMENTAL_tx_status');
    assert.equal(args.params, 'array');
    assert.equal(args.save, 'transfer.json');
    assert.equal(args.txHash, HASH);
    assert.equal(args.sender, SENDER);
    assert.ok(Object.isFrozen(args));
  });

  it('rejects bad usage with a UsageError', () => {
    const bad = [
      [], ['nope'], ['status', 'extra'], ['tx'], ['tx', HASH], ['tx', HASH, SENDER, 'extra'],
      ['tx', 'short', SENDER], ['tx', `${HASH}0`, SENDER], ['tx', 'O'.repeat(44), SENDER],
      ['tx', HASH, 'Bad Account'], ['tx', HASH, 'a'],
      ['tx', HASH, SENDER, '--unknown', 'x'], ['tx', HASH, SENDER, '--method'],
      ['tx', HASH, SENDER, '--method', '--params'], ['tx', HASH, SENDER, '--method', 'tx', '--method', 'tx'],
      ['tx', HASH, SENDER, '--method', 'status'], ['tx', HASH, SENDER, '--params', 'xml'],
      ['tx', HASH, SENDER, '--save', '../x.json'], ['tx', HASH, SENDER, '--save', 'a/b.json'],
      ['tx', HASH, SENDER, '--save', 'x.txt'], ['tx', HASH, SENDER, '--save', '.json'],
      ['tx', HASH, SENDER, '--save', `${'a'.repeat(70)}.json`],
    ];
    bad.forEach((argv, i) => {
      assert.throws(() => parseInspectArgs(argv), UsageError, `argv #${i}`);
    });
    assert.throws(() => parseInspectArgs('tx'), TypeError);
    assert.throws(() => parseInspectArgs([5]), TypeError);
  });

  it('never echoes arguments in error messages', () => {
    try {
      parseInspectArgs(['tx', 'SECRETVALUE', SENDER]);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(!error.message.includes('SECRETVALUE'));
    }
  });
});

describe('buildTxParams and fixtureUrl', () => {
  it('builds the two parameter styles', () => {
    assert.deepEqual(buildTxParams('object', HASH, SENDER), {
      tx_hash: HASH, sender_account_id: SENDER, wait_until: 'FINAL',
    });
    assert.deepEqual(buildTxParams('array', HASH, SENDER), [HASH, SENDER]);
  });

  it('builds fixture URLs for plain file names only', () => {
    assert.ok(fixtureUrl('transfer.json').pathname.endsWith('/near/fixtures/transfer.json'));
    for (const bad of ['../x.json', 'a/b.json', 'x.txt', '', undefined, 5]) {
      assert.throws(() => fixtureUrl(bad), UsageError, String(bad));
    }
  });
});

describe('shapeLines', () => {
  it('describes every field with its path, type and value', () => {
    const lines = shapeLines({ a: 1, b: 'hi', c: [1, 2, 3, 4], d: { e: null, f: true } });
    assert.deepEqual(lines, [
      '$: object(4)',
      '$.a: number 1',
      '$.b: string(2) "hi"',
      '$.c: array(4)',
      '$.c[0]: number 1',
      '$.c[1]: number 2',
      '$.c[2]: number 3',
      '$.c: ... 1 more',
      '$.d: object(2)',
      '$.d.e: null',
      '$.d.f: boolean true',
    ]);
  });

  it('clips long strings but reports their length', () => {
    const lines = shapeLines({ s: 'x'.repeat(100) });
    assert.equal(lines[1], `$.s: string(100) "${'x'.repeat(80)}…"`);
  });

  it('describes nested arrays of objects', () => {
    const lines = shapeLines({ list: [{ id: 'a' }, { id: 'b' }] });
    assert.deepEqual(lines, [
      '$: object(1)', '$.list: array(2)', '$.list[0]: object(1)', '$.list[0].id: string(1) "a"',
      '$.list[1]: object(1)', '$.list[1].id: string(1) "b"',
    ]);
  });

  it('handles scalars at the top level', () => {
    assert.deepEqual(shapeLines(5), ['$: number 5']);
    assert.deepEqual(shapeLines(null), ['$: null']);
    assert.deepEqual(shapeLines('s'), ['$: string(1) "s"']);
  });

  it('caps the number of lines and the depth', () => {
    const wide = {};
    for (let i = 0; i < 20; i += 1) wide[`k${i}`] = i;
    const lines = shapeLines(wide, { maxLines: 5 });
    assert.equal(lines.length, 6);
    assert.equal(lines[5], '... output truncated');
    const deep = { a: { b: { c: { d: 1 } } } };
    assert.deepEqual(shapeLines(deep, { maxDepth: 2 }), ['$: object(1)', '$.a: object(1)', '$.a.b: object(1)']);
  });
});

describe('source guard', () => {
  it('never prints from the library file', () => {
    const source = fs.readFileSync(new URL('./inspect.js', import.meta.url), 'utf8');
    assert.ok(!/\bconsole\s*\./.test(source));
  });
});
