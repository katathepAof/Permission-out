import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.ALLOW_LOCAL_BUILD = '1';
await import('./build.mjs');

const root = resolve(import.meta.dirname, '..');
const secretFiles = ['API_Key_Local.txt', 'API_Key.txt'].map(name => resolve(root, name));

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
  let source = '';
  let selectedFile = '';
  for (const secretFile of secretFiles) {
    try {
      source = await readFile(secretFile, 'utf8');
      selectedFile = secretFile;
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (!selectedFile) throw new Error('Missing API_Key_Local.txt or API_Key.txt');
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
  console.log(`Local preview configured with public Supabase settings from ${selectedFile.endsWith('API_Key_Local.txt') ? 'API_Key_Local.txt' : 'API_Key.txt'}`);
} catch (error) {
  console.warn(`Local preview will use UI-only mode: ${error.message}`);
}
