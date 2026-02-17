// tools/filter_m3u.js
// Replaces HEAD-only checks with a small-range GET and content sniffing
// Keeps entries whose response indicates HLS (#EXTM3U or HLS content-type)

const fs = require('fs');
const fetch = require('node-fetch');
const { URL } = require('url');

const IPTV_MASTER = "https://iptv-org.github.io/iptv/index.m3u";
const OUTPUT_PATH = "./playlist/index.m3u";
const TIMEOUT_MS = 9000; // per-request timeout
const MAX_CONCURRENT = 12; // parallel requests
const RANGE_BYTES = 8191; // fetch first ~8KB

function timeoutFetch(input, opts = {}, ms = TIMEOUT_MS) {
  return Promise.race([
    fetch(input, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

async function getText(url) {
  const r = await timeoutFetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}

function parseM3URaw(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF')) {
      const meta = l;
      const name = meta.split(',').slice(1).join(',').trim();
      const tvgLogo = (meta.match(/tvg-logo="([^"]+)"/) || [null, null])[1] || "";
      const tvgId = (meta.match(/tvg-id="([^"]+)"/) || [null, null])[1] || "";
      const stream = (lines[i + 1] || "").trim();
      out.push({ metaLine: meta, name, tvgLogo, tvgId, streamLine: stream });
    }
  }
  return out;
}

async function sniffStream(url) {
  try {
    // ensure URL is valid
    new URL(url);
  } catch (e) {
    return false;
  }

  // Request a small byte range to avoid downloading whole stream
  const headers = {
    'User-Agent': 'iptv-filter/1.0 (+https://github.com)',
    'Range': `bytes=0-${RANGE_BYTES}`,
    'Accept': '*/*'
  };

  try {
    const r = await timeoutFetch(url, { method: 'GET', headers, redirect: 'follow' });
    // if server responds with a redirect to HTML or a 403/4xx, it's not valid
    if (!r.ok) return false;

    // If content-type explicitly indicates m3u8, accept.
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl') || ct.includes('vnd.apple.mpegurl')) {
      return true;
    }

    // Read the small chunk we requested
    const text = await r.text();

    // Common CDN misconfigurations might still return HTML - detect HLS header
    if (text && text.indexOf('#EXTM3U') !== -1) return true;

    // Some manifests are served with text/plain but still valid m3u8; check file extension
    if (url.toLowerCase().includes('.m3u8')) return true;

    return false;
  } catch (e) {
    // timeout, network, DNS, or other issue -> treat as invalid
    return false;
  }
}

async function filterAll() {
  console.log("Downloading master playlist:", IPTV_MASTER);
  const raw = await getText(IPTV_MASTER);
  const parsed = parseM3URaw(raw);
  console.log("Found", parsed.length, "entries. Now validating candidates...");

  const results = [];
  const seen = new Set();
  let i = 0;

  async function worker() {
    while (i < parsed.length) {
      const idx = i++;
      const item = parsed[idx];
      const s = item.streamLine;
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);

      // quick cheap filter: ensure it starts with http or https
      if (!/^https?:\/\//i.test(s)) continue;

      const ok = await sniffStream(s);
      if (ok) {
        results.push(item);
        console.log("KEEP:", item.name, s);
      } else {
        console.log("DROP:", item.name, s);
      }
    }
  }

  // spawn workers
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, 12) }).map(() => worker());
  await Promise.all(workers);

  // Build output
  console.log("Writing", results.length, "valid entries to", OUTPUT_PATH);
  const header = "#EXTM3U\n";
  const outLines = [header];
  for (const r of results) {
    outLines.push(r.metaLine);
    outLines.push(r.streamLine);
  }

  fs.mkdirSync('./playlist', { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, outLines.join("\n"), 'utf8');
  console.log("Done.");
}

filterAll().catch(err => {
  console.error("ERROR:", err && err.stack ? err.stack : err);
  process.exit(1);
});