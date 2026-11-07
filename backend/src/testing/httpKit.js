// Test helpers that start the real app on a random local port.
// Uses node:http directly so tests control every header. Not used in production.

import http from 'node:http';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { createLogger } from '../http/logger.js';

export const OWNER_TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

export function makeDeps(options = {}) {
  const db = options.db ?? openDatabase(':memory:');
  const config = loadConfig({ OWNER_TOKEN, ...options.env });
  const logs = [];
  const logger = createLogger({ level: 'debug', write: (line) => logs.push(line) });
  return { db, config, logger, logs };
}

export async function startTestServer(options = {}) {
  const { db, config, logger, logs } = makeDeps(options);
  const created = createApp({
    db,
    config,
    logger,
    now: options.now,
    routeModules: options.routeModules,
  });
  const server = http.createServer(created.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // request(method, path, { token, headers, json, body })
  //   token: sends "Authorization: Bearer <token>"
  //   json:  sends JSON.stringify(json) as application/json
  //   body:  sends a raw string or Buffer (set your own headers)
  function request(method, path, { token, headers = {}, json, body } = {}) {
    return new Promise((resolve, reject) => {
      const sent = { ...headers };
      if (token !== undefined) sent.authorization = `Bearer ${token}`;
      let payload = body;
      if (json !== undefined) {
        payload = JSON.stringify(json);
        if (sent['content-type'] === undefined) sent['content-type'] = 'application/json';
      }
      if (payload !== undefined && sent['content-length'] === undefined && sent['transfer-encoding'] === undefined) {
        sent['content-length'] = String(Buffer.byteLength(payload));
      }
      const req = http.request(
        { host: '127.0.0.1', port, method, path, headers: sent, agent: false },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = null;
            }
            resolve({ status: res.statusCode, headers: res.headers, text, json: parsed });
          });
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  return {
    db,
    config,
    logger,
    logs,
    routes: created.routes,
    request,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
