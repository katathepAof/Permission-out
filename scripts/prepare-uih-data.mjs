import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'uih-20072026');
const outputRoot = resolve(root, 'data-out', 'uih-20072026', 'v1');
const kmzRoot = resolve(outputRoot, 'kmz');

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(absolute));
    else if (/\.kml$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(kmzRoot, { recursive: true });

const sourceFiles = (await filesUnder(sourceRoot)).sort((a, b) => a.localeCompare(b, 'en'));
if (!sourceFiles.length) throw new Error('No KML files found in uih-20072026');

const items = [];
for (const absolute of sourceFiles) {
  const source = await readFile(absolute);
  const sourceRelative = relative(sourceRoot, absolute).split(sep).join('/');
  const group = sourceRelative.split('/')[0] || 'other';
  const outputName = `${basename(absolute, extname(absolute))}.kmz`;
  const objectPath = `kmz/${group}/${outputName}`;
  const outputPath = resolve(outputRoot, ...objectPath.split('/'));
  await mkdir(resolve(outputPath, '..'), { recursive: true });

  const archive = new JSZip();
  archive.file('doc.kml', source);
  const kmz = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  await writeFile(outputPath, kmz);

  const kmlText = source.toString('utf8');
  const placemarkCount = (kmlText.match(/<Placemark(?:\s|>)/gi) || []).length;
  items.push({
    id: createHash('sha256').update(sourceRelative).update(source).digest('hex').slice(0, 16),
    name: outputName,
    group,
    sourceName: basename(absolute),
    sourceRelative,
    path: objectPath,
    contentType: 'application/vnd.google-earth.kmz',
    bytes: kmz.byteLength,
    originalBytes: source.byteLength,
    placemarkCount,
    sha256: createHash('sha256').update(source).digest('hex')
  });
}

const manifest = {
  id: 'uih-20072026',
  title: 'ข้อมูลโครงข่าย UIH จาก PEA',
  version: 'v1',
  generatedAt: new Date().toISOString(),
  format: 'KMZ',
  sourceFormat: 'KML',
  fileCount: items.length,
  totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
  totalOriginalBytes: items.reduce((sum, item) => sum + item.originalBytes, 0),
  groups: [...new Set(items.map(item => item.group))],
  items
};
await writeFile(resolve(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({
  outputRoot,
  fileCount: manifest.fileCount,
  totalOriginalBytes: manifest.totalOriginalBytes,
  totalKmzBytes: manifest.totalBytes,
  compressionRatio: Number((manifest.totalBytes / manifest.totalOriginalBytes).toFixed(4)),
  placemarkCount: items.reduce((sum, item) => sum + item.placemarkCount, 0)
}, null, 2));
