import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import worker from '../src/worker.js';

const root = join(import.meta.dirname, '..', 'dist');
const projectRoot = join(import.meta.dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

function parseSecrets(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

let localEnv = {};
try {
  let source = '';
  for (const fileName of ['API_Key_Local.txt', 'API_Key.txt']) {
    try {
      source = await readFile(join(projectRoot, fileName), 'utf8');
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (!source) throw new Error('Local API key file is missing');
  const secrets = parseSecrets(source);
  localEnv = {
    SUPABASE_URL: secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL || '',
    SUPABASE_PUBLISHABLE_KEY: secrets.SUPABASE_PUBLISHABLE_KEY || secrets.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    SUPABASE_SERVICE_ROLE_KEY: secrets.SUPABASE_SERVICE_ROLE_KEY || secrets.SUPABASE_SECRET_KEY || secrets.service_role || ''
  };
} catch {
  // Static preview remains available; /api/admin/* will report missing server configuration.
}

async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function serveWorkerApi(nodeRequest, nodeResponse) {
  const origin = `http://${nodeRequest.headers.host || '127.0.0.1:4173'}`;
  const body = await readRequestBody(nodeRequest);
  const request = new Request(new URL(nodeRequest.url, origin), {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body
  });
  const workerResponse = await worker.fetch(request, localEnv);
  const headers = Object.fromEntries(workerResponse.headers.entries());
  let payload = Buffer.from(await workerResponse.arrayBuffer());
  const isGzipPayload = payload.length > 2 && payload[0] === 0x1f && payload[1] === 0x8b;
  const expectsGzipFile = new URL(nodeRequest.url, origin).pathname.toLowerCase().endsWith('.gz');

  // Node fetch transparently decodes Content-Encoding but preserves the upstream
  // header. Normalize it for the browser, while keeping .gz application assets
  // compressed because production.js intentionally expands those streams itself.
  delete headers['content-encoding'];
  delete headers['content-length'];
  if (expectsGzipFile && !isGzipPayload) payload = gzipSync(payload);
  if (!expectsGzipFile && isGzipPayload) payload = gunzipSync(payload);

  nodeResponse.writeHead(workerResponse.status, headers);
  nodeResponse.end(payload);
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/') || pathname === '/bootstrap.js') {
      await serveWorkerApi(request, response);
      return;
    }
    const routePath = pathname === '/mod2' ? '/mod2/' : pathname;
    const relative = routePath === '/'
      ? 'index.html'
      : routePath.endsWith('/')
        ? `${normalize(routePath).replace(/^[/\\]+/, '')}index.html`
        : normalize(routePath).replace(/^[/\\]+/, '');
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error('Invalid path');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Permission Out preview: http://127.0.0.1:4173'));
