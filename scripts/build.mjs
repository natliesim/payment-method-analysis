// Builds data/payment_methods.{json,csv} and index.html from the raw chart extraction.
// Usage: node scripts/build.mjs <raw.json> (raw.json comes from scripts/extract.py)
import fs from 'node:fs';
import { geoPath, geoEqualEarth } from 'd3-geo';
import { feature } from 'topojson-client';
import { createRequire } from 'node:module';
import { kmeans, silhouette } from './kmeans.mjs';
const require = createRequire(import.meta.url);
const world = require('world-atlas/countries-110m.json');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const REGION_PAGES = { 'Asia Pacific': [24, 37], Europe: [41, 56], 'Latin America': [60, 65], 'Middle East and Africa': [69, 72], 'North America': [75, 76] };
const ATLAS_NAME = { 'United States': 'United States of America', UAE: 'United Arab Emirates' };
const DISPLAY = { UAE: 'United Arab Emirates' };
const POINTS = { 'Hong Kong': [114.17, 22.32], Singapore: [103.82, 1.35] };
const num = s => (s.startsWith('<') ? 0 : parseFloat(s));
const rows = side => side.map(r => ({ m: r.method.replace('Debit Card', 'Debit cards'), a: num(r.vals[0]), b: num(r.vals[1]), as: r.vals[0], bs: r.vals[1] }))
  .sort((x, y) => (x.m === 'Others') - (y.m === 'Others') || y.a - x.a);

const brands = JSON.parse(fs.readFileSync('data/brands.json', 'utf8'));
const slug = s => s.toLowerCase().replace(/&/g, 'and').normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const logos = {};
// Card scheme share box. Two pages list scheme names under a grouped figure, so they are set by hand.
const rawSchemes = Object.fromEntries(JSON.parse(fs.readFileSync('data/raw_schemes.json', 'utf8')).map(r => [r.page, r]));
const SCHEME_FIX = {
  34: { schemes: [['Domestic schemes', '97%'], ['International schemes', '3%']],
    note: 'Domestic: BC, Hana, Hyundai, KB Kookmin, Lotte, NH, Samsung, Shinhan, Woori. International: American Express, China UnionPay, JCB, Mastercard, Visa.' },
  76: { schemes: [['Visa', '58%'], ['Mastercard', '24%'], ['Others', '9%'], ['American Express', '8%']],
    note: 'Others: Accel, Discover, Diners Club, NYCE, PULSE, Star.' },
};
const schemesFor = page => {
  const fix = SCHEME_FIX[page];
  const list = fix ? fix.schemes : rawSchemes[page].schemes.map(x => [x.name, x.share]);
  if (list.some(([n]) => !/^[A-Za-z ]+$/.test(n))) throw new Error('Unclean scheme name on page ' + page);
  return { rows: list.map(([m, as]) => ({ m, a: num(as), as })).sort((x, y) => (x.m === 'Others') - (y.m === 'Others') || y.a - x.a), note: fix ? fix.note : '' };
};
const data = {};
for (const r of raw) {
  const region = Object.keys(REGION_PAGES).find(k => r.page >= REGION_PAGES[k][0] && r.page <= REGION_PAGES[k][1]);
  if (!region) continue; // global and regional summary pages
  const key = r.title.replace(' payment methods', '');
  data[key] = { name: DISPLAY[key] || key, region, page: r.page, ecom: rows(r.ecom), pos: rows(r.pos),
    size: { ecom: [r.market[0], r.market[1], r.cagr[0]], pos: [r.market[2], r.market[3], r.cagr[1]] },
    schemes: schemesFor(r.page).rows, schemeNote: schemesFor(r.page).note,
    brands: brands.pages[r.page].map(n => {
      if (!brands.types[n]) throw new Error('No description for brand ' + n);
      logos[slug(n)] = 'data:image/png;base64,' + fs.readFileSync(`assets/logos/${slug(n)}.png`).toString('base64');
      return { n, t: brands.types[n], s: slug(n) };
    }) };
}

// K-means on each market's 2025 payment mix (share of value by method, online and in store).
const FEATURES = [['ecom', 'Digital wallets', 'Wallets'], ['ecom', 'Credit cards', 'Credit'], ['ecom', 'Debit cards', 'Debit'], ['ecom', 'A2A', 'A2A'], ['ecom', 'BNPL', 'BNPL'], ['ecom', 'Cash', 'Cash'],
  ['pos', 'Digital wallets', 'Wallets'], ['pos', 'Credit cards', 'Credit'], ['pos', 'Debit cards', 'Debit'], ['pos', 'Cash', 'Cash'], ['pos', 'A2A', 'A2A']];
