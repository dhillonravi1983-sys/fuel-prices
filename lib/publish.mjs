// Writes dist/ (what gets deployed) and data/ (last good output, committed). Never logs response bodies.
import fs from 'node:fs';
import path from 'node:path';

const PAUSE_AFTER_MS = 72 * 3600e3;
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); };

export function loadState(root) {
  return { status: readJson(path.join(root, 'data/status.json')) ?? { markets: {} } };
}

/**
 * result: { market, ok, failures, files:{relPath: object}, meta:{stationCount, medians, ...}, entry:{index.json market entry} }
 * On success: files replace data/<market>/. On failure: previous files are kept and status becomes degraded,
 * then paused once the last good run is older than 72 h.
 */
export function record(root, state, result, now = Date.now()) {
  const m = (state.status.markets[result.market] ??= {});
  m.lastRunAt = new Date(now).toISOString();
  m.errors = result.ok ? [] : result.failures.slice(0, 5);
  if (result.ok) {
    fs.rmSync(path.join(root, 'data', result.market), { recursive: true, force: true });
    for (const [rel, obj] of Object.entries(result.files)) writeJson(path.join(root, 'data', result.market, rel), obj);
    Object.assign(m, { lastGoodAt: m.lastRunAt, status: 'ok', ...result.meta, entry: result.entry });
  } else {
    const age = m.lastGoodAt ? now - Date.parse(m.lastGoodAt) : Infinity;
    m.status = age > PAUSE_AFTER_MS ? 'paused' : 'degraded';
  }
}

/** Assemble dist/ from the last good data of every market plus index.json, _headers and status.json. */
export function buildDist(root, state, now = Date.now()) {
  const dist = path.join(root, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const markets = {};
  for (const [id, m] of Object.entries(state.status.markets)) {
    if (!m.entry) { markets[id] = { kind: 'stations', status: 'paused' }; continue; }
    markets[id] = { ...m.entry, status: m.status, updatedAt: m.lastGoodAt };
    const src = path.join(root, 'data', id);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dist, id === 'AU-WA' ? 'au-wa' : id.toLowerCase()), { recursive: true });
  }
  writeJson(path.join(dist, 'index.json'), { schemaVersion: 1, generatedAt: new Date(now).toISOString(), minAppVersion: '1.0.14', markets });
  fs.writeFileSync(path.join(dist, '_headers'), '/*\n  Cache-Control: public, max-age=300\n  Access-Control-Allow-Origin: *\n');
  // status.json is for the factory dashboard, not the app
  const s = Object.fromEntries(Object.entries(state.status.markets).map(([id, m]) => [id, {
    status: m.status ?? 'paused', lastRunAt: m.lastRunAt, lastGoodAt: m.lastGoodAt, stationCount: m.stationCount, errors: m.errors ?? [],
  }]));
  writeJson(path.join(dist, 'status.json'), s);
  writeJson(path.join(root, 'data/status.json'), state.status);
  return dist;
}

/** True when dist content (minus timestamps) equals the last deployed digest, so the deploy can be skipped. */
export function digest(root) {
  const dist = path.join(root, 'dist');
  const parts = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (!['index.json', 'status.json'].includes(f.name) || d !== dist) parts.push(p + fs.readFileSync(p, 'utf8'));
  } };
  walk(dist);
  return parts.sort().join('|').length + ':' + parts.reduce((h, s) => { for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }, 7);
}
