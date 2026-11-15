// Builds data/payment_methods.{json,csv} and index.html from the raw chart extraction.
// Usage: node scripts/build.mjs <raw.json> (raw.json comes from scripts/extract.py)
import fs from 'node:fs';
import { geoPath, geoEqualEarth } from 'd3-geo';
import { feature } from 'topojson-client';
import { createRequire } from 'node:module';
import { kmeans, silhouette } from './kmeans.mjs';
import { pca2 } from './pca.mjs';
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

// K-means on twelve features per market, standardised (z-scores) so each counts equally:
//  - 2025 payment mix (report): share of spending on cards, wallets plus bank transfers (A2A), and cash, online and in store
//  - 2030 forecast (report): change in card and cash share in store, and yearly market growth online and in store
//  - access (World Bank Global Findex): adults with an account, adults who made a digital payment
const findex = JSON.parse(fs.readFileSync('data/findex.json', 'utf8')).markets;
const CARDS = ['Credit cards', 'Debit cards', 'Prepaid cards'], DIGITAL = ['Digital wallets', 'A2A'], CASH = ['Cash'];
const sh = (c, ch, ms, f = 'a') => c[ch].filter(r => ms.includes(r.m)).reduce((t, r) => t + r[f], 0);
const FEATURES = [
  ['ecCards', 'Online: card share 2025 (%)', c => sh(c, 'ecom', CARDS)], ['ecDig', 'Online: wallet + A2A share 2025 (%)', c => sh(c, 'ecom', DIGITAL)], ['ecCash', 'Online: cash share 2025 (%)', c => sh(c, 'ecom', CASH)],
  ['posCards', 'In store: card share 2025 (%)', c => sh(c, 'pos', CARDS)], ['posDig', 'In store: wallet + A2A share 2025 (%)', c => sh(c, 'pos', DIGITAL)], ['posCash', 'In store: cash share 2025 (%)', c => sh(c, 'pos', CASH)],
  ['dCards', 'In store: change in card share 2025-2030 (pts)', c => sh(c, 'pos', CARDS, 'b') - sh(c, 'pos', CARDS)], ['dCash', 'In store: change in cash share 2025-2030 (pts)', c => sh(c, 'pos', CASH, 'b') - sh(c, 'pos', CASH)],
  ['ecCagr', 'Online market growth 2025-2030 (% a year)', c => parseFloat(c.size.ecom[2])], ['posCagr', 'In-store market growth 2025-2030 (% a year)', c => parseFloat(c.size.pos[2])],
  ['acct', 'Adults with an account (%)', (c, k) => findex[k]['account.t.d'].value], ['digpay', 'Adults who made a digital payment (%)', (c, k) => findex[k]['g20.made'].value]];
// Shown as evidence but not clustered on.
const EXTRA = [['dDig', c => sh(c, 'pos', DIGITAL, 'b') - sh(c, 'pos', DIGITAL)], ['debit', (c, k) => findex[k]['fin2.t.d'].value], ['acct17', (c, k) => findex[k].account_2017.value]];
const K = 4;
const keys = Object.keys(data);
const X = keys.map(k => FEATURES.map(([, , fn]) => fn(data[k], k)));
keys.forEach(k => { const f = findex[k]; data[k].findex = { account: f['account.t.d'], debitCard: f['fin2.t.d'], digitalPayment: f['g20.made'], account2017: f.account_2017 }; });
const mean = v => v.reduce((a, b) => a + b, 0) / v.length, col = f => X.map(x => x[f]);
const mu = FEATURES.map((_, f) => mean(col(f))), sd = FEATURES.map((_, f) => Math.sqrt(mean(col(f).map(v => (v - mu[f]) ** 2))));
const Z = X.map(x => x.map((v, f) => (v - mu[f]) / sd[f]));
const km = kmeans(Z, K);
const sil = silhouette(Z, km.labels);
const groups = [...Array(K).keys()].map(ci => { const members = keys.filter((_, j) => km.labels[j] === ci), avg = {};
  FEATURES.forEach(([id, , fn]) => { avg[id] = Math.round(mean(members.map(k => fn(data[k], k)))); });
  EXTRA.forEach(([id, fn]) => { avg[id] = Math.round(mean(members.map(k => fn(data[k], k)))); });
  return { members, avg }; });
