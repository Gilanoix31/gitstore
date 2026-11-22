import {
  $,
  $$,
  esc,
  fmtBytes,
  fmtNum,
  timeAgo,
  debounce,
  isApk,
  isPrerelease,
  isNewer,
  pickPrimaryAsset,
  safeRepo,
  avatarUrl,
  letterAvatar,
  appIcon,
  icon,
  toast,
  openModal,
  confirmDialog,
  pool,
} from './util.js';
import * as gh from './github.js';
import * as native from './native.js';
import * as store from './store.js';

const APP_VERSION = '1.1.1';
const memo = new Map();
let pendingInstall = null;

const state = {
  route: { name: 'discover' },
  catalogFilter: 'all',
  search: { q: '', local: [], api: [], loading: false, done: false, error: '' },
  live: { items: [], loading: false, loaded: false, error: '' },
  detail: null,
  installed: [],
  installedLoaded: false,
  installedLoading: false,
  installedError: '',
  installedQuery: '',
  scanMatches: [],
  autoRunning: false,
  showSystem: false,
  libTab: 'installed',
  checking: false,
  installPermission: null,
};

function detailHref(repo) {
  const [owner, name] = String(repo).split('/');
  return `#/app/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function memoRepo(repo) {
  if (repo?.repo) memo.set(repo.repo.toLowerCase(), repo);
  return repo;
}

function memoGet(repo) {
  return memo.get(String(repo).toLowerCase()) || null;
}

function setView(html) {
  $('#view').innerHTML = html;
}

function versionLabel(app) {
  return app?.tag || app?.version || 'APK';
}

function pageHead(title, sub) {
  return `<div class="page-head"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;
}

function skeleton(count = 4) {
  return `<div class="skeleton-list">${Array.from({ length: count }, () => '<div class="skeleton-row"><span class="sk-icon"></span><span class="sk-lines"><i></i><i></i></span></div>').join('')}</div>`;
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/discover';
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');
  if (parts[0] === 'app' && parts[1] && parts[2]) {
    return { name: 'detail', repo: `${decodeURIComponent(parts[1])}/${decodeURIComponent(parts[2])}` };
  }
  if (parts[0] === 'search') return { name: 'search', params };
  if (parts[0] === 'library') return { name: 'library', params };
  if (parts[0] === 'settings') return { name: 'settings', params };
  return { name: 'discover' };
}

function updateChrome() {
  const back = $('#backBtn');
  back.classList.toggle('hidden', state.route.name !== 'detail');
  const active = state.route.name === 'detail' ? '' : state.route.name;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === active));
  updateRatePill();
}

function updateRatePill() {
  const pill = $('#ratePill');
  if (!pill) return;
  const text = gh.rateSummary();
  if (!text) {
    pill.classList.add('hidden');
    return;
  }
  pill.classList.remove('hidden');
  pill.textContent = text;
  pill.classList.toggle('warn', gh.rate.remaining === 0);
}

async function route() {
  const next = parseRoute();
  state.route = next;
  if (next.name === 'search') {
    const q = next.params.get('q');
    if (q !== null && q !== state.search.q) {
      state.search = { q, local: [], api: [], loading: false, done: false, error: '' };
    }
  }
  updateChrome();
  window.scrollTo(0, 0);
  if (next.name === 'discover') renderDiscover();
  else if (next.name === 'search') renderSearch();
  else if (next.name === 'detail') await renderDetail(next.repo);
  else if (next.name === 'library') await renderLibrary();
  else if (next.name === 'settings') renderSettings();
}

function categoryName(id) {
  return store.categories().find((c) => c.id === id)?.name || id;
}

function appRow(app) {
  const primary = app.asset || pickPrimaryAsset(app.assets || []);
  const installed = store.installedForRepo(app.repo, state.installed);
  const update = installed && app.version && isNewer(app.version, installed.versionName);
  return `<a class="app-row" href="${detailHref(app.repo)}">
    ${appIcon(app)}
    <div class="app-main">
      <div class="app-title">${esc(app.name)}${app.custom ? ' <span class="badge">added</span>' : ''}</div>
      <div class="app-sub">${esc(app.repo)}</div>
      <div class="app-desc">${esc(app.desc || '')}</div>
      <div class="app-meta">
        <span class="badge ghost">${esc(versionLabel(app))}</span>
        ${Number(app.stars) > 0 ? `<span>${icon('star', 13)} ${fmtNum(app.stars)}</span>` : ''}
        ${primary ? `<span>${esc(primary.sizeText || fmtBytes(primary.size))}</span>` : ''}
        ${installed ? `<span class="badge accent">${update ? 'update' : 'installed'}</span>` : ''}
      </div>
    </div>
    <span class="chev">${icon('chevron')}</span>
  </a>`;
}

function repoRow(r) {
  const known = store.appByRepo(r.repo);
  return `<a class="app-row" href="${detailHref(r.repo)}">
    ${appIcon({ repo: r.repo, name: r.name })}
    <div class="app-main">
      <div class="app-title">${esc(r.name)}${r.archived ? ' <span class="badge">archived</span>' : ''}</div>
      <div class="app-sub">${esc(r.repo)}</div>
      <div class="app-desc">${esc(r.desc || 'No description')}</div>
      <div class="app-meta">
        <span>${icon('star', 14)} ${fmtNum(r.stars)}</span>
        ${r.license ? `<span>${esc(r.license)}</span>` : ''}
        ${known ? `<span class="badge ghost">${esc(known.tag)}</span>` : '<span class="badge">check releases</span>'}
      </div>
    </div>
    <span class="chev">${icon('chevron')}</span>
  </a>`;
}

function featureCard(app) {
  return `<a class="feature-card" href="${detailHref(app.repo)}">
    ${appIcon(app, 'app-icon lg')}
    <div class="feature-name">${esc(app.name)}</div>
    <div class="feature-desc">${esc(app.desc || '')}</div>
    <div class="feature-foot">
      <span class="badge ghost">${esc(versionLabel(app))}</span>
      <span class="muted">${esc(fmtBytes(app.asset?.size || 0))}</span>
    </div>
  </a>`;
}

