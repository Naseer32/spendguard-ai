import { Link } from 'react-router-dom';
import Brand from '../layout/Brand.jsx';
import {
  ActivityIcon,
  AlertIcon,
  ApprovalsIcon,
  CheckIcon,
  PaymentsIcon,
  ShieldIcon,
} from '../components/ui/Icons.jsx';
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

const PROBLEM_ICONS = [AlertIcon, PaymentsIcon, ActivityIcon];
const SOLUTION_ICONS = [ShieldIcon, PaymentsIcon, ApprovalsIcon];

function CtaLink({ className = '', light = false }) {
  return (
    <Link
      to={DASHBOARD_ROUTE}
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-sm font-semibold transition-colors active:translate-y-px ${
        light
          ? 'bg-white text-ink hover:bg-accent-50'
          : 'bg-accent-600 text-white shadow-card hover:bg-accent-700'
      } ${className}`}
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
      className={tone === 'surface' ? 'border-y border-line bg-surface' : 'bg-white'}
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-600">{eyebrow}</p>
        <h2
          id={`${id}-title`}
          className="mt-2 max-w-2xl text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-4xl"
        >
          {title}
        </h2>
        <div className="mt-8 sm:mt-10">{children}</div>
      </div>
    </section>
  );
}

function FeatureGrid({ items, icons, danger = false }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((item, i) => {
        const Ic = icons[i];
        return (
          <li key={item.title} className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset ${
                danger ? 'bg-danger-50 text-danger-600 ring-danger-200' : 'bg-accent-50 text-accent-600 ring-accent-100'
              }`}
            >
              <Ic className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-ink">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{item.body}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <Link
            to={DASHBOARD_ROUTE}
            className="inline-flex min-h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-soft"
          >
            Open dashboard
          </Link>
        </div>
      </header>

      <main>
        {/* 1. Hero */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden="true" className="landing-grid absolute inset-0" />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--color-accent-100),transparent)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-12 text-center sm:px-6 sm:pb-24 sm:pt-24 lg:px-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white/90 px-3 py-1 text-xs font-semibold text-accent-700 shadow-card">
              <ShieldIcon className="h-4 w-4" />
              Spending controls for AI agents on NEAR
            </span>
            <h1
              id="hero-title"
              className="mx-auto mt-6 max-w-3xl text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-6xl"
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
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line hover:bg-surface"
              >
                See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-ink-soft">
              {['NEAR Testnet', 'Deterministic rules', 'Human approval'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 ring-1 ring-inset ring-line">
                  <CheckIcon className="h-3.5 w-3.5 text-success-600" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 2. Problem */}
        <Section id="problem" eyebrow="The problem" title="Agents that can spend need limits.">
          <FeatureGrid items={PROBLEMS} icons={PROBLEM_ICONS} danger />
        </Section>

        {/* 3. Solution */}
        <Section id="solution" eyebrow="The solution" title="You set the rules. SpendGuard enforces them." tone="surface">
          <FeatureGrid items={SOLUTIONS} icons={SOLUTION_ICONS} />
        </Section>

        {/* 4. How it works */}
        <Section id="how-it-works" eyebrow="How it works" title="Four steps from request to proof.">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.label} className="rounded-2xl border border-line bg-white p-5 shadow-card">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold">{s.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 5. Product preview: the real Overview page, scaled and non-interactive */}
        <Section id="preview" eyebrow="Product preview" title="The dashboard you will use." tone="surface">
          <div className="rounded-2xl border border-line bg-white p-1.5 shadow-pop sm:p-2">
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
              <div aria-hidden="true" className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-surface-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-surface-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-surface-strong" />
              </div>
              <p className="truncate text-xs font-medium text-ink-muted">SpendGuard AI &middot; Overview</p>
              <span className="rounded-md bg-warning-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-700 ring-1 ring-inset ring-warning-200">
                Demo
              </span>
            </div>
            <div
              className="relative h-[260px] overflow-hidden rounded-xl border border-line sm:h-[420px] lg:h-[640px]"
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
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
            </div>
          </div>
          <p className="mt-4 text-sm text-ink-muted">{PREVIEW_NOTE}</p>
        </Section>

        {/* 6. Security */}
        <Section id="security" eyebrow="Security" title="Proof you can check, not promises.">
          <ul className="grid gap-4 md:grid-cols-2">
            {SECURITY.map((s) => (
              <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-700 ring-1 ring-inset ring-success-200">
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
        <section aria-labelledby="cta-title" className="bg-white px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-ink px-5 py-12 text-center sm:px-10 sm:py-16">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(50%_100%_at_50%_0%,rgb(47_99_208/0.45),transparent)]" />
            <div className="relative">
              <h2 id="cta-title" className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                See SpendGuard AI in action.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
                Explore the dashboard on NEAR Testnet with sample data.
              </p>
              <CtaLink light className="mt-7 w-full sm:w-auto" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white px-4 py-6 text-center text-xs text-ink-muted">
        SpendGuard AI &middot; Built for the NEAR Hackathon &middot; Testnet only
      </footer>
    </div>
  );
}
