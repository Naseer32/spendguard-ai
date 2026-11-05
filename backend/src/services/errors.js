// Typed errors thrown by services. The HTTP layer (Stage 2c) maps the `code`
// to a status. Messages are safe to show to callers: they never contain
// secrets.

export class ServiceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends ServiceError {
  constructor(message, field = null) {
    super(message, 'VALIDATION');
    this.field = field;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message) {
    super(message, 'NOT_FOUND');
  }
}

export class ConflictError extends ServiceError {
  constructor(message, code = 'CONFLICT') {
    super(message, code);
  }
}

export class IdempotencyConflictError extends ConflictError {
  constructor(message) {
    super(message, 'IDEMPOTENCY_CONFLICT');
  }
}
