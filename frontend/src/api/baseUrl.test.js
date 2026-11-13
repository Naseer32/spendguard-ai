import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl } from './baseUrl.js';

test('empty means same origin', () => {
  assert.deepEqual(validateBaseUrl(''), { ok: true, value: '' });
  assert.deepEqual(validateBaseUrl('   '), { ok: true, value: '' });
});

test('https origins are accepted and normalised', () => {
  assert.equal(validateBaseUrl('https://api.example.com/').value, 'https://api.example.com');
  assert.equal(validateBaseUrl(' https://api.example.com:8443 ').value, 'https://api.example.com:8443');
});

test('http is allowed only for this device and private networks', () => {
  for (const h of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.5:3000', 'http://10.0.0.2', 'http://172.20.1.1', 'http://[::1]:3000']) {
    assert.equal(validateBaseUrl(h).ok, true, h);
  }
  for (const h of ['http://api.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'http://localhost.evil.com']) {
    assert.equal(validateBaseUrl(h).ok, false, h);
  }
});

test('credentials, paths, queries, hashes and other schemes are refused', () => {
  for (const h of ['https://u:p@api.example.com', 'https://api.example.com/api', 'https://api.example.com/?x=1', 'https://api.example.com/#x', 'ftp://x.example.com', 'javascript:alert(1)', 'not a url', 'api.example.com']) {
    assert.equal(validateBaseUrl(h).ok, false, h);
  }
});
