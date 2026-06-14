# Pipe Taxonomy Coverage Report

## Scope
- Build first shared taxonomy from Smokingpipes field audit and existing Danish Pipe Shop data.
- No Smokingpipes product conversion was run.
- No raw collection file is modified by this script.

## Input Files
- data/raw/smokingpipes-field-values-audit.json
- data/raw/smokingpipes-details-new-final.json
- data/products/danish-products.json
- data/danish-products.ts
- data/pipes.ts
- data/brand-content.ts
- data/taxonomy/brand-aliases.json
- data/taxonomy/pipe-shapes.json
- data/taxonomy/pipe-finishes.json
- data/taxonomy/pipe-materials.json

## Source Counts
- Smokingpipes products: 5136
- Danish products: 2165

## Brand Coverage
- Smokingpipes brands: 109/109 (100%), excluded 0
- Danish brands: 110/110 (100%), excluded 0

## Shape Coverage
- Smokingpipes shapes: 41/41 (100%), excluded 1
- Danish shapes: 21/21 (100%), excluded 1

## Finish Coverage
- Smokingpipes finishes: 9/9 (100%), excluded 0
- Danish finishes: 8/8 (100%), excluded 1

## Bowl Material Coverage
- Smokingpipes bowl materials: 8/8 (100%), excluded 0
- Danish bowl materials: 4/4 (100%), excluded 1

## Stem Material Coverage
- Smokingpipes stem materials: 5/5 (100%), excluded 1
- Danish stem materials: 1/1 (100%), excluded 1

## Unmapped Values
### smokingpipesBrands
- None
### danishBrands
- None
### smokingpipesShapes
- None
### danishShapes
- None
### smokingpipesFinishes
- None
### danishFinishes
- None
### smokingpipesBowlMaterials
- None
### danishBowlMaterials
- None
### smokingpipesStemMaterials
- None
### danishStemMaterials
- None

## Needs Review
- brands: Clay Pipes (clay-pipes)
- brands: Doctors (doctors)
- brands: Dollar Kapten Pipe (dollar-kapten-pipe)
- brands: Eriksen Keystone filter pipe (eriksen-keystone-filter-pipe)
- brands: Imp Meerschaum (imp-meerschaum)
- brands: KS Pipe (ks-pipe)
- brands: Pipe Key Ring (pipe-key-ring)
- brands: Pipepack (pipepack)
- brands: SON (Nording) (son-nording)
- brands: TDPS (tdps)
- brands: The French Pipe (the-french-pipe)
- brands: Unbranded (unbranded)
- brands: Unknown Meerschaum (unknown-meerschaum)

## Provisional
- brands: Luiz Lavos (luiz-lavos)
- brands: Sara Eltang Pipes (sara-eltang-pipes)
- brands: Tom Eltang (tom-eltang)
- shapes: Acorn/Pear (acorn-pear)
- finishes: Other (other)
- bowlMaterials: Other (other)
- stemMaterials: Other (other)

## Alias Collisions
- None

## Slug Collisions
- None

## Brand Country Conflicts
- ashton: England / United Kingdom
- barling: England / Italy / United Kingdom / United States
- brigham: France / Italy
- clay-pipes: Germany / United States
- dunhill: England / United Kingdom
- erik-stokkebye-4th-generation: Denmark / France
- falcon: Turkey / United Kingdom
- nording: Denmark / Ireland
- rattrays: Germany / Italy / Scotland / United States
- tom-eltang: Denmark / United States
- vauen: Germany / United States
- white-elephant: Germany / Italy / United States

## Business Rule Checks
- estatePrefix: OK - Estate Savinelli resolves to Savinelli
- billiardBillard: OK - Billiard => billiard, Billard => billiard
- bentBilliard: OK - Bent Billiard => bent-billiard
- straightBilliard: OK - Straight Billiard is not a current raw alias; no bend information is collapsed.
- notApplicable: OK - N/A normal shape mapping: none, stem mapping: none

## N/A and Other Handling
- N/A is treated as a special non-taxonomy value where present.
- Other is retained as a provisional fallback category where source data uses it.

## Next Conversion Suggestions
- Reuse these taxonomy files as lookup tables in the future Smokingpipes converter.
- Keep original raw values on products while storing canonical slug and Chinese label separately.
- Do not merge needs-review brands until the human content table confirms them.

## Validation Errors
- None

## Validation Warnings
- None
