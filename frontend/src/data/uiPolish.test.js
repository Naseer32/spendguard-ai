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
