import { useState } from 'react';
import Button from './ui/Button.jsx';
import Modal from './ui/Modal.jsx';

/**
 * Shows an agent API key ONCE. The backend never returns it again, and this app
 * never stores it: it lives only in this component's props until Done is pressed.
 * Cannot be dismissed by Escape or a backdrop tap, so it is not lost by accident.
 */
export default function ApiKeyDialog({ apiKey, agentName, rotated = false, onDone }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the key can still be selected by hand
    }
  }

  return (
    <Modal
      open
      dismissible={false}
      onClose={() => {}}
      title={rotated ? 'New API key' : 'Agent created: save its API key'}
      description={`${agentName}: shown once. AMANA Guard cannot show it again.`}
      footer={
        <Button variant="primary" className="w-full sm:w-auto" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
          Copy this key into your agent&apos;s secret store now. Anyone with it can submit payment
          requests as this agent
          {rotated ? ', and the previous key has stopped working' : ''}.
        </p>
        <div>
          <label htmlFor="new-api-key" className="text-sm font-medium text-ink">
            API key
          </label>
          <input
            id="new-api-key"
            readOnly
            value={apiKey}
            onFocus={(e) => e.target.select()}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
          />
          <Button className="mt-2 w-full sm:w-auto" onClick={copy}>
            {copied ? 'Copied' : 'Copy key'}
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          I have saved this key somewhere safe.
        </label>
      </div>
    </Modal>
  );
}
