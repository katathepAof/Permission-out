const APP_VERSION = '2.0.0';

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

    if (url.pathname === '/app-config.js') {
      const config = {
        supabaseUrl: env.SUPABASE_URL || '',
        supabaseAnonKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
        appName: 'Permission Out',
        autosave: true,
        requireSupabase: true
      };
      return new Response(`window.APP_CONFIG = ${JSON.stringify(config)};\n`, {
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

    return env.ASSETS.fetch(request);
  }
};
