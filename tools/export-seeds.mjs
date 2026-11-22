import { SEEDS, CATEGORIES } from './seeds.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const out = {
  categories: CATEGORIES,
  seeds: SEEDS.map(([repo, category, name, desc]) => ({ repo, category, name, desc })),
};
await writeFile(path.join(ROOT, 'www', 'data', 'seeds.json'), JSON.stringify(out, null, 1));
console.log(`Wrote ${out.seeds.length} seeds`);
