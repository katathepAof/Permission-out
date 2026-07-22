import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';

const sourcePath = new URL('../PEA Area.kmz', import.meta.url);
const archive = await JSZip.loadAsync(await readFile(sourcePath));
const kmlEntries = Object.values(archive.files).filter(entry => !entry.dir && /\.kml$/i.test(entry.name));
if (!kmlEntries.length) throw new Error('No KML document found in PEA Area.kmz');

const folderCounts = new Map();
const propertyValues = new Map();
const geometryCounts = new Map();
const namePrefixes = new Map();
let featureCount = 0;

function addProperty(key, value) {
  if (value === null || value === undefined || value === '') return;
  if (!propertyValues.has(key)) propertyValues.set(key, new Map());
  const values = propertyValues.get(key);
  const normalized = String(value).trim();
  values.set(normalized, (values.get(normalized) || 0) + 1);
}

function walk(node, folders = []) {
  if (node.type === 'folder') {
    const name = String(node.meta?.name || '(unnamed)').trim();
    folders = [...folders, name];
    const path = folders.join(' / ');
    folderCounts.set(path, (folderCounts.get(path) || 0) + 1);
  } else if (node.type === 'Feature') {
    featureCount += 1;
    const geometryType = node.geometry?.type || 'null';
    geometryCounts.set(geometryType, (geometryCounts.get(geometryType) || 0) + 1);
    addProperty('@folder', folders.join(' / ') || '(root)');
    for (const [key, value] of Object.entries(node.properties || {})) addProperty(key, value);
    const featureName = String(node.properties?.name || '').trim();
    const prefix = featureName.match(/^[^\.]+\./)?.[0] || '(other)';
    namePrefixes.set(prefix, (namePrefixes.get(prefix) || 0) + 1);
  }
  for (const child of node.children || []) walk(child, folders);
}

for (const entry of kmlEntries) {
  const text = await entry.async('string');
  const document = new DOMParser().parseFromString(text, 'text/xml');
  walk(kmlWithFolders(document, { skipNullGeometry: true }));
}

const topValues = Object.fromEntries([...propertyValues.entries()]
  .map(([key, values]) => [key, [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)])
  .sort((a, b) => a[0].localeCompare(b[0])));

console.log(JSON.stringify({
  sourceBytes: (await readFile(sourcePath)).byteLength,
  kmlEntries: kmlEntries.map(entry => entry.name),
  featureCount,
  geometryCounts: Object.fromEntries(geometryCounts),
  namePrefixes: Object.fromEntries([...namePrefixes.entries()].sort((a, b) => b[1] - a[1])),
  folders: Object.fromEntries([...folderCounts.entries()].slice(0, 100)),
  topPropertyValues: topValues
}, null, 2));