function renderDiscover() {
  const cat = store.catalog();
  if (!cat.apps.length) {
    setView(
      `${pageHead('GitStore', 'A GitHub-only app store.')}
       <div class="empty">${icon('github', 36)}<h2>No catalog loaded</h2><p>Refresh the catalog to scrape APK releases from GitHub.</p><button class="btn primary" data-action="refresh-catalog">${icon('refresh')} Refresh catalog</button></div>`,
    );
    return;
  }

  const counts = store.categoryCounts();
  let chips = [{ id: 'all', name: 'All' }].concat(
    store.categories().filter((c) => c.id !== 'all' && counts[c.id]),
  );
  if (cat.customCount) chips = chips.concat([{ id: 'custom', name: 'My additions' }]);

  const filter = state.catalogFilter;
  let list = cat.apps;
  if (filter === 'custom') list = list.filter((a) => a.custom);
  else if (filter !== 'all') list = list.filter((a) => a.category === filter);
  list = [...list].sort(
    (a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0) || String(a.name).localeCompare(String(b.name)),
  );

  const feat = store.featured();
  const appsCount = cat.apps.length;
  const catCount = store.categories().filter((c) => c.id !== 'all' && counts[c.id]).length;

  setView(`
    <section class="hero">
      <div class="hero-top"><span class="logo-badge">${icon('github', 22)}</span><span class="eyebrow">GitHub only</span></div>
      <h1>Apps straight from the source.</h1>
      <p>${appsCount} open-source Android apps with APK releases, scraped from GitHub. No accounts, no ads, no middleman.</p>
      <div class="hero-stats">
        <div><b>${appsCount}</b><span>apps</span></div>
        <div><b>${catCount}</b><span>categories</span></div>
        <div><b>${cat.generatedAt ? esc(timeAgo(cat.generatedAt)) : 'bundled'}</b><span>catalog age</span></div>
      </div>
      <div class="hero-actions">
        <a class="btn primary" href="#/search">${icon('search')} Find an app</a>
        <button class="btn ghost" data-action="refresh-catalog">${icon('refresh')} Refresh</button>
      </div>
    </section>

    <a class="search-trigger" href="#/search">${icon('search')}<span>Search GitHub for Android apps</span></a>

    <div class="chips" id="catChips">
      ${chips
        .map(
          (c) =>
            `<button class="chip ${filter === c.id ? 'active' : ''}" data-action="filter" data-filter="${esc(c.id)}">${esc(c.name)}${c.id === 'all' ? ` <span class="chip-count">${appsCount}</span>` : counts[c.id] ? ` <span class="chip-count">${counts[c.id]}</span>` : ''}</button>`,
        )
        .join('')}
    </div>

    <section class="section">
      <div class="section-head"><h2>Featured</h2><span class="muted">hand-picked</span></div>
      <div class="hscroll">${feat.map(featureCard).join('')}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Live from GitHub</h2><a class="link" href="#/search?q=${encodeURIComponent('topic:android')}">See all</a></div>
      <div id="livePicks">${liveHtml()}</div>
    </section>

    <section class="section" id="catalogList">
      <div class="section-head"><h2>${esc(filter === 'all' ? 'All apps' : filter === 'custom' ? 'My additions' : categoryName(filter))}</h2><span class="muted">${list.length} apps · by popularity</span></div>
      <div class="app-list">${list.map(appRow).join('') || emptyInline('Nothing here yet.')}</div>
    </section>
  `);

  loadLivePicks();
}

function emptyInline(text) {
  return `<div class="empty small">${icon('box', 26)}<p>${esc(text)}</p></div>`;
}

function liveHtml() {
  if (state.live.items.length) return `<div class="app-list">${state.live.items.map(repoRow).join('')}</div>`;
  if (state.live.loading) return skeleton(2);
  if (state.live.error) return `<div class="callout warn">${icon('alert')} ${esc(state.live.error)}</div>`;
  return emptyInline('Live results will appear here.');
}

function loadLivePicks() {
  if (state.live.loading || state.live.loaded) return;
  state.live.loading = true;
  const host = $('#livePicks');
  if (host) host.innerHTML = skeleton(2);
  gh.searchRepos({ q: gh.livePicksQuery(), sort: 'updated', perPage: 8 })
    .then((res) => {
      state.live.items = res.items.filter(gh.isAndroidish).slice(0, 6);
      state.live.items.forEach(memoRepo);
      state.live.loaded = true;
      state.live.loading = false;
      const h = $('#livePicks');
      if (h) h.innerHTML = liveHtml();
      updateRatePill();
    })
    .catch((err) => {
      state.live.loading = false;
      state.live.error = err.message || 'Could not reach GitHub';
      const h = $('#livePicks');
      if (h) h.innerHTML = liveHtml();
      updateRatePill();
    });
}

function renderSearch() {
  const q = state.search.q;
  setView(`
    <div class="page-head"><h1>Search</h1><p>Find Android apps with APK releases anywhere on GitHub.</p></div>
    <form class="search-box" id="searchForm">
      ${icon('search', 20)}
      <input id="searchInput" type="search" placeholder="youtube, notes, launcher, emulator…" value="${esc(q)}" autocomplete="off" spellcheck="false" enterkeyhint="search">
      <button type="submit" class="btn primary">Search</button>
    </form>
    <div class="chips" id="suggestChips">
      ${['youtube', 'music', 'notes', 'launcher', 'emulator', 'privacy', 'rss', 'manga', 'keyboard', 'torrent']
        .map((s) => `<button type="button" class="chip" data-suggest="${s}">${s}</button>`)
        .join('')}
    </div>
    <div id="searchResults">${searchResultsHtml()}</div>
  `);

  const input = $('#searchInput');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const run = debounce(() => {
    state.search.q = input.value.trim();
    performSearch(state.search.q);
  }, 450);
  input.addEventListener('input', run);
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.search.q = input.value.trim();
    performSearch(state.search.q);
  });
  $('#suggestChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-suggest]');
    if (!chip) return;
    input.value = chip.dataset.suggest;
    state.search.q = chip.dataset.suggest;
    performSearch(state.search.q);
  });

  if (q && !state.search.done && !state.search.loading) performSearch(q);
}

function searchResultsHtml() {
  const s = state.search;
  if (!s.q) {
    return `<div class="empty">${icon('search', 32)}<h3>Search GitHub</h3><p>Type a keyword above. GitStore finds repositories, then checks their releases for real APK files.</p></div>`;
  }
  if (s.loading && !s.local.length && !s.api.length) return skeleton(4);

  let html = '';
  if (s.error) html += `<div class="callout warn">${icon('alert')}<div>${esc(s.error)}</div></div>`;
  if (s.local.length) {
    html += `<div class="section-head"><h2>In your catalog</h2><span class="muted">${s.local.length}</span></div><div class="app-list">${s.local.map(appRow).join('')}</div>`;
  }
  if (s.api.length) {
    html += `<div class="section-head"><h2>On GitHub</h2><span class="muted">${s.api.length}</span></div><div class="app-list">${s.api.map(repoRow).join('')}</div>`;
  }
  if (!html) {
    html = `<div class="empty">${icon('search', 30)}<h3>No matches</h3><p>Try another keyword, or paste a GitHub repo name.</p></div>`;
  }
  return html;
}

