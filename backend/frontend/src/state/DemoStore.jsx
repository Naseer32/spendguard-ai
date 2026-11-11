import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createDemoState } from '../data/demoSeed.js';
import { reducer } from './reducer.js';

// DEMO STORE. Holds the in-memory demo records and exposes the actions the
// pages use. When the real backend is integrated, this is the seam to replace:
// pages only talk to `useDemoStore()`, never to the demo seed directly.
//
// Nothing here is persisted: a page reload restores the original demo data.

const StoreContext = createContext(null);

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const nowIso = () => new Date().toISOString();

export function DemoStoreProvider({ children, initialState }) {
  const [state, setState] = useState(() => initialState ?? createDemoState());
  const ref = useRef(state);

  const apply = useCallback((action) => {
    const next = reducer(ref.current, action);
    if (next === ref.current) return false;
    ref.current = next;
    setState(next);
    return true;
  }, []);

  const actions = useMemo(
    () => ({
      /** @returns {string|null} the new agent id */
      createAgent(values) {
        const id = newId('demo-agent');
        return apply({ type: 'agent/create', id, now: nowIso(), values }) ? id : null;
      },
      updateLimits: (agentId, values) =>
        apply({ type: 'agent/updateLimits', agentId, now: nowIso(), values }),
      setAgentStatus: (agentId, status) =>
        apply({ type: 'agent/setStatus', agentId, status, now: nowIso() }),
      setRecipient: (agentId, values) =>
        apply({ type: 'recipient/set', agentId, id: newId('demo-recipient-row'), now: nowIso(), values }),
      removeRecipient: (agentId, accountId) =>
        apply({ type: 'recipient/remove', agentId, accountId, now: nowIso() }),
      decideApproval: (requestId, decision, comment) =>
        apply({ type: 'approval/decide', requestId, decision, comment, now: nowIso() }),
      reset() {
        const fresh = createDemoState();
        ref.current = fresh;
        setState(fresh);
      },
    }),
    [apply],
  );

  const value = useMemo(() => {
    const agentsById = Object.fromEntries(state.agents.map((a) => [a.id, a]));
    return { state, agentsById, actions };
  }, [state, actions]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useDemoStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useDemoStore must be used inside <DemoStoreProvider>');
  return ctx;
}
