import worker from '../src/worker.js';

const env = {
  SUPABASE_URL: 'https://example-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  ASSETS: { fetch: async request => new URL(request.url).pathname === '/'
    ? new Response('<html><body><script src="bootstrap.js"></script></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    : new Response('asset-ok') }
};

const configResponse = await worker.fetch(new Request('https://example.com/bootstrap.js'), env);
const configBody = await configResponse.text();
if (!configBody.includes(env.SUPABASE_URL) || configResponse.headers.get('Cache-Control') !== 'no-store, no-cache, must-revalidate') {
  throw new Error('Runtime app config test failed');
}

const healthResponse = await worker.fetch(new Request('https://example.com/api/health'), env);
const health = await healthResponse.json();
if (healthResponse.status !== 200 || !health.supabaseConfigured) throw new Error('Configured health check failed');

const missingHealth = await worker.fetch(new Request('https://example.com/api/health'), { ASSETS: env.ASSETS });
if (missingHealth.status !== 503) throw new Error('Missing-config health check failed');

const htmlResponse = await worker.fetch(new Request('https://example.com/'), env);
const html = await htmlResponse.text();
if (!html.includes(env.SUPABASE_URL) || html.includes('src="bootstrap.js"')) throw new Error('HTML runtime config injection failed');

const assetResponse = await worker.fetch(new Request('https://example.com/production.js'), env);
if (await assetResponse.text() !== 'asset-ok') throw new Error('Static asset fallback test failed');

console.log('Worker runtime tests passed');
