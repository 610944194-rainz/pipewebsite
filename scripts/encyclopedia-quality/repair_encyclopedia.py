#!/usr/bin/env python3
"""Apply explicit, reviewable encyclopedia decisions. No remote writes or fuzzy merges."""
import argparse, copy, hashlib, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
def load_data(path):
    text = pathlib.Path(path).read_text(encoding='utf-8')
    return json.loads(text.split('=', 1)[1].strip().rstrip(';'))
def digest(text): return hashlib.sha256(text.encode()).hexdigest()
def unique(values):
    out=[]; seen=set()
    for value in values:
        key=json.dumps(value, ensure_ascii=False, sort_keys=True)
        if key not in seen: out.append(value); seen.add(key)
    return out
def visible(data): return [b for b in data['blends'] if not b.get('hidden') and not b.get('catalogHidden')]
def profile(data):
    rows=visible(data)
    return dict(records=len(rows),brands=sum(not b.get('hidden') for b in data['brands']),
      missingComponents=sum(not b['components'] for b in rows),missingCut=sum(not b['cut'] for b in rows),
      missingFamily=sum(not b['family'] or b['family']==['n a'] for b in rows),
      missingPackages=sum(not b['packages'] and not any(v.get('packageLabel') for v in b.get('packageImages',[])) for b in rows),
      missingDescription=sum(not b['descriptions'] for b in rows),
      externalCardImages=sum(str(b.get('image','')).startswith('http') for b in rows))

CUTS={
 'mixture, wild cut':('mixture-wild-cut','Mixture / Wild Cut','混合切／不规则切'),
 'wild cut mixture':('mixture-wild-cut','Mixture / Wild Cut','混合切／不规则切'),
 'cube/ribbon':('cube-ribbon','Cube / Ribbon','方块切／丝带切'),
 'loose cut and ready rubbed':('loose-ready-rubbed','Loose Cut / Ready Rubbed','松散切／预揉'),
 'twist/rope':('rope','Rope','绳草'),
 'thick twist/rope':('thick-twist','Thick Twist','粗绳草'),
 'coarse':('rough-cut','Rough Cut','粗切'),
 'course cut':('rough-cut','Rough Cut','粗切'),
 'sliced twist / coins':('sliced-twist','Sliced Twist','绳草切片'),
 'sliced twist':('sliced-twist','Sliced Twist','绳草切片'),
 'mixture with curly-cut':('mixture-curly-cut','Mixture / Curly Cut','混合切／卷切'),
 'cube cut-mixture':('cube-mixture','Cube Cut / Mixture','方块切／混合切'),
 'roll-cut-flake':('rolled-flake','Rolled Flake','卷制切片'),
 'loose cut-mixture':('loose-mixture','Loose Cut / Mixture','松散切／混合切'),
 'loose- and cross-cut':('loose-cross-cut','Loose / Cross Cut','松散切／十字切')
}

