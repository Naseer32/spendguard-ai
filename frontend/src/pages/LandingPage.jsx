import { Link } from 'react-router-dom';
import Brand from '../layout/Brand.jsx';
import { CheckIcon, ShieldIcon } from '../components/ui/Icons.jsx';
import {
  DASHBOARD_ROUTE,
  HERO,
  PREVIEW_NOTE,
  PROBLEMS,
  SECURITY,
  SOLUTIONS,
  STEPS,
} from '../data/landingContent.js';
import { DataStoreProvider } from '../state/DataStore.jsx';
import OverviewPage from './OverviewPage.jsx';

function CtaLink({ className = '' }) {
  return (
    <Link
      to={DASHBOARD_ROUTE}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-accent-600 px-5 text-sm font-medium text-white transition-colors hover:bg-accent-700 ${className}`}
    >
      {HERO.cta}
    </Link>
  );
}

function Section({ id, eyebrow, title, children, tone = 'white' }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={tone === 'surface' ? 'bg-surface' : 'bg-white'}
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-600">{eyebrow}</p>
        <h2
          id={`${id}-title`}
          className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-4xl"
        >
          {title}
        </h2>
        <div className="mt-8 sm:mt-10">{children}</div>
      </div>
    </section>
  );
}

function CardGrid({ items, cols = 'md:grid-cols-3' }) {
  return (
    <ul className={`grid gap-4 ${cols}`}>
      {items.map((item) => (
        <li key={item.title} className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
          <h3 className="text-base font-semibold text-ink">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <Link
            to={DASHBOARD_ROUTE}
            className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-accent-700 hover:bg-accent-50"
          >
            Open dashboard
          </Link>
        </div>
      </header>

      <main>
        {/* 1. Hero */}
        <section aria-labelledby="hero-title" className="bg-gradient-to-b from-accent-50 to-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-12 text-center sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-3 py-1 text-xs font-medium text-accent-700">
              <ShieldIcon className="h-4 w-4" />
              Spending controls for AI agents on NEAR
            </span>
            <h1
              id="hero-title"
              className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl"
            >
              {HERO.title}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
              {HERO.subtitle}
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CtaLink />
              <a
                href="#how-it-works"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:bg-surface"
              >
                See how it works
              </a>
            </div>
          </div>
        </section>

        {/* 2. Problem */}
        <Section id="problem" eyebrow="The problem" title="Agents that can spend need limits.">
          <CardGrid items={PROBLEMS} />
        </Section>

        {/* 3. Solution */}
        <Section id="solution" eyebrow="The solution" title="You set the rules. SpendGuard enforces them." tone="surface">
          <CardGrid items={SOLUTIONS} />
        </Section>

        {/* 4. How it works */}
        <Section id="how-it-works" eyebrow="How it works" title="Four steps from request to proof.">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.label} className="rounded-2xl border border-line bg-white p-5 shadow-card">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-base font-semibold">{s.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 5. Product preview: the real Overview page, scaled and non-interactive */}
        <Section id="preview" eyebrow="Product preview" title="The dashboard you will use." tone="surface">
          <div
            className="relative h-[260px] overflow-hidden rounded-2xl border border-line bg-white shadow-card sm:h-[420px] lg:h-[640px]"
            role="img"
            aria-label="Preview of the SpendGuard AI dashboard overview"
          >
            <div
              inert
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 w-[1100px] origin-top-left scale-[0.31] bg-surface sm:scale-[0.55] lg:scale-100"
            >
              <DataStoreProvider>
                <OverviewPage />
              </DataStoreProvider>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-muted">{PREVIEW_NOTE}</p>
        </Section>

        {/* 6. Security */}
        <Section id="security" eyebrow="Security" title="Proof you can check, not promises.">
          <ul className="grid gap-4 md:grid-cols-2">
            {SECURITY.map((s) => (
              <li key={s.title} className="flex gap-3 rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-700">
                  <CheckIcon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* 7. Final CTA */}
        <section aria-labelledby="cta-title" className="bg-ink">
          <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-20">
            <h2 id="cta-title" className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
              See SpendGuard AI in action.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
              Explore the dashboard on NEAR Testnet with sample data.
            </p>
            <CtaLink className="mt-7" />
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white px-4 py-6 text-center text-xs text-ink-muted">
        SpendGuard AI &middot; Built for the NEAR Hackathon &middot; Testnet only
      </footer>
    </div>
  );
}
