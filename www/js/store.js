// Catalog, settings and installed-app bookkeeping.

import {
  storageGet,
  storageSet,
  sortAssets,
  isApk,
  cleanVersion,
  ownerOf,
  avatarUrl,
  isNewer,
  isPrerelease,
} from './util.js';

const KEY_SETTINGS = 'gs.settings.v1';
const KEY_CATALOG = 'gs.catalog.v1';
const KEY_CUSTOM = 'gs.custom.v1';
const KEY_LIBRARY = 'gs.library.v1';
const KEY_MIRROR = 'gs.mirror.v1';
const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/Gilanoix31/gitstore/master/www/data/catalog.json';

const FEATURED = [
  'TeamNewPipe/NewPipe',
  'ImranR98/Obtainium',
  'RikkaApps/Shizuku',
  'JunkFood02/Seal',
  'AntennaPod/AntennaPod',
  'organicmaps/organicmaps',
  'LawnchairLauncher/lawnchair',
  'mihonapp/mihon',
  'libre-tube/LibreTube',
  'OxygenCobalt/Auxio',
  'termux/termux-app',
  'localsend/localsend',
  'off-grid-ai/mobile',
  'jobobby04/tachiyomisy',
];

let state = {
  settings: { theme: 'system' },
  catalog: { apps: [], categories: [], generatedAt: '', stats: {}, skipped: [], customCount: 0 },
  map: new Map(),
  seeds: [],
  seedCategories: [],
};

function mergeApps(base = [], custom = []) {
  const seen = new Set();
  const out = [];
  for (const app of base) {
    if (!app?.repo) continue;
    const key = app.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(app);
  }
  for (const app of custom) {
    if (!app?.repo) continue;
    const key = app.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(app);
  }
  return out;
}

function rebuildMap() {
  state.map = new Map();
  for (const app of state.catalog.apps) state.map.set(app.repo.toLowerCase(), app);
}

export async function init() {
  state.settings = { theme: 'system', autoUpdate: false, ...storageGet(KEY_SETTINGS, {}) };

  let bundled = { apps: [], categories: [], generatedAt: '', stats: {} };
  try {
    const res = await fetch('data/catalog.json');
    if (res.ok) bundled = await res.json();
  } catch {
    /* offline first run */
  }

  let seedsDoc = { seeds: [], categories: [] };
  try {
    const res = await fetch('data/seeds.json');
    if (res.ok) seedsDoc = await res.json();
  } catch {
    /* ignore */
  }
  state.seeds = seedsDoc.seeds || [];
  state.seedCategories = seedsDoc.categories || bundled.categories || [];

  const refreshed = storageGet(KEY_CATALOG, null);
  const custom = storageGet(KEY_CUSTOM, []);
  const baseApps = refreshed?.apps?.length ? refreshed.apps : bundled.apps || [];

  state.catalog = {
    apps: mergeApps(baseApps, custom),
    categories: bundled.categories?.length ? bundled.categories : seedsDoc.categories || [],
    generatedAt: refreshed?.generatedAt || bundled.generatedAt || '',
    stats: refreshed?.stats || bundled.stats || {},
    skipped: refreshed?.skipped || [],
    customCount: custom.length,
    refreshed: Boolean(refreshed?.apps?.length),
  };
  rebuildMap();
  applyTheme();
  return state.catalog;
}

export const catalog = () => state.catalog;
export const apps = () => state.catalog.apps;
export const categories = () => state.catalog.categories;
export const seeds = () => state.seeds;

export function appByRepo(repo) {
  if (!repo) return null;
  return state.map.get(String(repo).toLowerCase()) || null;
}

export function categoryCounts() {
  const counts = {};
  for (const app of state.catalog.apps) counts[app.category || 'tools'] = (counts[app.category || 'tools'] || 0) + 1;
  return counts;
}

export function featured() {
  const picked = FEATURED.map(appByRepo).filter(Boolean);
  if (picked.length >= 6) return picked;
  for (const app of state.catalog.apps) {
    if (!picked.includes(app)) picked.push(app);
    if (picked.length >= 8) break;
  }
  return picked;
}

