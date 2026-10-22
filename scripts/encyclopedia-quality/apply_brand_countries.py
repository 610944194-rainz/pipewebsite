#!/usr/bin/env python3
"""Apply explicit brand-country evidence; reject changed IDs or conflicting verified countries."""
import argparse,copy,json,pathlib,re
HERE=pathlib.Path(__file__).resolve().parent
UNKNOWN={'','待补充',None}
def load(path):
 return json.loads(re.sub(r';\s*$','',re.sub(r'^window\.ENCYCLOPEDIA\s*=\s*','',pathlib.Path(path).read_text(encoding='utf-8'))))
def apply(data,rules):
 d=copy.deepcopy(data);brands={b['id']:b for b in d['brands']}
 for r in rules['brands']:
  b=brands.get(r['id']);assert b and b['name']==r['expectedName'],'Country identity guard: '+str(r['id'])
  assert b.get('country') in UNKNOWN|{r['country']},'Country conflict; re-review required: '+b['name']
  b.update(country=r['country'],countrySource=r['sourceUrl'],countryStatus='verified',countryEvidence={'basis':r['basis'],'note':r['note'],'checkedAt':r['checkedAt'],'sources':list(dict.fromkeys([r['sourceUrl']]+r.get('additionalSources',[])))})
 for r in rules['review']:
  b=brands.get(r['id']);assert b and b['name']==r['expectedName'],'Review identity guard: '+str(r['id'])
  if b.get('country') in UNKNOWN:
   b.update(country='待补充',countryStatus='review',countryEvidence={'basis':'unresolved','note':r['reason'],'checkedAt':r['checkedAt'],'sources':r['sources']})
 visible=[b for b in d['brands'] if not b.get('hidden')]
 d['brandCountryRevision']=rules['version'];d['brandCountryDefinition']=rules['definition']
 d['brandCountrySummary']={'brands':len(visible),'classified':sum(b.get('country') not in UNKNOWN for b in visible),'review':sum(b.get('country') in UNKNOWN for b in visible),'updated':len(rules['brands'])}
 validate(d,rules)
 return d
def validate(d,rules):
 assert d.get('brandCountryRevision')==rules['version'],'Missing brand country revision'
 brands={b['id']:b for b in d['brands']}
 for r in rules['brands']:
  b=brands[r['id']];assert b['name']==r['expectedName'] and b.get('country')==r['country'],'Country regressed: '+r['expectedName']
  assert b.get('countrySource')==r['sourceUrl'] and b.get('countryEvidence')=={'basis':r['basis'],'note':r['note'],'checkedAt':r['checkedAt'],'sources':list(dict.fromkeys([r['sourceUrl']]+r.get('additionalSources',[])))},'Country evidence removed: '+b['name']
 for r in rules['review']:
  b=brands[r['id']]
  if b.get('country') in UNKNOWN:assert b.get('countryStatus')=='review' and b.get('countryEvidence',{}).get('note')==r['reason'],'Missing review explanation: '+b['name']
 visible=[b for b in d['brands'] if not b.get('hidden')]
 assert d.get('brandCountrySummary')=={'brands':len(visible),'classified':sum(b.get('country') not in UNKNOWN for b in visible),'review':sum(b.get('country') in UNKNOWN for b in visible),'updated':len(rules['brands'])},'Country summary does not match actual data'
 assert all(b.get('country') not in UNKNOWN or b.get('countryStatus')=='review' for b in d['brands'] if not b.get('hidden')),'Unreviewed missing country'
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');p.add_argument('--rules',default=str(HERE/'brand-countries.json'));a=p.parse_args()
 d=apply(load(a.input),json.loads(pathlib.Path(a.rules).read_text(encoding='utf-8')))
 pathlib.Path(a.output).write_text('window.ENCYCLOPEDIA = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
 print('PASS: country rules applied',json.dumps(d['brandCountrySummary']))
