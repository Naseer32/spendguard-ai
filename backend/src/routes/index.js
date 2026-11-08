import { registerAgentRoutes } from './agentApi.js';
import { registerHealthRoutes } from './health.js';
import { registerOwnerAgentRoutes } from './ownerAgents.js';
import { registerOwnerAuditRoutes } from './ownerAudit.js';
import { registerOwnerPaymentRoutes } from './ownerPayments.js';

// Each module is a function (route, deps) that registers its routes.
export const DEFAULT_ROUTE_MODULES = Object.freeze([
  registerHealthRoutes,
  registerAgentRoutes,
  registerOwnerAgentRoutes,
  registerOwnerPaymentRoutes,
  registerOwnerAuditRoutes,
]);
