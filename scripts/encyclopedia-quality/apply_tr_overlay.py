#!/usr/bin/env python3
"""Apply reviewed TobaccoReviews Dunhill evidence after Danish and country layers."""
import copy,json,pathlib,re,sys
HERE=pathlib.Path(__file__).resolve().parent
def apply(data,o):
 data=copy.deepcopy(data);rows={b['id']:b for b in data['blends']}
 for s in o['blends']:
  if s['id'] not in rows:data['blends'].append(copy.deepcopy(s));rows[s['id']]=data['blends'][-1];continue
  b=rows[s['id']];assert b['uid']==s['uid'] and b['brand']==239,'TR identity ownership changed: '+s['id']
  b['trSourceEntry']=s['trSourceEntry'];b['status']=s['status']
  for key in ['components','cut','family','packages','image','imageLocalized','imageStatus','descriptionZh','descriptionKind','descriptions']:
   if key in s and not b.get(key):b[key]=copy.deepcopy(s[key])
  for key in ['sources','sourceParameters','rawParameters','originalDescriptions','sourceDescriptionEvidence','metrics','packageImages']:
   items=b.get(key,[]);seen={json.dumps(x,sort_keys=True,ensure_ascii=False) for x in items}
   for x in s.get(key,[]):
    k=json.dumps(x,sort_keys=True,ensure_ascii=False)
    if k not in seen:items.append(copy.deepcopy(x));seen.add(k)
   b[key]=items
 data['tobaccoReviewsImport']=o['summary'];return data
def validate(d,o):
 rows={b['id']:b for b in d['blends']};ids=set()
 for s in o['blends']:
  b=rows[s['id']];assert b['brand']==239 and not b.get('hidden') and not b.get('catalogHidden')
  tid=s['trSourceEntry']['id'];assert tid not in ids;ids.add(tid)
  assert any(x.get('source_key')=='tobaccoreviews' and x.get('source_item_id')==tid for x in b['sources'])
  for x in s.get('sourceDescriptionEvidence',[]):
   if x['source_key']=='tobaccoreviews':assert any(a.get('content_sha256')==x['content_sha256'] and a.get('description_zh')==x['description_zh'] for a in b.get('sourceDescriptionEvidence',[]))
  for x in s.get('packageImages',[]):
   if x['id'].startswith('tobaccoreviews:'):assert x in b.get('packageImages',[])
 assert len(ids)==67
if __name__=='__main__':
 p=pathlib.Path(sys.argv[1]);raw=p.read_text(encoding='utf8');d=json.loads(re.sub(r';\s*$','',re.sub(r'^window\.ENCYCLOPEDIA\s*=\s*','',raw)));o=json.loads((HERE/'tr-dunhill-20261020-overlay.json').read_text(encoding='utf8'));d=apply(d,o);validate(d,o);p.write_text('window.ENCYCLOPEDIA = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8');print('PASS TR overlay: 67 entries')
