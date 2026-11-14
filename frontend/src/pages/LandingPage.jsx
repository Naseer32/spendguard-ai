import { Link } from 'react-router-dom';
import Brand from '../layout/Brand.jsx';
import {
  ActivityIcon,
  AlertIcon,
  ApprovalsIcon,
  CheckIcon,
  ChevronRightIcon,
  PaymentsIcon,
  ShieldIcon,
} from '../components/ui/Icons.jsx';
import {
  DASHBOARD_ROUTE,
  FAQ,
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
      className={`inline-flex min-h-12 items-center justify-center rounded-full px-7 text-[15px] font-semibold transition-colors active:translate-y-px ${
        light ? 'bg-white text-ink hover:bg-accent-50' : 'bg-ink text-white shadow-card hover:bg-ink-soft'
      } ${className}`}
    >
      {HERO.cta}
    </Link>
  );
}

function Section({ id, eyebrow, title, lead, children, tone = 'white' }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={tone === 'surface' ? 'border-y border-line bg-surface' : 'bg-white'}
    >
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">{eyebrow}</p>
            <h2
              id={`${id}-title`}
              className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl"
            >
              {title}
            </h2>
          </div>
          {lead ? (
            <p className="text-base leading-relaxed text-ink-muted lg:col-span-5 lg:pt-8 lg:text-lg">{lead}</p>
          ) : null}
        </div>
        <div className="mt-10 sm:mt-14">{children}</div>
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
          <li key={item.title} className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-7">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset ${
                danger ? 'bg-danger-50 text-danger-600 ring-danger-200' : 'bg-accent-50 text-accent-600 ring-accent-100'
              }`}
            >
              <Ic className="h-5 w-5" />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink">{item.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{item.body}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <Brand />
          <Link
            to={DASHBOARD_ROUTE}
            className="inline-flex min-h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-soft"
          >
            Open dashboard
          </Link>
        </div>
      </header>

      <main>
        {/* 1. Hero */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-accent-100/70 via-accent-50/60 to-white" />
          <div aria-hidden="true" className="landing-grid absolute inset-0 opacity-60" />
          <div aria-hidden="true" className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-accent-600/15 blur-3xl" />
          <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-16 text-center sm:px-6 sm:pb-28 sm:pt-28 lg:px-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-accent-700 shadow-card">
              <ShieldIcon className="h-4 w-4" />
              Spending controls for AI agents on NEAR
            </span>
            <h1
              id="hero-title"
              className="mx-auto mt-7 max-w-4xl text-[42px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-7xl"
            >
              {HERO.title}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-xl">
              {HERO.subtitle}
            </p>
            <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CtaLink />
              <a
                href="#how-it-works"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/90 px-7 text-[15px] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-white"
              >
                See how it works
              </a>
            </div>
            <ul className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-ink-soft">
              {['NEAR Testnet', 'Deterministic rules', 'Human approval'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 ring-1 ring-inset ring-line">
                  <CheckIcon className="h-3.5 w-3.5 text-success-600" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 2. Problem */}
        <Section id="problem" eyebrow="The problem" title="Agents that can spend need limits." lead="Giving an AI agent access to funds is easy. Keeping it inside the rules you intended is the hard part.">
          <FeatureGrid items={PROBLEMS} icons={PROBLEM_ICONS} danger />
        </Section>

        {/* 3. Solution */}
        <Section id="solution" eyebrow="The solution" title="You set the rules. SpendGuard enforces them." lead="Every payment request passes through your policy before any money can move." tone="surface">
          <FeatureGrid items={SOLUTIONS} icons={SOLUTION_ICONS} />
        </Section>

        {/* 4. How it works */}
        <Section id="how-it-works" eyebrow="How it works" title="Four steps from request to proof.">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.label} className="relative rounded-3xl border border-line bg-white p-6 shadow-card">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.label}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 5. Product preview: the real Overview page, scaled and non-interactive */}
        <Section id="preview" eyebrow="Product preview" title="The dashboard you will use." lead={PREVIEW_NOTE} tone="surface">
          <div className="rounded-3xl border border-line bg-white p-2 shadow-pop sm:p-3">
            <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1.5">
              <div aria-hidden="true" className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-success-200" />
              </div>
              <p className="truncate text-xs font-medium text-ink-muted">SpendGuard AI &middot; Overview</p>
              <span className="rounded-md bg-warning-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-700 ring-1 ring-inset ring-warning-200">
                Demo
              </span>
            </div>
            <div
              className="relative h-[280px] overflow-hidden rounded-2xl border border-line sm:h-[440px] lg:h-[680px]"
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
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />
            </div>
          </div>
        </Section>

        {/* 6. Security */}
        <Section id="security" eyebrow="Security" title="Proof you can check, not promises." lead="Payments are verified against NEAR Testnet, and the audit trail is built so edits to history show.">
          <ul className="grid gap-4 md:grid-cols-2">
            {SECURITY.map((s) => (
              <li key={s.title} className="flex gap-4 rounded-3xl border border-line bg-white p-6 shadow-card sm:p-7">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-700 ring-1 ring-inset ring-success-200">
                  <CheckIcon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* FAQ */}
        <Section id="faq" eyebrow="FAQ" title="Questions, answered plainly." tone="surface">
          <div className="mx-auto max-w-3xl divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-card">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4 sm:px-6">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
                </summary>
                <p className="pb-2 pt-1 text-[15px] leading-relaxed text-ink-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* 7. Final CTA */}
        <section aria-labelledby="cta-title" className="bg-white px-5 pb-16 pt-4 sm:px-6 sm:pb-24 lg:px-8">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-center sm:px-10 sm:py-20">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(50%_100%_at_50%_0%,rgb(47_99_208/0.5),transparent)]" />
            <div className="relative">
              <h2 id="cta-title" className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-5xl">
                See SpendGuard AI in action.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-white/70 sm:text-lg">
                Explore the dashboard on NEAR Testnet with sample data.
              </p>
              <CtaLink light className="mt-8 w-full sm:w-auto" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white px-5 py-8 text-center text-xs text-ink-muted">
        SpendGuard AI &middot; Built for the NEAR Hackathon &middot; Testnet only
      </footer>
    </div>
  );
}
