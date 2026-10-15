#!/usr/bin/env python3
"""Integration checks: identities, protected records, reruns, links and source checksums."""
import copy, hashlib, importlib.util, json, pathlib, sys
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('repair',HERE/'repair_encyclopedia.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
source=mod.load_data(sys.argv[1]);decisions=json.loads((HERE/'decisions.json').read_text());translations=json.loads((HERE/'translations.json').read_text())
first,report=mod.apply(source,decisions,translations);second,_=mod.apply(first,decisions,translations)
assert first==second,'Repeated application changes data'
original={b['id']:b for b in source['blends']};repaired={b['id']:b for b in first['blends']}
assert set(original)==set(repaired),'A stored record was deleted/added'
for id,b in original.items():
 assert b['uid']==repaired[id]['uid'],id+' UID changed'
 assert b['legacyIds']==repaired[id]['legacyIds'],id+' numeric legacy URL ownership changed'
 if b.get('hidden'):assert repaired[id].get('hidden'),id+' hidden product resurfaced'
for id,b in repaired.items():
 for record in b.get('originalDescriptions',[]):assert hashlib.sha256(record['description_text'].encode()).hexdigest()==record['content_sha256']
 if id in translations:assert b['descriptions'][0]['translation_kind']=='full' and len(b['descriptionZh'])>200
assert repaired['blendv3:9e21b48a87c822af']['zh']=='亨利庄园35号'
assert repaired['blendv3:ef838b86e1955b8f']['zh']=='35号'
assert repaired['blendv3:5e2e7ca7e306fe49']['cut']=='curly-cut'
assert repaired['blendv3:429edfdb042b5777']['cut']=='mixture'
for id in ['canonical:240','canonical:140']:
 assert not repaired[id].get('catalogHidden'),'Haunted Bookshop ribbon/cake incorrectly merged'
for id in ['blendv3:6deb362994ac679a','blendv3:619bf666efb987e5']:
 assert not repaired[id].get('catalogHidden'),'Distinct year incorrectly merged'
drift=copy.deepcopy(source);drift['blends'][next(i for i,b in enumerate(drift['blends']) if b['id']=='canonical:685')]['name']='Different Product'
try:mod.apply(drift,decisions,translations)
except ValueError:pass
else:raise AssertionError('Changed identity silently accepted')
app=pathlib.Path(sys.argv[2]).read_text();patched=mod.patch_app(app)
assert mod.patch_app(patched)==patched,'Repeated frontend patch changes code'
assert 'const b=allBlends.find' in patched,'Archived detail IDs no longer resolve'
assert 'allBlends.filter(b=>!b.catalogHidden)' in patched
print(json.dumps({'pass':True,'storedRecords':len(repaired),'uidAndLegacyOwnersPreserved':len(repaired),'before':report['before'],'after':report['after']},ensure_ascii=False))
