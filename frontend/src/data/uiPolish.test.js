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

test('Inter is actually loaded, and page titles use the larger editorial size', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /family=Inter/);
  assert.match(read('../components/ui/PageContainer.jsx'), /sm:text-4xl/);
});

test('landing FAQ makes no unverifiable claims', async () => {
  const { FAQ } = await import('./landingContent.js');
  assert.ok(FAQ.length >= 3);
  const text = JSON.stringify(FAQ).toLowerCase();
  for (const banned of ['audited', 'bank-grade', 'unhackable', '100%', 'guarantee', 'mainnet', 'insured']) {
    assert.ok(!text.includes(banned), `banned claim: ${banned}`);
  }
});

test('metric cards use the larger numeric treatment', () => {
  const c = read('../components/ui/Card.jsx');
  assert.match(c, /sm:text-4xl/);
  assert.match(c, /<Card className="p-5 sm:p-6">/);
});

test('overview keeps its demo labelling after the visual redesign', () => {
  assert.match(read('../pages/OverviewPage.jsx'), /<DemoBanner \/>/);
  assert.match(read('../components/ui/DemoBanner.jsx'), /Demo data\./);
  assert.match(read('../layout/AppLayout.jsx'), /linear-gradient\(to_bottom/);
});
