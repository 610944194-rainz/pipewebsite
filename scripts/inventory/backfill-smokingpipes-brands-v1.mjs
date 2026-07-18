import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { convertSmokingpipesCandidateDetails } from "../convert-smokingpipes-products-v2.mjs";
import { classifySmokingpipesBrandExclusion } from "../lib/smokingpipes-brand-exclusions-v1.mjs";

export const BRAND_FIELDS = Object.freeze([
  "rawBrand",
  "brandMapped",
  "sourceScopedBrandMappingApplied",
  "sourceScopedBrandMappingClassification",
  "brand",
  "canonicalBrand",
  "canonicalBrandSlug",
  "canonicalBrandZh",
  "canonicalBrandCountry",
  "brandReviewStatus",
  "brandIndexEligible",
  "brandReviewNotes",
]);

const FALCON_EXCLUSION_FIELDS = Object.freeze([
  "listingEligible",
  "filterEligible",
  "publicIndexEligible",
  "publiclySellable",
  "publication",
]);
const EXAMPLE_PRODUCT_ID = "676128";
const MINIMUM_EXPECTED_RECOVERED = 900;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function items(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, payload) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function isExactBrand(value, expected) {
  return text(value).toLowerCase() === expected;
}

export function classifyCurrentBrand(product = {}) {
  const values = [product.brand, product.canonicalBrand].map(text);
  if (values.some((value) => isExactBrand(value, "unknown meerschaum"))) {
    return "unknown-meerschaum";
  }
  if (values.some((value) => isExactBrand(value, "unbranded"))) {
    return "unbranded";
  }
  if (values.every((value) => !value || isExactBrand(value, "unknown"))) {
    return "generic-unknown";
  }
  return "known";
}

function normalizedDetailBrand(detail = {}) {
  const brand = text(detail.brand);
  return /^(?:unknown|unknown meerschaum|unbranded)$/i.test(brand)
    ? ""
    : brand;
}

function makeConverterDetail(product, existingDetail) {
  return {
    ...(existingDetail || {}),
    sourceProductId: text(product.sourceProductId),
    sourceUrl:
      text(existingDetail?.sourceUrl || existingDetail?.href) ||
      text(product.sourceUrl),
    brand: normalizedDetailBrand(existingDetail),
    title:
      text(existingDetail?.title) ||
      text(product.rawTitle || product.displayNameEn),
    fullTitle:
      text(existingDetail?.fullTitle) ||
      text(product.fullTitle || product.displayNameEn || product.rawTitle),
    conditionType: text(existingDetail?.conditionType || product.conditionType) || "new",
    price: existingDetail?.price || product.price?.rawText || product.price?.raw || "",
  };
}

function evidenceSource({ existingDetail, listItem }) {
  if (normalizedDetailBrand(existingDetail)) return "detail";
  if (text(listItem?.brand)) return "list";
  return "url";
}

function applyBrandFields(product, converted) {
  const next = { ...product };
  for (const field of BRAND_FIELDS) next[field] = structuredClone(converted[field]);
  return next;
}

function applyFalconExclusion(product) {
  const next = { ...product };
  next.listingEligible = false;
  next.filterEligible = false;
  next.publicIndexEligible = false;
  next.publiclySellable = false;
  next.publication = {
    ...(product.publication || {}),
    status: "excluded",
    listingEligible: false,
    publicIndexEligible: false,
    publiclySellable: false,
    brandIndexEligible: false,
    filterEligible: false,
    reason: "excluded-brand:falcon",
  };
  return next;
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
}

export function countUnexpectedNonBrandChanges(beforeProduct, afterProduct) {
  const allowed = new Set([
    ...BRAND_FIELDS,
    ...(classifySmokingpipesBrandExclusion(afterProduct).excluded
      ? FALCON_EXCLUSION_FIELDS
      : []),
  ]);
  return changedFields(beforeProduct, afterProduct).filter(
    (field) => !allowed.has(field)
  ).length;
}

function countBrands(records) {
  return Object.fromEntries(
    [...records.reduce((counts, record) => {
      counts.set(record.brand, Number(counts.get(record.brand) || 0) + 1);
      return counts;
    }, new Map())]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
  );
}