// Order the groups: most cash in store, most cards in store, most wallets and transfers; the one left is in between.
const pick = (left, score) => left.sort((a, b) => score(b) - score(a))[0];
let left = [...groups];
const cash = pick(left, g => g.avg.posCash); left = left.filter(g => g !== cash);
const card = pick(left, g => g.avg.posCards); left = left.filter(g => g !== card);
const digital = pick(left, g => g.avg.ecDig + g.avg.posDig); left = left.filter(g => g !== digital);
const growing = left[0];
// Each sentence below is tied to a figure. The checks stop the build if a comparison in the text stops being true.
const only = (g, id, dir) => groups.every(o => o === g || (dir > 0 ? o.avg[id] < g.avg[id] : o.avg[id] > g.avg[id]));
const must = (ok, msg) => { if (!ok) throw new Error('Insight no longer supported by the data: ' + msg); };
must(only(card, 'posCagr', -1) && only(card, 'ecCagr', -1), 'mature card markets grow slowest');
must(only(card, 'acct', 1), 'mature card markets have the highest account ownership');
must(only(digital, 'posCards', -1), 'wallet markets have the lowest in-store card share');
must(only(cash, 'posCash', 1) && only(cash, 'acct', -1), 'cash-heavy markets have most cash and fewest accounts');
must(only(cash, 'ecCagr', 1) && only(cash, 'posCagr', 1), 'cash-heavy markets grow fastest');
must(growing.avg.acct > growing.avg.acct17 && cash.avg.acct > cash.avg.acct17, 'account ownership is rising');
must(card.avg.dCards < 0 && growing.avg.dCards < 0 && growing.avg.dDig > 0 && cash.avg.dCash < 0, 'forecast direction');
const a = g => g.avg;
const clusters = [
  ['Mature card markets', card, `Most adults have bank accounts and cards: ${a(card).acct}% have an account, ${a(card).debit}% own a debit card and ${a(card).digpay}% made a digital payment in the past year. Card use is deeply established, at ${a(card).posCards}% of in-store spending, so growth is the slowest of the four groups: ${a(card).posCagr}% a year in store and ${a(card).ecCagr}% online to 2030. Cards are forecast to lose ${-a(card).dCards} points of in-store share by 2030 while wallets and bank transfers gain ${a(card).dDig}.`],
  ['Wallet and A2A-first markets', digital, `A large share of spending goes through mobile wallets or direct bank transfers instead of cards: ${a(digital).ecDig}% online and ${a(digital).posDig}% in store. Cards can be bypassed here; they carry ${a(digital).posCards}% of in-store spending, the lowest of any group. ${a(digital).acct}% of adults have an account.`],
  ['Growing digital markets', growing, `Account ownership is rising, from ${a(growing).acct17}% of adults in 2017 to ${a(growing).acct}%, and people mix cash with digital methods: in store, cards take ${a(growing).posCards}%, wallets and transfers ${a(growing).posDig}% and cash ${a(growing).posCash}%. Wallets and transfers are forecast to gain ${a(growing).dDig} points of in-store share by 2030 while cards lose ${-a(growing).dCards}.`],
  ['Cash-heavy, low-access markets', cash, `Many adults have no bank account: ${a(cash).acct}% have one, up from ${a(cash).acct17}% in 2017, and ${a(cash).digpay}% made a digital payment in the past year. Cash takes ${a(cash).posCash}% of in-store spending, the most of any group. These are also the fastest-growing markets, at ${a(cash).ecCagr}% a year online and ${a(cash).posCagr}% in store, and cash is forecast to lose ${-a(cash).dCash} points of in-store share by 2030.`],
].map(([name, g, desc]) => ({ name, desc, avg: g.avg, members: g.members }));
clusters.forEach((c, i) => c.members.forEach(k => { data[k].cluster = i; }));
// Two-dimensional view of the standardised features for the cluster plot.
const pca = pca2(Z);
keys.forEach((k, j) => { data[k].pc = pca.points[j].map(v => +v.toFixed(3)); });
console.log(pca.comps.map(c => c.share.toFixed(2) + ' ' + c.vec.map((v, i) => FEATURES[i][0] + ' ' + v.toFixed(2)).join(', ')).join('\n'));
const clusterInfo = { k: K, silhouette: +sil.toFixed(2), features: FEATURES.map(([id, label]) => ({ id, label })), clusters, pcaShare: pca.comps.map(c => Math.round(c.share * 100)) };

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
const ccsv = ['market,region,cluster,' + FEATURES.map(([, label]) => `"${label}"`).join(',')];
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
