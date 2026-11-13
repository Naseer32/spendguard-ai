import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { yoctoToNear } from '../lib/money.js';
import { validateAgentForm, validateLimits } from '../lib/validation.js';
import { useStore } from '../state/DataStore.jsx';
import { useToast } from '../state/Toasts.jsx';
import ApiKeyDialog from './ApiKeyDialog.jsx';
import { FormError, useSubmit } from './useSubmit.jsx';
import Button from './ui/Button.jsx';
import { TextField } from './ui/Field.jsx';
import Modal from './ui/Modal.jsx';

function LimitFields({ values, errors, set }) {
  return (
    <>
      <TextField
        label="Daily budget (NEAR)"
        inputMode="decimal"
        autoComplete="off"
        value={values.dailyBudget}
        onChange={(e) => set('dailyBudget', e.target.value)}
        error={errors.dailyBudget}
        hint="The most this agent may spend per UTC day."
      />
      <TextField
        label="Per-transaction limit (NEAR)"
        inputMode="decimal"
        autoComplete="off"
        value={values.perTxLimit}
        onChange={(e) => set('perTxLimit', e.target.value)}
        error={errors.perTxLimit}
        hint="Larger single payments are blocked. Must not exceed the daily budget."
      />
      <TextField
        label="Approval threshold (NEAR)"
        inputMode="decimal"
        autoComplete="off"
        value={values.approvalThreshold}
        onChange={(e) => set('approvalThreshold', e.target.value)}
        error={errors.approvalThreshold}
        hint="Payments above this need your approval. Must not exceed the per-transaction limit."
      />
    </>
  );
}

function useFormState(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const set = (field, value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };
  return { values, errors, setErrors, set };
}

function NewAgentForm({ onClose }) {
  const { actions, isLive } = useStore();
  const notify = useToast();
  const navigate = useNavigate();
  const { busy, serverError, run, fail } = useSubmit();
  const [issued, setIssued] = useState(null); // { id, apiKey, name }: live mode only, shown once
  const { values, errors, setErrors, set } = useFormState({
    name: '', sourceAccount: '', dailyBudget: '', perTxLimit: '', approvalThreshold: '',
  });

  function submit(e) {
    e.preventDefault();
    const result = validateAgentForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    return run(async () => {
      const r = await actions.createAgent(result.value);
      if (!r.ok) {
        if (r.field) setErrors({ [r.field]: r.error });
        fail(r.error);
        return;
      }
      if (isLive) {
        // The backend returns the agent's API key exactly once. Show it before leaving.
        setIssued({ id: r.id, apiKey: r.apiKey, name: result.value.name });
        return;
      }
      notify(`Demo agent "${result.value.name}" created. Nothing was sent to a backend.`);
      onClose();
      navigate(`/agents/${r.id}`);
    });
  }

  if (issued) {
    return (
      <ApiKeyDialog
        apiKey={issued.apiKey}
        agentName={issued.name}
        onDone={() => {
          const id = issued.id;
          setIssued(null); // drops the key from memory
          onClose();
          navigate(`/agents/${id}`);
        }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New agent"
      description={
        isLive
          ? 'Creates a real agent on your SpendGuard backend.'
          : 'Demo only: this adds a sample agent in your browser session.'
      }
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="agent-form" className="w-full sm:w-auto" disabled={busy}>
            {busy ? 'Creating…' : isLive ? 'Create agent' : 'Create demo agent'}
          </Button>
        </>
      }
    >
      <form id="agent-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Agent name"
          autoComplete="off"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <TextField
          label="Source account"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={values.sourceAccount}
          onChange={(e) => set('sourceAccount', e.target.value)}
          error={errors.sourceAccount}
          hint="The NEAR account the owner will pay from, e.g. my-agent.testnet."
        />
        <LimitFields values={values} errors={errors} set={set} />
        <FormError message={serverError} />
        <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
          {isLive
            ? 'The backend creates the agent\'s API key and shows it once. This app never stores it.'
            : 'Demo agents have no API key. With a live backend, the key is shown once and never stored.'}
        </p>
      </form>
    </Modal>
  );
}

/** Create-agent dialog. Mounted only while open so the form always starts empty. */
export function NewAgentModal({ open, onClose }) {
  return open ? <NewAgentForm onClose={onClose} /> : null;
}

function LimitsForm({ agent, onClose }) {
  const { actions, isLive } = useStore();
  const notify = useToast();
  const { busy, serverError, run, fail } = useSubmit();
  const { values, errors, setErrors, set } = useFormState({
    dailyBudget: yoctoToNear(agent.dailyBudget) ?? '',
    perTxLimit: yoctoToNear(agent.perTxLimit) ?? '',
    approvalThreshold: yoctoToNear(agent.approvalThreshold) ?? '',
  });

  function submit(e) {
    e.preventDefault();
    const result = validateLimits(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    return run(async () => {
      const r = await actions.updateLimits(agent.id, result.value);
      if (!r.ok) {
        if (r.field) setErrors({ [r.field]: r.error });
        fail(r.error);
        return;
      }
      notify(isLive ? 'Limits updated.' : 'Demo limits updated.');
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit limits"
      description={isLive ? agent.name : `${agent.name}: demo only, changes stay in this browser session.`}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="limits-form" className="w-full sm:w-auto" disabled={busy}>
            {busy ? 'Saving…' : 'Save limits'}
          </Button>
        </>
      }
    >
      <form id="limits-form" onSubmit={submit} noValidate className="space-y-4">
        <LimitFields values={values} errors={errors} set={set} />
        <FormError message={serverError} />
      </form>
    </Modal>
  );
}

export function EditLimitsModal({ agent, open, onClose }) {
  return open && agent ? <LimitsForm agent={agent} onClose={onClose} /> : null;
}