export function buildSmokingpipesBrandBackfill({
  productionProducts,
  publicProducts = [],
  listProducts = [],
  details = [],
  minimumExpectedRecovered = MINIMUM_EXPECTED_RECOVERED,
} = {}) {
  const production = items(productionProducts);
  const listById = new Map(
    items(listProducts)
      .map((item) => [text(item.sourceProductId), item])
      .filter(([id]) => id)
  );
  const detailsById = new Map(
    items(details)
      .map((item) => [text(item.sourceProductId), item])
      .filter(([id]) => id)
  );
  const before = {
    genericUnknown: production.filter((item) => classifyCurrentBrand(item) === "generic-unknown").length,
    unknownMeerschaum: production.filter((item) => classifyCurrentBrand(item) === "unknown-meerschaum").length,
    unbranded: production.filter((item) => classifyCurrentBrand(item) === "unbranded").length,
    known: production.filter((item) => classifyCurrentBrand(item) === "known").length,
  };
  const publicUnknownBefore = items(publicProducts).filter((item) => {
    const brand = text(item.brandName || item.brand || item.canonicalBrand);
    return !brand || isExactBrand(brand, "unknown");
  }).length;
  const candidates = production.filter(
    (item) => classifyCurrentBrand(item) === "generic-unknown"
  );
  const syntheticDetails = candidates.map((product) =>
    makeConverterDetail(product, detailsById.get(text(product.sourceProductId)))
  );
  const converted = convertSmokingpipesCandidateDetails(syntheticDetails, items(listProducts));
  const convertedById = new Map(
    converted.products.map((item) => [text(item.sourceProductId), item])
  );
  const recovered = [];
  const unresolved = [];
  const nextProducts = production.map((product) => {
    if (classifyCurrentBrand(product) !== "generic-unknown") return product;
    const sourceProductId = text(product.sourceProductId);
    const convertedProduct = convertedById.get(sourceProductId);
    const canonicalBrand = text(convertedProduct?.canonicalBrand);
    const mapped = convertedProduct?.brandMapped === true;
    const genericResult = !canonicalBrand || /^(?:unknown|unknown meerschaum|unbranded)$/i.test(canonicalBrand);
    if (!convertedProduct || !mapped || genericResult) {
      unresolved.push({
        sourceProductId,
        title: text(product.rawTitle || product.displayNameEn),
        sourceUrl: text(product.sourceUrl),
        reason: !convertedProduct ? "converter-failure" : !mapped ? "unmapped-brand-evidence" : "generic-brand-result",
      });
      return product;
    }

    const source = evidenceSource({
      existingDetail: detailsById.get(sourceProductId),
      listItem: listById.get(sourceProductId),
    });
    let next = applyBrandFields(product, convertedProduct);
    const exclusion = classifySmokingpipesBrandExclusion(next);
    if (exclusion.excluded) next = applyFalconExclusion(next);
    recovered.push({
      sourceProductId,
      brand: canonicalBrand,
      source,
      falconExcluded: exclusion.excluded,
      sourceUrl: text(product.sourceUrl),
      title: text(product.rawTitle || product.displayNameEn),
    });
    return next;
  });

  const nextById = new Map(nextProducts.map((item) => [text(item.sourceProductId), item]));
  const knownBrandChangedCount = production.filter(
    (beforeProduct) =>
      classifyCurrentBrand(beforeProduct) === "known" &&
      BRAND_FIELDS.some(
        (field) =>
          JSON.stringify(beforeProduct[field]) !==
          JSON.stringify(nextById.get(text(beforeProduct.sourceProductId))?.[field])
      )
  ).length;
  const changed = production
    .map((beforeProduct) => ({
      before: beforeProduct,
      after: nextById.get(text(beforeProduct.sourceProductId)),
    }))
    .filter(({ before: beforeProduct, after }) =>
      JSON.stringify(beforeProduct) !== JSON.stringify(after)
    );
  const nonBrandFieldChangedCount = changed.filter(({ before: beforeProduct, after }) => {
    return countUnexpectedNonBrandChanges(beforeProduct, after) > 0;
  }).length;
  const idsBefore = production.map((item) => text(item.sourceProductId));
  const idsAfter = nextProducts.map((item) => text(item.sourceProductId));
  const sourceProductIdsStable =
    production.length === nextProducts.length &&
    idsBefore.length === new Set(idsBefore).size &&
    idsAfter.length === new Set(idsAfter).size &&
    idsBefore.every((id, index) => id === idsAfter[index]);
  const exampleBefore = production.find(
    (item) => text(item.sourceProductId) === EXAMPLE_PRODUCT_ID
  );
  const exampleAfter = nextById.get(EXAMPLE_PRODUCT_ID);
  const exampleRecovered =
    text(exampleBefore?.brand) === "" &&
    text(exampleAfter?.canonicalBrand) === "Chacom";
  const recoveredFromDetail = recovered.filter((record) => record.source === "detail").length;
  const recoveredFromList = recovered.filter((record) => record.source === "list").length;
  const recoveredFromUrl = recovered.filter((record) => record.source === "url").length;
  const falconExcludedCount = recovered.filter((record) => record.falconExcluded).length;
  const canWrite =
    exampleRecovered &&
    converted.failures.length === 0 &&
    knownBrandChangedCount === 0 &&
    nonBrandFieldChangedCount === 0 &&
    sourceProductIdsStable &&
    recovered.length >= minimumExpectedRecovered;

  return {
    nextProducts,
    report: {
      version: "smokingpipes-brand-backfill-audit-v1",
      generatedAt: new Date().toISOString(),
      productionUnknownBefore: before.genericUnknown,
      publicUnknownBefore,
      recoveredCount: recovered.length,
      unresolvedCount: unresolved.length,
      recoveredFromDetail,
      recoveredFromList,
      recoveredFromUrl,
      ambiguousCount: unresolved.filter((record) => record.reason === "unmapped-brand-evidence").length,
      falconExcludedCount,
      knownBrandChangedCount,
      nonBrandFieldChangedCount,
      sourceProductIdsStable,
      productionCountBefore: production.length,
      productionCountAfter: nextProducts.length,
      minimumExpectedRecovered,
      minimumExpectedRecoveredMet: recovered.length >= minimumExpectedRecovered,
      converterFailureCount: converted.failures.length,
      currentBrandBreakdown: before,
      example: {
        sourceProductId: EXAMPLE_PRODUCT_ID,
        title: text(exampleBefore?.rawTitle || exampleBefore?.displayNameEn),
        before: exampleBefore
          ? { brand: exampleBefore.brand, canonicalBrand: exampleBefore.canonicalBrand }
          : null,
        after: exampleAfter
          ? { brand: exampleAfter.brand, canonicalBrand: exampleAfter.canonicalBrand }
          : null,
        evidence: recovered.find((record) => record.sourceProductId === EXAMPLE_PRODUCT_ID)?.source || null,
        passed: exampleRecovered,
      },
      topRecoveredBrands: countBrands(recovered),
      unresolvedSamples: unresolved.slice(0, 50),
      canWrite,
    },
  };
}

