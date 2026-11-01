# Danish storefront migration (2026-11-01)

The original entry `https://www.danishpipeshop.com/l/-zh/Pipes1` redirects to
`https://www.danishpipeshop.cn/zh/categories/piber`. Keep using the existing daily
runner and scheduler: `scripts/inventory/run-danish-daily-v1.mjs`. No scheduler,
production data, credentials, server publisher, or package manifests were changed.

## Adapter behavior

- V18 detects the redirected category route and switches to the modern adapter.
  Legacy collection remains available for legacy pages.
- Requests 96 products per page and follows actual next-page links. Requires an
  unchanged advertised total, exact final count, unique numeric IDs, valid USD
  prices, names and images. Empty, blocked, repeated or truncated pages fail.
  `DANISH_MODERN_MAX_LIST_PAGES` defaults to 200, independently of the legacy
  show-more cap. `DANISH_TARGET_COUNT` remains a hard upper limit.
- Waits for cards inside `main`, avoiding partially streamed Next.js fragments.
- Retains the numeric `-i<ID>` suffix as the stable ID across both URL formats.
  URL/name/price/status changes remain ordinary list patches, not new products.
- Details use Product JSON-LD, verify both page and structured-data IDs, require
  USD offers and explicit stock state, and use only that product's CDN gallery.
  Recommendation images are excluded. Specifications come from table rows;
  Chinese measurement labels and units map to existing converter conventions.
- Prices are the storefront's displayed USD prices excluding VAT. Reads the
  current sale price rather than the struck-through original price or badge.
  Unknown currencies or availability states fail rather than being guessed.
- Old `/img/` URLs now return 404. Each daily detail queue includes up to 100
  existing products needing gallery migration, within the existing 25% queue
  limit and leaving reused production records. Successfully converted products
  stop qualifying on later days. Existing history outside the current catalogue
  is retained. Migration is gradual, not a claim that all images are repaired.

## Verification

Live browser crawl: **22 pages, 2,081 unique products, advertised total 2,081**.
Production comparison: 1,944 matched IDs, zero ID anomalies. After the existing
70 exclusions, the initial queue contains 67 new products, 5 reappearances,
2 missing-detail products and 100 media migrations: **174 total**, below the
502-product safety limit.

Three live detail samples: sold new Stanwell, available new Stanwell, sold Estate
Stanwell; galleries contain 6/6/4 product images, with 15 specification rows each.
Only sampling was performed for details; a complete publish cycle was not run.

Regression commands:

```sh
node scripts/inventory/test-danish-modern-site-v1.mjs
node scripts/inventory/test-danish-daily-v1.mjs
node scripts/inventory/test-danish-specs-parser-v1.mjs
npm run build
```

The modern regression uses reduced captures from the live site checked into
`fixtures/danish-modern`; it needs Playwright Chromium (`npx playwright install
chromium`) but no live network. It covers URL compatibility, pagination,
duplicate rejection, current price vs badges, sold status, gallery scope,
specifications, identity mismatch and bounded media migration.

## Rollout

Use the existing Windows Chrome environment and run the existing collect-only
entry first (`node scripts/inventory/run-danish-daily-v1.mjs --collect-only`).
Inspect run-summary and detail errors, then use the existing approved publish
procedure. Do not replace production with the live list or the three detail
samples. Git changes must first be approved under this repository's AGENTS.md.