function refreshSearchResults() {
  const host = $('#searchResults');
  if (host) host.innerHTML = searchResultsHtml();
}

async function performSearch(term) {
  state.search.term = term;
  state.search.loading = true;
  state.search.done = false;
  state.search.error = '';
  state.search.local = store.searchLocal(term);
  refreshSearchResults();

  let api = [];
  let error = '';
  if (String(term).length >= 2) {
    try {
      const res = await gh.searchRepos({ q: gh.searchQuery(term), perPage: 30 });
      api = res.items.filter(gh.isAndroidish).map(memoRepo);
    } catch (err) {
      error =
        err instanceof gh.RateLimitError
          ? 'GitHub API limit reached. Add a personal token in Settings for 5,000 calls per hour.'
          : err.message || 'GitHub search failed';
    }
  }

  const localRepos = new Set(state.search.local.map((a) => a.repo.toLowerCase()));
  state.search.api = api.filter((r) => !localRepos.has(r.repo.toLowerCase()));
  state.search.error = error;
  state.search.loading = false;
  state.search.done = true;
  refreshSearchResults();
  updateRatePill();
}

function releaseCard(d, assets, selected, latestVersion, installed, canUpdate) {
  if (d.loading && !d.releases.length) {
    return `<div class="card">${skeleton(2)}</div>`;
  }
  if (!assets.length) {
    return `<div class="card">
      <div class="card-head"><h2>No APK assets</h2></div>
      <p class="muted">Recent releases on GitHub do not include an .apk file. The project may distribute through F-Droid or its own website.</p>
      <button class="btn ghost" data-action="github" data-url="${esc(d.app?.releasesPage || `https://github.com/${d.repo}/releases`)}">${icon('external')} Open releases page</button>
    </div>`;
  }
  const label = installed ? (canUpdate ? `Update to ${latestVersion}` : 'Reinstall') : `Install ${latestVersion}`;
  return `<section class="card release-card">
    <div class="card-head">
      <div><span class="eyebrow">Latest release</span><h2>${esc(d.releases[0]?.tag || 'Release')}</h2></div>
      ${d.releases[0] && isPrerelease(d.releases[0].tag) ? '<span class="badge warn">pre-release</span>' : ''}
    </div>
    <div class="meta-line">${d.releases[0]?.publishedAt ? esc(timeAgo(d.releases[0].publishedAt)) : 'GitHub release'}${d.source ? ` · ${d.source === 'scrape' ? 'scraped from github.com' : 'via GitHub API'}` : ''}</div>
    <div class="asset-list">
      ${assets
        .map(
          (a, i) => `<button class="asset ${selected?.url === a.url ? 'selected' : ''}" data-action="select-asset" data-index="${i}">
            <span class="radio"></span>
            <span class="asset-name">${esc(a.name)}</span>
            <span class="asset-size">${esc(a.sizeText || fmtBytes(a.size))}</span>
          </button>`,
        )
        .join('')}
    </div>
    <div class="install-row">
      <button class="btn primary wide" data-action="install">${icon('download')} ${esc(label)}</button>
      <button class="btn ghost" data-action="github" data-url="${esc(selected?.url || '')}" title="Download in browser">${icon('external')}</button>
    </div>
    <p class="hint">APK downloaded directly from the project's GitHub release. Android will ask you to confirm the install.</p>
  </section>`;
}

function releaseRows(d) {
  if (!d.releases.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>Releases</h2><span class="muted">${d.releases.length}</span></div>
    <div class="releases">
      ${d.releases
        .map((r) => {
          const open = d.openReleases.has(r.tag);
          return `<div class="release ${open ? 'open' : ''}">
            <button class="release-head" data-action="toggle-release" data-tag="${esc(r.tag)}">
              <span class="release-tag">${esc(r.tag)}</span>
              ${isPrerelease(r.tag) ? '<span class="badge warn">pre</span>' : ''}
              <span class="release-date">${r.publishedAt ? esc(timeAgo(r.publishedAt)) : ''}</span>
              <span class="release-count">${r.assets.length} APK</span>
              <span class="chev">${icon('chevron')}</span>
            </button>
            ${
              open
                ? `<div class="release-assets">${r.assets
                    .map(
                      (a) => `<div class="asset-row">
                        <span class="asset-name">${esc(a.name)}</span>
                        <span class="asset-size">${esc(a.sizeText || fmtBytes(a.size))}</span>
                        <button class="btn tiny primary" data-action="install-asset" data-repo="${esc(d.repo)}" data-url="${esc(a.url)}" data-name="${esc(a.name)}" data-size="${a.size || 0}">Install</button>
                      </div>`,
                    )
                    .join('')}</div>`
                : ''
            }
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

function paintDetail() {
  const d = state.detail;
  if (!d || state.route.name !== 'detail') return;
  const repo = d.repo;
  const app = d.app;
  const meta = d.meta;
  const name = app?.name || meta?.name || repo.split('/')[1];
  const desc = app?.desc || meta?.desc || '';
  const installed = store.installedForRepo(repo, state.installed);
  const latest = d.releases[0] || null;
  const assets = latest?.assets || [];
  const selected = d.selected && assets.some((a) => a.url === d.selected.url) ? d.selected : assets[0] || null;
  const latestVersion = latest?.version || app?.version || '';
  const canUpdate = installed && latestVersion && isNewer(latestVersion, installed.versionName);
  const stars = meta?.stars ?? app?.stars;
  const license = meta?.license || app?.license;
  const updated = meta?.updatedAt || '';
  const customButton = !app
    ? assets.length
      ? `<button class="btn ghost" data-action="add-custom">${icon('plus')} Add to my store</button>`
      : ''
    : app.custom
      ? `<button class="btn ghost danger" data-action="remove-custom" data-repo="${esc(repo)}">${icon('trash')} Remove from my store</button>`
      : '';

  const installedCard = installed
    ? `<div class="callout ${canUpdate ? 'warn' : 'success'}">${icon(canUpdate ? 'alert' : 'check', 20)}<div><b>${canUpdate ? 'Update available' : 'Installed'}</b> · v${esc(installed.versionName)}<div class="muted small">${esc(installed.packageName)}${canUpdate ? ` · latest ${esc(latestVersion)}` : ''}</div></div></div>`
    : '';

  setView(`
    <div class="detail-hero">
      ${appIcon({ repo, name }, 'app-icon xl')}
      <div class="detail-head">
        <h1>${esc(name)}</h1>
        <a class="repo-link" href="${esc(app?.page || meta?.page || `https://github.com/${repo}`)}" data-action="github" data-url="${esc(app?.page || meta?.page || `https://github.com/${repo}`)}">${esc(repo)} ${icon('external', 14)}</a>
        <p>${esc(desc || 'No description provided.')}</p>
        <div class="chips small">
          ${app?.category ? `<span class="badge ghost">${esc(categoryName(app.category))}</span>` : ''}
          ${stars != null ? `<span class="badge ghost">${icon('star', 13)} ${fmtNum(stars)}</span>` : ''}
          ${license ? `<span class="badge ghost">${esc(license)}</span>` : ''}
          ${updated ? `<span class="badge ghost">updated ${esc(timeAgo(updated))}</span>` : ''}
          ${app?.custom ? '<span class="badge">added by you</span>' : ''}
        </div>
      </div>
    </div>

    <div class="action-row">
      <button class="btn primary" data-action="install" ${assets.length ? '' : 'disabled'}>
        ${icon('download')} ${installed ? (canUpdate ? `Update to ${esc(latestVersion)}` : 'Reinstall') : `Install${latestVersion ? ' ' + esc(latestVersion) : ''}`}
      </button>
      ${installed ? `<button class="btn ghost" data-action="open-app" data-package="${esc(installed.packageName)}">${icon('play')} Open</button>` : ''}
      <button class="btn ghost" data-action="github" data-url="${esc(app?.page || meta?.page || `https://github.com/${repo}`)}">${icon('github')} GitHub</button>
      <button class="btn ghost" data-action="copy" data-text="${esc(repo)}">${icon('copy')}</button>
    </div>

    ${installedCard}

    ${releaseCard(d, assets, selected, latestVersion, installed, canUpdate)}

    ${d.error ? `<div class="callout warn">${icon('alert')}<div>${esc(d.error)}<div class="muted small">Showing cached catalog data when available.</div></div></div>` : ''}

    ${releaseRows(d)}

    ${customButton ? `<div class="row-gap">${customButton}</div>` : ''}

    <div class="callout">
      ${icon('shield', 20)}
      <div><b>Direct from GitHub.</b> This APK comes from <span class="mono">${esc(repo)}</span>'s public release assets. GitStore does not host or modify it.</div>
    </div>
  `);
}

async function renderDetail(repo) {
  if (!safeRepo(repo)) {
    setView(`${pageHead('Not found', 'That is not a valid GitHub repository.')}<a class="btn ghost" href="#/discover">Back to discover</a>`);
    return;
  }
  const app = store.appByRepo(repo);
  const meta = memoGet(repo);
  state.detail = {
    repo,
    app,
    meta,
    releases: [],
    selected: null,
    loading: true,
    error: '',
    source: '',
    openReleases: new Set(),
  };

  if (app?.assets?.length) {
    const rel = {
      tag: app.tag,
      name: app.tag,
      version: app.version,
      publishedAt: app.releasedAt,
      prerelease: isPrerelease(app.tag),
      assets: app.assets,
      page: app.releasesPage,
    };
    state.detail.releases = [rel];
    state.detail.selected = app.asset || rel.assets[0];
    state.detail.loading = false;
  }
  paintDetail();

  if (!meta) {
    gh.getRepo(repo)
      .then((r) => {
        memoRepo(r);
        if (state.detail?.repo === repo) {
          state.detail.meta = r;
          paintDetail();
        }
      })
      .catch(() => {});
  }

  try {
    const { releases, source } = await gh.resolveReleases(repo);
    if (state.detail?.repo !== repo) return;
    if (releases.length) {
      const merged = store.sortReleasesStableFirst(releases);
      state.detail.releases = merged;
      state.detail.source = source;
      const previous = state.detail.selected;
      const first = merged[0]?.assets || [];
      state.detail.selected = previous && first.some((a) => a.url === previous.url) ? previous : first[0] || null;
    }
    state.detail.loading = false;
    state.detail.error = '';
  } catch (err) {
    if (state.detail?.repo !== repo) return;
    state.detail.loading = false;
    if (!state.detail.releases.length) state.detail.error = err.message || 'Could not load releases';
  }
  paintDetail();
  updateRatePill();
}

function permStatusHtml(granted) {
  return granted
    ? `<span class="status ok">${icon('check', 16)} Allowed</span>`
    : `<span class="status warn">${icon('alert', 16)} Not allowed</span>`;
}

async function refreshInstallPermission() {
  if (!native.hasNative) return;
  try {
    const res = await native.canInstall();
    state.installPermission = Boolean(res.granted);
    const host = $('#permStatus');
    if (host) host.innerHTML = permStatusHtml(state.installPermission);
  } catch {
    /* ignore */
  }
}

function showProgress(pct, label) {
  const bar = $('#progressBar');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.querySelector('.bar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bar.querySelector('.label').textContent = label;
}

function hideProgress() {
  setTimeout(() => $('#progressBar')?.classList.add('hidden'), 500);
}

function onDownloadProgress(p) {
  const total = Number(p.total) || 0;
  const loaded = Number(p.loaded) || 0;
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  showProgress(pct, `${pct}% · ${fmtBytes(loaded)}${total ? ' / ' + fmtBytes(total) : ''}`);
}

function showPermissionSheet(repo, asset, app) {
  pendingInstall = { repo, asset, app };
  const m = openModal(`
    <div class="sheet-head"><h3>Allow installs</h3><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="sheet-text">Android needs your permission before GitStore can hand an APK to the package installer. Turn on <b>Allow from this source</b>, then come back.</p>
    <div class="sheet-actions">
      <button class="btn ghost" data-close>Later</button>
      <button class="btn primary" data-grant>${icon('shield')} Open settings</button>
    </div>
  `);
  m.el.querySelector('[data-grant]').addEventListener('click', async () => {
    try {
      await native.openInstallSettings();
      m.close();
      toast('Enable installs, then tap Install again');
    } catch (err) {
      toast(err.message || 'Could not open settings', 'error');
    }
  });
}

async function installDirect(repo, asset, app) {
  if (!asset?.url) {
    toast('No APK asset selected', 'error');
    return;
  }
  if (!native.hasNative) {
    window.open(asset.url, '_blank', 'noopener');
    return;
  }
  const can = await native.canInstall().catch(() => ({ granted: false }));
  state.installPermission = Boolean(can.granted);
  if (!can.granted) {
    showPermissionSheet(repo, asset, app);
    return;
  }
  showProgress(0, 'Starting download…');
  try {
    const res = await native.installApk({ url: asset.url, fileName: asset.name, repo });
    if (res.needPermission) {
      hideProgress();
      showPermissionSheet(repo, asset, app);
      return;
    }
    store.saveLibraryEntry(repo, res);
    hideProgress();
    toast('Installer opened. Confirm to finish.', 'success');
    setTimeout(() => loadInstalled(true), 2200);
    if (state.route.name === 'detail' && state.detail?.repo === repo) paintDetail();
    return true;
  } catch (err) {
    hideProgress();
    toast(err.message || 'Install failed', 'error');
    return false;
  }
}

async function installSelected() {
  const d = state.detail;
  if (!d) return;
  const assets = d.releases[0]?.assets || [];
  const asset = d.selected && assets.some((a) => a.url === d.selected.url) ? d.selected : assets[0];
  await installDirect(d.repo, asset, d.app);
}

function addCustomFromDetail() {
  const d = state.detail;
  if (!d) return;
  const latest = d.releases[0];
  const asset = d.selected || latest?.assets?.[0];
  if (!latest || !asset) {
    toast('No APK to add', 'error');
    return;
  }
  const entry = {
    repo: d.repo,
    name: d.meta?.name || d.repo.split('/')[1],
    category: 'tools',
    desc: d.meta?.desc || '',
    owner: d.repo.split('/')[0],
    icon: avatarUrl(d.repo),
    page: `https://github.com/${d.repo}`,
    releasesPage: `https://github.com/${d.repo}/releases`,
    tag: latest.tag,
    version: latest.version,
    releasedAt: latest.publishedAt,
    stars: d.meta?.stars || 0,
    asset,
    assets: latest.assets,
    custom: true,
  };
  store.addCustomApp(entry);
  d.app = store.appByRepo(d.repo);
  toast('Added to your store', 'success');
  paintDetail();
}

async function loadInstalled(silent = false) {
  if (!native.hasNative) {
    state.installedLoaded = true;
    return;
  }
  if (state.installedLoading) return;
  state.installedLoading = true;
  try {
    const res = await native.getInstalled();
    state.installed = (res.apps || []).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    state.installedError = '';
    state.installedLoaded = true;
    const pkgMap = store.packageToRepo();
    for (const app of state.installed) {
      const repo = pkgMap.get(app.packageName);
      if (repo) {
        store.saveLibraryEntry(repo, {
          packageName: app.packageName,
          versionName: app.versionName,
          versionCode: app.versionCode,
          label: app.label,
        });
      }
    }
  } catch (err) {
    state.installedError = err.message || 'Could not read installed apps';
    state.installedLoaded = true;
  }
  state.installedLoading = false;
  if (!silent && state.route.name === 'library') renderLibrary();
  if (state.route.name === 'detail') paintDetail();
}

function libTabs(updates) {
  const counts = {
    installed: state.installed.filter((a) => !a.isSystem).length,
    updates: updates.length,
    tracked: store.trackedApps().length,
  };
  return `<div class="segmented big">
    ${[
      ['installed', `Installed${counts.installed ? ` ${counts.installed}` : ''}`],
      ['updates', `Updates${counts.updates ? ` ${counts.updates}` : ''}`],
      ['tracked', `Tracked${counts.tracked ? ` ${counts.tracked}` : ''}`],
      ['scan', `Scan${state.scanMatches.length ? ` ${state.scanMatches.length}` : ''}`],
    ]
      .map(
        ([id, label]) =>
          `<button class="${state.libTab === id ? 'active' : ''}" data-action="lib-tab" data-tab="${id}">${esc(label)}</button>`,
      )
      .join('')}
  </div>`;
}

function installedRows(updates) {
  const updateByPkg = new Map(updates.map((u) => [u.installed.packageName, u]));
  let list = state.installed.filter((a) => state.showSystem || !a.isSystem);
  const q = state.installedQuery.trim().toLowerCase();
  if (q) list = list.filter((a) => `${a.label} ${a.packageName}`.toLowerCase().includes(q));
  if (!list.length) {
    return `<div class="empty small">${icon('box', 28)}<p>No installed apps match. ${
      native.hasNative ? '' : 'Install the Android APK to see installed apps.'
    }</p></div>`;
  }
  return `<div class="app-list">${list
    .map((a) => {
      const repo = store.findRepoForInstalled(a);
      const update = updateByPkg.get(a.packageName);
      return `<div class="app-row static" data-label="${esc(`${a.label} ${a.packageName}`.toLowerCase())}">
        ${letterAvatar(a.label)}
        <div class="app-main">
          <div class="app-title">${esc(a.label)}${a.isSystem ? ' <span class="badge">system</span>' : ''}${update ? ' <span class="badge accent">update</span>' : ''}</div>
          <div class="app-sub">${esc(a.packageName)}</div>
          <div class="app-meta">
            <span>v${esc(a.versionName || '?')}</span>
            ${repo ? `<a class="link" href="${detailHref(repo)}">${esc(repo)}</a>` : ''}
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-action="open-package" data-package="${esc(a.packageName)}" aria-label="Open">${icon('play', 18)}</button>
          <button class="icon-btn" data-action="uninstall-package" data-package="${esc(a.packageName)}" aria-label="Uninstall">${icon('trash', 18)}</button>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function updatesPanel(updates) {
  if (state.checking) {
    return `<div class="card"><div class="card-head"><h2>Checking…</h2></div><p class="muted" id="checkProgress">Looking up latest releases on GitHub.</p></div>`;
  }
  if (!updates.length) {
    return `<div class="empty">${icon('check', 32)}<h3>Everything is up to date</h3><p>Updates are detected for apps installed through GitStore.</p><button class="btn ghost" data-action="check-updates">${icon('refresh')} Check again</button></div>`;
  }
  return `<div class="app-list">${updates
    .map(
      (u) => `<div class="app-row static">
        ${appIcon(u.app)}
        <div class="app-main">
          <div class="app-title">${esc(u.app.name)} <span class="badge accent">update</span></div>
          <div class="app-sub">${esc(u.installed.versionName)} → ${esc(u.latest)}</div>
          <div class="app-meta"><span>${esc(u.repo)}</span></div>
        </div>
        <button class="btn tiny primary" data-action="install-update" data-repo="${esc(u.repo)}">Update</button>
      </div>`,
    )
    .join('')}</div>`;
}

function trackedPanel() {
  const tracked = store.trackedApps();
  if (!tracked.length) {
    return `<div class="empty">${icon('box', 30)}<h3>Nothing tracked yet</h3><p>Apps you install through GitStore appear here so you can update or reinstall them.</p><a class="btn primary" href="#/discover">Browse apps</a></div>`;
  }
  return `<div class="app-list">${tracked
    .map(({ entry, app }) => {
      const installed = state.installed.find((a) => a.packageName === entry.packageName);
      const update = app && installed && isNewer(app.version, installed.versionName);
      return `<div class="app-row static">
        ${appIcon(app || { repo: entry.repo, name: entry.label })}
        <div class="app-main">
          <div class="app-title">${esc(app?.name || entry.label || entry.repo)}${update ? ' <span class="badge accent">update</span>' : ''}</div>
          <div class="app-sub">${esc(entry.repo)}</div>
          <div class="app-meta">
            <span>${installed ? `installed v${esc(installed.versionName)}` : 'not installed'}</span>
            ${app?.version ? `<span>latest ${esc(app.version)}</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          ${installed ? `<button class="icon-btn" data-action="open-package" data-package="${esc(entry.packageName)}" aria-label="Open">${icon('play', 18)}</button>` : ''}
          ${update ? `<button class="btn tiny primary" data-action="install-update" data-repo="${esc(entry.repo)}">Update</button>` : ''}
          <button class="icon-btn" data-action="remove-tracked" data-repo="${esc(entry.repo)}" aria-label="Remove">${icon('close', 18)}</button>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function scanPanel() {
  if (!native.hasNative) {
    return `<div class="empty">${icon('info', 30)}<h3>Android only</h3><p>Install the Android APK to scan installed apps.</p></div>`;
  }
  if (state.installedLoading && !state.installedLoaded) return skeleton(4);
  const tracked = new Set(Object.values(store.getLibrary()).map((entry) => entry.packageName));
  const matches = state.scanMatches;
  if (!matches.length) {
    return `<div class="empty">${icon('search', 30)}<h3>No matches found</h3><p>None of your installed apps matched the GitHub catalog by name or package.</p></div>`;
  }
  return `<div class="card"><div class="card-head"><h2>${matches.length} GitHub apps found</h2><span class="muted">tap Track to receive updates</span></div></div>
    <div class="app-list">${matches
      .map(
        ({ installed, app }) => `<div class="app-row static">
        ${appIcon(app)}
        <div class="app-main">
          <div class="app-title">${esc(installed.label)} <span class="badge ghost">${esc(app.name)}</span></div>
          <div class="app-sub">${esc(installed.packageName)}</div>
          <div class="app-meta"><span>v${esc(installed.versionName || '?')}</span><span>${esc(app.repo)}</span></div>
        </div>
        <button class="btn tiny ${tracked.has(installed.packageName) ? 'ghost' : 'primary'}" data-action="track-installed" data-repo="${esc(app.repo)}" data-package="${esc(installed.packageName)}" ${tracked.has(installed.packageName) ? 'disabled' : ''}>${tracked.has(installed.packageName) ? 'Tracked' : 'Track'}</button>
      </div>`,
      )
      .join('')}</div>`;
}

async function renderLibrary() {
  if (!state.installedLoaded && native.hasNative && !state.installedLoading) {
    setView(`${pageHead('Library', 'Installed and tracked apps.')}${skeleton(5)}`);
    await loadInstalled(true);
  }
  state.scanMatches = store.scanMatches(state.installed);
  const updates = store.getUpdates(state.installed);
  let body = '';
  if (state.libTab === 'installed') {
    body = `
      <div class="lib-tools">
        <input id="installedFilter" type="search" placeholder="Filter installed apps" value="${esc(state.installedQuery)}" autocomplete="off">
        <button class="btn tiny ghost ${state.showSystem ? 'active' : ''}" data-action="toggle-system">${state.showSystem ? 'Hide system' : 'Show system'}</button>
        <button class="icon-btn" data-action="refresh-installed" aria-label="Refresh">${icon('refresh', 18)}</button>
      </div>
      ${state.installedError ? `<div class="callout warn">${icon('alert')} ${esc(state.installedError)}</div>` : ''}
      ${installedRows(updates)}`;
  } else if (state.libTab === 'updates') {
    body = `<div class="lib-tools"><button class="btn ghost" data-action="check-updates">${icon('refresh')} Check for updates</button></div>${updatesPanel(updates)}`;
  } else if (state.libTab === 'scan') {
    body = `<div class="lib-tools"><button class="btn ghost" data-action="refresh-installed">${icon('refresh')} Rescan device</button></div>${scanPanel()}`;
  } else {
    body = trackedPanel();
  }

  setView(`
    ${pageHead('Library', 'Installed and tracked apps.')}
    ${!native.hasNative ? `<div class="callout warn">${icon('info')} Browser preview: installs and app management need the Android APK.</div>` : ''}
    ${libTabs(updates)}
    ${body}
  `);

  const filter = $('#installedFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      state.installedQuery = filter.value;
      const q = filter.value.trim().toLowerCase();
      $$('.app-row[data-label]').forEach((row) => {
        row.classList.toggle('hidden', q && !row.dataset.label.includes(q));
      });
    });
  }
}

async function checkUpdates() {
  if (!native.hasNative) {
    toast('Update checks need the Android app', 'error');
    return;
  }
  const tracked = store.trackedApps().filter((t) => t.app);
  if (!tracked.length) {
    toast('Install an app first', 'error');
    return;
  }
  state.checking = true;
  if (state.route.name === 'library') renderLibrary();
  const slice = tracked.slice(0, 20);
  let done = 0;
  await pool(slice, 3, async ({ app }) => {
    try {
      const { releases } = await gh.resolveReleases(app.repo);
      const rel = store.sortReleasesStableFirst(releases)[0];
      if (rel?.assets?.length) store.updateAppRelease(app.repo, rel);
    } catch {
      /* skip */
    }
    done++;
    const host = $('#checkProgress');
    if (host) host.textContent = `Checked ${done} of ${slice.length}…`;
  });
  state.checking = false;
  if (state.route.name === 'library') renderLibrary();
  toast('Update check finished', 'success');
}

function renderSettings() {
  const s = store.settings();
  const cat = store.catalog();
  setView(`
    ${pageHead('Settings', 'Catalog, installs and GitHub access.')}
    ${!native.hasNative ? `<div class="callout warn">${icon('info')} Browser preview. Installs, installed-app management and catalog refresh require the Android build.</div>` : ''}

    <section class="card">
      <div class="card-head"><h2>GitHub access</h2><span class="muted">${esc(gh.rateSummary())}</span></div>
      <p class="muted">An optional personal access token raises the API limit from 60 to 5,000 requests per hour. It is stored only on this device.</p>
      <div class="field-row">
        <input id="tokenInput" type="password" placeholder="ghp_…" value="${esc(gh.getToken())}" autocomplete="off" spellcheck="false">
        <button class="btn primary" data-action="save-token">Save</button>
      </div>
      ${gh.getToken() ? `<button class="btn tiny ghost" data-action="clear-token">Remove token</button>` : ''}
      <p class="hint">No scopes are needed for public repositories.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="segmented">
        ${['system', 'light', 'dark']
          .map((t) => `<button class="${s.theme === t ? 'active' : ''}" data-action="theme" data-theme="${t}">${t}</button>`)
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Installing apps</h2><span id="permStatus">${native.hasNative ? (state.installPermission === null ? '<span class="muted">checking…</span>' : permStatusHtml(state.installPermission)) : '<span class="muted">Android only</span>'}</span></div>
      <p class="muted">GitStore downloads the APK straight from GitHub and hands it to Android's package installer.</p>
      ${native.hasNative ? `<button class="btn ghost" data-action="grant-install">${icon('shield')} Open install permission</button>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Updates</h2><span class="muted">${s.autoUpdate ? 'automatic' : 'manual'}</span></div>
      <div class="kv"><span>Auto-update tracked apps</span><button class="btn tiny ${s.autoUpdate ? 'primary' : 'ghost'}" data-action="toggle-auto-update">${s.autoUpdate ? 'On' : 'Off'}</button></div>
      <p class="hint">When GitStore opens, newer mirrored releases are downloaded and handed to Android's installer.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Catalog</h2><span class="muted">${cat.apps.length} apps</span></div>
      <div class="kv"><span>Generated</span><b>${cat.generatedAt ? esc(timeAgo(cat.generatedAt)) : 'bundled'}</b></div>
      <div class="kv"><span>Source</span><b>github.com release assets</b></div>
      <div class="kv"><span>Seed repos</span><b>${store.seeds().length || '—'}</b></div>
      <div class="row-gap">
        <button class="btn primary" data-action="refresh-catalog">${icon('refresh')} Refresh catalog</button>
        <button class="btn ghost" data-action="mirror-catalog">Sync latest</button>
        <button class="btn ghost" data-action="reset-catalog">Reset</button>
      </div>
      <p class="hint">Refresh scrapes github.com release pages for all seed repos. It uses no API token and no quota.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Data</h2></div>
      <div class="row-gap">
        <button class="btn ghost" data-action="clear-cache">Clear API cache</button>
        <button class="btn ghost danger" data-action="clear-library">Clear library</button>
      </div>
    </section>

    <section class="card about">
      <div class="brand-line">${icon('github', 22)} <b>GitStore</b> <span class="badge ghost">v${APP_VERSION}</span></div>
      <p class="muted">A GitHub-only app store. The catalog is scraped from public release assets. Not affiliated with GitHub. GPL-3.0.</p>
    </section>
  `);
  refreshInstallPermission();
}

async function refreshCatalogFlow() {
  if (!native.hasNative) {
    toast('Catalog refresh needs the Android app', 'error');
    return;
  }
  const seeds = store.seeds();
  if (!seeds.length) {
    toast('No seed repos available', 'error');
    return;
  }
  const ok = await confirmDialog({
    title: 'Refresh catalog?',
    message: `Scrape ${seeds.length} GitHub repositories for APK releases. This can take a few minutes and uses your network.`,
    confirmText: 'Start',
  });
  if (!ok) return;

  let cancelled = false;
  const modal = openModal(`
    <div class="sheet-head"><h3>Scraping GitHub</h3><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
    <p class="sheet-text" id="scanStatus">Starting…</p>
    <div class="scan-bar"><div id="scanBar"></div></div>
    <div class="sheet-actions"><button class="btn ghost" data-cancel>Cancel</button></div>
  `);
  modal.el.querySelector('[data-cancel]').addEventListener('click', () => {
    cancelled = true;
    modal.close();
    toast('Refresh cancelled', 'info');
  });

  const entries = [];
  const skipped = [];
  let done = 0;
  const total = seeds.length;
  const status = () => {
    const text = modal.el.querySelector('#scanStatus');
    const bar = modal.el.querySelector('#scanBar');
    if (text) text.textContent = `${done} of ${total} repos · ${entries.length} with APK`;
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
  };
  status();

  await pool(
    seeds,
    3,
    async (seed) => {
      if (cancelled) return;
      try {
        const releases = await gh.scrapeReleases(seed.repo, 3);
        const rel = store.sortReleasesStableFirst(releases).find((r) => r.assets?.length);
        const known = store.appByRepo(seed.repo);
        const entry = rel ? store.buildEntry({ ...seed, stars: known?.stars || 0 }, rel) : null;
        if (entry) entries.push(entry);
        else skipped.push(seed.repo);
      } catch {
        skipped.push(seed.repo);
      }
      done++;
      status();
    },
    () => cancelled,
  );

  if (cancelled) return;
  if (!entries.length) {
    modal.close();
    toast('No APKs found — check your connection', 'error');
    return;
  }
  store.saveRefreshedCatalog(entries, skipped);
  state.catalogFilter = 'all';
  state.live.loaded = false;
  state.live.items = [];
  modal.close();
  toast(`Catalog refreshed: ${entries.length} apps`, 'success');
  route();
}

async function resetCatalog() {
  const ok = await confirmDialog({
    title: 'Reset catalog?',
    message: 'Restore the catalog bundled with the app. Your added apps and library are kept.',
    confirmText: 'Reset',
  });
  if (!ok) return;
  store.clearRefreshedCatalog();
  await store.init();
  state.catalogFilter = 'all';
  state.live.loaded = false;
  state.live.items = [];
  toast('Catalog reset', 'success');
  route();
}

async function saveToken() {
  const input = $('#tokenInput');
  const value = input ? input.value.trim() : '';
  gh.setToken(value);
  toast(value ? 'Token saved' : 'Token removed', 'success');
  updateRatePill();
  renderSettings();
}

async function onViewClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'filter':
      state.catalogFilter = target.dataset.filter;
      renderDiscover();
      $('#catalogList')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    case 'install':
      await installSelected();
      return;
    case 'install-asset':
      await installDirect(target.dataset.repo, {
        url: target.dataset.url,
        name: target.dataset.name,
        size: Number(target.dataset.size) || 0,
      });
      return;
    case 'select-asset': {
      const d = state.detail;
      if (!d) return;
      const assets = d.releases[0]?.assets || [];
      d.selected = assets[Number(target.dataset.index)] || assets[0];
      paintDetail();
      return;
    }
    case 'toggle-release': {
      const d = state.detail;
      if (!d) return;
      const tag = target.dataset.tag;
      if (d.openReleases.has(tag)) d.openReleases.delete(tag);
      else d.openReleases.add(tag);
      paintDetail();
      return;
    }
    case 'open-app':
    case 'open-package': {
      const pkg = target.dataset.package;
      if (!pkg) return;
      try {
        await native.openApp(pkg);
      } catch (err) {
        toast(err.message || 'Could not open app', 'error');
      }
      return;
    }
    case 'uninstall':
    case 'uninstall-package': {
      const pkg = target.dataset.package;
      if (!pkg) return;
      const ok = await confirmDialog({
        title: 'Uninstall app?',
        message: `Remove ${pkg} from this device?`,
        confirmText: 'Uninstall',
        danger: true,
      });
      if (!ok) return;
      try {
        await native.uninstall(pkg);
        toast('Uninstall requested', 'success');
        setTimeout(() => loadInstalled(true), 1800);
      } catch (err) {
        toast(err.message || 'Uninstall failed', 'error');
      }
      return;
    }
    case 'github':
    case 'open-url':
      native.openExternal(target.dataset.url || '');
      return;
    case 'copy':
      try {
        await navigator.clipboard.writeText(target.dataset.text || '');
        toast('Copied', 'success');
      } catch {
        toast('Copy failed', 'error');
      }
      return;
    case 'add-custom':
      addCustomFromDetail();
      return;
    case 'remove-custom':
      store.removeCustomApp(target.dataset.repo);
      toast('Removed from your store', 'success');
      route();
      return;
    case 'grant-install':
      try {
        await native.openInstallSettings();
      } catch (err) {
        toast(err.message || 'Could not open settings', 'error');
      }
      return;
    case 'refresh-catalog':
      refreshCatalogFlow();
      return;
    case 'reset-catalog':
      resetCatalog();
      return;
    case 'clear-cache':
      gh.clearCache();
      toast('API cache cleared', 'success');
      updateRatePill();
      return;
    case 'clear-library': {
      const ok = await confirmDialog({
        title: 'Clear library?',
        message: 'Forget tracked apps and their install mapping. Installed apps are not removed.',
        confirmText: 'Clear',
        danger: true,
      });
      if (!ok) return;
      store.clearLibrary();
      toast('Library cleared', 'success');
      route();
      return;
    }
    case 'check-updates':
      checkUpdates();
      return;
    case 'save-token':
      saveToken();
      return;
    case 'clear-token':
      gh.setToken('');
      toast('Token removed', 'success');
      renderSettings();
      return;
    case 'theme':
      store.saveSettings({ theme: target.dataset.theme });
      renderSettings();
      return;
    case 'track-installed': {
      const installed = state.installed.find((a) => a.packageName === target.dataset.package);
      if (!installed) return;
      store.saveLibraryEntry(target.dataset.repo, installed);
      toast(`Tracking ${installed.label}`, 'success');
      state.libTab = 'tracked';
      renderLibrary();
      return;
    }
    case 'toggle-auto-update':
      store.saveSettings({ autoUpdate: !store.settings().autoUpdate });
      toast(`Auto-update ${store.autoUpdateEnabled() ? 'enabled' : 'disabled'}`, 'success');
      renderSettings();
      return;
    case 'mirror-catalog': {
      const updated = await maybeMirror(true);
      toast(updated ? 'Catalog synced' : 'Already up to date', updated ? 'success' : 'info');
      return;
    }
    case 'refresh-installed':
      state.installedLoaded = false;
      await loadInstalled(true);
      renderLibrary();
      return;
    case 'toggle-system':
      state.showSystem = !state.showSystem;
      renderLibrary();
      return;
    case 'lib-tab':
      state.libTab = target.dataset.tab;
      renderLibrary();
      return;
    case 'install-update': {
      const app = store.appByRepo(target.dataset.repo);
      if (!app) return;
      const asset = app.asset || pickPrimaryAsset(app.assets || []);
      if (asset) await installDirect(app.repo, asset, app);
      return;
    }
    case 'remove-tracked':
      store.removeLibraryEntry(target.dataset.repo);
      toast('Removed from library', 'success');
      renderLibrary();
      return;
    default:
      return;
  }
}

async function maybeMirror(force = false) {
  const updated = await store.mirrorCatalog(force).catch(() => null);
  if (!updated) return false;
  toast(`Catalog updated · ${updated.apps.length} apps`, 'success');
  await route();
  if (native.hasNative && state.installedLoaded) runAutoUpdates();
  return true;
}

async function runAutoUpdates() {
  if (!native.hasNative || !store.autoUpdateEnabled() || state.autoRunning) return;
  state.autoRunning = true;
  try {
    const updates = store.getUpdates(state.installed).slice(0, 3);
    let sent = 0;
    for (const update of updates) {
      const asset = update.app.asset || pickPrimaryAsset(update.app.assets || []);
      if (!asset) continue;
      const ok = await installDirect(update.repo, asset, update.app);
      if (ok) sent++;
    }
    if (sent) toast(`${sent} update${sent > 1 ? 's' : ''} sent to installer`, 'success');
  } finally {
    state.autoRunning = false;
  }
}

async function boot() {
  $('#backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/discover';
  });
  window.addEventListener('hashchange', route);
  $('#view').addEventListener('click', onViewClick);

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    refreshInstallPermission();
    maybeMirror();
    runAutoUpdates();
    if (pendingInstall) {
      const can = await native.canInstall().catch(() => ({ granted: false }));
      if (can.granted) {
        const pending = pendingInstall;
        pendingInstall = null;
        installDirect(pending.repo, pending.asset, pending.app);
      }
    }
  });

  window.addEventListener('online', () => {
    toast('Back online', 'success');
    maybeMirror();
  });
  window.addEventListener('offline', () => toast('You are offline', 'error'));

  try {
    await store.init();
  } catch (err) {
    console.error(err);
  }
  gh.pruneCache();
  maybeMirror();
  await route();

  if (native.hasNative) {
    native.onDownloadProgress(onDownloadProgress);
    loadInstalled(true).then(() => {
      if (state.route.name === 'discover') renderDiscover();
      if (state.route.name === 'detail') paintDetail();
      runAutoUpdates();
    });
    refreshInstallPermission();
  }
}

boot();
