#!/usr/bin/env python3
import copy,json,pathlib,re,sys,hashlib
HERE=pathlib.Path(__file__).resolve().parent
def source_ids(s):return [x for x in re.split(r'[ /,]+',s.get('source_item_id','')) if x]
def apply(d,o):
 d=copy.deepcopy(d);rows={b['id']:b for b in d['blends']}
 for saved in o['blends']:
  if saved['id'] not in rows:d['blends'].append(copy.deepcopy(saved));rows[saved['id']]=d['blends'][-1];continue
  b=rows[saved['id']];assert b['uid']==saved['uid'] and b['brand']==239,'PU identity changed: '+saved['id']
  for s in saved['sources']:
   match=next((x for x in b['sources'] if x['source_key']==s['source_key'] and x['source_item_id']==s['source_item_id']),None)
   if match is None:b['sources'].append(copy.deepcopy(s))
   else:match.update(copy.deepcopy(s))
  for k in ['sourceRawArchive','originalDescriptions','sourceDescriptionEvidence','packageImages','sourceConflicts']:
   if k not in saved:continue
   dest=b.setdefault(k,[]);seen={json.dumps(x,sort_keys=True,ensure_ascii=False) for x in dest}
   for x in saved[k]:
    key=json.dumps(x,sort_keys=True,ensure_ascii=False)
    if key not in seen:dest.append(copy.deepcopy(x));seen.add(key)
 for r in o['detachRules']:
  b=rows[r['fromId']];assert b['brand']==69,'Peterson identity changed'
  for s in b['sources']:
   if s['source_key']=='pipeuncle':s['source_item_id']=' / '.join(x for x in source_ids(s) if x!=r['sourceId'])
  b['sources']=[s for s in b['sources'] if s['source_item_id']]
  b['aliases']=[a for a in b['aliases'] if not re.search('dunhill|登喜路',a,re.I)]
  archive=b.setdefault('identitySourceArchive',[])
  if not any(x.get('source_product_id')==r['sourceId'] for x in archive):archive.append(copy.deepcopy(r['archive']))
 d['pipeUncleDunhillImport']=o['summary'];return d
def validate(d,o):
 rows={b['id']:b for b in d['blends']};visible=[b for b in d['blends'] if not b.get('hidden') and not b.get('catalogHidden')]
 for s in o['blends']:
  b=rows[s['id']];assert b['brand']==239 and b in visible
  for rec in s.get('sourceRawArchive',[]):
   expected=rec['source_item_id'];owners={x['id'] for x in visible if any(z['source_key']=='pipeuncle' and expected in source_ids(z) for z in x['sources'])}
   assert owners=={b['id']},'PU source identity ambiguous: '+expected
   actual=next((x for x in b.get('sourceRawArchive',[]) if x['source_item_id']==expected),None);assert actual
   for textkey in ['description_zh','description_en']:assert actual[textkey]==rec[textkey],'Full raw description removed: '+expected
  for p in s.get('packageImages',[]):
   if p['id'].startswith('pipeuncle:'):assert p in b.get('packageImages',[]),'PU image removed'
  if s['id'].startswith('pipeuncle-dunhill:'):assert len(b.get('descriptionZh',''))>=300 and b['uid']==s['uid']
 for r in o['detachRules']:
  b=rows[r['fromId']];assert b['brand']==69 and not any(re.search('dunhill|登喜路',a,re.I) for a in b['aliases'])
 assert rows['pipeuncle-dunhill:nightcap']['cut']=='ribbon'
 assert rows['pipeuncle-dunhill:royal-yacht']['components']==['virginia']
 assert len(o['blends'])==12 and len(o['detachRules'])==7
if __name__=='__main__':
 p=pathlib.Path(sys.argv[1]);raw=p.read_text(encoding='utf8');d=json.loads(re.sub(r';\s*$','',re.sub(r'^window\.ENCYCLOPEDIA\s*=\s*','',raw)));o=json.loads((HERE/'pipeuncle-dunhill-20261020-overlay.json').read_text(encoding='utf8'));d=apply(d,o);validate(d,o);p.write_text('window.ENCYCLOPEDIA = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8');print('PASS: PipeUncle 12 source records, 6 restored Dunhill products, 7 brand separations')
