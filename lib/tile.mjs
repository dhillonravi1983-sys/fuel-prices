// Groups stations into 0.25-degree tiles. Cell id = floor(lat*4)_floor(lon*4), matching the app.
export const CELL = 0.25;
export const cellId = (lat, lon) => `${Math.floor(lat * 4)}_${Math.floor(lon * 4)}`;

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** stations: [{id,n,b,lat,lon,p:{grade:[price,iso]}, pt?:{grade:price}}] -> Map(cell -> tile object) */
export function buildTiles(stations, updatedAt) {
  const cells = new Map();
  for (const s of stations) {
    const id = cellId(s.lat, s.lon);
    if (!cells.has(id)) cells.set(id, { schemaVersion: 1, cell: id, updatedAt, stations: [] });
    cells.get(id).stations.push(s);
  }
  return cells;
}

export function medians(stations) {
  const by = {};
  for (const s of stations) for (const [g, v] of Object.entries(s.p)) (by[g] ??= []).push(v[0]);
  return Object.fromEntries(Object.entries(by).map(([g, v]) => [g, median(v)]));
}

/** Spec 3.1: implausible prices (outside 0.5x-2x the grade median) are dropped, not published. Returns how many. */
export function dropOutliers(stations) {
  const med = medians(stations);
  let dropped = 0;
  for (const s of stations) for (const [g, v] of Object.entries(s.p)) {
    if (med[g] && (v[0] < med[g] * 0.5 || v[0] > med[g] * 2)) { delete s.p[g]; if (s.pt) delete s.pt[g]; dropped++; }
  }
  return dropped;
}
