import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GENERATED_ROOT = path.join(ROOT, "data", "generated", "public-products");
const DETAILS_ROOT = path.join(GENERATED_ROOT, "details");
const REVIEW_DIR = path.join(ROOT, "data", "review");

const INPUTS = {
  staging: path.join(ROOT, "data", "products", "unified-products-staging.json"),
  round3Validation: path.join(ROOT, "data", "review", "round3-apply-validation-v1.json"),
};

const OUTPUTS = {
  manifest: path.join(GENERATED_ROOT, "manifest.json"),
  catalog: path.join(GENERATED_ROOT, "catalog.json"),
  lookup: path.join(GENERATED_ROOT, "detail-lookup.json"),
  brands: path.join(GENERATED_ROOT, "brands.json"),
  filters: path.join(GENERATED_ROOT, "filters.json"),
  buildJson: path.join(REVIEW_DIR, "round5-public-index-build-v1.json"),
  fieldContract: path.join(REVIEW_DIR, "round5-public-index-field-contract-v1.md"),
  validationJson: path.join(REVIEW_DIR, "round5-public-index-validation-v1.json"),
  validationMarkdown: path.join(REVIEW_DIR, "round5-public-index-validation-v1.md"),
};

const EXPECTED = {
  detailShardCount: 64,
  falconAkbSourceProductIds: ["427301", "427315", "427320", "427322", "479928", "479931"],
};

const PERFORMANCE_BUDGETS = {
  catalogMaxBytes: 10 * 1024 * 1024,
  catalogAverageRecordMaxBytes: 1300,
  catalogMaxRecordBytes: 4000,
  lookupMaxBytes: 2 * 1024 * 1024,
  brandsMaxBytes: 2 * 1024 * 1024,
  filtersMaxBytes: 1 * 1024 * 1024,
  detailShardMaxBytes: 3 * 1024 * 1024,
};

const CATALOG_ALLOWLIST = new Set([
  "id",
  "source",
  "sourceProductId",
  "brandName",
  "brandSlug",
  "brandCountry",
  "displayName",
  "displayNameEn",
  "rawTitle",
  "mainImage",
  "sourcePriceAmount",
  "sourcePriceCurrency",
  "msrpAmount",
  "siteDisplayAmount",
  "siteDisplayCurrency",
  "siteDisplayReady",
  "inventoryStatus",
  "publicIndexEligible",
  "publiclySellable",
  "inventoryConfidence",
  "conditionType",
  "conditionLabel",
  "galleryCount",
  "weightGrams",
  "shape",
  "shapeZh",
  "finish",
  "finishZh",
  "bowlMaterial",
  "bowlMaterialZh",
  "stemMaterial",
  "stemMaterialZh",
  "filter",
  "filterEligibility",
  "sortKeys",
]);

const DETAIL_FORBIDDEN_KEYS = new Set([
  "sourceSpecific",
  "specsText",
  "rawDetail",
  "rawHtml",
  "html",
  "audit",
  "integration",
  "search",
  "publication",
  "images",
  "classification",
  "inventory",
  "price",
  "brand",
]);

function requiredText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  const text = requiredText(value);
  return text || null;
}

function stableCompare(a, b) {
  return requiredText(a).localeCompare(requiredText(b), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => stableCompare(a, b)));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex").toUpperCase();
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function deriveShard(id) {
  const firstByteHex = crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);
  return (Number.parseInt(firstByteHex, 16) % EXPECTED.detailShardCount).toString(16).padStart(2, "0");
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => stableCompare(a, b))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function compactJson(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

function discoverDetailFiles(manifest, warnings) {
  if (Array.isArray(manifest?.detailFiles) && manifest.detailFiles.length) {
    return [...manifest.detailFiles].sort(stableCompare);
  }
  if (!fsSync.existsSync(DETAILS_ROOT)) return [];
  const discovered = fsSync
    .readdirSync(DETAILS_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:[0-2][0-9a-f]|3[0-9a-f])\.json$/i.test(entry.name)
    )
    .map((entry) =>
      relativePath(path.join(DETAILS_ROOT, entry.name))
    )
    .sort(stableCompare);
  if (discovered.length) {
    warnings.push(
      "Manifest does not list detailFiles; validated detail shards discovered from data/generated/public-products/details."
    );
  }
  return discovered;
}

