import { useState } from 'react';
import { newIdempotencyKey, validatePaymentRequest } from '../lib/paymentRequest.js';
import { useStore } from '../state/DataStore.jsx';
import { FormError, useSubmit } from './useSubmit.jsx';
import Button from './ui/Button.jsx';
import { TextField } from './ui/Field.jsx';
import Modal from './ui/Modal.jsx';

// Acts as the AGENT for one payment: the owner types the agent's API key, SpendGuard evaluates the request,
// and the new request opens so it can be approved and paid from the wallet. The key lives in this form's
// state only. It is cleared when the form closes and is never stored or logged.

function Form({ agent, onClose, onCreated }) {
  const { actions } = useStore();
  const { busy, serverError, run, fail } = useSubmit();
  const [values, setValues] = useState({ recipient: '', amount: '', purpose: '', agentKey: '' });
  const [errors, setErrors] = useState({});

  const set = (field, value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  function submit(e) {
    e.preventDefault();
    const result = validatePaymentRequest(values, agent);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const { agentKey, ...input } = result.value;
    return run(async () => {
      const r = await actions.requestPayment(agentKey, { idempotencyKey: newIdempotencyKey(), ...input });
      if (!r.ok) {
        fail(r.error);
        return;
      }
      setValues((v) => ({ ...v, agentKey: '' })); // drop the key from memory
      onCreated(r.id);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Request a payment"
      description={`Ask SpendGuard to evaluate a payment as ${agent.name}. The decision comes from your limits and recipient lists.`}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="request-payment-form" className="w-full sm:w-auto" disabled={busy}>
            {busy ? 'Evaluating…' : 'Request payment'}
          </Button>
        </>
      }
    >
      <form id="request-payment-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Recipient"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={values.recipient}
          onChange={(e) => set('recipient', e.target.value)}
          error={errors.recipient}
          hint="A NEAR Testnet account, for example bob.testnet."
        />
        <TextField
          label="Amount (NEAR)"
          inputMode="decimal"
          autoComplete="off"
          value={values.amount}
          onChange={(e) => set('amount', e.target.value)}
          error={errors.amount}
        />
        <TextField
          label="Purpose"
          optional
          autoComplete="off"
          value={values.purpose}
          onChange={(e) => set('purpose', e.target.value)}
          error={errors.purpose}
        />
        <TextField
          label="Agent API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={values.agentKey}
          onChange={(e) => set('agentKey', e.target.value)}
          error={errors.agentKey}
          hint="Shown once when the agent was created or its key was rotated. Used for this request only and never stored. Rotate the key if you lost it."
        />
        <FormError message={serverError} />
      </form>
    </Modal>
  );
}

export default function RequestPaymentModal({ agent, open, onClose, onCreated }) {
  return open && agent ? <Form agent={agent} onClose={onClose} onCreated={onCreated} /> : null;
}
