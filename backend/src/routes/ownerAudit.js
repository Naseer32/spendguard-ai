import { ACCESS } from '../http/routeKit.js';
import { getAuditHeadView, listAuditEntries, verifyAuditLog } from '../services/auditLog.js';
import { ValidationError } from '../services/errors.js';

export function registerOwnerAuditRoutes(route, { db }) {
  const O = ACCESS.OWNER;

  route('GET', '/api/audit', O, ({ query }) => ({ body: listAuditEntries(db, query) }), {
    query: { afterSeq: 'int', limit: 'int', event: 'string', entityId: 'string' },
  });

  route('GET', '/api/audit/head', O, () => ({ body: { head: getAuditHeadView(db) } }));

  // expectedSeq and expectedHash (a head stored outside the database) must be
  // given together; they let verification detect truncation and rebuilds.
  route(
    'GET',
    '/api/audit/verify',
    O,
    ({ query }) => {
      const hasSeq = query.expectedSeq !== undefined;
      const hasHash = query.expectedHash !== undefined;
      if (hasSeq !== hasHash) {
        throw new ValidationError(
          'expectedSeq and expectedHash must be given together',
          hasSeq ? 'expectedHash' : 'expectedSeq',
        );
      }
      const options = hasSeq
        ? { expectedHead: { seq: query.expectedSeq, hash: query.expectedHash } }
        : {};
      return { body: { verification: verifyAuditLog(db, options) } };
    },
    { query: { expectedSeq: 'int', expectedHash: 'string' } },
  );
}
