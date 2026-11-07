// node run.mjs [gb|au-wa|th ...]   Fetch -> normalise -> validate -> publish only if every gate passes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect as collectGb } from './collectors/gb.mjs';
import { collect as collectWa } from './collectors/au-wa.mjs';
import { collect as collectTh } from './collectors/th.mjs';
import { validateStations } from './lib/validate.mjs';
import { buildDist, digest, loadState, record } from './lib/publish.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS = { gb: ['GB', collectGb], 'au-wa': ['AU-WA', collectWa], th: ['TH', collectTh] };
const wanted = process.argv.slice(2).filter((a) => ADAPTERS[a]);
const state = loadState(root);

for (const key of wanted.length ? wanted : Object.keys(ADAPTERS)) {
  const [market, collect] = ADAPTERS[key];
  try {
    const r = await collect();
    const last = state.status.markets[market];
    const v = validateStations(r.stations, r.tiles, last, Date.now());
    const files = Object.fromEntries([...r.tiles].map(([id, t]) => [`${id}.json`, t]));
    record(root, state, { market, ok: v.ok, failures: v.failures, files, meta: { stationCount: r.stations.length, medians: r.medians }, entry: r.entry });
    console.log(`${market}: ${v.ok ? 'ok' : 'REJECTED'} (${r.stations.length} stations)${v.ok ? '' : ' ' + v.failures.join('; ')}`);
  } catch (e) {
    // only the message: never a response body or a credential
    record(root, state, { market, ok: false, failures: [String(e.message).slice(0, 200)] });
    console.log(`${market}: failed (${String(e.message).slice(0, 120)})`);
  }
}
buildDist(root, state);
console.log('digest', digest(root));
