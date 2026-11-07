import { registerAgentRoutes } from './agentApi.js';
import { registerHealthRoutes } from './health.js';
import { registerOwnerAgentRoutes } from './ownerAgents.js';

// Each module is a function (route, deps) that registers its routes.
// Owner payment, approval and audit routes are added in the next part.
export const DEFAULT_ROUTE_MODULES = Object.freeze([
  registerHealthRoutes,
  registerAgentRoutes,
  registerOwnerAgentRoutes,
]);
