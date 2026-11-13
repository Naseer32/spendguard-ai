import { useState } from 'react';
import { Card, CardBody, CardHeader } from './ui/Card.jsx';
import Button from './ui/Button.jsx';
import { TextField } from './ui/Field.jsx';
import { FormError } from './useSubmit.jsx';
import { useStore } from '../state/DataStore.jsx';
import { useToast } from '../state/Toasts.jsx';

/**
 * Connect to a SpendGuard backend. The app starts in demo mode and stays there
 * until the backend accepts the address and owner token typed here.
 *
 * The token is a password field, is held in memory only, is cleared on
 * Disconnect, and is never saved, shown again or sent anywhere except as the
 * Authorization header of requests to the address entered.
 */
export default function ConnectionCard() {
  const { isLive, connection, connect, disconnect, refresh, status } = useStore();
  const notify = useToast();
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const connecting = connection.status === 'connecting';

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const r = await connect({ baseUrl, token });
    setToken(''); // never keep the secret in the form once it has been used
    if (!r.ok) {
      if (r.field === 'baseUrl' || r.field === 'token') setErrors({ [r.field]: r.error });
      else setFormError(r.error);
      return;
    }
    notify('Connected. Showing live data from your backend.');
  }

  return (
    <Card aria-labelledby="set-backend" className="xl:col-span-2">
      <CardHeader
        id="set-backend"
        title="Backend connection"
        description={
          isLive
            ? 'Showing live data from your SpendGuard backend.'
            : 'The app is in demo mode. Connect to your backend to see real agents and payment requests.'
        }
      />
      <CardBody>
        {isLive ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Connected to <strong className="font-semibold">{connection.baseUrl || 'this server (same origin)'}</strong>.
              The owner token is held in this tab&apos;s memory only and is dropped when you disconnect or close the tab.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={refresh} disabled={status.refreshing}>
                {status.refreshing ? 'Refreshing…' : 'Refresh data'}
              </Button>
              <Button
                variant="danger-outline"
                onClick={() => {
                  disconnect();
                  notify('Disconnected. Back in demo mode.', 'info');
                }}
              >
                Disconnect
              </Button>
            </div>
            {status.error ? <FormError message={status.error} /> : null}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
            <TextField
              label="Backend address"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="http://localhost:3000"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              error={errors.baseUrl}
              hint="Just the server address, no path. Leave empty if this page is served by, or proxied to, the backend."
            />
            <TextField
              label="Owner token"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              error={errors.token}
              hint="The backend's OWNER_TOKEN. Kept in memory only: never saved, never shown again."
            />
            <FormError message={formError ?? connection.error} />
            <Button type="submit" variant="primary" disabled={connecting} className="w-full sm:w-auto">
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
