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
