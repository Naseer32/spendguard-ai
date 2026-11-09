// Errors raised by the RPC client. Messages are fixed strings: they never
// contain the URL (it may hold an API key) or text from the remote server.
// Remote text is kept in separate fields for diagnostics only.

export class RpcError extends Error {
  constructor(message, code, retryable) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
  }
}

export class RpcTimeoutError extends RpcError {
  constructor() {
    super('RPC request timed out', 'RPC_TIMEOUT', true);
  }
}

// reason is a short machine-readable code such as ECONNREFUSED, or "fetch_failed".
export class RpcNetworkError extends RpcError {
  constructor(reason = 'fetch_failed') {
    super('RPC request failed', 'RPC_NETWORK', true);
    this.reason = reason;
  }
}

export class RpcHttpError extends RpcError {
  constructor(status) {
    super(`RPC server returned HTTP ${status}`, 'RPC_HTTP', status === 429 || status >= 500);
    this.status = status;
  }
}

// detail is always one of a few fixed strings written in rpcClient.js.
export class RpcProtocolError extends RpcError {
  constructor(detail) {
    super(`RPC response was not usable: ${detail}`, 'RPC_PROTOCOL', false);
    this.detail = detail;
  }
}

// The server answered with a JSON-RPC error object. rpcCode, rpcMessage and
// remote come from the server (public chain information, truncated).
export class RpcRemoteError extends RpcError {
  constructor({ rpcCode = null, rpcMessage = null, remote = null } = {}) {
    super('RPC server returned an error', 'RPC_REMOTE', false);
    this.rpcCode = rpcCode;
    this.rpcMessage = rpcMessage;
    this.remote = remote;
  }
}
