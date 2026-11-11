import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Per-viewer display settings.
// - timeZone is remembered in this browser's localStorage (a convenience only;
//   every read/write is wrapped because storage can be blocked or empty).
// - previewState is a demo tool for reviewing loading/empty/error layouts. It
//   is never persisted.

const TZ_KEY = 'spendguard.ui.timeZone';

function readTimeZone() {
  try {
    const v = window.localStorage.getItem(TZ_KEY);
    return v === 'utc' ? 'utc' : 'local';
  } catch {
    return 'local';
  }
}

function writeTimeZone(value) {
  try {
    window.localStorage.setItem(TZ_KEY, value);
  } catch {
    /* storage unavailable: setting still applies for this session */
  }
}

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [timeZone, setTimeZoneState] = useState(readTimeZone);
  const [previewState, setPreviewState] = useState('normal');

  const setTimeZone = useCallback((value) => {
    const next = value === 'utc' ? 'utc' : 'local';
    setTimeZoneState(next);
    writeTimeZone(next);
  }, []);

  const value = useMemo(
    () => ({ timeZone, setTimeZone, previewState, setPreviewState }),
    [timeZone, setTimeZone, previewState],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
