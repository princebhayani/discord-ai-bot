import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '../services/logger.js';

export interface HealthServerOptions {
  port?: number;
  host?: string;
  isDiscordReady: () => boolean;
  webhookHandler?: (
    rawBody: string,
    signatureHeader: string | undefined
  ) => Promise<unknown>;
  logger?: Logger;
}

const MAX_WEBHOOK_BYTES = 64 * 1024;

/**
 * Lightweight built-in Node.js HTTP health & readiness server for Render Free Web Service
 * and external UptimeRobot monitoring. Runs inside the same Node.js process as the Discord bot.
 */
export class HealthServer {
  private server: http.Server | null = null;
  private shuttingDown = false;
  private readonly port: number;
  private readonly host: string;
  private readonly isDiscordReady: () => boolean;
  private readonly webhookHandler?: HealthServerOptions['webhookHandler'];
  private readonly logger?: Logger;

  constructor(options: HealthServerOptions) {
    this.port = options.port ?? Number(process.env.PORT ?? 3000);
    this.host = options.host ?? '0.0.0.0';
    this.isDiscordReady = options.isDiscordReady;
    this.webhookHandler = options.webhookHandler;
    this.logger = options.logger;
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }

  getBoundAddress(): { host: string; port: number } | null {
    if (!this.server || !this.server.listening) {
      return null;
    }
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') {
      return null;
    }
    const info = addr as AddressInfo;
    return { host: info.address, port: info.port };
  }

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) {
      throw new Error('HealthServer is already initialized; refusing to start a second HTTP server.');
    }

    const srv = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Keep socket timeouts tight to conserve memory on Render Free
    srv.keepAliveTimeout = 5000;
    srv.headersTimeout = 10000;
    srv.requestTimeout = 10000;

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        srv.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        resolve();
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      srv.listen(this.port, this.host);
    });

    this.server = srv;
    const bound = this.getBoundAddress() ?? { host: this.host, port: this.port };
    this.logger?.info('HTTP health server listening', {
      host: bound.host,
      port: bound.port,
    });
    return bound;
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    const srv = this.server;
    if (!srv) {
      return;
    }
    this.server = null;

    if (!srv.listening) {
      return;
    }

    srv.closeIdleConnections?.();
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
    this.logger?.info('HTTP health server closed');
  }

  private sendJson(
    res: http.ServerResponse,
    method: string,
    statusCode: number,
    payload: Record<string, unknown>,
    closeConnection = false
  ): void {
    const body = JSON.stringify(payload);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
    };
    if (closeConnection) {
      headers.Connection = 'close';
    }

    res.writeHead(statusCode, headers);
    if (method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const method = (req.method ?? 'GET').toUpperCase();
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    // 1. Liveness endpoint (/healthz) — fast, dependency-free, independent of Discord Gateway state
    if (pathname === '/healthz' && (method === 'GET' || method === 'HEAD')) {
      if (this.shuttingDown) {
        this.sendJson(res, method, 503, { status: 'shutting_down' }, true);
        return;
      }
      this.sendJson(res, method, 200, { status: 'ok' });
      return;
    }

    // 2. Readiness endpoint (/readyz) — indicates whether the Discord Gateway bot is operational
    if (pathname === '/readyz' && (method === 'GET' || method === 'HEAD')) {
      let discordConnected = false;
      if (!this.shuttingDown) {
        try {
          discordConnected = Boolean(this.isDiscordReady());
        } catch {
          discordConnected = false;
        }
      }

      if (discordConnected) {
        this.sendJson(res, method, 200, {
          status: 'ready',
          discordConnected: true,
        });
      } else {
        this.sendJson(
          res,
          method,
          503,
          {
            status: 'not_ready',
            discordConnected: false,
          },
          this.shuttingDown
        );
      }
      return;
    }

    // 3. Optional signed ticket webhook endpoint (only active when TICKET_WEBHOOK_SECRET is configured)
    if (pathname === '/webhooks/ticket' && method === 'POST' && this.webhookHandler && !this.shuttingDown) {
      let totalBytes = 0;
      let aborted = false;
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_WEBHOOK_BYTES) {
          aborted = true;
          this.sendJson(res, method, 413, { error: 'payload_too_large' }, true);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (aborted) return;
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const sig = req.headers['x-ticket-signature'];
        const sigStr = Array.isArray(sig) ? sig[0] : sig;

        void this.webhookHandler!(rawBody, sigStr)
          .then((outcome) => {
            this.sendJson(res, method, 200, { ok: true, ...(outcome as Record<string, unknown>) });
          })
          .catch(() => {
            this.sendJson(res, method, 401, { error: 'invalid_webhook' });
          });
      });
      return;
    }

    // 4. Unknown paths / unsupported methods -> 404
    this.sendJson(res, method, 404, { error: 'not_found' });
  }
}

