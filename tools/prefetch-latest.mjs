import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE = path.join(import.meta.dirname, '.cache');
const UA = 'GitStoreCatalogBot/1.0 (+https://github.com; catalog builder)';
const REPOS = [
  'guardianproject/orbot',
  'd4rken-org/sdmaid-se',
  'termux/termux-x11',
  'LawnchairLauncher/lawnchair',
  'Acode-Foundation/Acode',
  'AndroidIDEOfficial/AndroidIDE',
];

const key = (url) => createHash('sha1').update(url).digest('hex') + '.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429 || res.status === 403) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 10000 * (attempt + 1);
        console.log(`  rate limited, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, text: '', url: res.url };
      return { ok: true, status: res.status, text: await res.text(), url: res.url };
    } catch (err) {
      console.log(`  error ${String(err).slice(0, 80)}`);
      await sleep(3000 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, text: '', url };
}

function tagFromHtml(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/,
    /<meta property="og:url" content="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeURIComponent(m[1].replace(/&amp;/g, '&'));
  }
  return '';
}

await mkdir(CACHE, { recursive: true });
for (const repo of REPOS) {
  const latestUrl = `https://github.com/${repo}/releases/latest`;
  const latest = await get(latestUrl);
  if (!latest.ok) {
    console.log(`${repo}: no stable latest (${latest.status})`);
    await sleep(1500);
    continue;
  }
  await writeFile(path.join(CACHE, key(latestUrl)), latest.text);
  const tag = tagFromHtml(latest.text);
  console.log(`${repo}: latest stable -> ${tag || '(none)'}`);
  if (tag) {
    const assetsUrl = `https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`;
    const assets = await get(assetsUrl);
    if (assets.ok) {
      await writeFile(path.join(CACHE, key(assetsUrl)), assets.text);
      const apk = (assets.text.match(/releases\/download\/[^"]+\.apk/gi) || []).length;
      console.log(`  assets cached (${apk} apk links)`);
    } else {
      console.log(`  assets failed (${assets.status})`);
    }
  }
  await sleep(1500);
}
console.log('done');
