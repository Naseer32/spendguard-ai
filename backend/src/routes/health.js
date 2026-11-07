import { ACCESS } from '../http/routeKit.js';

// GET /api/health: the only public route. It checks the database answers.
export function registerHealthRoutes(route, { db }) {
  route('GET', '/api/health', ACCESS.PUBLIC, () => {
    db.prepare('SELECT 1 AS ok').get();
    return { body: { status: 'ok' } };
  });
}
