// Errors raised by the HTTP layer. Messages are fixed and safe to send to
// clients. They never contain secrets or caller-supplied text.

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.headers = Object.freeze({ ...headers });
  }
}

// The same error for a missing, malformed or wrong credential, so a caller
// cannot tell which one it was.
export class UnauthorizedError extends HttpError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'authentication required', { 'WWW-Authenticate': 'Bearer' });
  }
}

export class ForbiddenError extends HttpError {
  constructor() {
    super(403, 'FORBIDDEN', 'access denied');
  }
}

export class RouteNotFoundError extends HttpError {
  constructor() {
    super(404, 'NOT_FOUND', 'not found');
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'invalid request', code = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor() {
    super(413, 'PAYLOAD_TOO_LARGE', 'request body too large');
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor() {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', 'content type must be application/json');
  }
}

export class RateLimitError extends HttpError {
  constructor(retryAfterSeconds) {
    if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 86400) {
      throw new TypeError('retryAfterSeconds must be an integer from 1 to 86400');
    }
    super(429, 'RATE_LIMITED', 'too many requests', { 'Retry-After': String(retryAfterSeconds) });
  }
}
