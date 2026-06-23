# Smokingpipes Progressive Daily V1

## Status

Progressive Daily V1 is an isolated, dry-run-first orchestration layer. It
preserves successfully completed details across interrupted runs and builds an
additive partial candidate.

It does not automatically write production data, commit, push, switch proxies
or nodes, bypass CAPTCHA, or modify Windows scheduled tasks.

## Files

State and lock:

```text
data/inventory/smokingpipes-progressive-daily-state.json
data/inventory/state/smokingpipes-progressive-daily.lock
```

Candidate:

```text
data/products/smokingpipes-products-partial-next-dry-run.json
data/generated/public-products-partial-next/
```

Reports:

```text
data/review/smokingpipes-progressive-daily-report.md
data/review/smokingpipes-progressive-daily-report.json
data/review/smokingpipes-progressive-partial-audit-report.md
data/review/smokingpipes-progressive-partial-audit-report.json
data/review/smokingpipes-progressive-partial-apply-preview.json
```

## Strict state validation

The state schema version is:

```text
smokingpipes-progressive-daily-state-v1
```

Unsupported versions, malformed JSON, duplicate candidate IDs, invalid
statuses, and invalid counters or dates block the run. The runner does not
guess or silently repair malformed state.

## Explicit list evidence

Ingest an existing list/diff pair:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-ingest-list --current-list="data/inventory/smokingpipes-current-list-dry-run.json" --diff="data/inventory/smokingpipes-inventory-diff-dry-run.json" --no-commit --no-deploy --verbose
```

If the paths are omitted, those two dry-run files are used by default. This
mode reads current-list, diff, and production products only. It writes the
progressive state and progressive report only; it does not launch a browser,
fetch details, build partial-next, generate public catalog/recent-new, or write
production.

`diff.newIds`, `diff.reappearedIds`, and `diff.disappearedIds` are the
authoritative ID sets. Price changes and explicit OUT OF STOCK are derived
only from concrete current-list versus production fields because the current
diff schema does not expose those arrays.

Partial scans may retain only evidence observed on successfully scanned pages:

- new product;
- valid explicit price change;
- explicit OUT OF STOCK;
- reappeared product.

A list-only new product remains pending in progressive state and cannot enter
the product candidate, public catalog, or `recent-new`.

Incomplete or CAPTCHA-blocked scans never produce disappeared or
sold-by-absence updates. Only a complete expected-page scan without strong
verification may record disappeared IDs for a later full reconciliation.
Progressive partial candidate V1 does not apply disappeared changes.

The state includes both `schema` and `version`, verification status,
`lastSeenAt`, `retryCount`, and summary counts. Re-ingestion is idempotent.
Complete/published candidates are not downgraded. An eligible blocked
candidate may return to pending while keeping its blocked history.

## Detail chunk

Default:

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-detail-chunk --progressive-detail-max=5 --browser-channel=chrome --browser-profile=sp-chrome --allow-manual-verification=true --no-commit --no-deploy --verbose
```

The chunk selects only eligible pending new products. Complete, published,
review-only, failed, or not-yet-eligible blocked products are skipped.

Every successful detail updates the state immediately. Strong verification
stops the current access immediately. Completed details remain complete. The
blocked item records:

- `blockedCount`;
- `lastBlockedAt`;
- `lastBlockedReason`;
- `nextEligibleAt`.

The default relay delay is 90 minutes. A later eligible run restores the item
to pending for processing while preserving its blocked history.

## Build partial candidate

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-build-candidate --no-commit --no-deploy --verbose
```

The build starts from production and is additive:

- complete, public-ready new products may be added;
- explicit price changes update only approved price fields;
- explicit OUT OF STOCK and reappeared update only inventory evidence fields;
- existing complete title, brand, taxonomy, description, measurements, image,
  and gallery fields are never overwritten by list-only data;
- no product is deleted.

Repeated builds from the same state are idempotent. Product, catalog, and
`recent-new` identities are deduplicated.

## Audit gates

The audit must report zero for:

```text
deletedProducts
pendingLeak
failedLeak
blockedLeak
reviewOnlyLeak
zeroPriceSellable
```

It also rejects duplicate identities and sold/unavailable products in
`recent-new`.

## Partial apply preview

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-partial-apply --no-commit --no-deploy --verbose
```

V1 only previews the product IDs that would be applied. It does not copy files
to production, mark candidates published, set `lastAppliedAt`, set
`appliedInCommit`, commit, or push.

All results keep:

```text
productionWritten=false
commitPerformed=false
pushPerformed=false
```

## Offline mock sequence

```powershell
node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-detail-chunk --mock --progressive-detail-max=5 --mock-verification=strong --verbose

node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-build-candidate --mock --verbose

node scripts/inventory/run-inventory-automation-v1.mjs --source=smokingpipes --mode=progressive-partial-apply --mock --verbose
```

Mock mode uses `.cache/inventory-v1/mock` and does not open a browser or access
Smokingpipes.
