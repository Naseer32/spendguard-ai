import { useEffect, useRef, useState } from 'react';
import Button from './Button.jsx';
import Modal from './Modal.jsx';

/** Confirm/cancel dialog for actions that change demo state. */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onClose,
  children,
}) {
  // onConfirm may be async (live backend calls): block repeat clicks until it settles.
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button className="w-full sm:w-auto" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="w-full sm:w-auto"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
