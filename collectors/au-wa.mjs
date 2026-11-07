// Western Australia FuelWatch: public RSS, no key. Tomorrow's prices appear from about 14:30 AWST.
import { buildTiles, dropOutliers, medians } from '../lib/tile.mjs';

const BASE = 'https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS';
const PRODUCTS = { ulp91: 1, ulp95: 2, diesel: 4, lpg: 5, ulp98: 6 };
const tag = (s, t) => (s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) ?? [])[1]?.trim();
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    price: Math.round(parseFloat(tag(it, 'price')) * 10), // cents/litre -> dollars x1000
    name: decode(tag(it, 'trading-name')), brand: decode(tag(it, 'brand')),
    lat: parseFloat(tag(it, 'latitude')), lon: parseFloat(tag(it, 'longitude')), date: tag(it, 'date'),
  })).filter((r) => r.price > 0 && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

async function feed(product, day) {
  const res = await fetch(`${BASE}?Product=${product}&Day=${day}`, { headers: { 'User-Agent': 'rdlabs-fuel-prices-collector' } });
  if (!res.ok) throw new Error(`FuelWatch HTTP ${res.status}`);
  return parseRss(await res.text());
}

export async function collect(now = new Date()) {
  const byKey = new Map();
  const stamp = now.toISOString();
  for (const [grade, product] of Object.entries(PRODUCTS)) {
    for (const r of await feed(product, 'today')) {
      const k = `${r.name}|${r.lat}|${r.lon}`;
      const st = byKey.get(k) ?? { id: `wa:${r.lat.toFixed(5)},${r.lon.toFixed(5)}`, n: r.name, b: r.brand, lat: r.lat, lon: r.lon, p: {} };
      st.p[grade] = [r.price, stamp];
      byKey.set(k, st);
    }
    // an empty tomorrow feed means "not published yet": no pt, never a guess
    for (const r of await feed(product, 'tomorrow')) {
      const st = byKey.get(`${r.name}|${r.lat}|${r.lon}`);
      if (st) (st.pt ??= {})[grade] = r.price;
    }
  }
  const stations = [...byKey.values()];
  const rejected = dropOutliers(stations);
  for (let i = stations.length - 1; i >= 0; i--) if (!Object.keys(stations[i].p).length) stations.splice(i, 1);
  const tiles = buildTiles(stations, stamp);
  return {
    market: 'AU-WA', rejected, stations, tiles, medians: medians(stations),
    entry: { kind: 'stations', currency: 'AUD', source: 'FuelWatch (WA)', cell: 0.25, tilePath: 'au-wa/{cell}.json', announcesNextDay: true,
      attribution: 'Prices from FuelWatch, Government of Western Australia.', licence: 'FuelWatch public feed' },
  };
}
