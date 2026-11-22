// Small shared helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

export function timeAgo(input) {
  if (!input) return '';
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'in the future';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  const hrs = Math.round(min / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.round(days / 30);
  if (months < 12) return months + 'mo ago';
  return Math.round(months / 12) + 'y ago';
}

export function debounce(fn, wait = 300) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function cleanVersion(tag) {
  return String(tag ?? '')
    .replace(/^[vV]/, '')
    .replace(/^release[-_/ ]?/i, '');
}

export function isApk(name) {
  return /\.apk$/i.test(String(name ?? ''));
}

export function isPrerelease(tag) {
  return /(^|[._\-/ ])(alpha|beta|rc|nightly|dev|pre|preview|canary|snapshot|test)/i.test(String(tag ?? ''));
}

export function assetScore(asset) {
  const name = String(asset?.name ?? '').toLowerCase();
  let score = 0;
  if (name.includes('arm64') || name.includes('aarch64')) score += 100;
  if (name.includes('universal')) score += 80;
  if (name.includes('armeabi') || name.includes('arm-v7') || name.includes('armv7')) score += 40;
  if (name.includes('release')) score += 10;
  if (name.includes('debug')) score -= 30;
  if (name.includes('x86')) score -= 20;
  return score + Math.min((Number(asset?.size) || 0) / 1e9, 5);
}

export function sortAssets(assets = []) {
  return [...assets].sort((a, b) => assetScore(b) - assetScore(a));
}

export function pickPrimaryAsset(assets = []) {
  return sortAssets(assets.filter((a) => isApk(a.name)))[0] || null;
}

export function compareVersions(a, b) {
  const norm = (v) =>
    cleanVersion(v)
      .toLowerCase()
      .replace(/[+]/g, '.')
      .split(/[.\-_/ ]+/)
      .filter(Boolean);
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d > 0 ? 1 : -1;
    } else if (nx !== ny) {
      return nx ? 1 : -1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

export function isNewer(latest, installed) {
  if (!latest || !installed) return false;
  return compareVersions(latest, installed) > 0;
}

export function safeRepo(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

export function ownerOf(repo) {
  return String(repo || '').split('/')[0] || '';
}

export function avatarUrl(repo, size = 160) {
  return `https://github.com/${encodeURIComponent(ownerOf(repo))}.png?size=${size}`;
}

export function hashColor(text) {
  let h = 0;
  for (let i = 0; i < String(text).length; i++) h = (h * 31 + String(text).charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 42% 32%)`;
}

export function letterAvatar(name) {
  const letter = (String(name || '?').trim()[0] || '?').toUpperCase();
  return `<span class="letter-avatar" style="background:${hashColor(name)}">${esc(letter)}</span>`;
}

export function appIcon(app, cls = 'app-icon') {
  const repo = app.repo || app.full_name || '';
  const name = app.name || repo.split('/')[1] || '?';
  if (!repo) return `<span class="${cls}">${letterAvatar(name)}</span>`;
  const fallback = encodeURIComponent(letterAvatar(name));
  return `<span class="${cls}"><img loading="lazy" src="${esc(avatarUrl(repo))}" alt="" onerror="this.style.display='none';this.parentNode.classList.add('fallback');this.parentNode.insertAdjacentHTML('afterbegin', decodeURIComponent('${fallback}'))"></span>`;
}

const ICONS = {
  discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  library: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  github: '<path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  box: '<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 7.7 8 9 4.6-1.3 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
};

export function icon(name, size = 20) {
  const body = ICONS[name] || '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function toast(message, type = 'info', ms = 3200) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info', 18)}<span>${esc(message)}</span>`;
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 250);
  }, ms);
}

export function openModal(inner, { onClose } = {}) {
  const root = $('#modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 220);
    onClose?.();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  $$('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  return { el: overlay, close };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = openModal(
      `<div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
       <p class="sheet-text">${esc(message)}</p>
       <div class="sheet-actions">
         <button class="btn ghost" data-close>Cancel</button>
         <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmText)}</button>
       </div>`,
      { onClose: () => { if (!settled) { settled = true; resolve(false); } } },
    );
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      settled = true;
      resolve(true);
      m.close();
    });
  });
}

export function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function pool(items, limit, worker, shouldStop = () => false) {
  let index = 0;
  const run = async () => {
    while (!shouldStop()) {
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}
