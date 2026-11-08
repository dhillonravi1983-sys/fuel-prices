// UK: the GOV.UK Fuel Finder feed, read through fuelpricetoday.co.uk's open mirror of it (Open Government Licence v3.0).
// Why a mirror: the government download and API sit behind a GOV.UK One Login and block scripted requests (403),
// and registration for API credentials was refused. The mirror republishes the same feed every 3 hours, keyed on the
// feed's own node_id. If the mirror stalls or changes shape the freshness gate below throws, the run is recorded as
// failed, the previous tiles stay up, and GB goes degraded then paused. Never guess a price.
import { gunzipSync } from 'node:zlib';
import { buildTiles, dropOutliers, medians } from '../lib/tile.mjs';

const BASE = 'https://fuelpricetoday.co.uk/data';
const UA = { 'User-Agent': 'rdlabs-fuel-prices-collector' };
// feed grade -> the key the app reads (src/lib/prices/grades.ts, MARKET_GRADE_MAP.GB)
const GRADE = { E10: 'e10', E5: 'e5', B7_STANDARD: 'b7', B7_PREMIUM: 'sb7' };
const MAX_AGE_DAYS = 2;

/** Minimal RFC-4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** stations.csv rows + history rows -> [{id,n,b,lat,lon,p:{grade:[pounds x1000, iso]}}], newest day per station and grade. */
export function build(stationRows, historyRows, now = new Date()) {
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
  const latest = new Map(); // node|fuel -> row with the greatest date
  for (const r of historyRows) {
    if (!GRADE[r.fuel] || r.date < cutoff) continue;
    const k = `${r.node_id}|${r.fuel}`;
    const cur = latest.get(k);
    if (!cur || r.date > cur.date) latest.set(k, r);
  }
  if (!latest.size) throw new Error(`GB: mirror has no prices newer than ${MAX_AGE_DAYS} days`);
  const byNode = new Map();
  for (const r of latest.values()) {
    const price = Math.round(parseFloat(r.price_ppl) * 10); // pence/litre -> pounds x1000
    const when = Date.parse(r.price_last_updated);
    if (!(price > 0) || Number.isNaN(when)) continue;
    if (!byNode.has(r.node_id)) byNode.set(r.node_id, {});
    byNode.get(r.node_id)[GRADE[r.fuel]] = [price, new Date(when).toISOString()];
  }
  const stations = [];
  for (const s of stationRows) {
    const p = byNode.get(s.node_id);
    if (!p) continue;
    if (s.temporarily_closed === '1' || s.members_only === '1' || s.coordinates_fix === 'outside_uk') continue;
    const lat = parseFloat(s.latitude), lon = parseFloat(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 49 || lat > 61 || lon < -9 || lon > 2.5) continue;
    stations.push({ id: `gb:${s.node_id.slice(0, 12)}`, n: s.name, b: s.brand || undefined, lat, lon, p });
  }
  return stations;
}

async function get(path, gz) {
  const res = await fetch(`${BASE}/${path}`, { headers: UA });
  if (!res.ok) throw new Error(`GB mirror HTTP ${res.status} for ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (gz ? gunzipSync(buf) : buf).toString('utf8');
}

export async function collect(now = new Date()) {
  const month = (d) => d.toISOString().slice(0, 7);
  const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const stationRows = parseCsv(await get('stations.csv'));
  const hist = parseCsv(await get(`history-${month(now)}.csv.gz`, true));
  // in the first days of a month the current file is thin; the previous month fills the gap
  if (now.getUTCDate() <= MAX_AGE_DAYS + 1) hist.push(...parseCsv(await get(`history-${month(prior)}.csv.gz`, true)));
  const stations = build(stationRows, hist, now);
  const stamp = now.toISOString();
  const rejected = dropOutliers(stations);
  for (let i = stations.length - 1; i >= 0; i--) if (!Object.keys(stations[i].p).length) stations.splice(i, 1);
  return {
    market: 'GB', rejected, stations, tiles: buildTiles(stations, stamp), medians: medians(stations),
    entry: { kind: 'stations', currency: 'GBP', source: 'GOV.UK Fuel Finder', cell: 0.25, tilePath: 'gb/{cell}.json', announcesNextDay: false,
      attribution: 'Contains public sector information licensed under the Open Government Licence v3.0. Data via fuelpricetoday.co.uk.',
      licence: 'Open Government Licence v3.0' },
  };
}
