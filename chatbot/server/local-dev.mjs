import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleChatRequest } from '../core/handler.mjs';
import { createRateLimiter } from '../core/rate-limit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const CLIENTS_DIR = path.join(REPO_ROOT, 'chatbot', 'clients');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Parse .env files (chatbot/.env then root .env) without overriding existing env values.
 */
export function loadEnvFiles(baseDir = REPO_ROOT) {
  const loaded = {};
  const candidates = [path.join(baseDir, 'chatbot', '.env'), path.join(baseDir, '.env')];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      let val = line.slice(eqIndex + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in loaded)) {
        loaded[key] = val;
      }
    }
  }

  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
  return loaded;
}

/**
 * Load all non-template client packs from disk.
 */
export async function loadClientsFromDisk(clientsDir = CLIENTS_DIR) {
  const entries = await fs.readdir(clientsDir, { withFileTypes: true });
  const clients = {};

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(clientsDir, entry.name);
    const configPath = path.join(dir, 'config.json');
    const knowledgePath = path.join(dir, 'knowledge.md');
    if (!existsSync(configPath) || !existsSync(knowledgePath)) continue;

    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const knowledge = await fs.readFile(knowledgePath, 'utf8');
    const clientId = config.id || entry.name;
    clients[clientId] = { config, knowledge };
  }

  return clients;
}

async function readNodeRequestBody(req, maxBytes = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        resolve(Buffer.concat(chunks));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStaticFile(urlPathname, res) {
  let relativePath = decodeURIComponent(urlPathname);
  if (relativePath === '/') relativePath = '/index.html';
  const stripped = relativePath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(REPO_ROOT, stripped);
  const rootPrefix = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : `${REPO_ROOT}${path.sep}`;

  if (resolvedPath !== REPO_ROOT && !resolvedPath.startsWith(rootPrefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Prevent accidentally exposing .env files via static serving
  const basename = path.basename(resolvedPath).toLowerCase();
  if (basename === '.env' || basename.startsWith('.env.') || basename === '.dev.vars') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(resolvedPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

/**
 * Start the local static + API development server.
 */
export async function startLocalServer({
  port = Number(process.env.PORT || 8123),
  host = '127.0.0.1',
  envOverrides = {}
} = {}) {
  loadEnvFiles(REPO_ROOT);
  const env = { ...process.env, ...envOverrides };
  const clients = await loadClientsFromDisk(CLIENTS_DIR);
  const rateLimiter = createRateLimiter({
    maxRequests: Number(env.RATE_LIMIT_PER_MIN || 20),
    windowMs: 60_000
  });

  const server = http.createServer(async (req, res) => {
    try {
      const requestHost = req.headers.host || `${host}:${port}`;
      const fullUrl = new URL(req.url || '/', `http://${requestHost}`);

      if (fullUrl.pathname === '/api/chat' || fullUrl.pathname === '/api/health') {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
          }
        }
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
        const bodyBuffer = hasBody ? await readNodeRequestBody(req) : undefined;
        const webRequest = new Request(fullUrl.toString(), {
          method: req.method,
          headers,
          body: hasBody ? bodyBuffer : undefined
        });

        const webResponse = await handleChatRequest(webRequest, env, { clients, rateLimiter });
        const responseHeaders = {};
        webResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        res.writeHead(webResponse.status, responseHeaders);
        const arrayBuf = await webResponse.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }

      await serveStaticFile(fullUrl.pathname, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'server_error' }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${boundPort}`;

  return {
    server,
    host,
    port: boundPort,
    baseUrl,
    clients,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();

if (isEntrypoint) {
  const instance = await startLocalServer();
  const mockFlag = String(process.env.CHATBOT_MOCK || '') === '1';
  const configuredFlag = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  console.log(
    `Ndlela local dev server listening at ${instance.baseUrl} (clients=${Object.keys(instance.clients).join(',')}, openaiConfigured=${configuredFlag}, mock=${mockFlag})`
  );
}
