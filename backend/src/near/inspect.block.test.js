import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError, buildBlockParams, parseInspectArgs } from './inspect.js';

const BLOCK = '12E4MqAhaRrzvbZhiB1EaUVHJhrhAbdAhJgf73YzzRru';

describe('the block command', () => {
  it('parses a block hash, with an optional save name', () => {
    assert.deepEqual({ ...parseInspectArgs(['block', BLOCK]) }, { command: 'block', blockHash: BLOCK, save: null });
    const saved = parseInspectArgs(['block', BLOCK, '--save', 'block.json']);
    assert.equal(saved.save, 'block.json');
    assert.equal(parseInspectArgs(['block', '--save', 'b.json', BLOCK]).blockHash, BLOCK);
    assert.ok(Object.isFrozen(saved));
  });

  it('rejects bad usage', () => {
    const bad = [
      ['block'], ['block', BLOCK, 'extra'], ['block', 'short'], ['block', 'O'.repeat(44)],
      ['block', BLOCK, '--save'], ['block', BLOCK, '--save', '../x.json'], ['block', BLOCK, '--save', 'x.txt'],
      ['block', BLOCK, '--method', 'tx'], ['block', BLOCK, '--save', 'a.json', '--save', 'b.json'],
    ];
    bad.forEach((argv, i) => {
      assert.throws(() => parseInspectArgs(argv), UsageError, `argv #${i}`);
    });
  });

  it('builds the lookup parameters', () => {
    assert.deepEqual(buildBlockParams(BLOCK), { block_id: BLOCK });
  });
});