function parseArguments(argv) {
  const options = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    options.set(key, rest.length ? rest.join("=") : true);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const root = process.cwd();
  const productionPath = path.resolve(
    String(args.get("production") || "data/products/smokingpipes-products.json")
  );
  const listPath = path.resolve(
    String(args.get("list") || "data/inventory/smokingpipes-current-list-dry-run.json")
  );
  const detailsPath = args.get("details")
    ? path.resolve(String(args.get("details")))
    : null;
  const auditPath = path.resolve(
    String(
      args.get("audit") ||
        "data/audits/smokingpipes-daily-fix/smokingpipes-brand-backfill-latest.json"
    )
  );
  const publicPath = path.resolve(
    String(args.get("public") || "data/generated/public-products/catalog.json")
  );
  const write = args.get("write") === true;
  const expectedProductionPath = path.join(
    root,
    "data",
    "products",
    "smokingpipes-products.json"
  );
  const expectedAuditPath = path.join(
    root,
    "data",
    "audits",
    "smokingpipes-daily-fix",
    "smokingpipes-brand-backfill-latest.json"
  );
  if (write && productionPath !== expectedProductionPath) {
    throw new Error(
      `Refusing to write outside the Smokingpipes production source: ${productionPath}`
    );
  }
  if (auditPath !== expectedAuditPath) {
    throw new Error(
      `Refusing to write the backfill audit outside its approved runtime location: ${auditPath}`
    );
  }
  const result = buildSmokingpipesBrandBackfill({
    productionProducts: readJson(productionPath),
    publicProducts: fs.existsSync(publicPath) ? readJson(publicPath) : [],
    listProducts: readJson(listPath),
    details: detailsPath && fs.existsSync(detailsPath) ? readJson(detailsPath) : [],
  });
  result.report.productionPath = path.relative(root, productionPath).replace(/\\/g, "/");
  result.report.listPath = path.relative(root, listPath).replace(/\\/g, "/");
  result.report.detailsPath = detailsPath
    ? path.relative(root, detailsPath).replace(/\\/g, "/")
    : null;
  result.report.writeRequested = write;
  result.report.productionWritten = false;
  if (write && result.report.canWrite) {
    writeJsonAtomic(productionPath, result.nextProducts);
    result.report.productionWritten = true;
  }
  writeJsonAtomic(auditPath, result.report);
  console.log(JSON.stringify(result.report, null, 2));
  if (write && !result.report.canWrite) process.exitCode = 1;
}