export function searchLocal(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const app of state.catalog.apps) {
    const hay = `${app.name} ${app.repo} ${app.desc} ${app.category} ${(app.assets || []).map((a) => a.name).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (!hay.includes(t)) {
        score = -1;
        break;
      }
      if (String(app.name).toLowerCase().startsWith(t)) score += 8;
      else if (String(app.name).toLowerCase().includes(t)) score += 5;
      if (String(app.repo).toLowerCase().includes(t)) score += 3;
      score += 1;
    }
    if (score >= 0) scored.push({ app, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.app.name).localeCompare(String(b.app.name)));
  return scored.map((s) => s.app);
}

// ------------------------------------------------------------------ settings

export function settings() {
  return state.settings;
}

export async function mirrorCatalog(force = false) {
  const last = Number(storageGet(KEY_MIRROR, 0)) || 0;
  if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return null;
  try {
    const res = await fetch(`${REMOTE_CATALOG_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const remote = await res.json();
    if (!remote?.apps?.length) return null;
    storageSet(KEY_MIRROR, Date.now());
    const localAt = Date.parse(state.catalog.generatedAt || '') || 0;
    const remoteAt = Date.parse(remote.generatedAt || '') || 0;
    if (remoteAt <= localAt) return null;
    const custom = storageGet(KEY_CUSTOM, []);
    state.seedCategories = remote.categories?.length ? remote.categories : state.seedCategories;
    state.catalog = {
      apps: mergeApps(remote.apps, custom),
      categories: remote.categories?.length ? remote.categories : state.catalog.categories,
      generatedAt: remote.generatedAt,
      stats: remote.stats || {},
      skipped: remote.skipped || [],
      customCount: custom.length,
      refreshed: true,
    };
    storageSet(KEY_CATALOG, {
      generatedAt: remote.generatedAt,
      apps: remote.apps,
      skipped: remote.skipped || [],
      stats: remote.stats || {},
    });
    rebuildMap();
    return state.catalog;
  } catch {
    return null;
  }
}

export function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  storageSet(KEY_SETTINGS, state.settings);
  applyTheme();
  return state.settings;
}

export function applyTheme() {
  const theme = state.settings.theme || 'system';
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#0d1016' : '#f5f6fa');
  }
}

// -------------------------------------------------------------------- catalog

export function buildEntry(seed, release) {
  const assets = sortAssets((release?.assets || []).filter((a) => isApk(a.name)));
  if (!assets.length) return null;
  const primary = assets[0];
  return {
    repo: seed.repo,
    name: seed.name || String(seed.repo).split('/')[1],
    category: seed.category || 'tools',
    desc: seed.desc || '',
    owner: ownerOf(seed.repo),
    icon: avatarUrl(seed.repo),
    page: `https://github.com/${seed.repo}`,
    releasesPage: `https://github.com/${seed.repo}/releases`,
    tag: release.tag,
    version: cleanVersion(release.tag),
    releasedAt: primary.releasedAt || release.publishedAt || '',
    stars: Number(seed.stars) || 0,
    asset: primary,
    assets,
    custom: Boolean(seed.custom),
  };
}

export function saveRefreshedCatalog(newApps, skipped = []) {
  const generatedAt = new Date().toISOString();
  const stats = {
    seeds: state.seeds.length,
    withApk: newApps.length,
    skipped: skipped.length,
  };
  storageSet(KEY_CATALOG, { generatedAt, apps: newApps, skipped, stats });
  const custom = storageGet(KEY_CUSTOM, []);
  state.catalog = {
    ...state.catalog,
    apps: mergeApps(newApps, custom),
    generatedAt,
    stats,
    skipped,
    refreshed: true,
  };
  rebuildMap();
  return state.catalog;
}

export function clearRefreshedCatalog() {
  localStorage.removeItem(KEY_CATALOG);
}

export function customApps() {
  return storageGet(KEY_CUSTOM, []);
}

export function addCustomApp(app) {
  const custom = customApps().filter((a) => a.repo.toLowerCase() !== app.repo.toLowerCase());
  custom.unshift({ ...app, custom: true });
  storageSet(KEY_CUSTOM, custom);
  state.catalog = {
    ...state.catalog,
    apps: mergeApps(state.catalog.apps, [{ ...app, custom: true }]),
    customCount: custom.length,
  };
  rebuildMap();
}

export function removeCustomApp(repo) {
  const custom = customApps().filter((a) => a.repo.toLowerCase() !== String(repo).toLowerCase());
  storageSet(KEY_CUSTOM, custom);
  const refreshed = storageGet(KEY_CATALOG, null);
  const base = refreshed?.apps?.length ? refreshed.apps : null;
  if (base) {
    state.catalog = { ...state.catalog, apps: mergeApps(base, custom), customCount: custom.length };
  } else {
    state.catalog = {
      ...state.catalog,
      apps: state.catalog.apps.filter((a) => a.repo.toLowerCase() !== String(repo).toLowerCase()),
      customCount: custom.length,
    };
  }
  rebuildMap();
}

// -------------------------------------------------------------------- library

export function getLibrary() {
  return storageGet(KEY_LIBRARY, {});
}

export function libraryEntry(repo) {
  return getLibrary()[repo] || null;
}

export function saveLibraryEntry(repo, info = {}) {
  const lib = getLibrary();
  const previous = lib[repo] || {};
  lib[repo] = {
    repo,
    packageName: info.packageName || previous.packageName || '',
    versionName: info.versionName || previous.versionName || '',
    versionCode: info.versionCode || previous.versionCode || 0,
    label: info.label || previous.label || '',
    installedAt: info.installedAt || previous.installedAt || Date.now(),
  };
  storageSet(KEY_LIBRARY, lib);
  return lib[repo];
}

export function removeLibraryEntry(repo) {
  const lib = getLibrary();
  delete lib[repo];
  storageSet(KEY_LIBRARY, lib);
}

export function clearLibrary() {
  localStorage.removeItem(KEY_LIBRARY);
}

