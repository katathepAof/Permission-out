const APP_VERSION = '2.0.0';

function appConfig(env) {
  return {
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
    appName: 'Permission Out',
    autosave: true,
    requireSupabase: true
  };
}

function configAssignment(env) {
  return `window.APP_CONFIG = ${JSON.stringify(appConfig(env))};`;
}

function noStoreHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/bootstrap.js') {
      return new Response(`${configAssignment(env)}\n`, {
        headers: noStoreHeaders('text/javascript; charset=utf-8')
      });
    }

    if (url.pathname === '/api/health') {
      const configured = Boolean(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY));
      return Response.json({
        ok: configured,
        service: 'permission-out',
        version: APP_VERSION,
        supabaseConfigured: configured,
        timestamp: new Date().toISOString()
      }, {
        status: configured ? 200 : 503,
        headers: noStoreHeaders('application/json; charset=utf-8')
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if ((url.pathname === '/' || url.pathname === '/index.html') && assetResponse.headers.get('Content-Type')?.includes('text/html')) {
      const html = await assetResponse.text();
      const injected = html.replace('<script src="bootstrap.js"></script>', `<script>${configAssignment(env)}</script>`);
      const headers = new Headers(assetResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return new Response(injected, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }
    return assetResponse;
  }
};
