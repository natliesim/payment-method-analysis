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

// K-means on each market's 2025 payment mix, summarised as six features:
// the share of spending on cards, on wallets plus bank transfers (A2A), and on cash, online and in store.
// Features are standardised (z-scores) before clustering so that cash, which varies less, counts as much as the others.
const CARDS = ['Credit cards', 'Debit cards', 'Prepaid cards'], DIGITAL = ['Digital wallets', 'A2A'], CASH = ['Cash'];
const FEATURES = [['ecom', 'Cards', CARDS], ['ecom', 'Wallets + A2A', DIGITAL], ['ecom', 'Cash', CASH], ['pos', 'Cards', CARDS], ['pos', 'Wallets + A2A', DIGITAL], ['pos', 'Cash', CASH]];
const K = 4;
const keys = Object.keys(data);
const X = keys.map(k => FEATURES.map(([ch, , ms]) => data[k][ch].filter(r => ms.includes(r.m)).reduce((t, r) => t + r.a, 0)));
keys.forEach((k, j) => { data[k].feat = X[j]; });
const col = f => X.map(x => x[f]), mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const mu = FEATURES.map((_, f) => mean(col(f))), sd = FEATURES.map((_, f) => Math.sqrt(mean(col(f).map(v => (v - mu[f]) ** 2))));
const Z = X.map(x => x.map((v, f) => (v - mu[f]) / sd[f]));
const km = kmeans(Z, K);
const sil = silhouette(Z, km.labels);
const groups = [...Array(K).keys()].map(ci => { const m = X.filter((_, j) => km.labels[j] === ci);
  return { ci, centroid: FEATURES.map((_, f) => Math.round(mean(m.map(x => x[f])))), members: keys.filter((_, j) => km.labels[j] === ci) }; });
// Name each group from its averages: most cash in store, most cards in store, most wallets and transfers; the one left is in between.
const NAMES = [['Mature card markets', 'Cards carry most in-store spending and cash is small.'],
  ['Wallet and A2A driven', 'Digital wallets and bank transfers lead, most of all online.'],
  ['Going digital', 'A mix of cards, wallets and cash, with no single method dominant yet.'],
  ['Cash-heavy', 'Cash still takes a large share in store, and some of it online.']];
const pick = (left, score) => left.sort((a, b) => score(b) - score(a))[0];
let left = [...groups];
const cash = pick(left, g => g.centroid[5]); left = left.filter(g => g !== cash);
const card = pick(left, g => g.centroid[3]); left = left.filter(g => g !== card);
const digital = pick(left, g => g.centroid[1] + g.centroid[4]); left = left.filter(g => g !== digital);
const clusters = [card, digital, left[0], cash].map((g, i) => ({ name: NAMES[i][0], desc: NAMES[i][1], centroid: g.centroid, members: g.members }));
clusters.forEach((c, i) => c.members.forEach(k => { data[k].cluster = i; }));
const clusterInfo = { k: K, silhouette: +sil.toFixed(2), features: FEATURES.map(([ch, short]) => ({ ch, short })), clusters };

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
const ccsv = ['market,region,cluster,' + FEATURES.map(([ch, m]) => `${ch}_${m.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_pct`).join(',')];
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
