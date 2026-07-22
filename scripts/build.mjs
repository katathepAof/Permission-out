import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await mkdir(dist, { recursive: true });

const assets = ['production.css', 'production.js', 'manifest.webmanifest', 'sw.js', 'logo.svg', '_headers'];
for (const file of assets) await cp(resolve(root, file), resolve(dist, file));

let html = await readFile(resolve(root, 'Permission_Out.html'), 'utf8');
await writeFile(resolve(dist, 'index.html'), html, 'utf8');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const allowLocalBuild = process.env.ALLOW_LOCAL_BUILD === '1';
if ((!supabaseUrl || !supabaseAnonKey) && !allowLocalBuild) {
  throw new Error('Supabase configuration is required: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. For local UI-only builds, set ALLOW_LOCAL_BUILD=1.');
}
if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
  throw new Error('SUPABASE_URL must be a valid https://<project-ref>.supabase.co URL.');
}
const js = `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseAnonKey, appName: 'Permission Out', autosave: true, requireSupabase: true })};\n`;
await writeFile(resolve(dist, 'app-config.js'), js, 'utf8');
console.log(`Built Permission Out → dist (${supabaseUrl ? 'Supabase required and enabled' : 'local UI-only build explicitly allowed'})`);
