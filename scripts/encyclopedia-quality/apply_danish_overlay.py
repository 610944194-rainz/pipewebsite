#!/usr/bin/env python3
"""Apply reviewed Danish source evidence after encyclopedia generation."""
import argparse, copy, json, pathlib, re
def load(p):
 return json.loads(re.sub(r';\s*$','',re.sub(r'^window\.ENCYCLOPEDIA\s*=\s*','',pathlib.Path(p).read_text(encoding='utf-8'))))
def merge(data,overlay):
 data=copy.deepcopy(data);rows={b['id']:b for b in data['blends']};brands={b['id']:b for b in data['brands']}
 for sb in overlay['brands']:
  if sb['id'] not in brands:data['brands'].append(copy.deepcopy(sb));brands[sb['id']]=data['brands'][-1]
  else:
   br=brands[sb['id']];br['aliases']=list(dict.fromkeys(br.get('aliases',[])+sb.get('aliases',[])))
   if 'customBlendingServices' in sb:br['customBlendingServices']=copy.deepcopy(sb['customBlendingServices'])
 for saved in overlay['blends']:
  if saved['id'] not in rows:data['blends'].append(copy.deepcopy(saved));rows[saved['id']]=data['blends'][-1];continue
  b=rows[saved['id']];assert b['uid']==saved['uid'],'UID ownership changed: '+b['id']
  b['blend_unit_key']=saved['blend_unit_key'];b['aliases']=list(dict.fromkeys(b.get('aliases',[])+saved.get('aliases',[])))
  if saved.get('recipeCodes'):b['recipeCodes']=list(dict.fromkeys(b.get('recipeCodes',[])+saved['recipeCodes']))
  if b['id']=='blendv3:5e221c01a295a953' and 'perique' not in b.get('components',[]):b['components']=b.get('components',[])+['perique']
  for field in ['components','styles','cut','family','image','packages']:
   if not b.get(field):b[field]=copy.deepcopy(saved.get(field))
  if b.get('status')=='待核实':b['status']='在产'
  if len(saved.get('descriptionZh',''))>len(b.get('descriptionZh','')):
   b['descriptionZh']=saved['descriptionZh'];b['descriptions']=copy.deepcopy(saved['descriptions']);b['descriptionKind']='full'
  for field in ['sources','sourceDescriptionEvidence','originalDescriptions','sourceParameters','rawParameters','conflicts','packageImages']:
   items=b.get(field,[]);seen={json.dumps(x,sort_keys=True,ensure_ascii=False) for x in items}
   for x in saved.get(field,[]):
    k=json.dumps(x,sort_keys=True,ensure_ascii=False)
    if k not in seen:items.append(copy.deepcopy(x));seen.add(k)
   b[field]=items
  b['coverage']='parameters'
 data['danishImport']=overlay['summary']
 return data
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');p.add_argument('--overlay',default=str(pathlib.Path(__file__).with_name('danish-20261019-overlay.json')));a=p.parse_args()
 result=merge(load(a.input),json.loads(pathlib.Path(a.overlay).read_text(encoding='utf-8')))
 pathlib.Path(a.output).write_text('window.ENCYCLOPEDIA = '+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
 print('Applied Danish overlay:',len(result['blends']),'stored records')
