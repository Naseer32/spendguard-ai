// Pure helpers for loading backend data. They take an `api` object (see
// api/endpoints.js) so they can be tested with a fake.

export const AUDIT_WINDOW = 200;

/**
 * The audit endpoint is ascending with an `afterSeq` cursor. To show the
 * NEWEST entries, ask for the head sequence number first, then read the last
 * `window` entries.
 */
export async function loadLatestAudit(api, window = AUDIT_WINDOW) {
  const head = await api.listAudit({ limit: 1 });
  if (head.headSeq === 0) return { entries: [], hasOlder: false, headSeq: 0 };
  const afterSeq = Math.max(0, head.headSeq - window);
  const page = await api.listAudit({ afterSeq, limit: window });
  return { entries: page.entries, hasOlder: afterSeq > 0, headSeq: page.headSeq };
}

/** Entries older than `oldestSeq`, in the same ascending order. */
export async function loadOlderAudit(api, oldestSeq, window = AUDIT_WINDOW) {
  const upper = oldestSeq - 1;
  if (upper < 1) return { entries: [], hasOlder: false };
  const afterSeq = Math.max(0, upper - window);
  const page = await api.listAudit({ afterSeq, limit: upper - afterSeq });
  return { entries: page.entries.filter((e) => e.seq < oldestSeq), hasOlder: afterSeq > 0 };
}

/** Union by seq, ascending. Later copies win. */
export function mergeAudit(existing, incoming) {
  const bySeq = new Map();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Everything the list pages need, loaded together. */
export async function loadSnapshot(api) {
  const [agents, requests, audit] = await Promise.all([
    api.listAgents(),
    api.listPayments({}),
    loadLatestAudit(api),
  ]);
  return {
    agents,
    requests,
    // The payments endpoint returns at most 200 rows; if we got that many there may be more.
    requestsTruncated: requests.length >= 200,
    audit: audit.entries,
    auditHasOlder: audit.hasOlder,
    auditHeadSeq: audit.headSeq,
  };
}

/** Replace the item with the same id, or append it. */
export function upsertById(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}
