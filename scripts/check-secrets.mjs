import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const textExtensions = new Set(['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg', '.toml', '.txt', '.webmanifest']);
const secretPatterns = [
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bsk_live_[A-Za-z0-9]{20,}\b/g
];

const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'buffer' });
const trackedFiles = stdout.toString('utf8').split('\0').filter(Boolean);
const findings = [];
for (const file of trackedFiles) {
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  let source;
  try {
    source = await readFile(resolve(root, file), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push(file);
  }
}

if (findings.length) {
  throw new Error(`Potential credentials found in tracked files: ${[...new Set(findings)].join(', ')}`);
}
console.log(`Secret scan passed (${trackedFiles.length} repository files)`);
