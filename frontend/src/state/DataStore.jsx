import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoState } from '../data/demoSeed.js';
import { validateBaseUrl } from '../api/baseUrl.js';
import { createApiClient } from '../api/client.js';
import { createEndpoints } from '../api/endpoints.js';
import { ApiError, describeError } from '../api/errors.js';
import { describeEntry } from '../lib/audit.js';
import { reducer } from './reducer.js';
import { loadLatestAudit, loadOlderAudit, loadSnapshot, mergeAudit, upsertById, AUDIT_WINDOW } from './loaders.js';

// DATA STORE. One seam for every page. Two modes:
//
//   demo  (default)  in-memory sample data, clearly labelled. Nothing leaves the browser.
//   live             real data from the SpendGuard backend, using only its existing
//                    /api routes (see api/endpoints.js).
//
// The app always starts in demo mode. Live mode begins only after the owner types a
// backend address and token in Settings and the backend accepts them. The owner token
// is kept in memory only: never in localStorage, never in the URL, never logged.
// Disconnecting, or a rejected token, drops it and returns to demo mode.
//
// Every action is async and resolves { ok: true, ... } or { ok: false, error, field? }.

const StoreContext = createContext(null);

const BASE_KEY = 'spendguard.api.baseUrl';

function readStoredBase() {
  try {
    const v = window.localStorage.getItem(BASE_KEY);
    if (v !== null && validateBaseUrl(v).ok) return v;
  } catch {
    /* storage blocked */
  }
  return import.meta.env?.VITE_API_BASE_URL ?? '';
}

