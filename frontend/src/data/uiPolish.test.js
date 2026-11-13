import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('buttons keep 44px touch targets on phones', () => {
  const b = read('../components/ui/Button.jsx');
  assert.match(b, /md: 'min-h-11 /);
  assert.match(b, /sm: 'min-h-10 /);
});

test('demo labelling is untouched: DemoTag and sidebar still show demo/live state', () => {
  assert.match(read('../components/ui/Card.jsx'), /if \(isLive\) return null/);
  assert.match(read('../components/ui/Card.jsx'), />\s*Demo\s*</);
  assert.match(read('../layout/Sidebar.jsx'), /Sample data only\. Not connected to a backend\./);
});

test('navigation still renders from the shared nav items', () => {
  assert.match(read('../layout/Sidebar.jsx'), /NAV_ITEMS\.map/);
  assert.match(read('../layout/MobileNav.jsx'), /TAB_ITEMS\.map/);
});

test('landing preview is labelled Demo', () => {
  assert.match(read('../pages/LandingPage.jsx'), /Demo\s*<\/span>/);
});

test('design tokens define the shadows the UI uses', () => {
  const css = read('../index.css');
  assert.match(css, /--shadow-card:/);
  assert.match(css, /--shadow-pop:/);
});

test('header keeps both the Live and Demo status banners with their original text', () => {
  const h = read('../layout/Header.jsx');
  assert.match(h, /Demo mode: sample data only\. Not connected to the backend or NEAR Testnet\./);
  assert.match(h, /Live: connected to \{connection\.baseUrl/);
  assert.match(h, /Payments are signed in your NEAR Testnet wallet and verified by the backend\./);
});

test('shared display helpers keep their accessibility roles', () => {
  const d = read('../components/ui/Display.jsx');
  assert.match(d, /role="progressbar"/);
  assert.match(d, /aria-valuenow=\{percent\}/);
});
