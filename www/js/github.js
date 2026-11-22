// GitHub API client plus a scraper fallback that reads public release pages
// through the native bridge (github.com HTML has no CORS headers).

import { storageGet, storageSet, isApk, cleanVersion, sortAssets } from './util.js';
import * as native from './native.js';

const API = 'https://api.github.com';
const CACHE_PREFIX = 'gs.api.v2.';
const MEM = new Map();

export class RateLimitError extends Error {
  constructor(reset, message) {
    super(message || 'GitHub API rate limit reached');
    this.name = 'RateLimitError';
    this.reset = reset || 0;
  }
}

export const rate = {
  limit: null,
  remaining: null,
  reset: 0,
  searchRemaining: null,
  updatedAt: 0,
};

export function setToken(token) {
  token = String(token || '').trim();
  try {
    if (token) localStorage.setItem('gs.token.v1', token);
    else localStorage.removeItem('gs.token.v1');
  } catch {
    /* ignore */
  }
  MEM.clear();
}

export function getToken() {
  try {
    return localStorage.getItem('gs.token.v1') || '';
  } catch {
    return '';
  }
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function cacheRead(key) {
  const mem = MEM.get(key);
  if (mem && mem.exp > Date.now()) return mem.data;
  const stored = storageGet(CACHE_PREFIX + hash(key), null);
  if (stored && stored.exp > Date.now()) {
    MEM.set(key, stored);
    return stored.data;
  }
  return null;
}

function cacheWrite(key, data, ttl) {
  const entry = { exp: Date.now() + ttl, data };
  MEM.set(key, entry);
  storageSet(CACHE_PREFIX + hash(key), entry);
}

function updateRate(res) {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const limit = res.headers.get('x-ratelimit-limit');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining !== null) rate.remaining = Number(remaining);
  if (limit !== null) rate.limit = Number(limit);
  if (reset !== null) rate.reset = Number(reset) * 1000;
  rate.updatedAt = Date.now();
}

async function api(path, { ttl = 10 * 60e3, force = false } = {}) {
  const url = path.startsWith('http') ? path : API + path;
  if (!force) {
    const cached = cacheRead(url);
    if (cached) return cached;
  }
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new Error('Network error while contacting GitHub');
  }
  updateRate(res);

  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0' || res.status === 429) {
      throw new RateLimitError(reset, 'GitHub API rate limit reached');
    }
    throw new Error('GitHub refused the request (HTTP ' + res.status + ')');
  }
  if (!res.ok) throw new Error('GitHub API error ' + res.status);
  const data = await res.json();
  cacheWrite(url, data, ttl);
  return data;
}

export function normalizeRepo(r) {
  return {
    repo: r.full_name,
    name: r.name,
    owner: r.owner?.login || String(r.full_name || '').split('/')[0],
    icon: r.owner?.avatar_url || '',
    desc: r.description || '',
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    topics: r.topics || [],
    license: r.license?.spdx_id || r.license?.name || '',
    language: r.language || '',
    updatedAt: r.updated_at || '',
    pushedAt: r.pushed_at || '',
    archived: Boolean(r.archived),
    page: r.html_url || `https://github.com/${r.full_name}`,
    homepage: r.homepage || '',
  };
}

export function isAndroidish(repo) {
  const hay = `${repo.name || ''} ${repo.desc || ''} ${(repo.topics || []).join(' ')} ${repo.language || ''}`.toLowerCase();
  return /android|apk|fdroid|f-droid|kotlin|jetpack|compose|mobile/.test(hay);
}

export async function searchRepos({ q, sort = 'stars', order = 'desc', page = 1, perPage = 30, force = false }) {
  const params = new URLSearchParams({
    q,
    sort,
    order,
    per_page: String(perPage),
    page: String(page),
  });
  const data = await api(`/search/repositories?${params}`, { ttl: 5 * 60e3, force });
  const items = (data.items || []).map(normalizeRepo);
  if (data.total_count != null) rate.searchRemaining = rate.remaining;
  return { total: data.total_count || 0, items };
}

export async function getRepo(repo) {
  const data = await api(`/repos/${repo}`, { ttl: 30 * 60e3 });
  return normalizeRepo(data);
}

export function normalizeRelease(r) {
  const assets = (r.assets || [])
    .filter((a) => isApk(a.name))
    .map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size || 0,
      sizeText: '',
      downloadCount: a.download_count || 0,
      releasedAt: a.updated_at || r.published_at || '',
    }));
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    version: cleanVersion(r.tag_name),
    publishedAt: r.published_at || '',
    prerelease: Boolean(r.prerelease),
    body: r.body || '',
    page: r.html_url || '',
    assets: sortAssets(assets),
  };
}

export async function getReleases(repo, perPage = 12, { force = false } = {}) {
  const data = await api(`/repos/${repo}/releases?per_page=${perPage}`, {
    ttl: 15 * 60e3,
    force,
  });
  return (Array.isArray(data) ? data : []).map(normalizeRelease);
}

// Uses the native scraper: GitHub release pages, no token and no API quota.
export async function scrapeReleases(repo, maxTags = 3) {
  const data = await native.scrapeReleases(repo, maxTags);
  const releases = (data.releases || []).map((r) => ({
    tag: r.tag,
    name: r.tag,
    version: cleanVersion(r.tag),
    publishedAt: r.assets?.[0]?.releasedAt || '',
    prerelease: false,
    body: '',
    page: `https://github.com/${repo}/releases/tag/${encodeURIComponent(r.tag)}`,
    assets: sortAssets(
      (r.assets || []).map((a) => ({
        name: a.name,
        url: a.url,
        size: Number(a.size) || 0,
        sizeText: a.sizeText || '',
        downloadCount: 0,
        releasedAt: a.releasedAt || '',
      })),
    ),
  }));
  return releases.filter((r) => r.assets.length);
}

export async function resolveReleases(repo, { force = false } = {}) {
  try {
    const releases = await getReleases(repo, 12, { force });
    if (releases.some((r) => r.assets.length)) return { releases, source: 'api' };
  } catch (err) {
    if (!(err instanceof RateLimitError)) {
      // fall through to the scraper for any API failure
    }
  }
  if (native.hasNative) {
    const releases = await scrapeReleases(repo, 4);
    return { releases, source: 'scrape' };
  }
  return { releases: [], source: 'none' };
}

export function searchQuery(term) {
  const t = String(term || '').trim();
  if (!t) return 'topic:android stars:>800 archived:false fork:false';
  if (/[a-z]+:/i.test(t)) return t;
  return `${t} android in:name,description archived:false fork:false`;
}

export function livePicksQuery() {
  return 'topic:android stars:>2500 archived:false fork:false';
}

export function pruneCache() {
  try {
    const now = Date.now();
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const v = storageGet(k, null);
      if (!v || !v.exp || v.exp < now) localStorage.removeItem(k);
    }
    // hard cap to keep localStorage healthy
    const survivors = keys.filter((k) => localStorage.getItem(k));
    for (const k of survivors.slice(0, Math.max(0, survivors.length - 150))) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function clearCache() {
  MEM.clear();
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function rateSummary() {
  if (rate.remaining === null) return '';
  if (rate.remaining <= 0) {
    const mins = Math.max(0, Math.ceil((rate.reset - Date.now()) / 60000));
    return `API limit reached${mins ? `, resets in ${mins}m` : ''}`;
  }
  return `${rate.remaining}/${rate.limit ?? '?'} API calls left`;
}
