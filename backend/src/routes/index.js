import { registerHealthRoutes } from './health.js';

// Each module is a function (route, deps) that registers its routes.
// Agent and owner routes are added here in the next part.
export const DEFAULT_ROUTE_MODULES = Object.freeze([registerHealthRoutes]);
