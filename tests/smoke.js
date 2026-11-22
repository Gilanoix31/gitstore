import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const catalog = json('www/data/catalog.json');
const seeds = json('www/data/seeds.json');

assert.ok(catalog.apps.length > 50, 'catalog should contain a useful number of apps');
assert.ok(catalog.apps.every((a) => a.repo && a.assets?.length && a.asset?.url), 'every app needs an APK asset');
assert.ok(seeds.seeds.length > 100, 'seed list should be populated');

const util = await import(pathToFileURL(path.join(root, 'www/js/util.js')).href);
assert.equal(util.compareVersions('1.2.0', '1.10.0'), -1);
assert.equal(util.compareVersions('v2.0', '2.0.0'), 0);
assert.equal(util.compareVersions('2.0.1', '2.0'), 1);
assert.equal(util.safeRepo('TeamNewPipe/NewPipe'), true);
assert.equal(util.safeRepo('not a repo'), false);
const picked = util.pickPrimaryAsset([
  { name: 'app-x86_64.apk', size: 10 },
  { name: 'app-arm64-v8a.apk', size: 10 },
  { name: 'app-universal.apk', size: 10 },
]);
assert.ok(picked.name.includes('arm64'));
assert.equal(util.isApk('Foo.APK'), true);
assert.equal(util.isApk('Foo.apk.sha256'), false);

const html = read('www/index.html');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

const response = (data) => ({
  ok: true,
  status: 200,
  url: 'http://localhost/',
  headers: { get: () => null },
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const now = new Date().toISOString();
const repoPayload = {
  full_name: 'TeamNewPipe/NewPipe',
  name: 'NewPipe',
  owner: { login: 'TeamNewPipe', avatar_url: 'https://github.com/TeamNewPipe.png' },
  description: 'A libre lightweight streaming front-end for Android.',
  stargazers_count: 38000,
  forks_count: 7000,
  topics: ['android', 'youtube'],
  license: { spdx_id: 'GPL-3.0' },
  language: 'Java',
  updated_at: now,
  pushed_at: now,
  archived: false,
  html_url: 'https://github.com/TeamNewPipe/NewPipe',
  homepage: '',
};
const releasesPayload = [
  {
    tag_name: 'v0.29.3',
    name: 'v0.29.3',
    published_at: now,
    prerelease: false,
    body: '',
    html_url: 'https://github.com/TeamNewPipe/NewPipe/releases/tag/v0.29.3',
    assets: [
      {
        name: 'NewPipe_v0.29.3.apk',
        browser_download_url: 'https://github.com/TeamNewPipe/NewPipe/releases/download/v0.29.3/NewPipe_v0.29.3.apk',
        size: 12000000,
        download_count: 1000,
        updated_at: now,
      },
    ],
  },
];

const calls = [];
global.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url.endsWith('data/catalog.json')) return response(catalog);
  if (url.endsWith('data/seeds.json')) return response(seeds);
  if (url.includes('/search/repositories')) return response({ total_count: 0, items: [] });
  if (url.includes('/repos/TeamNewPipe/NewPipe/releases')) return response(releasesPayload);
  if (url.includes('/repos/TeamNewPipe/NewPipe')) return response(repoPayload);
  if (url.includes('api.github.com')) return response({});
  return response({});
};

global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.location = window.location;
global.history = window.history;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.getComputedStyle = window.getComputedStyle.bind(window);
window.scrollTo = () => {};
window.matchMedia = global.matchMedia;
window.fetch = global.fetch;

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const view = () => document.querySelector('#view').textContent.replace(/\s+/g, ' ');

const failures = [];
process.on('unhandledRejection', (err) => failures.push(err));

await import(pathToFileURL(path.join(root, 'www/js/app.js')).href + `?t=${Date.now()}`);
await wait(350);

assert.match(view(), /Apps straight from the source/);
assert.match(view(), /NewPipe/);
assert.match(view(), new RegExp(String(catalog.apps.length)));

window.location.hash = '#/app/TeamNewPipe/NewPipe';
window.dispatchEvent(new window.Event('hashchange'));
await wait(400);
assert.match(view(), /NewPipe/);
assert.match(view(), /NewPipe_v0\.29\.3\.apk/);
assert.match(view(), /Install/);

window.location.hash = '#/search?q=newpipe';
window.dispatchEvent(new window.Event('hashchange'));
await wait(500);
assert.match(view(), /In your catalog/);

window.location.hash = '#/discover';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
const chip = [...document.querySelectorAll('[data-action="filter"]')].find((b) => b.dataset.filter === 'ai');
assert.ok(chip, 'AI category chip exists');
chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(150);
const expected = catalog.apps
  .filter((a) => a.category === 'ai')
  .sort((a, b) => (b.stars || 0) - (a.stars || 0) || String(a.name).localeCompare(String(b.name)))
  .map((a) => a.repo);
const actual = [...document.querySelectorAll('#catalogList .app-row .app-sub')].map((el) => el.textContent.trim());
assert.deepEqual(actual, expected, 'category view must filter and sort by popularity');
assert.match(view(), /by popularity/);

window.location.hash = '#/settings';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
assert.match(view(), /GitHub access/);
assert.match(view(), /Refresh catalog/);

window.location.hash = '#/library';
window.dispatchEvent(new window.Event('hashchange'));
await wait(150);
assert.match(view(), /Library/);

assert.equal(failures.length, 0, `unhandled rejections: ${failures.map(String).join(', ')}`);
assert.ok(calls.some((u) => u.endsWith('data/catalog.json')), 'app should load the bundled catalog');

console.log('smoke tests passed');
console.log(`catalog: ${catalog.apps.length} apps, ${catalog.stats.withApk} with APK, ${seeds.seeds.length} seeds`);
