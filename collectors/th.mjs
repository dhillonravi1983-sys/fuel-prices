// Thailand: Bangchak's own public JSON price feed (the page at bangchak.co.th reads it). One brand (BCP) only;
// Thai pump prices are set close together, and the app labels the figure with the brand. No other brand is guessed.
// Terms were not individually confirmed (EPPO never answered); this is a public, unauthenticated feed read twice a day.
const URL_ = 'https://oil-price.bangchak.co.th/ApiOilPrice2/en';
const MAP = {
  'DIESEL B20': 'dieselB20', 'HI DIESEL S': 'dieselB7', 'HI PREMIUM DIESEL PLUS': 'dieselPremium',
  'GASOHOL E85 S EVO': 'e85', 'GASOHOL E20 S EVO': 'e20', 'GASOHOL 91 S EVO': 'gasohol91', 'GASOHOL 95 S EVO': 'gasohol95',
};
const x1000 = (n) => Math.round(Number(n) * 1000);
const ict = (d, m, y, h = 0) => new Date(Date.UTC(y, m - 1, d, h - 7)).toISOString(); // Thailand is UTC+7, no DST
const dmy = (s) => { const [d, m, y] = String(s).split('/').map(Number); return { d, m, y }; };

export function parseBangchak(json, prev, now = new Date()) {
  const row = json?.[0];
  if (!row) throw new Error('Bangchak: empty response');
  const list = JSON.parse(row.OilList);
  const today = dmy(row.OilDateNow);
  const todayIso = `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
  const eff = dmy(row.OilPriceDate);
  const fuels = {}, announced = [];
  const history = structuredClone(prev?.history ?? {});
  for (const o of list) {
    const key = MAP[String(o.OilName).trim().toUpperCase()];
    if (!key || !(o.PriceToday > 0)) continue;
    fuels[key] = { BCP: x1000(o.PriceToday) };
    const delta = x1000(o.PriceTomorrow) - x1000(o.PriceToday);
    // new prices take effect at 05:00 Thai time on the next day
    if (delta !== 0) announced.push({ fuel: key, delta, effectiveAt: ict(today.d + 1, today.m, today.y, 5), announcedAt: now.toISOString() });
    const h = (history[key] ??= []);
    if (!h.length || h.at(-1)[0] !== todayIso) h.push([todayIso, x1000(o.PriceToday)]);
    history[key] = h.slice(-90);
  }
  return {
    schemaVersion: 1, market: 'TH', updatedAt: now.toISOString(), sourceDate: ict(today.d, today.m, today.y),
    effectiveFrom: ict(eff.d, eff.m, eff.y, 5), region: 'BKK', fuels, announced, history,
  };
}

export async function collect(prev) {
  const res = await fetch(URL_, { headers: { 'User-Agent': 'rdlabs-fuel-prices-collector' } });
  if (!res.ok) throw new Error(`Bangchak HTTP ${res.status}`);
  const national = parseBangchak(await res.json(), prev);
  return {
    market: 'TH', national,
    entry: { kind: 'national', currency: 'THB', source: 'Bangchak', file: 'th/current.json',
      attribution: 'Prices from Bangchak (excluding Bangkok provincial tax).', licence: 'Public price feed' },
  };
}
