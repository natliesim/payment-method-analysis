import re, subprocess, json, sys, html
PDF = sys.argv[1]
def words(p):
    out = subprocess.run(['pdftotext','-bbox','-f',str(p),'-l',str(p),PDF,'-'],capture_output=True,text=True).stdout
    ws=[]
    for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',out):
        x0,y0,x1,y1=map(float,m.groups()[:4]); ws.append(dict(x0=x0,y0=y0,x1=x1,y1=y1,t=html.unescape(m.group(5))))
    return ws
def parse(p):
    ws=words(p)
    ecom=[w for w in ws if w['t']=='E-com' and w['x0']>842]; pos=[w for w in ws if w['t']=='POS' and w['x0']>842]
    # header words: the big ones in chart (largest height)
    e=max(ecom,key=lambda w:w['y1']-w['y0']); s=max(pos,key=lambda w:w['y1']-w['y0'])
    div=(e['x1']+s['x0'])/2; top=max(e['y1'],s['y1'])
    leg=[w for w in ws if w['t']=='forecast' and w['y0']>top and abs(w['x0']-div)<120]
    bottom=min(w['y0'] for w in leg)
    # title
    tw=[w for w in ws if w['y1']<e['y0'] and w['y0']>e['y0']-60 and (w['y1']-w['y0'])>(e['y1']-e['y0'])*0.9]
    tw.sort(key=lambda w:w['x0']); title=' '.join(w['t'] for w in tw)
    cagr=[w for w in ws if w['t']=='CAGR']
    cagr_vals=[]
    pcts=[]
    for w in ws:
        if re.fullmatch(r'<?\d+(\.\d+)?%',w['t']) and top<w['y0']<bottom:
            c=[c for c in cagr if 0<w['y0']-c['y0']<25 and abs(w['x1']-c['x1'])<60]
            if c: cagr_vals.append(w)
            else: pcts.append(w)
    res={'page':p,'title':title}
    for side,sel in (('ecom',lambda w:w['x1']<div),('pos',lambda w:w['x0']>div)):
        pv=sorted([w for w in pcts if sel(w) and abs((w['x0']+w['x1'])/2-div)<400],key=lambda w:w['y0'])
        lw=[w for w in ws if top<w['y0']<bottom and sel(w) and abs((w['x0']+w['x1'])/2-div)<45 and re.search('[A-Za-z]',w['t'])]
        lw.sort(key=lambda w:(w['y0'],w['x0']))
        groups=[]
        for w in lw:
            if groups and w['y0']-groups[-1][-1]['y0']<12: groups[-1].append(w)
            else: groups.append([w])
        rows=[]
        used=set()
        for g in groups:
            yc=(g[0]['y0']+g[-1]['y1'])/2
            near=[w for w in pv if abs((w['y0']+w['y1'])/2-yc)<16]
            near.sort(key=lambda w:w['y0'])
            rows.append({'method':' '.join(w['t'] for w in g),'vals':[w['t'] for w in near]})
            used.update(id(w) for w in near)
        res[side]=rows
        res[side+'_unused']=[w['t'] for w in pv if id(w) not in used]
    dol=sorted([w for w in ws if re.fullmatch(r'\$[\d.,]+[bmt]',w['t']) and w['x0']>div-420 and top<w['y0']<bottom+10],key=lambda w:w['x0'])
    res['market']=[w['t'] for w in dol]
    res['cagr']=[w['t'] for w in sorted(cagr_vals,key=lambda w:w['x0'])]
    return res
pages=[20,22]+list(range(24,38))+[39]+list(range(41,57))+[58]+list(range(60,66))+[67]+list(range(69,73))+[74,75,76]
out=[]
for p in pages:
    try: out.append(parse(p))
    except Exception as ex: out.append({'page':p,'error':repr(ex)})
json.dump(out,open(sys.argv[2] if len(sys.argv)>2 else 'raw.json','w'),indent=1)
for r in out:
    if 'error' in r: print(r); continue
    bad=[]
    for side in ('ecom','pos'):
        for row in r[side]:
            if len(row['vals'])!=2: bad.append((side,row))
        if r[side+'_unused']: bad.append((side,'unused',r[side+'_unused']))
    print(r['page'],r['title'],'|',len(r['ecom']),len(r['pos']),r['market'],r['cagr'],'BAD' if bad else '',bad)
