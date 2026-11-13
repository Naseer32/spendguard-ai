import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASHBOARD_ROUTE,
  HERO,
  LANDING_ROUTE,
  PREVIEW_NOTE,
  PROBLEMS,
  SECURITY,
  SOLUTIONS,
  STEPS,
} from './landingContent.js';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../pages/LandingPage.jsx', import.meta.url), 'utf8');

test('hero uses the required headline and CTA label', () => {
  assert.equal(HERO.title, 'Secure every payment made by your AI agents.');
  assert.equal(HERO.cta, 'Open Live Demo');
});

test('how it works is Evaluate, Approve, Sign, Verify in order', () => {
  assert.deepEqual(STEPS.map((s) => s.label), ['Evaluate', 'Approve', 'Sign', 'Verify']);
});

test('problem, solution and security sections have the agreed items', () => {
  assert.equal(PROBLEMS.length, 3);
  assert.deepEqual(SOLUTIONS.map((s) => s.title), [
    'Deterministic policy engine',
    'Spending limits',
    'Human approval',
  ]);
  assert.equal(SECURITY.length, 2);
});

test('copy makes no unverifiable security claims', () => {
  const text = JSON.stringify({ HERO, PROBLEMS, SOLUTIONS, STEPS, SECURITY, PREVIEW_NOTE }).toLowerCase();
  for (const banned of ['audited', 'bank-grade', 'military', 'unhackable', '100%', 'guarantee', 'mainnet', 'insured']) {
    assert.ok(!text.includes(banned), `banned claim: ${banned}`);
  }
});

test('landing is a separate route and the dashboard routes are intact', () => {
  assert.equal(LANDING_ROUTE, '/landing');
  assert.equal(DASHBOARD_ROUTE, '/');
  assert.match(app, /path="landing"/);
  // landing sits outside the dashboard layout route
  assert.ok(app.indexOf('path="landing"') < app.indexOf('<Route element={<AppLayout />}>'));
  assert.match(app, /<Route index element={<OverviewPage \/>} \/>/);
  for (const p of ['agents', 'agents/:agentId', 'payment-requests', 'approvals', 'activity', 'settings']) {
    assert.ok(app.includes(`path="${p}"`), `missing dashboard route ${p}`);
  }
});

test('landing page CTA links to the dashboard route and embeds the real Overview page', () => {
  assert.match(page, /DASHBOARD_ROUTE/);
  assert.match(page, /import OverviewPage from '\.\/OverviewPage\.jsx'/);
  assert.match(page, /<OverviewPage \/>/);
});

test('preview gets its own demo-mode store so it never shows live data', () => {
  assert.match(page, /import \{ DataStoreProvider \} from '\.\.\/state\/DataStore\.jsx'/);
  assert.match(page, /<DataStoreProvider>\s*<OverviewPage \/>\s*<\/DataStoreProvider>/);
});
