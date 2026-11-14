import { useState } from 'react';
import { signEligibility } from '../lib/payTx.js';
import { getPendingStorage, loadPendingFor, signAndReport, submitReport } from '../lib/signFlow.js';
import { useStore } from '../state/DataStore.jsx';
import { useWallet } from '../state/Wallet.jsx';
import Button from './ui/Button.jsx';
import { AccountId, Amount } from './ui/Display.jsx';

// Pay an APPROVED request from the connected NEAR Testnet wallet, then show what the BACKEND says.
// This panel never marks anything EXECUTED: the status badge comes from the backend's response.

const storage = getPendingStorage();

const TONE = Object.freeze({
  success: 'bg-green-50 text-green-900',
  warning: 'bg-amber-50 text-amber-900',
  danger: 'bg-red-50 text-red-900',
  neutral: 'bg-surface text-ink',
});

export default function SignPanel({ request, agent }) {
  const wallet = useWallet();
  const { isLive, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(() => loadPendingFor(storage, request.id));

  const approved = request.status === 'APPROVED';
  if (!approved && !pending && !result) return null;

  const eligibility = signEligibility({ payment: request, agent, accountId: wallet.accountId, isLive });
  const reportTx = actions.reportTransaction;

  const settle = (r) => {
    setResult(r);
    setPending(loadPendingFor(storage, request.id));
    // The backend refused outright: re-read the payment so the status shown is the backend's.
    if (!r.ok && r.stage === 'report' && !r.retryable) actions.loadPayment(request.id);
    setBusy(false);
  };

  const sign = async () => {
    setBusy(true);
    settle(
      await signAndReport({
        payment: request,
        agent,
        accountId: wallet.accountId,
        isLive,
        signTransfer: wallet.signTransfer,
        reportTx,
        storage,
      }),
    );
  };

  const retry = async () => {
    if (!pending) return;
    setBusy(true);
    settle(await submitReport({ requestId: request.id, ...pending, reportTx, storage }));
  };

  const view = result?.ok ? result.view : null;

  return (
    <section aria-labelledby="req-pay" className="rounded-lg border border-line px-4 py-3">
      <h3 id="req-pay" className="text-sm font-semibold text-ink">Pay with your NEAR wallet (Testnet)</h3>

      {approved && !pending ? (
        <>
          <p className="mt-1 text-sm text-ink-muted">
            This sends exactly the approved amount to the approved recipient. Your wallet asks you to confirm; this app
            never sees your keys or seed phrase.
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex flex-wrap gap-x-2"><dt className="text-ink-muted">Send</dt><dd><Amount yocto={request.amount} className="font-semibold" /></dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-ink-muted">To</dt><dd><AccountId value={request.recipient} /></dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-ink-muted">From</dt><dd>{agent ? <AccountId value={agent.sourceAccount} /> : 'Unknown'}</dd></div>
          </dl>
          {!eligibility.ok ? <p className="mt-2 text-sm text-ink-muted" role="status">{eligibility.message}</p> : null}
          {wallet.error ? <p className="mt-2 text-sm text-red-800" role="status">{wallet.error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {wallet.status !== 'connected' ? (
              <Button onClick={wallet.connect} disabled={wallet.status === 'connecting'}>Connect wallet</Button>
            ) : null}
            <Button variant="primary" onClick={sign} disabled={!eligibility.ok || busy}>
              {busy ? 'Waiting for wallet…' : 'Sign and send'}
            </Button>
          </div>
        </>
      ) : null}

      {pending ? (
        <div className="mt-2 text-sm">
          <p className="text-ink-muted">
            A transaction was sent from this browser for this request. Its hash is below; do not send it again.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-ink">{pending.txHash}</p>
          {!view || view.retry ? (
            <div className="mt-3">
              <Button onClick={retry} disabled={busy}>{busy ? 'Checking…' : 'Report to backend / re-check'}</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className={`mt-3 rounded-md px-3 py-2 text-sm ${TONE[view?.tone ?? (result.kind === 'rejected' ? 'neutral' : 'warning')]}`} role="status">
          {view ? (
            <>
              <p className="font-semibold">{view.title}</p>
              {view.detail ? <p className="mt-0.5">{view.detail}</p> : null}
              <p className="mt-0.5">Backend status: <strong>{result.payment?.status ?? 'unknown'}</strong></p>
            </>
          ) : (
            <>
              <p>{result.message}</p>
              {result.detail ? <p className="mt-1 break-words font-mono text-xs opacity-80">Wallet said: {result.detail}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
