package com.gitstore.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "GitStore")
public class GitStorePlugin extends Plugin {

    private static final String UA = "GitStore/1.0 (Android; +https://github.com)";

    // ---------------------------------------------------------------- installed

    @PluginMethod
    public void getInstalled(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray apps = new JSArray();
        List<PackageInfo> packages = pm.getInstalledPackages(0);
        for (PackageInfo pi : packages) {
            ApplicationInfo ai = pi.applicationInfo;
            if (ai == null) continue;
            JSObject o = new JSObject();
            o.put("packageName", pi.packageName);
            o.put("versionName", pi.versionName == null ? "" : pi.versionName);
            o.put("versionCode", versionCode(pi));
            o.put("label", labelOf(pm, ai, pi.packageName));
            o.put("isSystem", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            o.put("firstInstallTime", pi.firstInstallTime);
            apps.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPackageInfo(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName is required");
            return;
        }
        JSObject ret = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(pkg, 0);
            ApplicationInfo ai = pi.applicationInfo;
            ret.put("installed", true);
            ret.put("packageName", pi.packageName);
            ret.put("versionName", pi.versionName == null ? "" : pi.versionName);
            ret.put("versionCode", versionCode(pi));
            ret.put("label", ai == null ? pkg : labelOf(getContext().getPackageManager(), ai, pkg));
        } catch (PackageManager.NameNotFoundException e) {
            ret.put("installed", false);
        }
        call.resolve(ret);
    }

    // ------------------------------------------------------------------ install

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void installApk(final PluginCall call) {
        final String url = call.getString("url");
        final String fileName = call.getString("fileName", "download.apk");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final File dir = new File(getContext().getCacheDir(), "apk");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Could not create download directory");
            return;
        }
        final String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        final File out = new File(dir, safe);

        new Thread(() -> {
            try {
                download(url, out);
                PackageManager pm = getContext().getPackageManager();
                PackageInfo pi = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
                if (pi == null) {
                    call.reject("The downloaded file is not a valid APK");
                    return;
                }
                ApplicationInfo ai = pi.applicationInfo;
                if (ai != null) {
                    ai.sourceDir = out.getAbsolutePath();
                    ai.publicSourceDir = out.getAbsolutePath();
                }
                String label = ai == null ? pi.packageName : labelOf(pm, ai, pi.packageName);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
                    JSObject ret = new JSObject();
                    ret.put("needPermission", true);
                    ret.put("packageName", pi.packageName);
                    ret.put("versionName", pi.versionName == null ? "" : pi.versionName);
                    ret.put("versionCode", versionCode(pi));
                    ret.put("label", label);
                    ret.put("path", out.getAbsolutePath());
                    call.resolve(ret);
                    return;
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    out
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);

                JSObject ret = new JSObject();
                ret.put("needPermission", false);
                ret.put("packageName", pi.packageName);
                ret.put("versionName", pi.versionName == null ? "" : pi.versionName);
                ret.put("versionCode", versionCode(pi));
                ret.put("label", label);
                ret.put("path", out.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null) {
            call.reject("packageName is required");
            return;
        }
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (intent == null) {
            call.reject("No launch intent for " + pkg);
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void uninstall(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null) {
            call.reject("packageName is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    // --------------------------------------------------------------- scraping

    /**
     * Scrapes GitHub's public release pages (no API token, no rate limit).
     * Returns recent releases that actually contain .apk assets.
     */
    @PluginMethod
    public void scrapeReleases(final PluginCall call) {
        final String repo = call.getString("repo");
        final int maxTags = call.getInt("maxTags", 3);
        if (repo == null || repo.isEmpty()) {
            call.reject("repo is required");
            return;
        }
        new Thread(() -> {
            try {
                List<String> tags = fetchTags(repo);
                tags.sort((a, b) -> Boolean.compare(isPrerelease(a), isPrerelease(b)));
                JSArray releases = new JSArray();
                int tried = 0;
                for (String tag : tags) {
                    if (tried >= maxTags) break;
                    tried++;
                    String html;
                    try {
                        html = httpGet(
                            "https://github.com/" + repo + "/releases/expanded_assets/" +
                            encodePath(tag)
                        );
                    } catch (Exception e) {
                        continue;
                    }
                    JSArray assets = parseAssets(html);
                    if (assets.length() == 0) continue;
                    JSObject rel = new JSObject();
                    rel.put("tag", tag);
                    rel.put("version", cleanVersion(tag));
                    rel.put("publishedAt", assets.length() > 0 && assets.optJSONObject(0) != null ? assets.optJSONObject(0).optString("releasedAt", "") : "");
                    rel.put("assets", assets);
                    releases.put(rel);
                }
                JSObject ret = new JSObject();
                ret.put("repo", repo);
                ret.put("releases", releases);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }).start();
    }

    private List<String> fetchTags(String repo) throws IOException {
        List<String> tags = new ArrayList<>();
        try {
            String atom = httpGet("https://github.com/" + repo + "/releases.atom");
            Matcher m = Pattern.compile(
                "href=\"https://github\\.com/[^\"]+/releases/tag/([^\"]+)\""
            ).matcher(atom);
            while (m.find()) {
                String tag = Uri.decode(m.group(1));
                if (!tags.contains(tag)) tags.add(tag);
            }
        } catch (Exception ignored) {
        }
        if (tags.isEmpty()) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(
                    "https://github.com/" + repo + "/releases/latest"
                ).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", UA);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(20000);
                conn.getResponseCode();
                String finalUrl = conn.getURL().toString();
                Matcher m = Pattern.compile("/releases/tag/([^/?#]+)").matcher(finalUrl);
                if (m.find()) tags.add(Uri.decode(m.group(1)));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        return tags;
    }

    private JSArray parseAssets(String html) {
        JSArray assets = new JSArray();
        String[] chunks = html.split("<li ");
        for (int i = 1; i < chunks.length; i++) {
            String chunk = chunks[i];
            Matcher hrefM = Pattern.compile("href=\"(/[^\"]+/releases/download/[^\"]+)\"").matcher(chunk);
            if (!hrefM.find()) continue;
            String href = unescape(hrefM.group(1));
            if (href.contains("/archive/")) continue;

            String name;
            Matcher nameM = Pattern.compile("<span class=\"text-bold\">([^<]+)</span>").matcher(chunk);
            if (nameM.find()) {
                name = unescape(nameM.group(1).trim());
            } else {
                name = href.substring(href.lastIndexOf('/') + 1);
            }
            if (!name.toLowerCase().endsWith(".apk")) continue;

            String sizeText = "";
            Matcher sizeM = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(Bytes|KB|MB|GB)").matcher(chunk);
            if (sizeM.find()) sizeText = sizeM.group(1) + " " + sizeM.group(2);

            String date = "";
            Matcher dateM = Pattern.compile("datetime=\"([^\"]+)\"").matcher(chunk);
            if (dateM.find()) date = dateM.group(1);

            JSObject asset = new JSObject();
            asset.put("name", name);
            asset.put("url", "https://github.com" + href);
            asset.put("sizeText", sizeText);
            asset.put("size", sizeToBytes(sizeText));
            asset.put("releasedAt", date);
            assets.put(asset);
        }
        return assets;
    }

    // ---------------------------------------------------------------- helpers

    private String httpGet(String url) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(25000);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            InputStream in = conn.getInputStream();
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            return out.toString("UTF-8");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void download(String url, File out) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/octet-stream");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setConnectTimeout(25000);
            conn.setReadTimeout(40000);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("Download failed: HTTP " + code);

            long total = conn.getContentLengthLong();
            InputStream in = conn.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[65536];
            long loaded = 0;
            long last = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
                loaded += n;
                long now = System.currentTimeMillis();
                if (now - last > 300) {
                    last = now;
                    JSObject progress = new JSObject();
                    progress.put("loaded", loaded);
                    progress.put("total", total);
                    progress.put("fileName", out.getName());
                    notifyListeners("downloadProgress", progress);
                }
            }
            fos.flush();
            fos.close();
            in.close();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static long versionCode(PackageInfo pi) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return pi.getLongVersionCode();
        return pi.versionCode;
    }

    private static String labelOf(PackageManager pm, ApplicationInfo ai, String fallback) {
        try {
            CharSequence label = pm.getApplicationLabel(ai);
            if (label != null && label.length() > 0) return label.toString();
        } catch (Exception ignored) {
        }
        return fallback;
    }

    private static long sizeToBytes(String text) {
        if (text == null) return 0;
        Matcher m = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(Bytes|KB|MB|GB)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (!m.find()) return 0;
        double value = Double.parseDouble(m.group(1));
        String unit = m.group(2).toLowerCase();
        double mult = unit.equals("gb") ? 1073741824d : unit.equals("mb") ? 1048576d : unit.equals("kb") ? 1024d : 1d;
        return Math.round(value * mult);
    }

    private static boolean isPrerelease(String tag) {
        return Pattern.compile(
            "(^|[._\\-/ ])(alpha|beta|rc|nightly|dev|pre|preview|canary|snapshot|test)",
            Pattern.CASE_INSENSITIVE
        ).matcher(tag == null ? "" : tag).find();
    }

    private static String encodePath(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return value;
        }
    }

    private static String cleanVersion(String tag) {
        return tag.replaceFirst("^[vV]", "");
    }

    private static String unescape(String s) {
        return s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&#x27;", "'");
    }
}
