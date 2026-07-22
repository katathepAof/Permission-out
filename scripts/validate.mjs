import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = ['Permission_Out.html', 'production.css', 'production.js', 'src/worker.js', 'supabase/schema.sql', 'wrangler.toml'];
await Promise.all(required.map(file => access(resolve(root, file))));
const html = await readFile(resolve(root, 'Permission_Out.html'), 'utf8');
for (const id of ['projectTitle', 'saveProjectBtn', 'analyzeBtn', 'reportBody', 'map', 'peaLayerTrigger', 'peaLayerList']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required element: ${id}`);
}
if (!html.includes("permissionout:analysis-complete")) throw new Error('Analysis lifecycle event is missing');
if (!html.includes('<script src="bootstrap.js"></script>')) throw new Error('Runtime bootstrap script is missing');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
for (const source of inlineScripts) new Function(source);
console.log('Validation passed');
