// Errors from the backend API layer. Messages are safe to show to the owner:
// they never contain the owner token or raw response bodies.

/**
 * kind: 'network' | 'timeout' | 'auth' | 'rate' | 'client' | 'server' | 'shape' | 'config'
 */
export class ApiError extends Error {
  constructor(kind, message, { status = null, code = null, field = null, retryAfter = null, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
    this.data = data; // backend `data` on refusals such as a 409 on approve
  }
}

/** Plain-language text for the UI. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.kind) {
    case 'network':
      return 'Could not reach the backend. Check the address and that the server is running.';
    case 'timeout':
      return 'The backend took too long to respond. Try again.';
    case 'auth':
      return 'The backend rejected the owner token.';
    case 'rate':
      return error.retryAfter
        ? `Too many requests. Try again in ${error.retryAfter} seconds.`
        : 'Too many requests. Try again shortly.';
    case 'server':
      return 'The backend had a problem handling that. Try again shortly.';
    case 'shape':
      return 'The backend sent a response this app does not understand.';
    default:
      return error.message || 'The request was refused.';
  }
}
