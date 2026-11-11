import { useState } from 'react';
import { validateRecipientForm } from '../lib/validation.js';
import { useDemoStore } from '../state/DemoStore.jsx';
import { useToast } from '../state/Toasts.jsx';
import Button from './ui/Button.jsx';
import { SelectField, TextAreaField, TextField } from './ui/Field.jsx';
import Modal from './ui/Modal.jsx';

function RecipientForm({ agent, onClose }) {
  const { actions } = useDemoStore();
  const notify = useToast();
  const [values, setValues] = useState({ accountId: '', listType: 'ALLOW', note: '' });
  const [errors, setErrors] = useState({});

  const set = (field, value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  function submit(e) {
    e.preventDefault();
    const result = validateRecipientForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (actions.setRecipient(agent.id, result.value)) {
      notify(`${result.value.accountId} saved to the ${result.value.listType === 'ALLOW' ? 'allow' : 'block'} list (demo).`);
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add recipient"
      description={`${agent.name}: demo only. Adding an existing account moves it to the chosen list.`}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="recipient-form" className="w-full sm:w-auto">
            Save recipient
          </Button>
        </>
      }
    >
      <form id="recipient-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="NEAR account ID"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={values.accountId}
          onChange={(e) => set('accountId', e.target.value)}
          error={errors.accountId}
          hint="Lowercase letters, digits, and - _ . only."
        />
        <SelectField
          label="List"
          value={values.listType}
          onChange={(e) => set('listType', e.target.value)}
          error={errors.listType}
          hint="Allowed recipients can be paid within limits. Blocked recipients are always refused."
        >
          <option value="ALLOW">Allow list</option>
          <option value="BLOCK">Block list</option>
        </SelectField>
        <TextAreaField
          label="Note"
          optional
          value={values.note}
          onChange={(e) => set('note', e.target.value)}
          error={errors.note}
        />
      </form>
    </Modal>
  );
}

export default function RecipientModal({ agent, open, onClose }) {
  return open && agent ? <RecipientForm agent={agent} onClose={onClose} /> : null;
}
