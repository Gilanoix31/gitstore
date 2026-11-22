// Thin wrapper around the native GitStore Capacitor plugin.

const cap = globalThis.Capacitor;
const plugin =
  cap?.Plugins?.GitStore ||
  (typeof cap?.registerPlugin === 'function' ? cap.registerPlugin('GitStore') : null);

export const hasNative = Boolean(plugin);
export const isNativePlatform = Boolean(
  typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : plugin,
);

async function call(method, args = {}) {
  if (!plugin) throw new Error('Native bridge is not available in this preview');
  return plugin[method](args);
}

export const getInstalled = () => call('getInstalled');
export const getPackageInfo = (packageName) => call('getPackageInfo', { packageName });
export const canInstall = () => call('canInstall');
export const openInstallSettings = () => call('openInstallSettings');
export const installApk = (opts) => call('installApk', opts);
export const openApp = (packageName) => call('openApp', { packageName });
export const uninstall = (packageName) => call('uninstall', { packageName });
export const openUrl = (url) => call('openUrl', { url });
export const scrapeReleases = (repo, maxTags = 3) => call('scrapeReleases', { repo, maxTags });

export async function onDownloadProgress(cb) {
  if (!plugin?.addListener) return () => {};
  const handle = await plugin.addListener('downloadProgress', cb);
  return () => {
    try {
      handle?.remove?.();
    } catch {
      /* ignore */
    }
  };
}

export function openExternal(url) {
  if (hasNative) return openUrl(url).catch(() => window.open(url, '_blank'));
  window.open(url, '_blank', 'noopener');
  return Promise.resolve();
}