export function packageToRepo() {
  const map = new Map();
  for (const entry of Object.values(getLibrary())) {
    if (entry.packageName) map.set(entry.packageName, entry.repo);
  }
  return map;
}

export function installedForRepo(repo, installedApps = []) {
  const entry = libraryEntry(repo);
  const app = appByRepo(repo);
  if (entry?.packageName) {
    const found = installedApps.find((a) => a.packageName === entry.packageName);
    if (found) return found;
  }
  if (app) {
    const label = String(app.name || '').toLowerCase();
    const byLabel = installedApps.find((a) => String(a.label || '').toLowerCase() === label);
    if (byLabel) return byLabel;
  }
  return null;
}

function comparableVersion(v) {
  const s = String(v || '').trim();
  if (!s || !/\d/.test(s)) return false;
  // date-style tags (nightlies) are not reliable for ordering
  return !/^\d{4}[-.]\d{1,2}/.test(s);
}

export function getUpdates(installedApps = []) {
  const updates = [];
  for (const entry of Object.values(getLibrary())) {
    const app = appByRepo(entry.repo);
    if (!app) continue;
    const installed =
      (entry.packageName && installedApps.find((a) => a.packageName === entry.packageName)) ||
      installedApps.find((a) => String(a.label || '').toLowerCase() === String(app.name || '').toLowerCase());
    if (!installed) continue;
    const latest = app.version;
    if (!comparableVersion(latest) || !comparableVersion(installed.versionName)) continue;
    if (isNewer(latest, installed.versionName)) {
      updates.push({ repo: entry.repo, app, installed, latest });
    }
  }
  return updates;
}

export function updateAppRelease(repo, release) {
  const app = appByRepo(repo);
  if (!app || !release) return null;
  const assets = sortAssets((release.assets || []).filter((a) => isApk(a.name)));
  if (!assets.length) return null;
  app.tag = release.tag;
  app.version = cleanVersion(release.tag);
  app.asset = assets[0];
  app.assets = assets;
  app.releasedAt = assets[0].releasedAt || release.publishedAt || app.releasedAt || '';
  const persisted = state.catalog.apps.filter((a) => !a.custom);
  storageSet(KEY_CATALOG, {
    generatedAt: state.catalog.generatedAt || new Date().toISOString(),
    apps: persisted,
    skipped: state.catalog.skipped || [],
    stats: state.catalog.stats || {},
  });
  return app;
}

export function findRepoForInstalled(installedApp) {
  if (!installedApp) return '';
  const byPackage = packageToRepo().get(installedApp.packageName);
  if (byPackage) return byPackage;
  const label = String(installedApp.label || '').toLowerCase();
  const hit = state.catalog.apps.find((a) => String(a.name || '').toLowerCase() === label);
  return hit?.repo || '';
}

export function trackedApps() {
  const lib = getLibrary();
  return Object.values(lib)
    .map((entry) => ({ entry, app: appByRepo(entry.repo) }))
    .sort((a, b) => (b.entry.installedAt || 0) - (a.entry.installedAt || 0));
}

const GENERIC_PACKAGES = new Set(['app', 'android', 'mobile', 'client', 'main', 'org', 'com', 'net']);

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function scanMatches(installedApps = []) {
  const results = [];
  for (const installed of installedApps) {
    if (installed.isSystem) continue;
    const label = normalizeText(installed.label);
    const pkgPart = normalizeText(String(installed.packageName || '').split('.').pop());
    let best = null;
    let bestScore = 0;
    for (const app of state.catalog.apps) {
      const name = normalizeText(app.name);
      const [owner, repoName] = String(app.repo || '').split('/');
      const ownerPart = normalizeText(owner);
      const repoPart = normalizeText(repoName);
      let score = 0;
      if (name && (name === label || label.includes(name) || name.includes(label))) {
        score = Math.max(score, 100 - Math.abs(name.length - label.length));
      }
      if (repoPart && (repoPart === label || label.includes(repoPart) || repoPart.includes(label))) {
        score = Math.max(score, 88 - Math.abs(repoPart.length - label.length));
      }
      if (!GENERIC_PACKAGES.has(pkgPart) && pkgPart) {
        if (pkgPart === repoPart || repoPart.includes(pkgPart) || pkgPart.includes(repoPart)) score = Math.max(score, 82);
        if (pkgPart === name || name.includes(pkgPart)) score = Math.max(score, 78);
        if (pkgPart === ownerPart) score = Math.max(score, 62);
      }
      if (score > bestScore) {
        best = app;
        bestScore = score;
      }
    }
    if (best && bestScore >= 62) results.push({ installed, app: best, score: bestScore });
  }
  return results.sort((a, b) => b.score - a.score);
}

export function autoUpdateEnabled() {
  return Boolean(state.settings.autoUpdate);
}

export function sortReleasesStableFirst(releases = []) {
  return [...releases].sort((a, b) => {
    const pa = isPrerelease(a.tag) ? 1 : 0;
    const pb = isPrerelease(b.tag) ? 1 : 0;
    return pa - pb;
  });
}
