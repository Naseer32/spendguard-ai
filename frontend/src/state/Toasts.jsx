import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckIcon, InfoIcon, XIcon } from '../components/ui/Icons.jsx';

const ToastContext = createContext(null);

const TONES = {
  success: 'border-success-200 bg-white text-ink',
  info: 'border-line bg-white text-ink',
  error: 'border-danger-200 bg-white text-ink',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (message, tone = 'success') => {
      const id = ++counter.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Sits above the mobile tab bar. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${TONES[t.tone] ?? TONES.info}`}
          >
            {t.tone === 'success' ? (
              <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
            ) : (
              <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" />
            )}
            <p className="min-w-0 flex-1">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 rounded p-1 text-ink-muted hover:text-ink"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx.notify;
}
