// filter_m3u.js
const fs = require('fs');
const fetch = require('node-fetch');
const url = require('url');

const IPTV_MASTER = "https://iptv-org.github.io/iptv/index.m3u";
const OUTPUT_PATH = "./playlist/index.m3u";
const TIMEOUT_MS = 7000; // adjust as needed
const MAX_CONCURRENT = 12;

function timeoutFetch(u, opts, ms = TIMEOUT_MS){
  return Promise.race([
    fetch(u, opts),
    new Promise((_, rej) => setTimeout(()=> rej(new Error("timeout")), ms))
  ]);
}

async function getText(u){
  const r = await timeoutFetch(u);
  if(!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}

function parseM3URaw(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for(let i=0;i<lines.length;i++){
    const l = lines[i].trim();
    if(!l) continue;
    if(l.startsWith('#EXTINF')){
      const meta = l;
      const name = meta.split(',').slice(1).join(',').trim();
      const tvgLogo = (meta.match(/tvg-logo="([^"]+)"/) || [null,null])[1] || "";
      const tvgId = (meta.match(/tvg-id="([^"]+)"/) || [null,null])[1] || "";
      const stream = (lines[i+1]||"").trim();
      out.push({ metaLine: meta, name, tvgLogo, tvgId, streamLine: stream });
    }
  }
  return out;
}

// Do a HEAD to check content-type or follow if HEAD not allowed
async function checkStream(u){
  try{
    const parsed = new url.URL(u);
  }catch(e){
    return false;
  }
  try{
    // prefer HEAD
    let r = await timeoutFetch(u, { method: 'HEAD', redirect: 'follow' });
    if(!r.ok && r.status === 405) r = await timeoutFetch(u, { method: 'GET', redirect: 'follow' }); // some servers disallow HEAD
    if(!r.ok) return false;
    const ct = (r.headers.get('content-type')||'').toLowerCase();
    // Accept HLS manifests or media types that suggest HLS
    if(ct.includes('application/vnd.apple.mpegurl') || ct.includes('vnd.apple.mpegurl') || ct.includes('application/x-mpegurl') || u.toLowerCase().endsWith('.m3u8')) return true;
    // Some CDNs return text/plain for m3u8, accept if endswith .m3u8 or content-length > 0
    if(u.toLowerCase().includes('.m3u8')) return true;
    // Otherwise mark as unsafe
    return false;
  }catch(e){
    return false;
  }
}

async function filterAll(){
  console.log("Downloading master playlist...");
  const raw = await getText(IPTV_MASTER);
  const parsed = parseM3URaw(raw);
  console.log("Found", parsed.length, "entries. Checking streams (this may take a while)...");
  const results = [];
  const seen = new Set();
  let running = 0;
  let i = 0;

  async function worker(){
    while(i < parsed.length){
      const idx = i++;
      const item = parsed[idx];
      // quick skip duplicates by url
      if(seen.has(item.streamLine)) continue;
      seen.add(item.streamLine);
      const ok = await checkStream(item.streamLine);
      if(ok){
        results.push(item);
        console.log("KEEP:", item.name, item.streamLine);
      }else{
        // console.log("DROP:", item.name, item.streamLine);
      }
    }
  }

  // spawn concurrent workers
  const workers = Array.from({length: Math.min(MAX_CONCURRENT, 12)}).map(()=> worker());
  await Promise.all(workers);

  // Build M3U output content
  console.log("Writing", results.length, "valid entries to", OUTPUT_PATH);
  const header = "#EXTM3U\n";
  const outLines = [header];
  for(const r of results){
    outLines.push(r.metaLine);
    outLines.push(r.streamLine);
  }
  fs.mkdirSync('./playlist', { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, outLines.join("\n"), 'utf8');
  console.log("Done.");
}

filterAll().catch(err=>{ console.error(err); process.exit(1); });