import { useState } from 'react';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import ConnectionCard from '../components/ConnectionCard.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { DetailList } from '../components/ui/Display.jsx';
import { Segmented } from '../components/ui/Filters.jsx';
import { ShieldIcon, WalletIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import { APP_INFO } from '../lib/appInfo.js';
import { formatDateTime } from '../lib/time.js';
import { useStore } from '../state/DataStore.jsx';
import { useSettings } from '../state/Settings.jsx';
import { useToast } from '../state/Toasts.jsx';

function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-surface text-ink-soft ring-line',
    warning: 'bg-warning-50 text-warning-700 ring-warning-200',
    success: 'bg-success-50 text-success-700 ring-success-200',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function SettingsPage() {
  const { timeZone, setTimeZone, previewState, setPreviewState } = useSettings();
  const { actions, isLive, connection } = useStore();
  const notify = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const sample = '2026-11-10T14:05:00Z';

  return (
    <PageContainer title="Settings" description="Connections, display preferences and demo tools.">
      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        <ConnectionCard />

        <Card aria-labelledby="set-connections">
          <CardHeader id="set-connections" title="Connections" description="What this app is connected to right now." />
          <CardBody className="space-y-5">
            <DetailList
              items={[
                {
                  label: 'SpendGuard backend',
                  value: isLive ? (
                    <Pill tone="success">Connected: {connection.baseUrl || 'this server'}</Pill>
                  ) : (
                    <Pill tone="warning">Not connected (demo data)</Pill>
                  ),
                },
                { label: 'Network', value: `${APP_INFO.network} (display only)` },
                { label: 'Wallet', value: <Pill>Not connected</Pill> },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3">
              <WalletIcon className="h-5 w-5 shrink-0 text-ink-muted" />
              <p className="min-w-0 flex-1 text-sm text-ink-muted">
                Connect your NEAR Testnet wallet from the top bar. Payments are signed inside your wallet. SpendGuard never asks for,
                shows or stores private keys or seed phrases.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card aria-labelledby="set-display">
          <CardHeader id="set-display" title="Display" description="Remembered in this browser only." />
          <CardBody className="space-y-3">
            <p className="text-sm font-medium text-ink">Time zone for dates and times</p>
            <Segmented
              label="Time zone"
              value={timeZone}
              onChange={setTimeZone}
              items={[
                { id: 'local', label: 'My local time' },
                { id: 'utc', label: 'UTC' },
              ]}
            />
            <p className="text-xs text-ink-muted">
              Example: {formatDateTime(sample, timeZone)}. Daily budgets always reset at 00:00 UTC.
            </p>
          </CardBody>
        </Card>

        <Card aria-labelledby="set-demo">
          <CardHeader
            id="set-demo"
            title="Demo tools"
            description={isLive ? 'Unavailable while connected to a backend.' : 'Only available in demo mode.'}
          />
          <CardBody className={`space-y-5 ${isLive ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={isLive}>
            <div className="space-y-3">
              <p className="text-sm font-medium text-ink">Preview a page state</p>
              <Segmented
                label="Preview state"
                value={previewState}
                onChange={setPreviewState}
                items={[
                  { id: 'normal', label: 'Normal' },
                  { id: 'loading', label: 'Loading' },
                  { id: 'empty', label: 'Empty' },
                  { id: 'error', label: 'Error' },
                ]}
              />
              <p className="text-xs text-ink-muted">
                Simulates how lists look while loading, with no data, or after a failed request. Open any list page to see it.
              </p>
            </div>
            <div className="border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">Reset demo data</p>
              <p className="mt-1 text-xs text-ink-muted">
                Discards every change made in this session and restores the original samples.
              </p>
              <Button className="mt-3" onClick={() => setConfirmReset(true)}>Reset demo data</Button>
            </div>
          </CardBody>
        </Card>

        <Card aria-labelledby="set-security">
          <CardHeader id="set-security" title="Security" />
          <CardBody>
            <ul className="space-y-3 text-sm text-ink-soft">
              {[
                'Private keys and seed phrases are never requested, shown or stored here.',
                'Agent API keys are issued once by the backend, shown once when created or rotated, and never stored.',
                'The owner token stays in memory: it is never saved to this browser, put in a URL, or shown again.',
                'Policy decisions are made by the backend policy engine; the interface only displays them.',
                'A payment is only shown as Executed after the backend verifies its transaction on-chain.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                  {t}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card aria-labelledby="set-about" className="xl:col-span-2">
          <CardHeader id="set-about" title="About" />
          <CardBody>
            <DetailList
              items={[
                { label: 'Application', value: APP_INFO.name },
                { label: 'Version', value: `${APP_INFO.version} (${APP_INFO.build})` },
                { label: 'Data source', value: isLive ? 'SpendGuard backend (live)' : APP_INFO.dataSource },
                {
                  label: 'Persistence',
                  value: isLive
                    ? 'The backend stores the data. This app keeps only your display settings and the backend address; the owner token is never saved.'
                    : 'None. Reloading the page restores the original demo data.',
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          actions.reset();
          setConfirmReset(false);
          notify('Demo data reset.');
        }}
        title="Reset demo data?"
        description="Demo only."
        confirmLabel="Reset"
        danger
      >
        <p className="text-sm text-ink-muted">All changes you made to agents, recipients and approvals in this session will be lost.</p>
      </ConfirmDialog>
    </PageContainer>
  );
}
