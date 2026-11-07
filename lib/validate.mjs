// Validation gates from the Phase C spec section 5. Returns { ok, failures[] }; never throws.
import { gzipSync } from 'node:zlib';
import { medians } from './tile.mjs';

const H = 3600e3;

export function validateStations(stations, tiles, last, now = Date.now()) {
  const failures = [];
  // 1. shape
  for (const s of stations) {
    if (!s.id || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !s.p || typeof s.p !== 'object') {
      failures.push('schema: bad station record'); break;
    }
    for (const v of Object.values(s.p)) {
      if (!Number.isInteger(v[0]) || Number.isNaN(Date.parse(v[1]))) { failures.push('schema: price must be integer x1000 with ISO time'); break; }
    }
  }
  // 2. station count within 80%-130% of last good
  if (last?.stationCount) {
    const r = stations.length / last.stationCount;
    if (r < 0.8 || r > 1.3) failures.push(`count: ${stations.length} vs last ${last.stationCount}`);
  }
  // 3. per-grade median within +/-15% of last good
  const med = medians(stations);
  if (last?.medians) {
    for (const [g, m] of Object.entries(med)) {
      const prev = last.medians[g];
      if (prev && Math.abs(m - prev) / prev > 0.15) failures.push(`median: ${g} moved ${prev} -> ${m}`);
    }
  }
  // 4. no price outside 0.5x-2x the median
  for (const s of stations) for (const [g, v] of Object.entries(s.p)) {
    const m = med[g];
    if (m && (v[0] < m * 0.5 || v[0] > m * 2)) { failures.push(`range: ${g} price ${v[0]} outside 0.5-2x median ${m}`); break; }
  }
  // 5. newest price not older than 36 h
  const newest = Math.max(0, ...stations.flatMap((s) => Object.values(s.p).map((v) => Date.parse(v[1]))));
  if (!newest || now - newest > 36 * H) failures.push('stale: newest price older than 36 h');
  // 6. tile size < 150 KB gzipped
  for (const [id, t] of tiles) {
    if (gzipSync(JSON.stringify(t)).length > 150 * 1024) failures.push(`size: tile ${id} over 150 KB gz`);
  }
  return { ok: failures.length === 0, failures };
}

export function validateNational(file, now = Date.now()) {
  const failures = [];
  if (!file?.fuels || !Object.keys(file.fuels).length) failures.push('schema: no fuels');
  const eff = Date.parse(file?.effectiveFrom);
  if (Number.isNaN(eff) || now - eff > 3 * 24 * H) failures.push('stale: file date older than 3 days');
  for (const brands of Object.values(file?.fuels ?? {})) {
    for (const v of Object.values(brands)) if (!Number.isInteger(v) || v < 5000) failures.push('schema: bad price');
  }
  return { ok: failures.length === 0, failures };
}
