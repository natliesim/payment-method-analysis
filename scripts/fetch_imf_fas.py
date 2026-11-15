"""Downloads five IMF Financial Access Survey indicators for the 42 markets into data/imf_fas.json.
For each market it keeps the 2025 value, or the latest earlier year (from 2021) when 2025 is missing; null when there is none.
Usage: python3 scripts/fetch_imf_fas.py"""
import json, re, subprocess, sys, time
ISO = {'Australia': 'AUS', 'China': 'CHN', 'Hong Kong': 'HKG', 'India': 'IND', 'Indonesia': 'IDN', 'Japan': 'JPN', 'Malaysia': 'MYS', 'New Zealand': 'NZL',
       'Philippines': 'PHL', 'Singapore': 'SGP', 'South Korea': 'KOR', 'Taiwan': 'TWN', 'Thailand': 'THA', 'Vietnam': 'VNM', 'Belgium': 'BEL', 'Denmark': 'DNK',
       'Finland': 'FIN', 'France': 'FRA', 'Germany': 'DEU', 'Ireland': 'IRL', 'Italy': 'ITA', 'Netherlands': 'NLD', 'Norway': 'NOR', 'Poland': 'POL',
       'Portugal': 'PRT', 'Spain': 'ESP', 'Sweden': 'SWE', 'Switzerland': 'CHE', 'Turkey': 'TUR', 'United Kingdom': 'GBR', 'Argentina': 'ARG', 'Brazil': 'BRA',
       'Chile': 'CHL', 'Colombia': 'COL', 'Mexico': 'MEX', 'Peru': 'PER', 'Nigeria': 'NGA', 'Saudi Arabia': 'SAU', 'South Africa': 'ZAF', 'UAE': 'ARE',
       'Canada': 'CAN', 'United States': 'USA'}
url = 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,FAS,9.0.0/' + '+'.join(ISO.values()) + '.*.*.*.*.*.A?startPeriod=2021'
for attempt in range(4):
    x = subprocess.run(['curl', '-sS', '-m', '240', url], capture_output=True, text=True).stdout
    if '<Series' in x: break
    time.sleep(5)
else: raise SystemExit('IMF download failed')
series = []
for m in re.finditer(r'<Series ([^>]*)>(.*?)</Series>', x, re.S):
    a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
    obs = {y: float(v) for y, v in re.findall(r'TIME_PERIOD="(\d+)"[^>]*OBS_VALUE="([^"]*)"', m.group(2)) if v not in ('', 'NaN')}
    if obs and a.get('SEX', '_T') in ('_T', '_Z', ''): series.append((a, obs))
if '--list' in sys.argv:
    import collections
    c = collections.Counter((a['INDICATOR'], a.get('SECTOR'), a.get('COUNTERPARTY_SECTOR'), a['TYPE_OF_TRANSFORMATION']) for a, _ in series)
    for k, n in sorted(c.items(), key=lambda kv: -kv[1]): print(n, k)
    raise SystemExit
# id -> (label, indicator code, sector code, unit code)
WANT = {
    'atms': ('ATMs per 100,000 adults', 'FA18', '_Z', 'PHTADLT_NUM'),
    'branches': ('Commercial bank branches per 100,000 adults', 'FA22', 'COMBANK', 'PHTADLT_NUM'),
    'creditCards': ('Credit cards per 1,000 adults', 'FA24', '_Z', 'PTADLT_NUM'),
    'debitCards': ('Debit cards per 1,000 adults', 'FA25', '_Z', 'PTADLT_NUM'),
    'digitalBanking': ('Mobile and internet banking transactions per 1,000 adults', 'FA35', '_Z', 'PTADLT_NUM'),
}
back = {v: k for k, v in ISO.items()}
out = {k: {w: None for w in WANT} for k in ISO}
for a, obs in series:
    for w, (_, ind, sec, unit) in WANT.items():
        if (a['INDICATOR'], a.get('SECTOR'), a['TYPE_OF_TRANSFORMATION']) == (ind, sec, unit) and a.get('COUNTERPARTY_SECTOR', '_Z') == '_Z':
            y = max(obs); out[back[a['COUNTRY']]][w] = {'value': round(obs[y], 2), 'year': int(y)}
json.dump({'source': 'IMF Financial Access Survey (dataflow IMF.STA:FAS)', 'indicators': {w: v[0] for w, v in WANT.items()}, 'markets': out}, open('data/imf_fas.json', 'w'), indent=1)
for w in WANT:
    have = [k for k in out if out[k][w]]
    print(w, len(have), 'of', len(ISO), '| not 2025:', ', '.join(f"{k} {out[k][w]['year']}" for k in have if out[k][w]['year'] != 2025), '| none:', ', '.join(k for k in out if not out[k][w]), file=sys.stderr)
