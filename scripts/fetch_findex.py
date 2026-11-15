"""Downloads World Bank Global Findex indicators for the 42 markets into data/findex.json.
Uses the latest survey value from 2021 onwards for each market. Usage: python3 scripts/fetch_findex.py"""
import json, subprocess, sys, time
INDICATORS = {
    'account.t.d': 'Has an account (% age 15+)',
    'fin2.t.d': 'Owns a debit card (% age 15+)',
    'fin10': 'Owns a credit card (% age 15+)',
    'g20.made': 'Made a digital payment (% age 15+)',
    'merchant.pay': 'Made a digital merchant payment (% age 15+)',
    'con1': 'Owns a mobile phone (% age 15+)',
}
ISO = {'Australia': 'AUS', 'China': 'CHN', 'Hong Kong': 'HKG', 'India': 'IND', 'Indonesia': 'IDN', 'Japan': 'JPN', 'Malaysia': 'MYS', 'New Zealand': 'NZL',
       'Philippines': 'PHL', 'Singapore': 'SGP', 'South Korea': 'KOR', 'Taiwan': 'TWN', 'Thailand': 'THA', 'Vietnam': 'VNM', 'Belgium': 'BEL', 'Denmark': 'DNK',
       'Finland': 'FIN', 'France': 'FRA', 'Germany': 'DEU', 'Ireland': 'IRL', 'Italy': 'ITA', 'Netherlands': 'NLD', 'Norway': 'NOR', 'Poland': 'POL',
       'Portugal': 'PRT', 'Spain': 'ESP', 'Sweden': 'SWE', 'Switzerland': 'CHE', 'Turkey': 'TUR', 'United Kingdom': 'GBR', 'Argentina': 'ARG', 'Brazil': 'BRA',
       'Chile': 'CHL', 'Colombia': 'COL', 'Mexico': 'MEX', 'Peru': 'PER', 'Nigeria': 'NGA', 'Saudi Arabia': 'SAU', 'South Africa': 'ZAF', 'UAE': 'ARE',
       'Canada': 'CAN', 'United States': 'USA'}
def get(url):
    for attempt in range(5):
        r = subprocess.run(['curl', '-sS', '-m', '90', url], capture_output=True, text=True)
        try: return json.loads(r.stdout)
        except Exception: time.sleep(3)
    raise SystemExit('Failed: ' + url)
out = {k: {} for k in ISO}
codes = ';'.join(ISO.values()); back = {v: k for k, v in ISO.items()}
for ind in INDICATORS:
    d = get(f'https://api.worldbank.org/v2/country/{codes}/indicator/{ind}?format=json&source=28&date=2021:2025&per_page=1000')
    for r in d[1] or []:
        k = back.get(r['country']['id'])
        if k and r['value'] is not None:
            cur = out[k].get(ind)
            if not cur or r['date'] > cur['year']: out[k][ind] = {'value': round(r['value'], 1), 'year': r['date']}
    print(ind, sum(1 for k in out if ind in out[k]), 'of', len(ISO), file=sys.stderr)
# Account ownership in the 2017 survey round, to check whether ownership is rising.
d = get(f'https://api.worldbank.org/v2/country/{codes}/indicator/account.t.d?format=json&source=28&date=2017&per_page=1000')
for r in d[1] or []:
    k = back.get(r['country']['id'])
    if k and r['value'] is not None: out[k]['account_2017'] = {'value': round(r['value'], 1), 'year': r['date']}
print('account 2017', sum(1 for k in out if 'account_2017' in out[k]), 'of', len(ISO), file=sys.stderr)
json.dump({'source': 'World Bank Global Findex Database (API source 28)', 'indicators': INDICATORS, 'markets': out}, open('data/findex.json', 'w'), indent=1)
