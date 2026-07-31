/**
 * Serves the fixture pages over HTTP.
 *
 * The extension deliberately refuses `file://` URLs -- Chrome only grants
 * extensions access to them behind a user-toggled setting, so relying on them
 * would test a configuration real users do not have. A throwaway localhost
 * server gives the fixtures an ordinary `http://` origin instead.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const ROOT = resolve('tests/fixtures/sites');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export interface FixtureServer {
  readonly origin: string;
  url(name: string): string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const requested = new URL(request.url ?? '/', 'http://localhost').pathname;
      // Contain the served path inside the fixture directory.
      const path = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

      if (!path.startsWith(ROOT)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      try {
        const body = await readFile(path);
        response.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end('Not found');
      }
    })();
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    url: (name) => `${origin}/${name}`,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => {
          resolvePromise();
        });
      }),
  };
}
