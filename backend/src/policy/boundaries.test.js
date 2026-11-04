// Static guard: the money and policy code must stay pure and deterministic.
//
// It fails the build if a source file in src/money or src/policy
//   - imports anything outside its allowed folders (no db, ai, near, node:*
//     modules or npm packages), or
//   - uses floating point, clock, randomness, I/O or other non-deterministic
//     features.
//
// Comments are ignored. This guards against accidents, not a determined
// attacker, so code review still applies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(import.meta.dirname, '..');
const MONEY_DIR = path.join(SRC_DIR, 'money');
const POLICY_DIR = path.join(SRC_DIR, 'policy');

// Each guarded folder and the folders it may import from.
const GUARDED = [
  { dir: MONEY_DIR, allowed: [MONEY_DIR] },
  { dir: POLICY_DIR, allowed: [POLICY_DIR, MONEY_DIR] },
];

const FORBIDDEN = [
  ['Number()', /\bNumber\s*\(/],
  ['parseFloat', /\bparseFloat\b/],
  ['parseInt', /\bparseInt\b/],
  ['Math', /\bMath\s*\./],
  ['toFixed', /\.toFixed\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date()', /\bnew\s+Date\s*\(\s*\)/],
  ['fetch', /\bfetch\s*\(/],
  ['process', /\bprocess\b/],
  ['require', /\brequire\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['timers', /\b(?:setTimeout|setInterval|setImmediate)\b/],
  ['eval', /\beval\s*\(/],
  ['crypto', /\bcrypto\b/],
  ['performance', /\bperformance\b/],
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function forbiddenIn(source) {
  const code = stripComments(source);
  return FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
}

function importSpecifiers(source) {
  const code = stripComments(source);
  const specs = [];
  const withBindings =
    /^\s*(?:import|export)\s+[\w*{}\s,$]+?\s+from\s+['"]([^'"]+)['"]/gm;
  const sideEffect = /^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const re of [withBindings, sideEffect]) {
    for (const match of code.matchAll(re)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function isAllowedImport(spec, fromDir, allowedRoots) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return false; // node: modules and npm packages are not allowed
  }
  const target = path.resolve(fromDir, spec);
  return allowedRoots.some((root) => target.startsWith(root + path.sep));
}

function sourceFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => path.join(dir, f))
    .sort();
}

const rel = (file) => path.relative(SRC_DIR, file);

describe('guarded source files', () => {
  it('scans the expected files (the guard cannot pass by scanning nothing)', () => {
    const scanned = GUARDED.flatMap(({ dir }) => sourceFiles(dir)).map(rel);
    for (const expected of [
      path.join('money', 'yocto.js'),
      path.join('policy', 'reasonCodes.js'),
      path.join('policy', 'engine.js'),
      path.join('policy', 'budget.js'),
      path.join('policy', 'lifecycle.js'),
    ]) {
      assert.ok(scanned.includes(expected), `not scanned: ${expected}`);
    }
  });

  it('uses no floating point, clock, randomness or I/O', () => {
    const violations = [];
    for (const { dir } of GUARDED) {
      for (const file of sourceFiles(dir)) {
        const found = forbiddenIn(fs.readFileSync(file, 'utf8'));
        for (const name of found) violations.push(`${rel(file)}: ${name}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it('imports only from allowed folders', () => {
    const violations = [];
    for (const { dir, allowed } of GUARDED) {
      for (const file of sourceFiles(dir)) {
        const specs = importSpecifiers(fs.readFileSync(file, 'utf8'));
        for (const spec of specs) {
          if (!isAllowedImport(spec, path.dirname(file), allowed)) {
            violations.push(`${rel(file)}: ${spec}`);
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});

describe('scanner self-test: forbidden patterns', () => {
  const BAD = {
    'Number()': 'const x = Number("1");',
    parseFloat: 'const x = parseFloat("1.5");',
    parseInt: 'const x = parseInt("1", 10);',
    Math: 'const x = Math.max(1, 2);',
    toFixed: 'const s = x.toFixed(2);',
    'Date.now': 'const t = Date.now();',
    'new Date()': 'const d = new Date();',
    fetch: 'await fetch("x");',
    process: 'const e = process.env.KEY;',
    require: 'const fs = require("fs");',
    'dynamic import': 'await import("node:fs");',
    timers: 'setTimeout(() => {}, 1);',
    eval: 'eval("1");',
    crypto: 'const id = crypto.randomUUID();',
    performance: 'const t = performance.now();',
  };

  it('detects every forbidden pattern', () => {
    assert.deepEqual(Object.keys(BAD).sort(), FORBIDDEN.map(([n]) => n).sort());
    for (const [name, snippet] of Object.entries(BAD)) {
      assert.ok(forbiddenIn(snippet).includes(name), name);
    }
  });

  it('allows deterministic code', () => {
    const good = [
      'const d = new Date(ms);',
      'const ok = Number.isSafeInteger(x);',
      'const n = Number.isNaN(x);',
      'const r = evaluatePayment(input);',
      'const done = processed + 1n;',
      'const a = BigInt(1) + 2n;',
    ];
    for (const snippet of good) {
      assert.deepEqual(forbiddenIn(snippet), [], snippet);
    }
  });

  it('ignores comments', () => {
    const source = [
      '// Math.random() and Date.now() are never used here',
      '/* parseFloat, fetch(), process.env */',
      'const a = 1n;',
    ].join('\n');
    assert.deepEqual(forbiddenIn(source), []);
  });
});

describe('scanner self-test: imports', () => {
  it('extracts import and re-export specifiers', () => {
    const source = [
      "import { a } from './x.js';",
      "import b from '../money/y.js';",
      "export * from './z.js';",
      "import './side.js';",
      'import {',
      '  c,',
      '  d,',
      "} from 'node:fs';",
      "export const value = 'from';",
    ].join('\n');
    assert.deepEqual(importSpecifiers(source).sort(), [
      './side.js',
      './x.js',
      './z.js',
      '../money/y.js',
      'node:fs',
    ].sort());
  });

  it('allows policy to import policy and money', () => {
    const allowed = [POLICY_DIR, MONEY_DIR];
    assert.equal(isAllowedImport('./engine.js', POLICY_DIR, allowed), true);
    assert.equal(isAllowedImport('../money/yocto.js', POLICY_DIR, allowed), true);
  });

  it('rejects db, ai, near, node, npm and escaping imports', () => {
    const allowed = [POLICY_DIR, MONEY_DIR];
    const bad = [
      '../db/db.js',
      '../ai/explainer.js',
      '../near/rpc.js',
      '../services/payments.js',
      'node:sqlite',
      'node:fs',
      'express',
      '../money/../db/x.js',
      '../../outside.js',
      '../moneyx/a.js',
    ];
    for (const spec of bad) {
      assert.equal(isAllowedImport(spec, POLICY_DIR, allowed), false, spec);
    }
  });

  it('keeps money a leaf: it may not import policy', () => {
    assert.equal(isAllowedImport('./yocto.js', MONEY_DIR, [MONEY_DIR]), true);
    assert.equal(
      isAllowedImport('../policy/engine.js', MONEY_DIR, [MONEY_DIR]),
      false,
    );
  });
});
