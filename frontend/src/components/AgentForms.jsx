import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { yoctoToNear } from '../lib/money.js';
import { validateAgentForm, validateLimits } from '../lib/validation.js';
import { useDemoStore } from '../state/DemoStore.jsx';
import { useToast } from '../state/Toasts.jsx';
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
  const { actions } = useDemoStore();
  const notify = useToast();
  const navigate = useNavigate();
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
    const id = actions.createAgent(result.value);
    if (!id) {
      notify('The demo agent could not be created.', 'error');
      return;
    }
    notify(`Demo agent "${result.value.name}" created. Nothing was sent to a backend.`);
    onClose();
    navigate(`/agents/${id}`);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New agent"
      description="Demo only: this adds a sample agent in your browser session."
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="agent-form" className="w-full sm:w-auto">
            Create demo agent
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
        <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
          Agent API keys are created and shown once by the backend. This app never displays or
          stores API keys.
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
  const { actions } = useDemoStore();
  const notify = useToast();
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
    if (actions.updateLimits(agent.id, result.value)) {
      notify('Demo limits updated.');
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit limits"
      description={`${agent.name}: demo only, changes stay in this browser session.`}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="limits-form" className="w-full sm:w-auto">
            Save limits
          </Button>
        </>
      }
    >
      <form id="limits-form" onSubmit={submit} noValidate className="space-y-4">
        <LimitFields values={values} errors={errors} set={set} />
      </form>
    </Modal>
  );
}

export function EditLimitsModal({ agent, open, onClose }) {
  return open && agent ? <LimitsForm agent={agent} onClose={onClose} /> : null;
}
