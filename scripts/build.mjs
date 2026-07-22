import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const assets = ['production.css', 'production.js', 'manifest.webmanifest', 'sw.js', 'logo.svg', '_headers'];
for (const file of assets) await cp(resolve(root, file), resolve(dist, file));

let html = await readFile(resolve(root, 'Permission_Out.html'), 'utf8');
await writeFile(resolve(dist, 'index.html'), html, 'utf8');

const js = `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '', appName: 'Permission Out', autosave: true, requireSupabase: true })};\n`;
await writeFile(resolve(dist, 'bootstrap.js'), js, 'utf8');
console.log('Built Permission Out → dist (Supabase configuration will be injected by the Cloudflare Worker at runtime)');
