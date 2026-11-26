import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const REGISTRY = 'https://evilcharts.com/r';

const WANT = [
  'echarts-chart',
  'echarts-tooltip',
  'echarts-dot',
  'echarts-legend',
  'echarts-brush',
  'echarts-bar-chart',
  'echarts-line-chart',
  'echarts-area-chart',
  'echarts-pie-chart',
];

const cache = new Map();

async function fetchItem(name) {
  if (cache.has(name)) return cache.get(name);
  const url = `${REGISTRY}/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  const item = await res.json();
  cache.set(name, item);
  return item;
}

async function install(name, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const item = await fetchItem(name);
  for (const dep of item.registryDependencies || []) {
    const depName = dep.replace('@evilcharts/', '');
    await install(depName, seen);
  }
  for (const file of item.files || []) {
    const target = file.target || file.path;
    if (!target) continue;
    const rel = target.replace(/^components\/evilcharts\//, 'components/evilcharts/');
    const out = path.join(ROOT, rel);
    let content = file.content;
    if (!content) continue;
    content = content.replaceAll('@/registry/ui/', '@/components/evilcharts/ui/');
    content = content.replaceAll('@/registry/', '@/components/evilcharts/');
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, content, 'utf8');
    console.log('wrote', path.relative(ROOT, out));
  }
}

for (const name of WANT) {
  await install(name);
}
console.log('done');