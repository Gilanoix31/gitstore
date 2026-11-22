import { SEEDS, CATEGORIES } from './seeds.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'www', 'data', 'catalog.json');
const UA = 'GitStoreCatalogBot/1.0 (+https://github.com; catalog builder)';
const MAX_TAGS_TO_TRY = 4;
const CONCURRENCY = 4;
const OFFLINE = process.env.CATALOG_OFFLINE === '1';

const cacheKey = (url) => createHash('sha1').update(url).digest('hex') + '.html';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, { retries = 3, cache = true } = {}) {
  const key = cacheKey(url);
  const file = path.join(CACHE, key);
  if (cache) {
    try {
      const hit = await readFile(file, 'utf8');
      if (hit) return { ok: true, status: 200, url, text: hit, cached: true };
    } catch {}
  }
  if (OFFLINE) return { ok: false, status: 0, url, text: '', error: 'offline cache miss' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status === 403) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 8000 * (attempt + 1);
        console.warn(`  rate limited on ${url}, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        return { ok: false, status: res.status, url: res.url, text: '' };
      }
      const text = await res.text();
      if (cache) {
        await mkdir(CACHE, { recursive: true });
        await writeFile(file, text).catch(() => {});
      }
      return { ok: true, status: res.status, url: res.url, text };
    } catch (err) {
      if (attempt === retries) return { ok: false, status: 0, url, text: '', error: String(err) };
      await sleep(1500 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, url, text: '' };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseTags(atom) {
  const tags = [];
  const re = /<link[^>]+href="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/g;
  let m;
  while ((m = re.exec(atom))) tags.push(decodeURIComponent(m[1]));
  if (!tags.length) {
    const re2 = /<id>tag:github\.com,\d+:Repository\/\d+\/([^<]+)<\/id>/g;
    while ((m = re2.exec(atom))) tags.push(m[1]);
  }
  return [...new Set(tags)];
}

function parseSizeToBytes(text) {
  const m = /(\d+(?:\.\d+)?)\s*(Bytes|KB|MB|GB)/i.exec(text);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.round(n * mult);
}

function parseAssets(html) {
  const assets = [];
  const chunks = html.split('<li ').slice(1);
  for (const chunk of chunks) {
    const hrefM = /href="(\/[^"]+\/releases\/download\/[^"]+)"/.exec(chunk);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[1]);
    if (href.includes('/archive/')) continue;
    const nameM = /<span class="text-bold">([^<]+)<\/span>/.exec(chunk);
    const name = decodeEntities(nameM ? nameM[1].trim() : href.split('/').pop());
    if (!/\.apk$/i.test(name)) continue;
    const sizeM = /(?:>|\s)(\d+(?:\.\d+)?\s*(?:Bytes|KB|MB|GB))</i.exec(chunk);
    const sizeText = sizeM ? sizeM[1] : '';
    const dateM = /datetime="([^"]+)"/.exec(chunk);
    assets.push({
      name,
      url: `https://github.com${href}`,
      size: parseSizeToBytes(sizeText),
      sizeText,
      releasedAt: dateM ? dateM[1] : '',
    });
  }
  return assets;
}

function scoreAsset(a) {
  const n = a.name.toLowerCase();
  let score = 0;
  if (n.includes('arm64') || n.includes('aarch64')) score += 100;
  if (n.includes('universal')) score += 80;
  if (n.includes('armeabi') || n.includes('arm-v7') || n.includes('armv7')) score += 40;
  if (n.includes('release')) score += 10;
  if (n.includes('debug')) score -= 30;
  if (n.includes('x86')) score -= 20;
  return score + Math.min(a.size / 1e9, 5);
}

function cleanVersion(tag) {
  return String(tag).replace(/^[vV]/, '').replace(/^release[-_/ ]?/i, '');
}

function isPrerelease(tag) {
  return /(^|[._\-/ ])(alpha|beta|rc|nightly|dev|pre|preview|canary|snapshot|test)/i.test(String(tag));
}

