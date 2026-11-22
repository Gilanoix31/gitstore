import { SEEDS } from './seeds.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const UA = 'GitStoreCatalogBot/1.0 (+https://github.com; catalog discovery)';

const QUERIES = [
  'topic:android archived:false fork:false stars:>100',
  'topic:android-app archived:false fork:false stars:>50',
  'topic:apk archived:false fork:false stars:>20',
  'topic:android-application archived:false fork:false',
  'topic:open-source-android archived:false fork:false',
  'topic:fdroid archived:false fork:false',
  'topic:android-tv archived:false fork:false',
  '"android app" in:description stars:>200 fork:false',
  'android in:name,description stars:>300 fork:false language:Java',
  'android in:name,description stars:>300 fork:false language:Kotlin',
  'topic:manga-reader archived:false fork:false',
  'topic:anime archived:false fork:false android',
  'topic:emulator archived:false fork:false android',
  'topic:game archived:false fork:false android',
  'topic:launcher archived:false fork:false android',
  'topic:music-player archived:false fork:false android',
  'topic:video-player archived:false fork:false android',
  'topic:privacy archived:false fork:false android',
  'topic:productivity archived:false fork:false android',
  'topic:llm archived:false fork:false android',
  'topic:self-hosted archived:false fork:false android',
];

const CATEGORY_RULES = [
  ['emulation', /emulat|retro|nes|snes|n64|n64|psp|ps1|ps2|ps3|ps4|ps5|mame|dosbox|winlator|mobox|switch|yuzu|ryujinx|flycast|azahar|melonds|duckstation|scummvm|rpcsx|xash|citra|vita3k|mupen|reicast|ppsspp|happy.?chick|redream|sameboy|gambatte|bsnes|snes9x|desmu|sharp|xemu|win10|windows.?emu| VirtualBox|qemu|termux.*win/i],
  ['manga', /manga|anime|comic|novel|webtoon|tachiyomi|mihon|komikku|anilist|myanimelist|jikan|otaku|nhentai|hentai|doujin|shonen|mangadex/i],
  ['ai', /\bai\b|\bllm\b|gpt|chatgpt|machine.?learning|tensorflow|llama|onnx|diffusion|stable.?diffusion|voice|speech|ocr|translat|copilot|gemini|claude|ollama|neural|deep.?learn|whisper|image.?gen/i],
  ['launchers', /launcher|theme|icon.?pack|wallpaper|home.?screen|lock.?screen|status.?bar|navigation.?bar|dock|widget/i],
  ['games', /game|gaming|minecraft|fps|rpg|puzzle|chess|\bgo\b|sudoku|tetris|flappy|platformer|doom|quake|osu|stepmania|guitar|2048|nonogram|solitaire|mahjong|card|poker|bingo|wordle|crossword|racing|shooter|arcade|roguelike|visual.?novel|gameboy|pokemon|gba|3ds|wii|psp|playstation|xbox|steam|lutris|gamehub/i],
  ['maps', /map|navigat|\bgps\b|osm|openstreetmap|travel|transit|bus|train|offline.?map|geocach|compass|speedometer|altimeter/i],
  ['health', /health|fitness|workout|meditation|sleep|step|calorie|diet|period|cycle|water|habit|heart|blood|weight|running|cycling|yoga|gym/i],
  ['privacy', /password|encrypt|\bvpn\b|privacy|security|tor|firewall|adblock|tracker|permission|secure|vault|authenticator|2fa|password.?manager|incognito|dns|proxy|root|magisk|sandbox/i],
  ['music', /music|audio|player|radio|podcast|spotify|subsonic|navidrome|audiosyn|equalizer|recorder|ringtone|speaker|bluetooth|synth|midi|lyrics|scrobble/i],
  ['media', /video|media|stream|youtube|iptv|jellyfin|kodi|player|torrent|download|vlc|mpv|netflix|spotube|newpipe|mediainfo|convert|camera|gallery|photo|image|tv|chromecast/i],
  ['social', /social|chat|messag|matrix|telegram|signal|whatsapp|mastodon|twitter|reddit|forum|\bcall\b|\bsms\b|contacts|email|\bmail\b|fediverse|discord|slack|bridge|sms|dialer/i],
  ['reading', /read|news|book|rss|feed|pdf|epub|article|wiki|newspaper|magazine|comic|reader|library|document/i],
  ['dev', /\bdev\b|ide|terminal|git|code|compiler|editor|adb|debug|api|python|nodejs|termux|tasker|automation|script|shell|database|sql|server|webdav|ftp|ssh|proxy|home.?assistant|iot/i],
  ['productivity', /note|todo|task|calendar|file|manager|cloud|sync|office|scanner|calculator|keyboard|clipboard|backup|productiv|markdown|org.?mode|diary|journal|planner|timer|reminder|launcher|password|bookmark|bookmarks/i],
  ['lifestyle', /finance|budget|money|bank|expense|invoice|crypto|wallet|stock|invest|shopping|recipe|cook|food|travel|home|smart|light|remote|control|life|hack|daily|weather|flashlight|level|ruler|barcode|\bqr\b|scanner|note|habit|diary|journal|sleep|meditat/i],
];

function guessCategory(repo) {
  const text = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
  for (const [id, re] of CATEGORY_RULES) if (re.test(text)) return id;
  return 'tools';
}

function guessName(repo) {
  return repo.name
    .replace(/[_-]+/g, ' ')
    .replace(/\b(android|app|client|fork|rewrite)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || repo.name;
}

async function search(q) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${q}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  await new Promise((r) => setTimeout(r, 2200));
  return data.items || [];
}

const known = new Set(SEEDS.map(([repo]) => repo.toLowerCase()));
const found = new Map();

for (const q of QUERIES) {
  try {
    const items = await search(q);
    for (const item of items) {
      const id = item.full_name?.toLowerCase();
      if (!id || known.has(id) || item.archived || item.fork || item.disabled) continue;
      if (!found.has(id)) found.set(id, item);
    }
    console.log(`${q} -> ${items.length} results, ${found.size} unique candidates`);
  } catch (err) {
    console.warn(`search failed: ${err.message}`);
  }
}

const candidates = [...found.values()]
  .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
  .slice(0, 700)
  .map((repo) => {
    const desc = (repo.description || `${guessName(repo)} for Android.`).replace(/\s+/g, ' ').trim().slice(0, 180);
    return [repo.full_name, guessCategory(repo), guessName(repo), desc, repo.stargazers_count || 0];
  });

await writeFile(path.join(ROOT, 'tools', 'discovered.json'), JSON.stringify({ seeds: candidates }, null, 1));
console.log(`Wrote ${candidates.length} discovered candidates`);
