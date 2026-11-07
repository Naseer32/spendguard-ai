// Express application factory.
//
// Every route is registered through route(method, pattern, access, handler,
// options) and MUST declare an access level:
//   public: no authentication
//   owner:  Authorization: Bearer <OWNER_TOKEN>
//   agent:  Authorization: Bearer <agent API key>
// Authentication runs before the body is read, so unauthenticated callers can
// never make the server parse their body. Unknown paths are 404.
//
// Handlers receive { params, query, body, principal, serviceContext, db,
// config, logger, now } and return { status?, body?, error? }. The response is
// { data: body } (or { error, data } when an error object is returned).

import express from 'express';
import { extractBearer, verifyOwnerToken } from './http/ownerAuth.js';
import { RateLimitError, UnauthorizedError } from './http/httpErrors.js';
import {
  cors,
  errorHandler,
  notFoundHandler,
  rejectPlainOptions,
  requestContext,
  requireJsonContentType,
  securityHeaders,
} from './http/middleware.js';
import { createRateLimiter } from './http/rateLimit.js';
import {
  ACCESS,
  METHODS,
  PARAM_RULES,
  clientIp,
  isValidRoutePattern,
  paramNamesOf,
  readQuery,
  validateParams,
} from './http/routeKit.js';
import { DEFAULT_ROUTE_MODULES } from './routes/index.js';
import { authenticateAgent } from './services/agents.js';

const MINUTE_MS = 60_000;

function requireDependencies({ db, config, logger, now, routeModules }) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a database connection');
  }
  if (
    config === null ||
    typeof config !== 'object' ||
    typeof config.ownerTokenHash !== 'string' ||
    !Array.isArray(config.corsOrigins) ||
    !Number.isInteger(config.bodyLimitBytes) ||
    config.rateLimits === null ||
    typeof config.rateLimits !== 'object'
  ) {
    throw new TypeError('config must come from loadConfig');
  }
  for (const level of ['debug', 'info', 'warn', 'error']) {
    if (logger === null || typeof logger !== 'object' || typeof logger[level] !== 'function') {
      throw new TypeError('logger must come from createLogger');
    }
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  if (!Array.isArray(routeModules) || !routeModules.every((m) => typeof m === 'function')) {
    throw new TypeError('routeModules must be an array of functions');
  }
}

export function createApp({
  db,
  config,
  logger,
  now = Date.now,
  routeModules = DEFAULT_ROUTE_MODULES,
} = {}) {
  requireDependencies({ db, config, logger, now, routeModules });

  const authFailures = createRateLimiter({
    limit: config.rateLimits.authFailuresPerMinute, windowMs: MINUTE_MS, now,
  });
  const ownerLimiter = createRateLimiter({
    limit: config.rateLimits.ownerPerMinute, windowMs: MINUTE_MS, now,
  });
  const evaluateLimiter = createRateLimiter({
    limit: config.rateLimits.evaluatePerMinute, windowMs: MINUTE_MS, now,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestContext({ logger, now }));
  app.use(securityHeaders());
  app.use(cors(config));
  app.use(rejectPlainOptions());

  const jsonParser = express.json({
    limit: config.bodyLimitBytes,
    strict: true,
    type: 'application/json',
    inflate: false,
  });

  // Authentication guards. Failures are limited per client address: once the
  // limit is reached, even a correct credential is refused until the window ends.
  function blockedByFailures(req) {
    const state = authFailures.peek(clientIp(req));
    if (!state.allowed) {
      throw new RateLimitError(state.retryAfterSeconds);
    }
  }

  const guards = {
    [ACCESS.PUBLIC]: (req, res, next) => next(),

    [ACCESS.OWNER]: (req, res, next) => {
      const ip = clientIp(req);
      blockedByFailures(req);
      if (!verifyOwnerToken(req.headers.authorization, config.ownerTokenHash)) {
        authFailures.hit(ip);
        throw new UnauthorizedError();
      }
      const state = ownerLimiter.hit(ip);
      if (!state.allowed) {
        throw new RateLimitError(state.retryAfterSeconds);
      }
      req.principal = { type: 'owner', actor: 'owner' };
      next();
    },

    [ACCESS.AGENT]: (req, res, next) => {
      const ip = clientIp(req);
      blockedByFailures(req);
      const key = extractBearer(req.headers.authorization);
      const agent = key === null ? null : authenticateAgent(db, key);
      if (agent === null) {
        authFailures.hit(ip);
        throw new UnauthorizedError();
      }
      req.principal = { type: 'agent', agentId: agent.id, actor: `agent:${agent.id}`, agent };
      next();
    },
  };

  const registry = [];
  const seen = new Set();
  const deps = Object.freeze({
    db,
    config,
    logger,
    now,
    limits: Object.freeze({ evaluate: evaluateLimiter }),
  });

  function route(method, pattern, access, handler, options = {}) {
    if (!METHODS.includes(method)) {
      throw new TypeError(`method must be one of ${METHODS.join(', ')}`);
    }
    if (!isValidRoutePattern(pattern)) {
      throw new TypeError(`invalid route pattern ${String(pattern).slice(0, 80)}`);
    }
    if (!Object.values(ACCESS).includes(access)) {
      throw new TypeError('every route must declare an access level: public, owner or agent');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    const names = paramNamesOf(pattern);
    for (const name of names) {
      if (!Object.hasOwn(PARAM_RULES, name)) {
        throw new TypeError(`unknown route parameter :${name}`);
      }
    }
    const querySpec = options.query ?? {};
    const key = `${method} ${pattern}`;
    if (seen.has(key)) {
      throw new TypeError(`route ${key} is already registered`);
    }
    seen.add(key);
    registry.push(Object.freeze({ method, path: pattern, access, params: Object.freeze(names) }));

    const stack = [guards[access]];
    if (method === 'POST' || method === 'PUT') {
      stack.push(requireJsonContentType(), jsonParser);
    }
    stack.push(async (req, res) => {
      const params = validateParams(req.params, names);
      const query = readQuery(req.query, querySpec);
      const principal = req.principal ?? null;
      const result = await handler({
        params,
        query,
        body: req.body,
        principal,
        serviceContext: () => ({ now: now(), actor: principal === null ? 'system' : principal.actor }),
        ...deps,
      });
      const status = result?.status ?? 200;
      if (!Number.isInteger(status) || status < 200 || status > 499) {
        throw new TypeError('handler returned an invalid status');
      }
      const payload = result?.error
        ? { error: result.error, data: result.body ?? null }
        : { data: result.body ?? null };
      res.status(status).json(payload);
    });
    app[method.toLowerCase()](pattern, ...stack);
  }

  for (const register of routeModules) {
    register(route, deps);
  }

  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));

  return Object.freeze({ app, routes: Object.freeze([...registry]) });
}