function countBy(items, getter) {
  const out = {};
  for (const item of items) {
    const key = requiredText(getter(item)) || "(missing)";
    out[key] = (out[key] || 0) + 1;
  }
  return sortObject(out);
}

function shouldIncludePublic(row) {
  return row.entityType === "offer" && row.inventory?.listingEligible === true;
}

function isExcludedFilterValue(value) {
  const text = requiredText(value);
  return !text || text.toLowerCase() === "other";
}

function addFilterCount(map, value, label, labelZh, productId) {
  if (isExcludedFilterValue(value)) return;
  const key = requiredText(value);
  if (!map.has(key)) {
    map.set(key, {
      value: key,
      label: cleanText(label) || key,
      labelZh: cleanText(labelZh),
      productIds: new Set(),
    });
  }
  map.get(key).productIds.add(productId);
}

function finalizeFilterMap(map) {
  return [...map.values()]
    .map((entry) => ({
      value: entry.value,
      label: entry.label,
      labelZh: entry.labelZh,
      productCount: entry.productIds.size,
    }))
    .sort((a, b) => stableCompare(a.label, b.label) || stableCompare(a.value, b.value));
}

function rebuildFilters(catalog) {
  const maps = {
    source: new Map(),
    brand: new Map(),
    country: new Map(),
    shape: new Map(),
    finish: new Map(),
    bowlMaterial: new Map(),
    stemMaterial: new Map(),
    filter: new Map(),
    inventoryStatus: new Map(),
  };
  const usdPrices = [];

  for (const product of catalog) {
    addFilterCount(maps.source, product.source, product.source, null, product.id);
    addFilterCount(maps.brand, product.brandSlug || product.brandName, product.brandName, null, product.id);
    addFilterCount(maps.country, product.brandCountry, product.brandCountry, null, product.id);
    if (product.filterEligibility?.shape) addFilterCount(maps.shape, product.shape, product.shape, product.shapeZh, product.id);
    if (product.filterEligibility?.finish) addFilterCount(maps.finish, product.finish, product.finish, product.finishZh, product.id);
    if (product.filterEligibility?.bowlMaterial) {
      addFilterCount(maps.bowlMaterial, product.bowlMaterial, product.bowlMaterial, product.bowlMaterialZh, product.id);
    }
    if (product.filterEligibility?.stemMaterial) {
      addFilterCount(maps.stemMaterial, product.stemMaterial, product.stemMaterial, product.stemMaterialZh, product.id);
    }
    if (product.filterEligibility?.filter) addFilterCount(maps.filter, product.filter, product.filter, null, product.id);
    addFilterCount(maps.inventoryStatus, product.inventoryStatus, product.inventoryStatus, null, product.id);
    if (product.sourcePriceCurrency === "USD" && typeof product.sourcePriceAmount === "number") usdPrices.push(product.sourcePriceAmount);
  }

  return {
    schemaVersion: 1,
    options: Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, finalizeFilterMap(map)])),
    sourcePriceUsdStats: {
      productCount: usdPrices.length,
      min: usdPrices.length ? Math.min(...usdPrices) : null,
      max: usdPrices.length ? Math.max(...usdPrices) : null,
    },
    priceFilterRangesGenerated: false,
  };
}