function writeStoredBase(v) {
  try {
    window.localStorage.setItem(BASE_KEY, v);
  } catch {
    /* storage blocked */
  }
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

const EMPTY_LIVE = Object.freeze({
  agents: [],
  requests: [],
  requestsTruncated: false,
  recipientsByAgent: {},
  audit: [],
  auditHasOlder: false,
});

function failure(error) {
  const message = describeError(error);
  return {
    ok: false,
    error: message,
    kind: error instanceof ApiError ? error.kind : 'unknown',
    field: error instanceof ApiError ? error.field : null,
    status: error instanceof ApiError ? error.status : null,
    code: error instanceof ApiError ? (error.code ?? null) : null,
    // Sent by the backend when an approval is refused (409): why the policy no longer passes.
    refusalReasons:
      error instanceof ApiError && Array.isArray(error.data?.refusalReasons)
        ? error.data.refusalReasons.filter((c) => typeof c === 'string')
        : [],
  };
}

export function DataStoreProvider({ children, initialDemoState }) {
  const [demo, setDemo] = useState(() => initialDemoState ?? createDemoState());
  const demoRef = useRef(demo);

  const [mode, setMode] = useState('demo');
  const [live, setLive] = useState(EMPTY_LIVE);
  const [phase, setPhase] = useState('ready'); // demo is always ready; live: loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState({ status: 'disconnected', baseUrl: readStoredBase(), error: null });

  const tokenRef = useRef(null); // owner token: memory only
  const generation = useRef(0); // bumped on connect/disconnect so stale responses are ignored
  const apiRef = useRef(null);

  const isCurrent = (gen) => gen === generation.current;

  const disconnect = useCallback((reason = null) => {
    generation.current += 1;
    tokenRef.current = null;
    apiRef.current = null;
    setMode('demo');
    setLive(EMPTY_LIVE);
    setPhase('ready');
    setLoadError(null);
    setRefreshing(false);
    setConnection((c) => ({ status: 'disconnected', baseUrl: c.baseUrl, error: reason }));
  }, []);

  /** Wraps a live call: converts errors to a result, drops the token if the backend rejects it. */
  const guard = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'auth') {
          disconnect('The backend rejected the owner token, so you were disconnected. Back in demo mode.');
        }
        return failure(error);
      }
    },
    [disconnect],
  );

  const applyLive = useCallback((gen, updater) => {
    if (gen === generation.current) setLive(updater);
  }, []);

  const connect = useCallback(
    async ({ baseUrl, token }) => {
      const checked = validateBaseUrl(baseUrl);
      if (!checked.ok) return { ok: false, error: checked.error, field: 'baseUrl' };
      const trimmed = typeof token === 'string' ? token.trim() : '';
      if (trimmed === '') return { ok: false, error: 'Enter the owner token.', field: 'token' };

      const gen = ++generation.current;
      tokenRef.current = trimmed;
      const api = createEndpoints(createApiClient({ baseUrl: checked.value, getToken: () => tokenRef.current }));
      setConnection({ status: 'connecting', baseUrl: checked.value, error: null });
      try {
        await api.health(); // public: is there a backend at this address?
        const snapshot = await loadSnapshot(api); // owner routes: is the token accepted?
        if (!isCurrent(gen)) return { ok: false, error: 'Cancelled.' };
        apiRef.current = api;
        writeStoredBase(checked.value);
        setLive({ ...EMPTY_LIVE, ...snapshot, auditHasOlder: snapshot.auditHasOlder });
        setLoadError(null);
        setPhase('ready');
        setMode('live');
        setConnection({ status: 'connected', baseUrl: checked.value, error: null });
        return { ok: true };
      } catch (error) {
        if (!isCurrent(gen)) return { ok: false, error: 'Cancelled.' };
        tokenRef.current = null;
        apiRef.current = null;
        const result = failure(error);
        setConnection({ status: 'disconnected', baseUrl: checked.value, error: result.error });
        return { ...result, field: result.kind === 'auth' ? 'token' : result.field };
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return { ok: false, error: 'Not connected.' };
    const gen = generation.current;
    setRefreshing(true);
    const result = await guard(async () => {
      const snapshot = await loadSnapshot(api);
      if (!isCurrent(gen)) return { ok: false, error: 'Cancelled.' };
      setLive((l) => ({ ...l, ...snapshot }));
      setPhase('ready');
      setLoadError(null);
      return { ok: true };
    });
    if (isCurrent(gen)) {
      setRefreshing(false);
      if (!result.ok) {
        setLoadError(result.error);
        setPhase((p) => (p === 'ready' ? p : 'error'));
      }
    }
    return result;
  }, [guard]);

  // Best-effort: pull the newest audit entries after a change.
  const refreshAudit = useCallback(
    async (gen) => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const latest = await loadLatestAudit(api, AUDIT_WINDOW);
        applyLive(gen, (l) => ({ ...l, audit: mergeAudit(l.audit, latest.entries) }));
      } catch {
        /* the change itself succeeded; the log will catch up on the next refresh */
      }
    },
    [applyLive],
  );

  // ---- actions -----------------------------------------------------------------

  const actions = useMemo(() => {
    const isLive = mode === 'live';

    // Demo implementations: same async shape as live, in memory only.
    const applyDemo = (action) => {
      const next = reducer(demoRef.current, action);
      if (next === demoRef.current) return false;
      demoRef.current = next;
      setDemo(next);
      return true;
    };
    const demoResult = (changed, extra = {}) =>
      changed ? { ok: true, ...extra } : { ok: false, error: 'Nothing was changed.' };

    const withApi = (fn) =>
      guard(async () => {
        const api = apiRef.current;
        if (!api) return { ok: false, error: 'Not connected.' };
        const gen = generation.current;
        const out = await fn(api, gen);
        if (!isCurrent(gen)) return { ok: false, error: 'Cancelled.' };
        return out;
      });

    return {
      async createAgent(values) {
        if (!isLive) {
          const id = newId('demo-agent');
          return demoResult(applyDemo({ type: 'agent/create', id, now: nowIso(), values }), { id });
        }
        return withApi(async (api, gen) => {
          const { agent, apiKey } = await api.createAgent(values);
          applyLive(gen, (l) => ({ ...l, agents: upsertById(l.agents, agent) }));
          refreshAudit(gen);
          return { ok: true, id: agent.id, apiKey }; // the key is shown once by the caller, then dropped
        });
      },

      async updateLimits(agentId, values) {
        if (!isLive) return demoResult(applyDemo({ type: 'agent/updateLimits', agentId, now: nowIso(), values }));
        return withApi(async (api, gen) => {
          const agent = await api.updateLimits(agentId, values);
          applyLive(gen, (l) => ({ ...l, agents: upsertById(l.agents, agent) }));
          refreshAudit(gen);
          return { ok: true };
        });
      },

      async setAgentStatus(agentId, status) {
        if (!isLive) return demoResult(applyDemo({ type: 'agent/setStatus', agentId, status, now: nowIso() }));
        return withApi(async (api, gen) => {
          const agent = status === 'PAUSED' ? await api.pauseAgent(agentId) : await api.resumeAgent(agentId);
          applyLive(gen, (l) => ({ ...l, agents: upsertById(l.agents, agent) }));
          refreshAudit(gen);
          return { ok: true };
        });
      },

      /** Live only. Resolves { ok, apiKey }. */
      async rotateKey(agentId) {
        if (!isLive) return { ok: false, error: 'Demo agents have no API keys.' };
        return withApi(async (api, gen) => {
          const { agent, apiKey } = await api.rotateKey(agentId);
          applyLive(gen, (l) => ({ ...l, agents: upsertById(l.agents, agent) }));
          refreshAudit(gen);
          return { ok: true, apiKey };
        });
      },

      async loadRecipients(agentId) {
        if (!isLive) return { ok: true };
        return withApi(async (api, gen) => {
          const list = await api.listRecipients(agentId);
          applyLive(gen, (l) => ({ ...l, recipientsByAgent: { ...l.recipientsByAgent, [agentId]: list } }));
          return { ok: true };
        });
      },

      async setRecipient(agentId, values) {
        if (!isLive) {
          return demoResult(applyDemo({ type: 'recipient/set', agentId, id: newId('demo-recipient-row'), now: nowIso(), values }));
        }
        return withApi(async (api, gen) => {
          const rec = await api.setRecipient(agentId, values.accountId, { listType: values.listType, note: values.note });
          applyLive(gen, (l) => {
            const current = (l.recipientsByAgent[agentId] ?? []).filter((r) => r.accountId !== rec.accountId);
            return { ...l, recipientsByAgent: { ...l.recipientsByAgent, [agentId]: [...current, rec] } };
          });
          refreshAudit(gen);
          return { ok: true };
        });
      },

      async removeRecipient(agentId, accountId) {
        if (!isLive) return demoResult(applyDemo({ type: 'recipient/remove', agentId, accountId, now: nowIso() }));
        return withApi(async (api, gen) => {
          await api.removeRecipient(agentId, accountId);
          applyLive(gen, (l) => ({
            ...l,
            recipientsByAgent: {
              ...l.recipientsByAgent,
              [agentId]: (l.recipientsByAgent[agentId] ?? []).filter((r) => r.accountId !== accountId),
            },
          }));
          refreshAudit(gen);
          return { ok: true };
        });
      },

      /** Opens one payment from the backend so the detail shows the approval comment. */
      async loadPayment(requestId) {
        if (!isLive) return { ok: true };
        return withApi(async (api, gen) => {
          const { payment } = await api.getPayment(requestId);
          applyLive(gen, (l) => ({ ...l, requests: upsertById(l.requests, payment) }));
          return { ok: true };
        });
      },

      async decideApproval(requestId, decision, comment) {
        if (!isLive) return demoResult(applyDemo({ type: 'approval/decide', requestId, decision, comment, now: nowIso() }));
        const approve = decision === 'APPROVE';
        return withApi(async (api, gen) => {
          const out = approve ? await api.approvePayment(requestId, comment) : await api.rejectPayment(requestId, comment);
          const payment = { ...out.payment, decisionComment: comment ?? null };
          applyLive(gen, (l) => ({ ...l, requests: upsertById(l.requests, payment) }));
          refreshAudit(gen);
          return { ok: true };
        });
      },

      /**
       * Live only. Reports the wallet transaction to the backend and returns its verdict. The payment
       * status always comes from the backend response; it is never set here.
       */
      async reportTransaction(requestId, { txHash, signerId }) {
        if (!isLive) return { ok: false, kind: 'demo', error: 'Demo mode has no wallet or NEAR connection.' };
        return withApi(async (api, gen) => {
          const out = await api.reportTransaction(requestId, { txHash, signerId });
          applyLive(gen, (l) => {
            const prev = l.requests.find((r) => r.id === out.payment.id);
            return { ...l, requests: upsertById(l.requests, { ...out.payment, decisionComment: prev?.decisionComment ?? null }) };
          });
          refreshAudit(gen);
          return { ok: true, verdict: out.verdict, action: out.action, reason: out.reason, payment: out.payment };
        });
      },

      async loadOlderAudit() {
        if (!isLive) return { ok: true };
        return withApi(async (api, gen) => {
          const oldest = live.audit[0]?.seq;
          if (!oldest) return { ok: true };
          const older = await loadOlderAudit(api, oldest, AUDIT_WINDOW);
          applyLive(gen, (l) => ({ ...l, audit: mergeAudit(l.audit, older.entries), auditHasOlder: older.hasOlder }));
          return { ok: true };
        });
      },

      /** Live only. Resolves { ok, verification }. */
      async verifyAudit() {
        if (!isLive) return { ok: false, error: 'Audit verification needs a live backend.' };
        return withApi(async (api) => ({ ok: true, verification: await api.verifyAudit() }));
      },

      reset() {
        const fresh = createDemoState();
        demoRef.current = fresh;
        setDemo(fresh);
      },
    };
  }, [mode, guard, applyLive, refreshAudit, live.audit]);

  // A 409 on approve means the policy no longer passes (or the approval window passed) and the
  // backend may have changed the request's status. Re-read that one payment so lists stay truthful.
  const decideWithRefresh = useCallback(
    async (requestId, decision, comment) => {
      const result = await actions.decideApproval(requestId, decision, comment);
      if (!result.ok && mode === 'live' && result.status === 409) await actions.loadPayment(requestId);
      return result;
    },
    [actions, mode],
  );

  const value = useMemo(() => {
    const isLive = mode === 'live';
    const agents = isLive ? live.agents : demo.agents;
    const requests = isLive ? live.requests : demo.requests;
    const agentsById = Object.fromEntries(agents.map((a) => [a.id, a]));
    let recipients = demo.recipients;
    let audit = demo.audit;
    if (isLive) {
      const paymentsById = Object.fromEntries(live.requests.map((r) => [r.id, r]));
      recipients = Object.values(live.recipientsByAgent).flat();
      audit = live.audit.map((e) => describeEntry(e, { agentsById, paymentsById }));
    }
    return {
      mode,
      isLive,
      state: { agents, requests, recipients, audit },
      agentsById,
      actions: { ...actions, decideApproval: decideWithRefresh },
      // Loading info for list pages. Demo data is always ready.
      status: isLive ? { phase, error: loadError, refreshing } : { phase: 'ready', error: null, refreshing: false },
      requestsTruncated: isLive && live.requestsTruncated,
      auditHasOlder: isLive && live.auditHasOlder,
      connection,
      connect,
      disconnect,
      refresh,
    };
  }, [mode, live, demo, actions, decideWithRefresh, phase, loadError, refreshing, connection, connect, disconnect, refresh]);

  // Drop the token if the page is being torn down.
  useEffect(() => () => {
    tokenRef.current = null;
  }, []);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <DataStoreProvider>');
  return ctx;
}
