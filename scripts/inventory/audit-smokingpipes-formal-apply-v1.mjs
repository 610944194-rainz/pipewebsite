import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const FILES = {
  products: "data/products/smokingpipes-products.json",
  catalog: "data/generated/public-products/catalog.json",
  filters: "data/generated/public-products/filters.json",
  brands: "data/generated/public-products/brands.json",
  manifest: "data/generated/public-products/manifest.json",
  recentNew: "data/generated/public-products/recent-new.json",
  diff: "data/inventory/smokingpipes-inventory-diff-dry-run.json",
  markdownReport:
    "data/review/smokingpipes-formal-apply-audit-report.md",
  jsonReport:
    "data/review/smokingpipes-formal-apply-audit-report.json",
};

const REVIEW_ONLY_CATEGORIES = new Set([
  "missingPrice",
  "inventoryConflict",
  "missingImage",
  "missingRequiredFields",
  "taxonomyNeedsReview",
  "publicationExcluded",
  "convertFailed",
]);

function absolute(relativePath) {
  return path.join(ROOT, relativePath);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function items(payload, key = "products") {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function text(value) {
  return String(value ?? "").trim();
}

function sourceProductId(product) {
  return text(product?.sourceProductId);
}

function readinessCategory(product) {
  return text(
    product?.sourceSpecific?.smokingpipes?.baselineReadinessCategory
  );
}

function isSold(product) {
  return ["sold", "unavailable", "out-of-stock", "out_of_stock"].includes(
    text(product?.inventoryStatus).toLowerCase()
  );
}

function countBy(records, getter) {
  const counts = {};
  for (const record of records) {
    const key = text(getter(record)) || "(missing)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseBackupDir(argv) {
  const value = argv
    .find((arg) => arg.startsWith("--backup-dir="))
    ?.slice("--backup-dir=".length);
  if (!value) {
    throw new Error(
      "Missing --backup-dir=data/backups/formal-apply-smokingpipes-baseline-YYYYMMDD-HHMMSS"
    );
  }
  const resolved = path.resolve(ROOT, value);
  const backupsRoot = path.join(ROOT, "data", "backups");
  if (
    resolved !== backupsRoot &&
    !resolved.startsWith(`${backupsRoot}${path.sep}`)
  ) {
    throw new Error("Backup directory must stay under data/backups.");
  }
  return resolved;
}

async function main() {
  const backupDir = parseBackupDir(process.argv.slice(2));
  const [
    productsPayload,
    catalogPayload,
    filters,
    brands,
    manifest,
    recentNewPayload,
    diff,
    backupProductsPayload,
    backupCatalogPayload,
  ] = await Promise.all([
    readJson(absolute(FILES.products)),
    readJson(absolute(FILES.catalog)),
    readJson(absolute(FILES.filters)),
    readJson(absolute(FILES.brands)),
    readJson(absolute(FILES.manifest)),
    readJson(absolute(FILES.recentNew)),
    readJson(absolute(FILES.diff)),
    readJson(path.join(backupDir, FILES.products)),
    readJson(path.join(backupDir, FILES.catalog)),
  ]);

  const products = items(productsPayload);
  const catalog = items(catalogPayload);
  const recentNew = items(recentNewPayload);
  const backupProducts = items(backupProductsPayload);
  const backupCatalog = items(backupCatalogPayload);
  const backupProductIds = new Set(backupProducts.map(sourceProductId));
  const backupCatalogIds = new Set(
    backupCatalog.map((product) => text(product.id))
  );
  const catalogSmokingpipesIds = new Set(
    catalog
      .filter((product) => product.source === "smokingpipes")
      .map(sourceProductId)
  );

  const newProducts = products.filter(
    (product) => !backupProductIds.has(sourceProductId(product))
  );
  const reviewOnlyLeaks = newProducts.filter(
    (product) =>
      REVIEW_ONLY_CATEGORIES.has(readinessCategory(product)) &&
      catalogSmokingpipesIds.has(sourceProductId(product))
  );
  const inventoryConflictLeaks = newProducts.filter(
    (product) =>
      readinessCategory(product) === "inventoryConflict" &&
      catalogSmokingpipesIds.has(sourceProductId(product))
  );
  const newMissingImageLeaks = newProducts.filter(
    (product) =>
      readinessCategory(product) === "missingImage" &&
      catalogSmokingpipesIds.has(sourceProductId(product))
  );
  const newMissingRequiredLeaks = newProducts.filter(
    (product) =>
      readinessCategory(product) === "missingRequiredFields" &&
      catalogSmokingpipesIds.has(sourceProductId(product))
  );

  const soldCatalog = catalog.filter(isSold);
  const soldBySource = countBy(soldCatalog, (product) => product.source);
  const recentNewSold = recentNew.filter(isSold);
  const soldFlagMismatches = soldCatalog.filter(
    (product) =>
      product.publicIndexEligible !== true ||
      product.publiclySellable !== false
  );

  const disappearedIds = new Set((diff.disappearedIds || []).map(String));
  const disappearedCatalog = catalog.filter(
    (product) =>
      product.source === "smokingpipes" &&
      disappearedIds.has(sourceProductId(product)) &&
      isSold(product)
  );
  const disappearedCatalogIds = new Set(
    disappearedCatalog.map(sourceProductId)
  );
  const missingDisappeared = [...disappearedIds].filter(
    (id) => !disappearedCatalogIds.has(id)
  );

  const backupDanishSold = backupCatalog.filter(
    (product) => product.source === "danish" && isSold(product)
  );
  const catalogIds = new Set(catalog.map((product) => text(product.id)));
  const missingDanishSold = backupDanishSold.filter(
    (product) => !catalogIds.has(text(product.id))
  );

  const missingImage = catalog.filter(
    (product) => !text(product.mainImage)
  );
  const newIntroducedMissingImage = missingImage.filter(
    (product) => !backupCatalogIds.has(text(product.id))
  );
  const legacyDanishMissingImage = missingImage.filter(
    (product) =>
      backupCatalogIds.has(text(product.id)) && product.source === "danish"
  );
  const availableBadPrice = catalog.filter(
    (product) =>
      product.inventoryStatus === "available" &&
      (!(Number(product.sourcePriceAmount) > 0) ||
        !(Number(product.siteDisplayAmount) > 0) ||
        product.siteDisplayReady !== true)
  );

  const duplicateIds = catalog.length - new Set(catalog.map((item) => item.id)).size;
  const duplicateScopedSourceIds =
    catalog.length -
    new Set(
      catalog.map((item) => `${item.source}:${item.sourceProductId}`)
    ).size;

  const blockers = [];
  if (products.length !== 5777) blockers.push(`products count is ${products.length}, expected 5777`);
  if (catalog.length !== 7415) blockers.push(`catalog count is ${catalog.length}, expected 7415`);
  if (recentNew.length !== 295) blockers.push(`recent-new count is ${recentNew.length}, expected 295`);
  if (recentNewSold.length) blockers.push("recent-new contains sold/unavailable products");
  if (soldCatalog.length !== 821) blockers.push(`sold catalog count is ${soldCatalog.length}, expected 821`);
  if (missingDisappeared.length) blockers.push(`${missingDisappeared.length} disappeared Smokingpipes products are not retained as sold`);
  if (missingDanishSold.length) blockers.push(`${missingDanishSold.length} Danish sold products were removed`);
  if (reviewOnlyLeaks.length) blockers.push(`${reviewOnlyLeaks.length} review-only products leaked into catalog`);
  if (inventoryConflictLeaks.length) blockers.push(`${inventoryConflictLeaks.length} inventory-conflict products leaked into catalog`);
  if (newMissingImageLeaks.length || newIntroducedMissingImage.length) {
    blockers.push("new missing-image products leaked into catalog");
  }
  if (newMissingRequiredLeaks.length) blockers.push("new missing-required-fields products leaked into catalog");
  if (availableBadPrice.length) blockers.push(`${availableBadPrice.length} available products have missing/pending/zero price`);
  if (soldFlagMismatches.length) blockers.push(`${soldFlagMismatches.length} sold products have invalid index/sellable flags`);
  if (duplicateIds || duplicateScopedSourceIds) blockers.push("catalog contains duplicate identity keys");
  if (!filters?.options || !Array.isArray(brands?.brands) || !manifest) {
    blockers.push("one or more public index support files are invalid");
  }

  const warnings = [];
  if (legacyDanishMissingImage.length) {
    warnings.push(
      `${legacyDanishMissingImage.length} legacy Danish products have no main image`
    );
  }

  const verdict = blockers.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  const report = {
    version: "smokingpipes-formal-apply-audit-v1",
    generatedAt: new Date().toISOString(),
    backupDir: path.relative(ROOT, backupDir).replaceAll("\\", "/"),
    productionWritten: true,
    formalApplyExecuted: true,
    verdict,
    blockers,
    warnings,
    counts: {
      products: products.length,
      catalog: catalog.length,
      recentNew: recentNew.length,
      recentNewSold: recentNewSold.length,
      soldUnavailableCatalog: soldCatalog.length,
      soldBySource,
      disappearedExpected: disappearedIds.size,
      disappearedRetainedAsSold: disappearedCatalog.length,
      danishSoldExpected: backupDanishSold.length,
      danishSoldRetained: backupDanishSold.length - missingDanishSold.length,
      reviewOnlyInCatalog: reviewOnlyLeaks.length,
      inventoryConflictInCatalog: inventoryConflictLeaks.length,
      newMissingImageInCatalog: Math.max(
        newMissingImageLeaks.length,
        newIntroducedMissingImage.length
      ),
      newMissingRequiredFieldsInCatalog: newMissingRequiredLeaks.length,
      availableBadPrice: availableBadPrice.length,
      legacyDanishMissingImage: legacyDanishMissingImage.length,
      soldFlagMismatches: soldFlagMismatches.length,
      duplicateIds,
      duplicateScopedSourceIds,
    },
    ids: {
      missingDisappeared,
      missingDanishSold: missingDanishSold.map((product) => text(product.id)),
      reviewOnlyLeaks: reviewOnlyLeaks.map(sourceProductId),
      inventoryConflictLeaks: inventoryConflictLeaks.map(sourceProductId),
      newMissingImageLeaks: newMissingImageLeaks.map(sourceProductId),
      newMissingRequiredLeaks: newMissingRequiredLeaks.map(sourceProductId),
      availableBadPrice: availableBadPrice.map((product) => text(product.id)),
      legacyDanishMissingImage: legacyDanishMissingImage.map((product) =>
        text(product.id)
      ),
    },
  };

  const markdown = `# Smokingpipes Formal Apply Audit Report

- generatedAt: ${report.generatedAt}
- backupDir: ${report.backupDir}
- productionWritten: true
- formalApplyExecuted: true
- verdict: **${verdict}**

## Blockers

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Warnings

${warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none"}

## Counts

| Check | Count |
|---|---:|
| Smokingpipes products | ${products.length} |
| public catalog | ${catalog.length} |
| recent-new | ${recentNew.length} |
| recent-new sold/unavailable | ${recentNewSold.length} |
| catalog sold/unavailable | ${soldCatalog.length} |
| Smokingpipes disappeared retained as sold | ${disappearedCatalog.length}/${disappearedIds.size} |
| Danish sold retained | ${backupDanishSold.length - missingDanishSold.length}/${backupDanishSold.length} |
| review-only in catalog | ${reviewOnlyLeaks.length} |
| inventory conflict in catalog | ${inventoryConflictLeaks.length} |
| new missing image in catalog | ${Math.max(newMissingImageLeaks.length, newIntroducedMissingImage.length)} |
| new missing required fields in catalog | ${newMissingRequiredLeaks.length} |
| available missing/pending/zero price | ${availableBadPrice.length} |
| legacy Danish missing image | ${legacyDanishMissingImage.length} |
| sold flag mismatches | ${soldFlagMismatches.length} |
| duplicate ids | ${duplicateIds} |
| duplicate scoped sourceProductIds | ${duplicateScopedSourceIds} |

## Conclusion

${
  verdict === "FAIL"
    ? "Formal apply audit failed. Do not commit or deploy."
    : verdict === "WARN"
      ? "Formal apply data checks passed. Only legacy Danish missing-image warnings remain."
      : "Formal apply data checks passed without warnings."
}
`;

  await fs.writeFile(
    absolute(FILES.jsonReport),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(absolute(FILES.markdownReport), markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        verdict,
        blockers,
        warnings,
        counts: report.counts,
        reports: [FILES.markdownReport, FILES.jsonReport],
      },
      null,
      2
    )
  );
  if (verdict === "FAIL") process.exitCode = 2;
}

await main();