const K = 4;
const keys = Object.keys(data);
const X = keys.map(k => FEATURES.map(([c, m]) => (data[k][c].find(r => r.m === m) || { a: 0 }).a));
const km = kmeans(X, K);
const sil = silhouette(X, km.labels);
const nameFor = c => {
  const f = Object.fromEntries(FEATURES.map(([ch, m], i) => [ch + ':' + m, c[i]]));
  if ((f['ecom:Digital wallets'] + f['pos:Digital wallets']) / 2 > 60) return ['Wallet-first', 'Digital wallets carry most spending both online and in store.'];
  const s = { debit: f['pos:Debit cards'], credit: (f['ecom:Credit cards'] + f['pos:Credit cards']) / 2, a2a: (f['ecom:A2A'] + f['pos:Cash']) / 2 };
  const top = Object.keys(s).sort((a, b) => s[b] - s[a])[0];
  return { debit: ['Debit-led', 'Debit cards lead in store; wallets lead online.'], credit: ['Credit-led', 'Credit cards are strong in both channels.'],
    a2a: ['Bank transfer and cash', 'Account-to-account transfers lead online; cash is still big in store.'] }[top];
};
const order = [...Array(K).keys()].sort((a, b) => km.labels.filter(l => l === b).length - km.labels.filter(l => l === a).length);
const clusters = order.map(ci => { const [name, desc] = nameFor(km.centroids[ci]);
  return { name, desc, centroid: km.centroids[ci].map(v => Math.round(v)), members: keys.filter((_, j) => km.labels[j] === ci) }; });
if (new Set(clusters.map(c => c.name)).size !== K) throw new Error('Cluster names collide');
clusters.forEach((c, i) => c.members.forEach(k => { data[k].cluster = i; }));
const clusterInfo = { k: K, silhouette: +sil.toFixed(2), features: FEATURES.map(([ch, m, short]) => ({ ch, m, short })), clusters };

const W = 960, H = 470;
const fc = feature(world, world.objects.countries);
fc.features = fc.features.filter(f => f.properties.name !== 'Antarctica');
const proj = geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], fc);
const path = geoPath(proj);
const byAtlas = Object.fromEntries(Object.keys(data).map(k => [ATLAS_NAME[k] || k, k]));
const round = d => d.replace(/-?\d+\.\d+/g, n => (+n).toFixed(1));
const map = fc.features.map(f => ({ n: f.properties.name, k: byAtlas[f.properties.name] || null, d: round(path(f)) }));
const dots = Object.entries(POINTS).map(([k, ll]) => { const [x, y] = proj(ll); return { k, x: +x.toFixed(1), y: +y.toFixed(1) }; });
const missing = Object.keys(data).filter(k => !map.some(m => m.k === k) && !POINTS[k]);
if (missing.length) throw new Error('No map shape for: ' + missing);

fs.writeFileSync('data/payment_methods.json', JSON.stringify(data, null, 1));
const csv = ['market,region,channel,method,share_2025_pct,share_2030_forecast_pct,change_pts,report_page'];
for (const [k, c] of Object.entries(data)) for (const ch of ['ecom', 'pos']) for (const r of c[ch])
  csv.push([`"${c.name}"`, `"${c.region}"`, ch, r.m, r.as.replace('%', ''), r.bs.replace('%', ''), r.b - r.a, c.page].join(','));
fs.writeFileSync('data/payment_methods.csv', csv.join('\n') + '\n');
const scsv = ['market,region,scheme,share_2024_pct,report_page'];
for (const c of Object.values(data)) for (const r of c.schemes) scsv.push([c.name, c.region, r.m, r.as.replace('%', ''), c.page].map(v => `"${v}"`).join(','));
fs.writeFileSync('data/card_scheme_share.csv', scsv.join('\n') + '\n');
const ccsv = ['market,region,cluster,' + FEATURES.map(([ch, m]) => `${ch}_${m.toLowerCase().replace(/ /g, '_')}`).join(',')];
keys.forEach((k, j) => ccsv.push([`"${data[k].name}"`, `"${data[k].region}"`, `"${clusters[data[k].cluster].name}"`, ...X[j]].join(',')));
fs.writeFileSync('data/clusters.csv', ccsv.join('\n') + '\n');
const bcsv = ['market,region,brand,what_it_is,report_page'];
for (const c of Object.values(data)) for (const b of c.brands) bcsv.push([c.name, c.region, b.n, b.t, c.page].map(v => `"${v}"`).join(','));
fs.writeFileSync('data/popular_brands.csv', bcsv.join('\n') + '\n');

const html = fs.readFileSync('src/template.html', 'utf8')
  .replace('/*DATA*/null', () => JSON.stringify(data))
  .replace('/*MAP*/null', () => JSON.stringify(map))
  .replace('/*DOTS*/null', () => JSON.stringify(dots))
  .replace('/*LOGOS*/null', () => JSON.stringify(logos))
  .replace('/*CLUSTERS*/null', () => JSON.stringify(clusterInfo));
fs.writeFileSync('index.html', html);
console.log('silhouette', sil.toFixed(3), clusters.map(c => c.name + ' ' + c.members.length).join(', '));
console.log(Object.keys(data).length, 'markets;', map.length, 'shapes;', (html.length / 1024).toFixed(0) + ' KB');
