import { useState } from 'react';
import { validateComment } from '../lib/validation.js';
import { useDemoStore } from '../state/DemoStore.jsx';
import { useToast } from '../state/Toasts.jsx';
import Button from './ui/Button.jsx';
import { AccountId, Amount } from './ui/Display.jsx';
import { TextAreaField } from './ui/Field.jsx';
import Modal from './ui/Modal.jsx';

function DecisionForm({ request, decision, onClose }) {
  const { actions, agentsById } = useDemoStore();
  const notify = useToast();
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
    if (actions.decideApproval(request.id, decision, result.value)) {
      notify(
        approve
          ? 'Demo request marked Approved. Nothing was sent to a wallet or the network.'
          : 'Demo request marked Rejected.',
      );
    } else {
      notify('That request can no longer be decided.', 'error');
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={approve ? 'Approve this payment?' : 'Reject this payment?'}
      description="Demo only: this changes a sample record in your browser session."
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="decision-form"
            variant={approve ? 'success' : 'danger'}
            className="w-full sm:w-auto"
          >
            {approve ? 'Approve (demo)' : 'Reject (demo)'}
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
            ? 'In the real product, approving makes the backend re-check the policy against current limits and budget. You then sign the transfer in your own wallet, and the payment only becomes Executed after it is verified on-chain. None of that happens in this demo.'
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
