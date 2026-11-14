import { useState } from 'react';
import { validateComment } from '../lib/validation.js';
import { useStore } from '../state/DataStore.jsx';
import { useToast } from '../state/Toasts.jsx';
import { useSubmit } from './useSubmit.jsx';
import { reasonLabel } from '../lib/reasons.js';
import Button from './ui/Button.jsx';
import { AccountId, Amount } from './ui/Display.jsx';
import { TextAreaField } from './ui/Field.jsx';
import Modal from './ui/Modal.jsx';

function DecisionForm({ request, decision, onClose }) {
  const { actions, agentsById, isLive } = useStore();
  const notify = useToast();
  const { busy, serverError, run, fail } = useSubmit();
  const [refusal, setRefusal] = useState([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const approve = decision === 'APPROVE';
  const agent = agentsById[request.agentId];

  function submit(e) {
    e.preventDefault();
    const result = validateComment(comment);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    return run(async () => {
      const r = await actions.decideApproval(request.id, decision, result.value);
      if (!r.ok) {
        // Stay open so the owner can read why (e.g. the policy no longer passes).
        setRefusal(r.refusalReasons ?? []);
        fail(r.error);
        return;
      }
      notify(
        approve
          ? isLive
            ? 'Approved. Nothing has been paid yet: the transfer still needs to be signed in a wallet.'
            : 'Demo request marked Approved. Nothing was sent to a wallet or the network.'
          : isLive
            ? 'Request rejected.'
            : 'Demo request marked Rejected.',
      );
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={approve ? 'Approve this payment?' : 'Reject this payment?'}
      description={isLive ? 'This records your decision on the AMANA Guard backend.' : 'Demo only: this changes a sample record in your browser session.'}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            type="submit"
            form="decision-form"
            variant={approve ? 'success' : 'danger'}
            className="w-full sm:w-auto"
            disabled={busy}
          >
            {busy ? 'Saving…' : `${approve ? 'Approve' : 'Reject'}${isLive ? '' : ' (demo)'}`}
          </Button>
        </>
      }
    >
      <form id="decision-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="rounded-lg bg-surface px-4 py-3 text-sm">
          <p className="font-semibold text-ink">
            <Amount yocto={request.amount} /> from {agent ? agent.name : 'unknown agent'}
          </p>
          <p className="mt-1 text-ink-muted">
            to <AccountId value={request.recipient} />
          </p>
        </div>
        <p className="text-sm text-ink-muted">
          {approve
            ? isLive
              ? 'Approving makes the backend re-check the policy against current limits and budget. It does not move money: the transfer is signed in your own wallet, and a payment only becomes Executed after it is verified on-chain.'
              : 'In the real product, approving makes the backend re-check the policy against current limits and budget. You then sign the transfer in your own wallet, and the payment only becomes Executed after it is verified on-chain. None of that happens in this demo.'
            : 'Rejecting closes the request. The agent is told it was not approved.'}
        </p>
        <TextAreaField
          label="Comment"
          optional
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError(null);
          }}
          error={error}
        />
        {serverError ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            <p>{serverError}</p>
            {refusal.length > 0 ? (
              <ul className="list-disc pl-5">
                {refusal.map((code) => (
                  <li key={code}>{reasonLabel(code)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

/** `decision` is 'APPROVE' | 'REJECT'. Rendered only while a request is selected. */
export default function DecisionModal({ request, decision, onClose }) {
  return request && decision ? (
    <DecisionForm request={request} decision={decision} onClose={onClose} />
  ) : null;
}
