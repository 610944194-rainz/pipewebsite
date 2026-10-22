#!/usr/bin/env python3
"""Run after encyclopedia generation and before publication; exits nonzero on regression."""
import importlib.util,json,pathlib,sys
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('repair',HERE/'repair_encyclopedia.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else HERE.parents[1]);folder=root/'public/tobacco-encyclopedia'
d=m.load_data(folder/'data.js');rules=json.loads((HERE/'decisions.json').read_text());translations=json.loads((HERE/'translations.json').read_text());m.validate(d,rules)
assert d.get('qualityRevision')==rules['version'],'Missing quality projection: run repair_encyclopedia.py after source generation'
assert 'encyclopedia-quality-20261015-v1' in (folder/'app.js').read_text(),'Quality renderer missing'
for b in m.visible(d):
 assert not str(b.get('image','')).startswith('http'),'External image reintroduced: '+b['id']
 for rec in b.get('originalDescriptions',[]):assert m.digest(rec['description_text'])==rec['content_sha256']
rows={b['id']:b for b in d['blends']}
for rule in rules['fieldCorrections']:
 assert rows[rule['id']][rule['field']]==rule['value'],'Verified field regressed: '+rule['id']+' '+rule['field']
for rule in rules['originalRestorations']:
 assert any(x['content_sha256']==rule['original_sha256'] for x in rows[rule['id']].get('originalDescriptions',[])),'Full original removed: '+rule['id']
for id,text in translations.items():
 assert len(rows[id].get('descriptionZh',''))>=len(text)*.8,'Full description truncated: '+id
print('PASS: explicit identities, published scope, original checksums and full descriptions')

# Protect reviewed Danish evidence across later source regeneration.
p=HERE/'danish-20261019-overlay.json'
if p.exists():
 o=json.loads(p.read_text());current={b['id']:b for b in d['blends']}
 for saved in o['blends']:
  b=current.get(saved['id']);assert b and b['uid']==saved['uid'],'Danish identity removed: '+saved['id']
  actual={x['content_sha256'] for x in b.get('originalDescriptions',[])}
  assert all(x['content_sha256'] in actual for x in saved.get('originalDescriptions',[])),'Danish original removed: '+saved['id']
  variants={x['id'] for x in b.get('packageImages',[])}
  assert all(x['id'] in variants for x in saved.get('packageImages',[]) if x['id'].startswith('danishpipeshop:')),'Danish package image removed: '+saved['id']
 print('PASS: Danish source identities, originals and package images')

 if o['summary'].get('sourceProducts')==219:
  assert o['summary']['acceptedSourceProducts']==208 and o['summary']['excludedSourceProducts']==9
  brands={b['id']:b for b in d['brands']}
  assert len(brands[287].get('customBlendingServices',[]))==2,'MOB services missing'
  for saved in o['blends']:
   expected={x['source_item_id']:x['description_zh'] for x in saved.get('sourceDescriptionEvidence',[])}
   actual={x['source_item_id']:x['description_zh'] for x in current[saved['id']].get('sourceDescriptionEvidence',[])}
   assert all(actual.get(k)==v for k,v in expected.items()),'Chinese source text changed: '+saved['id']
  print('PASS: 208 source products, 9 rolling exclusions and 2 MOB service archives')

country_rules=HERE/'brand-countries.json'
if country_rules.exists():
 from apply_brand_countries import validate as validate_countries
 validate_countries(d,json.loads(country_rules.read_text(encoding='utf-8')))
 print('PASS: brand countries and evidence protected',d['brandCountrySummary'])

tr_rules=HERE/'tr-dunhill-20261020-overlay.json'
if tr_rules.exists():
 from apply_tr_overlay import validate as validate_tr
 validate_tr(d,json.loads(tr_rules.read_text(encoding='utf8')))
 print('PASS: 67 TobaccoReviews entries, Chinese descriptions and real source images')

# Frontend preference confirmed by user 2026-10-20: encyclopedia content only.
renderer=(folder/'app.js').read_text(encoding='utf8')
for label in ['查看依据','资料来源','TobaccoReviews 原站参数']:
 assert label not in renderer,'Removed source/evidence UI reintroduced: '+label
print('PASS: no source/evidence modules in public renderer')

pu_rules=HERE/'pipeuncle-dunhill-20261020-overlay.json'
if pu_rules.exists():
 from apply_pipeuncle_overlay import validate as validate_pu
 validate_pu(d,json.loads(pu_rules.read_text(encoding='utf8')))
 print('PASS: PipeUncle brand identities, full raw descriptions, Chinese and original packaging')
