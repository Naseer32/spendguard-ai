import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidNearAccountId,
  validateAgentForm,
  validateComment,
  validateLimits,
  validateRecipientForm,
} from './validation.js';

const goodAgent = {
  name: '  Test Agent ',
  sourceAccount: 'demo-source.example',
  dailyBudget: '100',
  perTxLimit: '50',
  approvalThreshold: '20',
};

test('isValidNearAccountId matches the backend rules', () => {
  for (const ok of ['alice.near', 'a1', 'my-account_1.testnet', 'x'.repeat(64)]) {
    assert.ok(isValidNearAccountId(ok), ok);
  }
  for (const bad of ['', 'a', 'Alice.near', 'a..b', '-a', 'a-', 'a b', 'x'.repeat(65), null, 5]) {
    assert.ok(!isValidNearAccountId(bad), String(bad));
  }
});

test('validateAgentForm accepts a good form and returns yocto strings', () => {
  const r = validateAgentForm(goodAgent);
  assert.ok(r.ok);
  assert.equal(r.value.name, 'Test Agent');
  assert.equal(r.value.dailyBudget, '100000000000000000000000000');
  assert.equal(r.value.approvalThreshold, '20000000000000000000000000');
});

test('validateAgentForm reports every problem at once', () => {
  const r = validateAgentForm({ name: '', sourceAccount: 'BAD ID', dailyBudget: '', perTxLimit: 'x', approvalThreshold: '-1' });
  assert.ok(!r.ok);
  assert.equal(r.value, null);
  for (const field of ['name', 'sourceAccount', 'dailyBudget', 'perTxLimit', 'approvalThreshold']) {
    assert.ok(r.errors[field], `expected an error for ${field}`);
  }
});

test('limits must satisfy approvalThreshold <= perTxLimit <= dailyBudget', () => {
  const tooHighTx = validateLimits({ dailyBudget: '10', perTxLimit: '20', approvalThreshold: '5' });
  assert.ok(!tooHighTx.ok);
  assert.ok(tooHighTx.errors.perTxLimit);

  const tooHighThreshold = validateLimits({ dailyBudget: '100', perTxLimit: '20', approvalThreshold: '30' });
  assert.ok(!tooHighThreshold.ok);
  assert.ok(tooHighThreshold.errors.approvalThreshold);

  const equal = validateLimits({ dailyBudget: '20', perTxLimit: '20', approvalThreshold: '20' });
  assert.ok(equal.ok, 'equal values are allowed');
});

test('zero is allowed only for the approval threshold', () => {
  assert.ok(validateLimits({ dailyBudget: '10', perTxLimit: '5', approvalThreshold: '0' }).ok);
  assert.ok(!validateLimits({ dailyBudget: '0', perTxLimit: '0', approvalThreshold: '0' }).ok);
});

test('names with control characters or excess length are rejected', () => {
  assert.ok(!validateAgentForm({ ...goodAgent, name: 'a\u0007b' }).ok);
  assert.ok(!validateAgentForm({ ...goodAgent, name: 'x'.repeat(101) }).ok);
  assert.ok(validateAgentForm({ ...goodAgent, name: 'x'.repeat(100) }).ok);
});

test('validateRecipientForm checks account, list type and note', () => {
  const ok = validateRecipientForm({ accountId: ' demo-a.example ', listType: 'ALLOW', note: '  hi ' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { accountId: 'demo-a.example', listType: 'ALLOW', note: 'hi' });

  assert.equal(validateRecipientForm({ accountId: 'demo-a.example', listType: 'BLOCK', note: '  ' }).value.note, null);
  assert.ok(validateRecipientForm({ accountId: 'Bad', listType: 'ALLOW' }).errors.accountId);
  assert.ok(validateRecipientForm({ accountId: 'good.example', listType: 'MAYBE' }).errors.listType);
  assert.ok(validateRecipientForm({ accountId: 'good.example', listType: 'ALLOW', note: 'x'.repeat(501) }).errors.note);
});

test('validateComment trims, nulls blanks and caps length', () => {
  assert.deepEqual(validateComment('  fine '), { ok: true, error: null, value: 'fine' });
  assert.equal(validateComment('   ').value, null);
  assert.ok(!validateComment('x'.repeat(501)).ok);
});
