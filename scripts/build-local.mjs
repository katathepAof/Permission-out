import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.ALLOW_LOCAL_BUILD = '1';
await import('./build.mjs');

const root = resolve(import.meta.dirname, '..');
const secretFile = resolve(root, 'API_Key.txt');

function cleanValue(value = '') {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function exactVariable(source, names) {
  for (const name of names) {
    const match = source.match(new RegExp(`^${name}\\s*[:=]\\s*(.+)$`, 'm'));
    if (match) return cleanValue(match[1]);
  }
  return '';
}

try {
  const source = await readFile(secretFile, 'utf8');
  const supabaseUrl = exactVariable(source, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
  const supabaseAnonKey = exactVariable(source, ['SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl) || !supabaseAnonKey) {
    throw new Error('Missing public Supabase URL or publishable key');
  }
  const config = {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseAnonKey,
    appName: 'Permission Out',
    autosave: false,
    requireSupabase: true
  };
  await writeFile(resolve(root, 'dist', 'bootstrap.js'), `window.APP_CONFIG = ${JSON.stringify(config)};\n`, 'utf8');
  console.log('Local preview configured with the public Supabase client settings from API_Key.txt');
} catch (error) {
  console.warn(`Local preview will use UI-only mode: ${error.message}`);
}
