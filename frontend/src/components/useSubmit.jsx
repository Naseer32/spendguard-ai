import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Busy + server-error state for async form submits. `run(fn)` ignores a second
 * submit while one is running, and never sets state after the form unmounted.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);
  const alive = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (fn) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setServerError(null);
    try {
      return await fn();
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const fail = useCallback((message) => {
    if (alive.current) setServerError(message);
  }, []);

  return { busy, serverError, run, fail, clearError: () => setServerError(null) };
}

/** Error returned by the backend (or the network), shown above the form's buttons. */
export function FormError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
      {message}
    </p>
  );
}
