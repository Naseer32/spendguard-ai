// Express middleware. Nothing here reads or logs request bodies or headers
// other than the few it needs (Origin, Content-Type, Content-Length).

import { randomUUID } from 'node:crypto';
import { mapError } from './errorMap.js';
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  PayloadTooLargeError,
  RouteNotFoundError,
  UnsupportedMediaTypeError,
} from './httpErrors.js';
import { clientIp } from './routeKit.js';

export function requestContext({ logger, now }) {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = now();
    req.requestId = requestId;
    res.set('X-Request-Id', requestId);
    res.on('finish', () => {
      const status = res.statusCode;
      const fields = {
        requestId,
        method: req.method,
        path: req.path,
        status,
        durationMs: Math.max(0, now() - startedAt),
        ip: clientIp(req),
      };
      if (req.route && typeof req.route.path === 'string') {
        fields.route = req.route.path;
      }
      if (req.principal) {
        fields.principal = req.principal.type;
        if (req.principal.agentId) {
          fields.agentId = req.principal.agentId;
        }
      }
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      logger[level]('http.request', fields);
    });
    next();
  };
}

export function securityHeaders() {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  };
}

// CORS for the configured origins only. Authentication is a bearer token, not
// a cookie, so credentials are never allowed and no wildcard is ever used.
export function cors(config) {
  const allowed = new Set(config.corsOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined) {
      next();
      return;
    }
    res.append('Vary', 'Origin');
    const isAllowed = typeof origin === 'string' && allowed.has(origin);
    if (isAllowed) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    const isPreflight =
      req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined;
    if (isPreflight) {
      if (!isAllowed) {
        next(new ForbiddenError());
        return;
      }
      res.set({
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      res.status(204).end();
      return;
    }
    if (isAllowed) {
      res.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
    }
    next();
  };
}

// OPTIONS that is not a CORS preflight gets no automatic answer.
export function rejectPlainOptions() {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next(new RouteNotFoundError());
      return;
    }
    next();
  };
}

function hasBody(req) {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

// A request that carries a body must be JSON.
export function requireJsonContentType() {
  return (req, res, next) => {
    if (hasBody(req) && !req.is('application/json')) {
      next(new UnsupportedMediaTypeError());
      return;
    }
    next();
  };
}

export function notFoundHandler() {
  return (req, res, next) => {
    next(new RouteNotFoundError());
  };
}

// Turns body-parser and Express errors into our own error types.
export function normalizeError(error) {
  if (error !== null && typeof error === 'object') {
    switch (error.type) {
      case 'entity.too.large':
        return new PayloadTooLargeError();
      case 'entity.parse.failed':
      case 'entity.verify.failed':
        return new BadRequestError('request body is not valid JSON', 'INVALID_JSON');
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return new UnsupportedMediaTypeError();
      case 'request.aborted':
      case 'request.size.invalid':
        return new BadRequestError();
      default:
        break;
    }
    if (error.status === 400 && !(error instanceof HttpError)) {
      return new BadRequestError();
    }
  }
  return error;
}

export function errorHandler({ logger }) {
  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    const mapped = mapError(normalizeError(error));
    if (mapped.internal) {
      logger.error('http.error', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: mapped.status,
        error,
      });
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.set(mapped.headers);
    res.status(mapped.status).json(mapped.body);
  };
}