def apply(data, decisions, translations):
    d=copy.deepcopy(data); before=profile(d); rows={b['id']:b for b in d['blends']}; brands={b['id']:b for b in d['brands']}; changes=[]
    def log(kind, id, **details): changes.append(dict(kind=kind,id=id,**details))
    # Explicit IDs and names prevent stale decisions from silently matching other products.
    for g in decisions['mergeGroups']:
        for id in g['members']:
            if id not in rows or rows[id]['name']!=g['expectedNames'][id]: raise ValueError('Identity guard failed: '+id)
    for item in decisions['exclude']:
        b=rows[item['id']]
        if not b.get('hidden'): log('exclude_non_blend',b['id'],reason=item['reason'])
        b.update(hidden=True,hiddenReason=item['reason'],recordKind='accessory_bundle')
    for rule in decisions['brandMerges']:
        old,new=brands[rule['from']],brands[rule['to']]
        new['aliases']=unique(new.get('aliases',[])+old.get('aliases',[])+[old['name'],old['zh']])
        old.update(hidden=True,redirectTo=new['id']);d.setdefault('brandRedirects',{})[str(old['id'])]=new['id']
        for b in d['blends']:
            if b['brand']==old['id']:
                b.setdefault('originalBrandId',old['id']); b['brand']=new['id'];log('brand_alias',b['id'],target=new['id'])
    for item in decisions['fieldCorrections']:
        b=rows[item['id']]
        if b[item['field']]!=item['value']:
            if b[item['field']]!=item['expectedOld']:
                raise ValueError('Verified field changed since review; do not overwrite: '+b['id']+' '+item['field'])
            log('verified_field',b['id'],field=item['field'],old=b[item['field']],value=item['value'],evidence=item['evidence'])
            b.setdefault('qualityFieldArchive',{}).setdefault(item['field'],copy.deepcopy(b[item['field']]))
            b[item['field']]=copy.deepcopy(item['value'])
    for item in decisions['seriesDisambiguation']:
        b=rows[item['id']]
        if not b.get('series'):
            b.update(series=item['series'],seriesZh=item['seriesZh'])
            b['aliases']=unique(b['aliases']+[b['name'],b['zh']])
            b['name']=item['series']+' '+b['name']; b['zh']=item['seriesZh']+b['zh']
            log('series_disambiguation',b['id'],name=b['name'])
    # Restore only source content whose SHA exactly matches the recorded translation provenance.
    for item in decisions['originalRestorations']:
        b=rows[item['id']]; source=item['original']; h=item['original_sha256']
        if digest(source['text'])!=h: raise ValueError('Original content checksum mismatch: '+b['id'])
        if not any(x.get('original_sha256')==h for x in b['descriptions']):
            if not any(x.get('content_sha256')==h for x in b.get('originalDescriptions',[])):
                log('original_skipped_source_changed',b['id']);continue
        original=dict(description_text=source['text'],language='en',source_key=source['source'],source_url=source.get('url'),content_sha256=h)
        b['originalDescriptions']=unique(b.get('originalDescriptions',[])+[original])
        if item['id'] in translations:
            text=translations[item['id']]
            if b.get('descriptionZh')!=text:
                if digest(b.get('descriptionZh',''))!=item['baselineChineseSha256']:
                    log('chinese_translation_preserved_changed',b['id']);continue
                b.setdefault('descriptionSummaryZh',b.get('descriptionZh',''))
                b['descriptions']=[dict(description_text=text,language='zh-CN',source_key=source['source'],original_sha256=h,translation_kind='full',translated_at='2026-10-15')]
                b['descriptionZh']=text;log('full_chinese_description',b['id'],characters=len(text))
        elif item['zhLength']<100:
            b['descriptionKind']='summary';b.setdefault('descriptionSummaryZh',b.get('descriptionZh',''))
    # Normalize only explicit original values, retaining mixed-cut distinctions.
    dictionary={c['cut_key']:c for c in d['cuts']}
    for b in d['blends']:
        if b.get('hidden'):continue
        vals=[r['value'].strip().lower() for r in b['rawParameters'] if r['field']=='cut']
        mapped={CUTS[v] for v in vals if v in CUTS}
        if not b['cut'] and len(mapped)==1:
            key,en,zh=next(iter(mapped));b['cut']=key
            if key not in dictionary:
                record=dict(cut_key=key,canonical_en=en,display_zh=zh);d['cuts'].append(record);dictionary[key]=record
            log('raw_cut_normalized',b['id'],value=key,raw=vals)
        raw_components=[r['value'].strip() for r in b['rawParameters'] if r['field']=='components']
        component_map={'Cavendish Virginia & Burleys':['cavendish','virginia','burley'],'Brown&GoldenVirginias':['virginia'],'Black Cavendish Virginia Cube Cut':['black-cavendish','virginia']}
        if not b['components'] and len(raw_components)==1 and raw_components[0] in component_map:
            b['components']=component_map[raw_components[0]];log('raw_components_normalized',b['id'],raw=raw_components)
        if not b['packages'] and not any(x.get('packageLabel') for x in b.get('packageImages',[])):
            packages=unique([m.group(1)+m.group(2).lower() for name in b['aliases'] for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?)\s*(kg|oz|g)\b',name,re.I)])
            if packages: b['packages']=packages;log('package_from_source_title',b['id'],value=packages)
        if str(b.get('image','')).startswith('http'):
            images=[im for v in b.get('packageImages',[]) for im in v.get('images',[]) if im.get('image','').startswith('assets/')]
            if images:
                b['previousCardImage']=b['image'];b['image']=images[0]['image'];b['imageLocalized']=True;log('local_card_image',b['id'],value=b['image'])
    # Keep original IDs in storage and directly accessible. Only collapse catalog projection.
    for g in decisions['mergeGroups']:
        target=rows[g['target']];members=[rows[i] for i in g['members']]
        target['aliases']=unique(target['aliases']+[v for b in members for v in [b['name'],b['zh'],*b.get('aliases',[])]])
        for field in ['packages','packageImages','sources','rawParameters','metrics','originalDescriptions']:
            target[field]=unique([x for b in members for x in b.get(field,[])])
        # Do not reassign numeric legacy IDs: old detail URLs keep their original UID/thread.
        target['identityMembers']=unique([dict(id=b['id'],uid=b.get('uid'),name=b['name'],zh=b['zh']) for b in members])
        # Select one richest existing Chinese description; retain each member's source record intact.
        richest=max(members,key=lambda b:sum(len(x['description_text']) for x in b['descriptions']))
        if sum(len(x['description_text']) for x in richest['descriptions'])>sum(len(x['description_text']) for x in target['descriptions']):
            target.setdefault('descriptionSummaryZh',target.get('descriptionZh',''));target['descriptions']=copy.deepcopy(richest['descriptions']);target['descriptionZh']=richest.get('descriptionZh','')
            if len(target['descriptionZh'])>=100:target.pop('descriptionKind',None)
        for field in ['cut','components','family']:
            variants=unique([b[field] for b in members if b[field]])
            if len(variants)>1:
                conflict=dict(field=field,reason='合并身份后仍保留来源参数分歧',values=variants,resolution='保留主条目值，待独立核对')
                target['conflicts']=unique(target['conflicts']+[conflict])
        for b in members[1:]:
            if not b.get('catalogHidden'):log('catalog_merge',b['id'],target=target['id'],evidence=g['evidence'])
            b.update(catalogHidden=True,canonicalBlendId=target['id'],catalogHiddenReason=g['evidence'])
        d.setdefault('blendIdentityAliases',{}).update({b['id']:target['id'] for b in members[1:]})
    # Normalize package galleries by actual image identity, not variant IDs.
    for b in d['blends']:
        for variant in b.get('packageImages',[]):variant['images']=unique(variant['images'])
    d['qualityRevision']=decisions['version']
    country_rules=HERE/'brand-countries.json'
    if country_rules.exists():
        from apply_brand_countries import apply as apply_countries
        d=apply_countries(d,json.loads(country_rules.read_text(encoding='utf-8')))
    validate(d,decisions)
    return d,dict(version=decisions['version'],before=before,after=profile(d),changes=changes)

def validate(d,decisions):
    rows={b['id']:b for b in d['blends']};brands={b['id']:b for b in d['brands']};cuts={x['cut_key'] for x in d['cuts']};components={x['component_key'] for x in d['components']}
    assert len(rows)==len(d['blends']), 'Duplicate stable IDs'
    assert len({b['uid'] for b in d['blends']})==len(d['blends']), 'Duplicate UIDs'
    for b in visible(d):
        assert b['brand'] in brands and not brands[b['brand']].get('hidden'),b['id']+' orphan brand'
        assert not b['cut'] or b['cut'] in cuts,b['id']+' unknown cut'
        assert set(b['components'])<=components,b['id']+' unknown components'
    for g in decisions['mergeGroups']:
        assert not rows[g['target']].get('catalogHidden')
        for id in g['members'][1:]:assert rows[id]['canonicalBlendId']==g['target'] and rows[id]['catalogHidden']
    assert rows['blendv3:9e21b48a87c822af']['uid']!=rows['blendv3:ef838b86e1955b8f']['uid'],'Different series must remain distinct'
    assert not rows['blendv3:9e21b48a87c822af'].get('catalogHidden')
    assert rows['canonical:317']['hidden']
    for pair in decisions.get('keepSeparate',[]):
        if pair['a'] in rows and pair['b'] in rows:
            a,b=rows[pair['a']],rows[pair['b']]
            assert a.get('canonicalBlendId',a['id'])!=b.get('canonicalBlendId',b['id']),'Historical keep-separate decision violated: '+pair['reason']

def patch_app(text):
    marker="// encyclopedia-quality-20261015-v1"
    if marker in text:return text
    old="const D={...sourceData,blends:sourceData.blends.filter(b=>!b.hidden),brands:sourceData.brands.filter(b=>!b.hidden)}, main=document.querySelector('main');"
    new=marker+"\nconst allBlends=sourceData.blends.filter(b=>!b.hidden);\nconst D={...sourceData,blends:allBlends.filter(b=>!b.catalogHidden),brands:sourceData.brands.filter(b=>!b.hidden)}, main=document.querySelector('main');"
    if old not in text:raise ValueError('Frontend projection guard failed')
    text=text.replace(old,new,1)
    needle='const b=D.blends.find(x=>x.id===decodeURIComponent(id)||x.legacyIds?.includes(Number(id)))'
    if needle not in text:raise ValueError('Detail ID lookup guard failed')
    text=text.replace(needle,needle.replace('D.blends','allBlends'),1)
    for old,new in {"virginia:'弗吉尼亚型'":"virginia:'弗吉尼亚'","aromatic:'芳香型'":"aromatic:'芳香'","burley:'白肋型'":"burley:'白肋'","'english aromatic':'英式芳香型'":"'english aromatic':'英式芳香'","natural:'原味型'":"natural:'原味'","oriental:'东方型'":"oriental:'东方'"}.items():
        if old not in text:raise ValueError('Vocabulary guard failed: '+old)
        text=text.replace(old,new,1)
    needle="const unique=[...new Map(b.descriptions.map(x=>[x.description_text,x])).values()];"
    new=needle+"const originals=[...new Map((b.originalDescriptions||[]).map(x=>[x.content_sha256,x])).values()];"
    if needle not in text:raise ValueError('Description renderer guard failed')
    text=text.replace(needle,new,1)
    start=text.index("else if(activeDetailTab==='description')")
    needle="${unique.length?unique.map"
    pos=text.index(needle,start)
    text=text[:pos]+text[pos:].replace(needle,"${b.descriptionKind==='summary'?'<p class=\"small-note\">中文简述</p>':''}"+needle,1)
    end="'<p class=\"prose\">当前资料尚未收录详细描述。</p>'}`;}}"
    addition="'<p class=\"prose\">当前资料尚未收录详细描述。</p>'}${originals.map(d=>`<details class=\"original-description\" style=\"margin-top:24px\"><summary>查看完整原文（English）</summary><article class=\"prose\" lang=\"en\" style=\"overflow-wrap:anywhere\">${d.description_text.split(/\\n\\s*\\n/).map(p=>`<p>${esc(p).replace(/\\n/g,\"<br>\")}</p>`).join('')}</article></details>`).join('')}`;}}"
    if end not in text:raise ValueError('Description panel closing guard failed')
    return text.replace(end,addition,1)

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--app',required=True);p.add_argument('--output',required=True);p.add_argument('--strict-baseline',action='store_true');args=p.parse_args()
    decisions=json.loads((HERE/'decisions.json').read_text());translations=json.loads((HERE/'translations.json').read_text())
    if args.strict_baseline:
        for file,key in [(args.data,'baselineDataSha256'),(args.app,'baselineAppSha256')]:
            if hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()!=decisions[key]:raise ValueError('Baseline changed, re-review required: '+file)
    data,report=apply(load_data(args.data),decisions,translations)
    app=patch_app(pathlib.Path(args.app).read_text());out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'data.js').write_text('window.ENCYCLOPEDIA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
    (out/'app.js').write_text(app);(out/'changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(dict(before=report['before'],after=report['after']),ensure_ascii=False))
if __name__=='__main__':main()