function stableFirst(tags) {
  return [...tags].sort((a, b) => Number(isPrerelease(a)) - Number(isPrerelease(b)));
}

async function latestStableTag(repo) {
  const res = await fetchText(`https://github.com/${repo}/releases/latest`);
  if (!res.ok) return '';
  const html = decodeEntities(res.text);
  const patterns = [
    /<link rel="canonical" href="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/,
    /<meta property="og:url" content="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeURIComponent(m[1]);
  }
  return '';
}

async function fetchStars(repo) {
  const page = await fetchText(`https://github.com/${repo}`);
  if (!page.ok) return 0;
  const m = /"stargazerCount":(\d+)/.exec(page.text);
  return m ? Number(m[1]) : 0;
}

function releaseCandidates(tags, latestStable) {
  const ordered = [];
  const add = (t) => {
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  add(latestStable);
  add(tags.find((t) => !isPrerelease(t)));
  for (const t of tags) add(t);
  return ordered;
}

async function resolveRepo(seed) {
  const [repo, category, name, desc] = seed;
  const owner = repo.split('/')[0];

  let tags = [];
  const atom = await fetchText(`https://github.com/${repo}/releases.atom`);
  if (atom.ok) tags = parseTags(atom.text);

  if (!tags.length) {
    const latest = await fetchText(`https://github.com/${repo}/releases/latest`);
    if (!latest.ok) return { repo, category, reason: `no releases (${latest.status})` };
    const m = /\/releases\/tag\/([^/?#]+)/.exec(latest.url);
    if (!m) return { repo, category, reason: 'no release tag' };
    tags = [decodeURIComponent(m[1])];
  }

  const hasStable = tags.some((t) => !isPrerelease(t));
  const latestStable = hasStable ? '' : await latestStableTag(repo);
  const candidates = releaseCandidates(tags, latestStable);

  for (const tag of candidates.slice(0, MAX_TAGS_TO_TRY)) {
    const frag = await fetchText(
      `https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`,
    );
    if (!frag.ok) continue;
    const assets = parseAssets(frag.text);
    if (!assets.length) continue;
    assets.sort((a, b) => scoreAsset(b) - scoreAsset(a));
    const primary = assets[0];
    return {
      repo,
      name,
      category,
      desc,
      owner,
      icon: `https://github.com/${owner}.png?size=160`,
      page: `https://github.com/${repo}`,
      releasesPage: `https://github.com/${repo}/releases`,
      tag,
      version: cleanVersion(tag),
      releasedAt: primary.releasedAt,
      stars: await fetchStars(repo),
      asset: primary,
      assets,
    };
  }

  return { repo, category, reason: 'no apk in recent releases' };
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  console.log(`Resolving ${SEEDS.length} repos...`);
  let done = 0;
  const results = await pool(SEEDS, CONCURRENCY, async (seed) => {
    const r = await resolveRepo(seed);
    done++;
    if (r.asset) {
      console.log(`[${done}/${SEEDS.length}] OK  ${seed[0]} -> ${r.tag} (${r.assets.length} apk)`);
    } else {
      console.log(`[${done}/${SEEDS.length}] --  ${seed[0]} : ${r.reason}`);
    }
    return r;
  });

  const apps = results.filter((r) => r.asset);
  apps.sort((a, b) => {
    const ca = CATEGORIES.findIndex((c) => c.id === a.category);
    const cb = CATEGORIES.findIndex((c) => c.id === b.category);
    return ca - cb || a.name.localeCompare(b.name);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'github.com release assets (scraped)',
    categories: CATEGORIES,
    stats: { seeds: SEEDS.length, withApk: apps.length, skipped: results.length - apps.length },
    apps,
  };
  await writeFile(OUT, JSON.stringify(payload, null, 1));
  console.log(`\nWrote ${apps.length} apps to ${OUT}`);
  console.log(`Skipped ${results.length - apps.length}:`);
  for (const r of results.filter((r) => !r.asset)) console.log(`  - ${r.repo}: ${r.reason}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
