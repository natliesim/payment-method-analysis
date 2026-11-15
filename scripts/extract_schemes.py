"""Reads the 'card scheme share' box on each market page of the report.
Usage: python3 scripts/extract_schemes.py <report.pdf> <out.json>"""
import re, subprocess, json, sys, html
PDF = sys.argv[1]
def words(p):
    out = subprocess.run(['pdftotext','-bbox','-f',str(p),'-l',str(p),PDF,'-'],capture_output=True,text=True).stdout
    return [dict(x0=float(m[1]),y0=float(m[2]),x1=float(m[3]),y1=float(m[4]),t=html.unescape(m[5]))
            for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',out)]
def parse(p):
    ws = [w for w in words(p) if w['x0'] > 842]
    sch = next(w for w in ws if w['t'] == 'scheme')
    line = sorted([w for w in ws if abs(w['y0'] - sch['y0']) < 6 and w['x0'] < sch['x1'] + 60 and w['x0'] > sch['x0'] - 120], key=lambda w: w['x0'])
    header = ' '.join(w['t'] for w in line)
    xmax = min([w['x0'] for w in ws if w['t'] == 'Digital' and abs(w['y0'] - sch['y0']) < 12 and w['x0'] > sch['x1']] or [9999]) - 10
    foot = [w for w in ws if w['t'].startswith('*Latest') or w['t'].startswith('*')]
    ymax = min([w['y0'] for w in foot if w['y0'] > sch['y1'] and w['x0'] < xmax] or [sch['y1'] + 130])
    body = sorted([w for w in ws if sch['y1'] < w['y0'] < ymax and line[0]['x0'] - 15 < w['x0'] < xmax], key=lambda w: (w['y0'] + w['y1']) / 2)
    lines = []
    for w in body:
        yc = (w['y0'] + w['y1']) / 2
        if lines and yc - lines[-1][0] < 10: lines[-1][1].append(w)
        else: lines.append([yc, [w]])
    entries = []
    for _, lw in lines:
        lw.sort(key=lambda w: w['x0'])
        for i, w in enumerate(lw):
            nxt = lw[i + 1]['t'] if i + 1 < len(lw) else ''
            if re.fullmatch(r'<?\d+(\.\d+)?', w['t']) and w['y1'] - w['y0'] > 18: entries.append({'share': w['t'] + '%', 'name': []})
            elif w['t'] == '%': continue
            elif re.fullmatch(r'<?\d+(\.\d+)?%', w['t']): entries.append({'share': w['t'], 'name': []})
            elif entries: entries[-1]['name'].append(w['t'])
    for e in entries: e['name'] = ' '.join(e['name'])
    entries.sort(key=lambda e: -float(e['share'].strip('<%')))
    return {'page': p, 'header': header, 'schemes': [{'name': e['name'], 'share': e['share']} for e in entries]}
pages = list(range(24,38)) + list(range(41,57)) + list(range(60,66)) + list(range(69,73)) + [75,76]
out = []
for p in pages:
    try: out.append(parse(p))
    except Exception as ex: out.append({'page': p, 'error': repr(ex)})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
for r in out:
    if 'error' in r: print(r); continue
    tot = sum(float(s['share'].strip('<%')) for s in r['schemes'])
    print(r['page'], r['header'], '|', tot, '|', '; '.join(s['share'] + ' ' + s['name'] for s in r['schemes']))