function collectBadJsonValues(value, pathName = "$", bad = []) {
  if (typeof value === "number" && !Number.isFinite(value)) bad.push(`${pathName}: non-finite number`);
  if (typeof value === "string" && ["undefined", "NaN", "Infinity"].includes(value)) {
    bad.push(`${pathName}: forbidden literal string ${value}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectBadJsonValues(entry, `${pathName}[${index}]`, bad));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) collectBadJsonValues(entry, `${pathName}.${key}`, bad);
  }
  return bad;
}

function assertWritablePath(filePath) {
  const resolved = path.resolve(filePath);
  const reviewRoot = path.resolve(REVIEW_DIR);
  if (!resolved.startsWith(`${reviewRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside data/review: ${filePath}`);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFileAtomic(filePath, content) {
  assertWritablePath(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) break;
      await sleep(50 * (attempt + 1));
    }
  }
  throw lastError;
}

function makeMarkdown(validation) {
  const errors = validation.errors.length ? validation.errors.map((item) => `- ${item}`).join("\n") : "- none";
  const warnings = validation.warnings.length ? validation.warnings.map((item) => `- ${item}`).join("\n") : "- none";
  return `# Public Product Index Validation

Status: ${validation.status}

## Summary

- catalog products: ${validation.counts.catalogProducts}
- detail records: ${validation.counts.detailRecords}
- lookup byId: ${validation.counts.lookupById}
- lookup bySourceProduct: ${validation.counts.lookupBySourceProduct}
- brands: ${validation.counts.brandCount}
- blocking errors: ${validation.errors.length}
- hidden records excluded: ${validation.safety.hiddenRecordsExcluded}
- non-offer records excluded: ${validation.safety.nonOfferRecordsExcluded}
- Falcon/AKB excluded: ${validation.safety.falconAkbExcluded}
- lookup consistent: ${validation.crossChecks.lookupConsistent}
- brands consistent: ${validation.crossChecks.brandsConsistent}
- filters consistent: ${validation.crossChecks.filtersConsistent}
- manifest hashes consistent: ${validation.crossChecks.manifestHashesConsistent}
- performance budgets passed: ${validation.performance.budgetsPassed}

## Errors

${errors}

## Warnings

${warnings}
`;
}

async function main() {
  const errors = [];
  const warnings = [];

  const requiredFiles = [
    OUTPUTS.manifest,
    OUTPUTS.catalog,
    OUTPUTS.lookup,
    OUTPUTS.brands,
    OUTPUTS.filters,
  ];
  for (const filePath of requiredFiles) {
    if (!fsSync.existsSync(filePath)) errors.push(`Missing required generated file: ${relativePath(filePath)}`);
  }

  let staging = [];
  let round3Validation = {};
  let manifest = {};
  let catalogFile = {};
  let lookup = {};
  let brands = {};
  let filters = {};
  let buildReport = {};

  try {
    const parsed = await readJson(INPUTS.staging);
    staging = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed)) errors.push("Staging is not an array.");
  } catch (error) {
    errors.push(error.message);
  }
  try {
    round3Validation = await readJson(INPUTS.round3Validation);
  } catch (error) {
    warnings.push(`Round 3 validation unavailable: ${error.message}`);
  }
  try {
    manifest = await readJson(OUTPUTS.manifest);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    catalogFile = await readJson(OUTPUTS.catalog);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    lookup = await readJson(OUTPUTS.lookup);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    brands = await readJson(OUTPUTS.brands);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    filters = await readJson(OUTPUTS.filters);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    buildReport = await readJson(OUTPUTS.buildJson);
  } catch (error) {
    warnings.push(`Round 5 build report unavailable: ${error.message}`);
  }

  const catalog = Array.isArray(catalogFile.products) ? catalogFile.products : [];
  if (!Array.isArray(catalogFile.products)) errors.push("catalog.json does not contain products array.");

  const detailFiles = discoverDetailFiles(manifest, warnings);
  const details = [];
  const detailShardStats = [];
  for (const relativeFile of detailFiles) {
    const filePath = path.join(ROOT, relativeFile);
    if (!fsSync.existsSync(filePath)) {
      errors.push(`Missing detail shard: ${relativeFile}`);
      continue;
    }
    try {
      const shard = await readJson(filePath);
      if (!Array.isArray(shard.products)) {
        errors.push(`Detail shard has no products array: ${relativeFile}`);
        continue;
      }
      details.push(...shard.products.map((product) => ({ ...product, __shard: shard.shard })));
      detailShardStats.push({
        shard: shard.shard,
        file: relativeFile,
        recordCount: shard.products.length,
        sizeBytes: fsSync.statSync(filePath).size,
      });
      const sortedIds = shard.products.map((product) => product.id);
      const reSorted = [...sortedIds].sort(stableCompare);
      if (JSON.stringify(sortedIds) !== JSON.stringify(reSorted)) {
        errors.push(`Detail shard is not sorted by product.id: ${relativeFile}`);
      }
    } catch (error) {
      errors.push(`Could not read detail shard ${relativeFile}: ${error.message}`);
    }
  }

  const publicRows = staging.filter(shouldIncludePublic);
  const hiddenRows = staging.filter((row) => !shouldIncludePublic(row));
  const publicIds = new Set(publicRows.map((row) => requiredText(row.id)));
  const hiddenIds = new Set(hiddenRows.map((row) => requiredText(row.id)));
  const catalogIds = catalog.map((product) => requiredText(product.id));
  const catalogIdSet = new Set(catalogIds);
  const detailIds = details.map((product) => requiredText(product.id));
  const detailIdSet = new Set(detailIds);
  const sourceProductKeys = catalog.map((product) => `${product.source}:${product.sourceProductId}`);
  const sourceProductKeySet = new Set(sourceProductKeys);
  const expectedCatalogCount = publicRows.length;
  const expectedSourceCounts = countBy(publicRows, (row) => row.source);
  const progressiveManifest =
    /^smokingpipes-progressive-/i.test(
      requiredText(manifest.generatorVersion)
    );

  if (!progressiveManifest && buildReport.status !== "passed") {
    errors.push(`Build report status is not passed: ${buildReport.status ?? "(missing)"}`);
  }
  if (progressiveManifest) {
    warnings.push(
      "Progressive manifest detected; stale Round 5 fixed-count build report is not used as a gate."
    );
  }
  if (catalog.length !== expectedCatalogCount) errors.push(`Catalog count mismatch: ${catalog.length}; staging public rows: ${expectedCatalogCount}`);
  if (details.length !== expectedCatalogCount) errors.push(`Detail record count mismatch: ${details.length}; expected: ${expectedCatalogCount}`);
  if (Object.keys(lookup.byId || {}).length !== expectedCatalogCount) errors.push("lookup.byId count mismatch.");
  if (Object.keys(lookup.bySourceProduct || {}).length !== expectedCatalogCount) {
    errors.push("lookup.bySourceProduct count mismatch.");
  }
  if (detailFiles.length !== EXPECTED.detailShardCount) errors.push(`Detail shard file count mismatch: ${detailFiles.length}`);
  if (new Set(catalogIds).size !== catalog.length) errors.push("Catalog IDs are not unique.");
  if (sourceProductKeySet.size !== catalog.length) errors.push("Catalog source+sourceProductId keys are not unique.");

  const sourceCounts = countBy(catalog, (product) => product.source);
  for (const source of new Set([
    ...Object.keys(sourceCounts),
    ...Object.keys(expectedSourceCounts),
  ])) {
    if (Number(sourceCounts[source] || 0) !== Number(expectedSourceCounts[source] || 0)) {
      errors.push(
        `${source} public count mismatch: ${sourceCounts[source] || 0}; staging public rows: ${expectedSourceCounts[source] || 0}`
      );
    }
  }
  if (Number(manifest.publicProductCount) !== catalog.length) {
    errors.push(
      `Manifest publicProductCount mismatch: ${manifest.publicProductCount}; catalog: ${catalog.length}`
    );
  }
  if (Number(manifest.excludedProductCount) !== hiddenRows.length) {
    errors.push(
      `Manifest excludedProductCount mismatch: ${manifest.excludedProductCount}; staging hidden rows: ${hiddenRows.length}`
    );
  }
  if (Number(manifest.detailCount ?? manifest.detailRecordCount) !== details.length) {
    errors.push(
      `Manifest detail count mismatch: ${manifest.detailCount ?? manifest.detailRecordCount}; details: ${details.length}`
    );
  }
  if (Number(manifest.detailShardCount) !== detailFiles.length) {
    errors.push(
      `Manifest detailShardCount mismatch: ${manifest.detailShardCount}; files: ${detailFiles.length}`
    );
  }

  const stagingById = new Map(staging.map((row) => [requiredText(row.id), row]));
  for (const product of catalog) {
    const row = stagingById.get(product.id);
    if (!row) errors.push(`Catalog product not found in staging: ${product.id}`);
    else {
      if (row.entityType !== "offer") errors.push(`Catalog product is not offer in staging: ${product.id}`);
      if (row.inventory?.listingEligible !== true) errors.push(`Catalog product is not listing eligible in staging: ${product.id}`);
      if (row.source === "smokingpipes" && row.inventory?.status === "needs-review") {
        errors.push(`Smokingpipes needs-review product entered catalog: ${product.id}`);
      }
    }
    for (const key of Object.keys(product)) {
      if (!CATALOG_ALLOWLIST.has(key)) errors.push(`Catalog contains non-allowlisted field ${key} on ${product.id}`);
    }
    for (const forbidden of ["gallery", "sourceSpecific", "specsText", "rawDetail", "rawHtml", "description"]) {
      if (Object.hasOwn(product, forbidden)) errors.push(`Catalog contains forbidden field ${forbidden} on ${product.id}`);
    }
  }

  for (const hiddenId of hiddenIds) {
    if (catalogIdSet.has(hiddenId) || detailIdSet.has(hiddenId) || lookup.byId?.[hiddenId]) {
      errors.push(`Hidden product entered public index: ${hiddenId}`);
    }
  }

  for (const id of EXPECTED.falconAkbSourceProductIds) {
    const key = `smokingpipes:${id}`;
    if (lookup.bySourceProduct?.[key] || sourceProductKeySet.has(key)) {
      errors.push(`Falcon/AKB anomaly entered public index: ${key}`);
    }
  }

  for (const detail of details) {
    if (!catalogIdSet.has(detail.id)) errors.push(`Detail record has no catalog record: ${detail.id}`);
    if (detail.__shard !== deriveShard(detail.id)) errors.push(`Detail shard mismatch for ${detail.id}`);
    for (const key of Object.keys(detail)) {
      if (key.startsWith("__")) continue;
      if (DETAIL_FORBIDDEN_KEYS.has(key)) errors.push(`Detail contains forbidden key ${key} on ${detail.id}`);
    }
  }

  let lookupConsistent = true;
  for (const product of catalog) {
    const shard = deriveShard(product.id);
    if (lookup.byId?.[product.id] !== shard) {
      lookupConsistent = false;
      errors.push(`lookup.byId mismatch for ${product.id}`);
    }
    const sourceKey = `${product.source}:${product.sourceProductId}`;
    if (lookup.bySourceProduct?.[sourceKey]?.id !== product.id || lookup.bySourceProduct?.[sourceKey]?.shard !== shard) {
      lookupConsistent = false;
      errors.push(`lookup.bySourceProduct mismatch for ${sourceKey}`);
    }
    if (!detailIdSet.has(product.id)) {
      lookupConsistent = false;
      errors.push(`Catalog product missing detail: ${product.id}`);
    }
  }

  const brandRefs = new Set();
  let brandReferenceCount = 0;
  let brandsConsistent = true;
  for (const brand of brands.brands || []) {
    if (!brand.productCount || brand.productCount < 1) {
      brandsConsistent = false;
      errors.push(`Brand has zero products: ${brand.brandName}`);
    }
    const productIds = Array.isArray(brand.productIds) ? brand.productIds : [];
    if (productIds.length !== brand.productCount) {
      brandsConsistent = false;
      errors.push(`Brand product count mismatch: ${brand.brandName}`);
    }
    for (const id of productIds) {
      if (!catalogIdSet.has(id)) {
        brandsConsistent = false;
        errors.push(`Brand references missing catalog product: ${brand.brandName} / ${id}`);
      }
      brandRefs.add(id);
      brandReferenceCount += 1;
    }
  }
  if (brandReferenceCount !== catalog.length) {
    brandsConsistent = false;
    errors.push(`Brand reference total mismatch: ${brandReferenceCount}`);
  }
  if (brandRefs.size !== catalog.length) {
    brandsConsistent = false;
    errors.push(`Unique brand reference count mismatch: ${brandRefs.size}`);
  }
  if (Number(manifest.brandCount) !== (brands.brands || []).length) {
    brandsConsistent = false;
    errors.push(
      `Manifest brandCount mismatch: ${manifest.brandCount}; brands: ${(brands.brands || []).length}`
    );
  }

  const rebuiltFilters = rebuildFilters(catalog);
  const filtersConsistent = stableJson(rebuiltFilters) === stableJson(filters);
  if (!filtersConsistent) errors.push("filters.json cannot be exactly rebuilt from catalog.json.");

  const manifestHashes = manifest.fileHashes || {};
  const manifestHashEntries = Object.entries(manifestHashes);
  let manifestHashesConsistent = manifestHashEntries.length ? true : null;
  if (!manifestHashEntries.length) {
    warnings.push(
      "Progressive manifest has no fileHashes; full structural and lookup/detail consistency checks were used instead."
    );
  }
  for (const [relativeFile, expectedHash] of manifestHashEntries) {
    const filePath = path.join(ROOT, relativeFile);
    if (!fsSync.existsSync(filePath)) {
      manifestHashesConsistent = false;
      errors.push(`Manifest file missing: ${relativeFile}`);
      continue;
    }
    const actualHash = hashFile(filePath);
    if (actualHash !== expectedHash) {
      manifestHashesConsistent = false;
      errors.push(`Manifest hash mismatch for ${relativeFile}`);
    }
  }

  const stagingSha256 = hashFile(INPUTS.staging);
  const manifestStagingHash = manifest.inputHashes?.staging || null;
  if (manifestStagingHash && manifestStagingHash !== stagingSha256) {
    errors.push(
      `Manifest staging hash mismatch: ${manifestStagingHash}; current: ${stagingSha256}`
    );
  }
  if (!manifestStagingHash) {
    warnings.push(
      "Progressive manifest has no staging input hash; catalog coverage was validated directly against current staging."
    );
  }

  const catalogText = fsSync.readFileSync(OUTPUTS.catalog, "utf8");
  const catalogCompactText = compactJson(catalogFile);
  const catalogFileBytes = fsSync.statSync(OUTPUTS.catalog).size;
  const catalogCompactBytes = byteLength(catalogCompactText);
  const lookupBytes = fsSync.statSync(OUTPUTS.lookup).size;
  const brandsBytes = fsSync.statSync(OUTPUTS.brands).size;
  const filtersBytes = fsSync.statSync(OUTPUTS.filters).size;
  const catalogRecordSizes = catalog.map((product) => byteLength(compactJson(product)));
  const performance = {
    catalogBytes: catalogCompactBytes,
    catalogFileBytes,
    catalogSerializationOverheadBytes:
      catalogFileBytes - catalogCompactBytes,
    catalogAverageRecordBytes:
      Math.round((catalogCompactBytes / catalog.length) * 100) /
      100,
    catalogMaxRecordBytes: Math.max(...catalogRecordSizes),
    lookupBytes,
    brandsBytes,
    filtersBytes,
    detailMaxShardBytes: detailShardStats.length
      ? Math.max(...detailShardStats.map((item) => item.sizeBytes))
      : 0,
    detailTotalBytes: detailShardStats.reduce((total, item) => total + item.sizeBytes, 0),
  };
  const budgetChecks = {
    catalogMaxBytes: performance.catalogBytes <= PERFORMANCE_BUDGETS.catalogMaxBytes,
    catalogAverageRecordMaxBytes:
      performance.catalogAverageRecordBytes <= PERFORMANCE_BUDGETS.catalogAverageRecordMaxBytes,
    catalogMaxRecordBytes: performance.catalogMaxRecordBytes <= PERFORMANCE_BUDGETS.catalogMaxRecordBytes,
    lookupMaxBytes: performance.lookupBytes <= PERFORMANCE_BUDGETS.lookupMaxBytes,
    brandsMaxBytes: performance.brandsBytes <= PERFORMANCE_BUDGETS.brandsMaxBytes,
    filtersMaxBytes: performance.filtersBytes <= PERFORMANCE_BUDGETS.filtersMaxBytes,
    detailShardMaxBytes: performance.detailMaxShardBytes <= PERFORMANCE_BUDGETS.detailShardMaxBytes,
  };
  for (const [name, passed] of Object.entries(budgetChecks)) {
    if (!passed) errors.push(`Performance budget failed: ${name}`);
  }

  for (const [label, value] of [
    ["catalog", catalogFile],
    ["lookup", lookup],
    ["brands", brands],
    ["filters", filters],
    ["details", details],
    ["manifest", manifest],
  ]) {
    const badValues = collectBadJsonValues(value);
    if (badValues.length) errors.push(`${label} has forbidden JSON values: ${badValues.slice(0, 10).join("; ")}`);
  }
  for (const [label, filePath] of [
    ["catalog", OUTPUTS.catalog],
    ["lookup", OUTPUTS.lookup],
    ["brands", OUTPUTS.brands],
    ["filters", OUTPUTS.filters],
    ["manifest", OUTPUTS.manifest],
  ]) {
    const text = fsSync.readFileSync(filePath, "utf8");
    if (/\b(undefined|NaN|Infinity)\b/.test(text)) errors.push(`${label} contains forbidden literal text.`);
  }
  if (catalogText.includes("rawHtml") || catalogText.includes("sourceSpecific")) {
    errors.push("catalog.json contains forbidden heavy field text.");
  }

  const hiddenRecordsExcluded = [...hiddenIds].every((id) => !catalogIdSet.has(id) && !detailIdSet.has(id) && !lookup.byId?.[id]);
  const nonOfferRecordsExcluded = catalog.every((product) => stagingByIdHasPublicOffer(staging, product.id));
  const falconAkbExcluded = EXPECTED.falconAkbSourceProductIds.every(
    (sourceProductId) => !sourceProductKeySet.has(`smokingpipes:${sourceProductId}`)
  );
  const smokingpipesNeedsReviewExcluded = catalog.every((product) => {
    const row = staging.find((item) => requiredText(item.id) === product.id);
    return !(row?.source === "smokingpipes" && row?.inventory?.status === "needs-review");
  });

  const validation = {
    schemaVersion: 1,
    validationName: "current-public-index-validation-v1",
    status: errors.length ? "failed" : "passed",
    architecture: {
      generatorVersion: manifest.generatorVersion || null,
      detailShardsRequired: true,
      detailFilesSource:
        Array.isArray(manifest.detailFiles) &&
        manifest.detailFiles.length
          ? "manifest"
          : "discovered-directory",
      expectedCatalogCount,
      expectedSourceCounts,
      expectedExcludedCount: hiddenRows.length,
    },
    counts: {
      catalogProducts: catalog.length,
      detailRecords: details.length,
      lookupById: Object.keys(lookup.byId || {}).length,
      lookupBySourceProduct: Object.keys(lookup.bySourceProduct || {}).length,
      sourceCounts,
      brandCount: Array.isArray(brands.brands) ? brands.brands.length : 0,
      filterOptionCounts: Object.fromEntries(
        Object.entries(filters.options || {}).map(([key, options]) => [key, Array.isArray(options) ? options.length : 0])
      ),
      detailShardCount: detailFiles.length,
    },
    safety: {
      hiddenRecordsExcluded,
      nonOfferRecordsExcluded,
      falconAkbExcluded,
      smokingpipesNeedsReviewExcluded,
    },
    crossChecks: {
      lookupConsistent,
      brandsConsistent,
      filtersConsistent,
      manifestHashesConsistent,
      manifestStagingHashMatchesRound3:
        manifestStagingHash &&
        round3Validation.hashes?.unifiedStaging
          ? manifestStagingHash ===
            round3Validation.hashes.unifiedStaging
          : null,
    },
    performance: {
      ...performance,
      budgetChecks,
      budgetsPassed: Object.values(budgetChecks).every(Boolean),
    },
    hashes: {
      manifest: fsSync.existsSync(OUTPUTS.manifest) ? hashFile(OUTPUTS.manifest) : null,
      catalog: fsSync.existsSync(OUTPUTS.catalog) ? hashFile(OUTPUTS.catalog) : null,
      lookup: fsSync.existsSync(OUTPUTS.lookup) ? hashFile(OUTPUTS.lookup) : null,
      brands: fsSync.existsSync(OUTPUTS.brands) ? hashFile(OUTPUTS.brands) : null,
      filters: fsSync.existsSync(OUTPUTS.filters) ? hashFile(OUTPUTS.filters) : null,
    },
    errors,
    warnings,
  };

  await writeFileAtomic(OUTPUTS.validationJson, stableJson(validation));
  await writeFileAtomic(OUTPUTS.validationMarkdown, makeMarkdown(validation));

  if (validation.status !== "passed") {
    console.error(JSON.stringify(validation, null, 2));
    process.exit(1);
  }
  console.log("Public product index validation passed.");
}

function stagingByIdHasPublicOffer(staging, id) {
  const row = staging.find((item) => requiredText(item.id) === id);
  return row?.entityType === "offer" && row?.inventory?.listingEligible === true;
}

await main();
