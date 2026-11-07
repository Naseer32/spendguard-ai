// Small helpers shared by the app and the route modules.

import { ValidationError } from '../services/errors.js';

export const ACCESS = Object.freeze({ PUBLIC: 'public', OWNER: 'owner', AGENT: 'agent' });
export const METHODS = Object.freeze(['GET', 'POST', 'PUT', 'DELETE']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every path parameter must have a rule here.
export const PARAM_RULES = Object.freeze({
  agentId: UUID_RE,
  requestId: UUID_RE,
  accountId: /^[a-z0-9._-]{2,64}$/,
});

// Only simple segments: /api/<lowercase-or-:param>/...  (no wildcards or optionals)
const ROUTE_PATTERN_RE = /^\/api(?:\/(?:[a-z0-9-]+|:[A-Za-z][A-Za-z0-9]*))+$/;
const PARAM_NAME_RE = /:([A-Za-z][A-Za-z0-9]*)/g;
const INTEGER_RE = /^(0|[1-9][0-9]{0,8})$/;
const MAX_QUERY_VALUE = 128;

export function isValidRoutePattern(pattern) {
  return typeof pattern === 'string' && ROUTE_PATTERN_RE.test(pattern);
}

export function paramNamesOf(pattern) {
  return [...pattern.matchAll(PARAM_NAME_RE)].map((match) => match[1]);
}

// Returns a plain object with the validated values of the named parameters.
export function validateParams(params, names) {
  const out = {};
  for (const name of names) {
    const rule = PARAM_RULES[name];
    if (rule === undefined) {
      throw new TypeError(`no validation rule for parameter ${name}`);
    }
    const value = params === null || params === undefined ? undefined : params[name];
    if (typeof value !== 'string' || !rule.test(value)) {
      throw new ValidationError(`${name} is not valid`, name);
    }
    out[name] = value;
  }
  return out;
}

// spec maps each allowed query parameter to 'int' or 'string'.
// Unknown parameters, repeated parameters, empty values and malformed
// integers are rejected. Returns only the parameters that were present.
export function readQuery(query, spec) {
  const out = {};
  const source = query === null || query === undefined ? {} : query;
  for (const key of Object.keys(source)) {
    const shown = key.slice(0, 50);
    if (!Object.hasOwn(spec, key)) {
      throw new ValidationError(`unknown query parameter ${JSON.stringify(shown)}`, shown);
    }
    const raw = source[key];
    if (typeof raw !== 'string') {
      throw new ValidationError(`${key} must be given exactly once`, key);
    }
    if (raw === '') {
      throw new ValidationError(`${key} must not be empty`, key);
    }
    if (raw.length > MAX_QUERY_VALUE) {
      throw new ValidationError(`${key} is too long`, key);
    }
    if (spec[key] === 'int') {
      if (!INTEGER_RE.test(raw)) {
        throw new ValidationError(`${key} must be a whole number`, key);
      }
      out[key] = Number(raw);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

// The address of the peer socket. Proxy headers are deliberately NOT trusted.
export function clientIp(req) {
  const raw = req.socket === undefined || req.socket === null ? undefined : req.socket.remoteAddress;
  if (typeof raw !== 'string' || raw === '') {
    return 'unknown';
  }
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}
