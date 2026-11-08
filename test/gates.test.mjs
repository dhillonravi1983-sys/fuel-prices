import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRss } from '../collectors/au-wa.mjs';
import { buildTiles, cellId } from '../lib/tile.mjs';
import { validateNational, validateStations } from '../lib/validate.mjs';

const now = Date.parse('2026-11-07T06:00:00Z');
const st = (i, p, t = '2026-11-07T04:00:00Z') => ({ id: `s${i}`, n: 'x', lat: 53.8, lon: -1.4, p: { e10: [p, t] } });
const good = Array.from({ length: 10 }, (_, i) => st(i, 1400 + i));
const check = (stations, last) => validateStations(stations, buildTiles(stations, 'x'), last, now);

test('cell id matches the app (floor of 4x)', () => assert.equal(cellId(53.8098, -1.4714), '215_-6'));
test('clean run passes', () => assert.equal(check(good, { stationCount: 10, medians: { e10: 1404 } }).ok, true));
test('station count collapse fails (80%-130% gate)', () => assert.match(check(good.slice(0, 5), { stationCount: 10 }).failures.join(), /count/));
test('median jump over 15% fails', () => assert.match(check(good, { stationCount: 10, medians: { e10: 1000 } }).failures.join(), /median/));
test('a price outside 0.5-2x median fails', () => assert.match(check([...good, st(99, 9000)], null).failures.join(), /range/));
test('prices older than 36 h fail', () => assert.match(check(good.map((s, i) => st(i, 1400, '2026-11-05T00:00:00Z')), null).failures.join(), /stale/));
test('float prices fail the schema gate', () => assert.match(check([st(1, 1.347)], null).failures.join(), /schema/));
test('national file older than 3 days fails', () => {
  assert.equal(validateNational({ fuels: { g: { PTT: 41350 } }, effectiveFrom: '2026-11-06T22:00:00Z' }, now).ok, true);
  assert.equal(validateNational({ fuels: { g: { PTT: 41350 } }, effectiveFrom: '2026-10-01T00:00:00Z' }, now).ok, false);
});
test('FuelWatch RSS parses to integer x1000 dollars; empty feed gives no items', () => {
  const xml = '<rss><channel><item><price>179.9</price><trading-name>A &amp; B</trading-name><brand>BP</brand><latitude>-31.95</latitude><longitude>115.86</longitude><date>2026-11-07</date></item></channel></rss>';
  const [r] = parseRss(xml);
  assert.equal(r.price, 1799);
  assert.equal(r.name, 'A & B');
  assert.deepEqual(parseRss('<rss><channel><description>Tomorrow\'s price is not available now</description></channel></rss>'), []);
});

import { dropOutliers } from '../lib/tile.mjs';
test('outlier prices are dropped before validation, not published', () => {
  const s = [...good.map((x) => structuredClone(x)), st(98, 4500)];
  assert.equal(dropOutliers(s), 1);
  assert.equal(Object.keys(s.at(-1).p).length, 0);
});

import { parseBangchak } from '../collectors/th.mjs';
const sample = [{ OilDateNow: '08/11/2026', OilPriceDate: '07/11/2026', OilList: JSON.stringify([
  { OilName: 'Gasohol 95 S EVO', PriceToday: 40.5, PriceTomorrow: 40.2 },
  { OilName: 'Hi Diesel S', PriceToday: 33.04, PriceTomorrow: 33.04 },
  { OilName: 'Gasohol 98 Plus', PriceToday: 50, PriceTomorrow: 50 },
]) }];
test('th parse maps keys, x1000, announced and history', () => {
  const f = parseBangchak(sample, null, new Date('2026-11-08T02:00:00Z'));
  assert.deepEqual(f.fuels, { gasohol95: { BCP: 40500 }, dieselB7: { BCP: 33040 } });
  assert.equal(f.announced.length, 1);
  assert.equal(f.announced[0].delta, -300);
  assert.equal(f.announced[0].effectiveAt, '2026-11-08T22:00:00.000Z');
  assert.equal(f.history.gasohol95.length, 1);
  assert.equal(parseBangchak(sample, f, new Date('2026-11-08T03:00:00Z')).history.gasohol95.length, 1);
  assert.equal(validateNational(f, Date.parse('2026-11-08T03:00:00Z')).ok, true);
});
test('th national gate rejects big jump and stale', () => {
  const f = parseBangchak(sample, null, new Date('2026-11-08T02:00:00Z'));
  const jumped = structuredClone(f); jumped.fuels.gasohol95.BCP = 60000;
  assert.equal(validateNational(jumped, Date.parse('2026-11-08T03:00:00Z'), f).ok, false);
  assert.equal(validateNational(f, Date.parse('2026-12-08T03:00:00Z')).ok, false);
});
