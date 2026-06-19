import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  REFERENCE_PRICE_COMMON_CONFIG,
  addDomesticShippingCny,
  calculateSmokingpipesReferencePrice,
} from "../lib/pricing/reference-price.mjs";

const ROOT = process.cwd();
const GENERATED_ROOT = path.join(ROOT, "data", "generated", "public-products");
const DETAILS_DIR = path.join(GENERATED_ROOT, "details");
const REVIEW_DIR = path.join(ROOT, "data", "review");

const INPUTS = {
  staging: path.join(ROOT, "data", "products", "unified-products-staging.json"),
  exchangeRates: path.join(ROOT, "data", "exchange-rates.ts"),
  smokingpipesPricing: path.join(ROOT, "data", "pricing", "smokingpipes-pricing.json"),
  contract: path.join(ROOT, "data", "products", "unified-product-contract.md"),
  round3Validation: path.join(ROOT, "data", "review", "round3-apply-validation-v1.json"),
  round4Audit: path.join(ROOT, "data", "review", "round4-price-inventory-audit-v1.json"),
  round4Validation: path.join(ROOT, "data", "review", "round4-price-inventory-validation-v1.json"),
};

const OUTPUTS = {
  manifest: path.join(GENERATED_ROOT, "manifest.json"),
  catalog: path.join(GENERATED_ROOT, "catalog.json"),
  lookup: path.join(GENERATED_ROOT, "detail-lookup.json"),
  brands: path.join(GENERATED_ROOT, "brands.json"),
  filters: path.join(GENERATED_ROOT, "filters.json"),
  buildJson: path.join(REVIEW_DIR, "round5-public-index-build-v1.json"),
  buildMarkdown: path.join(REVIEW_DIR, "round5-public-index-build-v1.md"),
  fieldContract: path.join(REVIEW_DIR, "round5-public-index-field-contract-v1.md"),
};

const EXPECTED = {
  stagingSha256: "B0446CBF44F6EA50DF1A7F1ACC131F000A168E80527E96053DAAC9DF93B09B7E",
  stagingTotal: 7301,
  publicProductCount: 6872,
  excludedProductCount: 429,
  sourceCounts: {
    danish: 2121,
    smokingpipes: 4751,
  },
  detailShardCount: 64,
  falconAkbSourceProductIds: ["427301", "427315", "427320", "427322", "479928", "479931"],
};


const SERVICE_FEE_RATE = 0.15;
const MIN_SERVICE_FEE_CNY = 200;
const INVALID_SOURCE_PRICE_THRESHOLD = 1;

const BRAND_CANONICAL_PUBLIC_MAP = new Map([
  ["savinelli autograph", { brandName: "Savinelli", brandSlug: "savinelli", brandCountry: "Italy" }],
  ["savinelli-autograph", { brandName: "Savinelli", brandSlug: "savinelli", brandCountry: "Italy" }],
  ["tsuge ikebana", { brandName: "Tsuge", brandSlug: "tsuge", brandCountry: "Japan" }],
  ["tsuge-ikebana", { brandName: "Tsuge", brandSlug: "tsuge", brandCountry: "Japan" }],
  ["ashton for paul olsen", { brandName: "Ashton", brandSlug: "ashton", brandCountry: "United Kingdom" }],
  ["ashton-for-paul-olsen", { brandName: "Ashton", brandSlug: "ashton", brandCountry: "United Kingdom" }],
  ["son (nording)", { brandName: "Nørding", brandSlug: "nording", brandCountry: "Denmark" }],
  ["son-nording", { brandName: "Nørding", brandSlug: "nording", brandCountry: "Denmark" }],
  ["eriksen keystone filter pipe", { brandName: "Nørding", brandSlug: "nording", brandCountry: "Denmark" }],
  ["eriksen-keystone-filter-pipe", { brandName: "Nørding", brandSlug: "nording", brandCountry: "Denmark" }],
]);

const HIDDEN_PUBLIC_BRAND_KEYS = new Set(["pipe key ring", "pipe-key-ring", "pipepack"]);

const PERFORMANCE_BUDGETS = {
  catalogMaxBytes: 8 * 1024 * 1024,
  catalogAverageRecordMaxBytes: 1200,
  catalogMaxRecordBytes: 4000,
  lookupMaxBytes: 2 * 1024 * 1024,
  brandsMaxBytes: 2 * 1024 * 1024,
  filtersMaxBytes: 1 * 1024 * 1024,
  detailShardMaxBytes: 3 * 1024 * 1024,
};

const CATALOG_ALLOWLIST = [
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
];

const FIELD_CONTRACT_ROWS = [
  ["id", "id", "yes", "yes", "copy stable unified id", "required", "not a filter"],
  ["source", "source", "yes", "yes", "copy source key", "required", "source filter includes every public record"],
  ["sourceProductId", "sourceProductId", "yes", "yes", "copy source-local id", "required", "not a filter"],
  ["brand.canonicalName", "brandName", "yes", "yes", "copy canonical brand", "empty becomes null", "brand filter uses brandName with brandSlug fallback value"],
  ["brand.slug", "brandSlug", "yes", "yes", "copy canonical brand slug", "empty becomes null", "brand option value is brandSlug or brandName"],
  ["brand.country", "brandCountry", "yes", "yes", "copy country", "empty becomes null", "country filter excludes empty and Other"],
  ["displayName", "displayName", "yes", "yes", "copy primary display name", "empty falls back to displayNameEn/rawTitle where consumers choose", "search/sort only"],
  ["displayNameEn", "displayNameEn", "yes", "yes", "copy English display name", "empty becomes null", "search/sort only"],
  ["displayNameZh", "displayNameZh", "no", "yes", "copy Chinese display name", "empty becomes null", "detail title evidence only"],
  ["rawTitle", "rawTitle/sourceOriginalText", "yes", "yes", "copy normalized source title text", "empty becomes null", "search/detail evidence"],
  ["images.main", "mainImage", "yes", "yes", "copy main image URL", "empty becomes null", "not a filter"],
  ["images.gallery", "gallery", "no", "yes", "copy unique gallery URLs only", "empty array", "not a filter"],
  ["price.amount", "sourcePriceAmount", "yes", "yes", "copy positive source amount", "non-finite becomes null", "price ranges are not generated"],
  ["price.currency", "sourcePriceCurrency", "yes", "yes", "copy source currency", "empty becomes null", "not a filter"],
  ["price.msrpAmount", "msrpAmount", "yes", "yes", "copy MSRP amount", "non-finite becomes null", "not a filter"],
  ["price.siteDisplayAmount", "siteDisplayAmount", "yes", "yes", "copy existing Danish display amount plus shared domestic shipping, then add service fee max(15%, CNY 200); derive Smokingpipes RMB reference from source USD, pricing config, exchange rate, plus shared domestic shipping", "non-finite becomes null", "not a filter"],
  ["price.siteDisplayCurrency", "siteDisplayCurrency", "yes", "yes", "copy existing Danish display currency; set Smokingpipes to CNY when reference price is valid", "empty becomes null", "not a filter"],
  ["price.siteDisplayReady", "siteDisplayReady", "yes", "yes", "copy existing Danish readiness; set Smokingpipes true only when reference price is valid", "missing becomes false", "not a filter"],
  ["inventory.status", "inventoryStatus", "yes", "yes", "copy status", "empty becomes null", "inventoryStatus filter includes available and sold"],
  ["inventory.confidence", "inventoryConfidence", "yes", "yes", "copy confidence", "empty becomes null", "not a filter"],
  ["condition.canonical/raw", "conditionType/conditionLabel", "yes", "yes", "copy canonical and raw condition", "empty becomes null", "not a required round5 filter"],
  ["classification.shape", "shape", "yes", "yes", "copy canonical shape", "empty becomes null", "requires classification.eligibility.shape=true"],
  ["classification.shapeZhName", "shapeZh", "yes", "yes", "copy Chinese shape label", "empty becomes null", "label only"],
  ["classification.finish", "finish", "yes", "yes", "copy canonical finish", "empty becomes null", "requires classification.eligibility.finish=true"],
  ["classification.finishZhName", "finishZh", "yes", "yes", "copy Chinese finish label", "empty becomes null", "label only"],
  ["classification.bowlMaterial", "bowlMaterial", "yes", "yes", "copy canonical bowl material", "empty becomes null", "requires classification.eligibility.bowlMaterial=true"],
  ["classification.bowlMaterialZhName", "bowlMaterialZh", "yes", "yes", "copy Chinese bowl material label", "empty becomes null", "label only"],
  ["classification.stemMaterial", "stemMaterial", "yes", "yes", "copy canonical stem material", "empty becomes null", "requires classification.eligibility.stemMaterial=true"],
  ["classification.stemMaterialZhName", "stemMaterialZh", "yes", "yes", "copy Chinese stem material label", "empty becomes null", "label only"],
  ["classification.filter", "filter", "yes", "yes", "copy filter value", "empty becomes null", "requires classification.eligibility.filter=true"],
  ["classification.filterSizeMm", "filterSizeMm", "no", "yes", "copy filter size", "non-finite becomes null", "not a round5 filter"],
  ["classification.eligibility", "filterEligibility", "yes", "yes", "copy field-level eligibility booleans", "missing fields become false", "primary filter eligibility source"],
  ["measurements.*", "measurements", "no", "yes", "copy selected numeric measurement fields", "non-finite becomes null", "not a filter"],
  ["model.canonicalModelKey/confidence", "model", "no", "yes", "copy normalized model fields only", "empty becomes null", "not a filter"],
  ["model.canonicalModelKey", "series", "no", "yes", "derive readable series segment when canonical key has series-*", "otherwise null", "not a filter"],
  ["rawTitle/displayNameEn", "year", "no", "yes", "derive first 1900-2099 year from public title text", "otherwise null", "not a filter"],
  ["search.keywords[0]", "productCode", "no", "yes", "copy only code-like Smokingpipes product code patterns", "otherwise null", "not a filter"],
  ["sourceUrl", "sourceUrl", "no", "yes", "copy original product page URL", "empty becomes null", "not a filter"],
  ["rawTitle", "sourceOriginalText", "no", "yes", "copy original normalized title text only", "empty becomes null", "not a filter"],
];

function cleanText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function requiredText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readExchangeRateMetadata(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const effectiveMonth = source.match(/effectiveMonth:\s*"([^"]+)"/)?.[1] || null;
  const basisDate = source.match(/basisDate:\s*"([^"]+)"/)?.[1] || null;
  const usdRateText = source.match(/USD:\s*([0-9.]+)/)?.[1] || "";
  const usdToCny = Number.parseFloat(usdRateText);

  if (!effectiveMonth || !basisDate || !Number.isFinite(usdToCny) || usdToCny <= 0) {
    throw new Error("Could not read USD exchange rate metadata.");
  }

  return {
    effectiveMonth,
    basisDate,
    rates: {
      USD: usdToCny,
    },
  };
}

function bool(value) {
  return value === true;
}

function stableCompare(a, b) {
  return requiredText(a).localeCompare(requiredText(b), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortById(a, b) {
  return stableCompare(a.id, b.id);
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => stableCompare(a, b)));
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
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot serialize non-finite number.");
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function compactJson(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function hashFileSync(filePath) {
  return hashBuffer(fsSync.readFileSync(filePath));
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function assertWritablePath(filePath) {
  const resolved = path.resolve(filePath);
  const generatedRoot = path.resolve(GENERATED_ROOT);
  const reviewRoot = path.resolve(REVIEW_DIR);
  if (
    !resolved.startsWith(`${generatedRoot}${path.sep}`) &&
    !resolved.startsWith(`${reviewRoot}${path.sep}`)
  ) {
    throw new Error(`Refusing to write outside allowed round5 outputs: ${filePath}`);
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

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function getWeightRange(weightGrams) {
  if (weightGrams === null) return null;
  if (weightGrams < 30) return "light";
  if (weightGrams <= 60) return "medium";
  return "heavy";
}


function normalizeKey(value) {
  return requiredText(value)
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slugKey(value) {
  return normalizeKey(value).replace(/[\s_]+/g, "-");
}

function canonicalPublicBrand(product) {
  const candidates = [
    product.brandSlug,
    product.brandName,
    slugKey(product.brandName),
    slugKey(product.brandSlug),
  ];

  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    const slug = slugKey(candidate);
    if (BRAND_CANONICAL_PUBLIC_MAP.has(key)) return BRAND_CANONICAL_PUBLIC_MAP.get(key);
    if (BRAND_CANONICAL_PUBLIC_MAP.has(slug)) return BRAND_CANONICAL_PUBLIC_MAP.get(slug);
  }

  return null;
}

function isHiddenPublicBrand(product) {
  const keys = [product.brandSlug, product.brandName, slugKey(product.brandName), slugKey(product.brandSlug)].map(normalizeKey);
  return keys.some((key) => HIDDEN_PUBLIC_BRAND_KEYS.has(key));
}

function applyPublicBrandCanonicalization(product) {
  const canonical = canonicalPublicBrand(product);
  if (!canonical) return product;
  return {
    ...product,
    brandName: canonical.brandName,
    brandSlug: canonical.brandSlug,
    brandCountry: product.brandCountry || canonical.brandCountry,
    sortKeys: {
      ...product.sortKeys,
      brand: canonical.brandName.toLowerCase(),
    },
  };
}

function applyMinimumServiceFeeCny(baseAmount) {
  const amount = finiteNumber(baseAmount);
  if (amount === null || amount <= 0) return null;
  const serviceFee = Math.max(amount * SERVICE_FEE_RATE, MIN_SERVICE_FEE_CNY);
  return amount + serviceFee;
}

function suppressPublicReferencePrice(product) {
  return {
    ...product,
    siteDisplayAmount: null,
    siteDisplayCurrency: null,
    siteDisplayReady: false,
    sortKeys: {
      ...product.sortKeys,
      price: null,
    },
  };
}

function normalizePublicReferencePrice(product) {
  const sourcePriceAmount = finiteNumber(product.sourcePriceAmount);
  const likelyBadParsedPrice =
    sourcePriceAmount !== null &&
    sourcePriceAmount > 0 &&
    sourcePriceAmount < INVALID_SOURCE_PRICE_THRESHOLD;

  if (likelyBadParsedPrice) {
    return suppressPublicReferencePrice(product);
  }

  return product;
}

function normalizePublicProduct(product) {
  return normalizePublicReferencePrice(applyPublicBrandCanonicalization(product));
}

function publicPriceFieldsFromRow(row, pricingContext) {
  const price = row.price || {};
  const sourcePriceAmount = finiteNumber(price.amount);
  const sourcePriceCurrency = cleanText(price.currency);
  const brandName = cleanText(row.brand?.canonicalName);

  if (requiredText(row.source) === "smokingpipes") {
    const reference = calculateSmokingpipesReferencePrice({
      sourcePriceAmount,
      brandName,
      usdToCny: pricingContext.exchangeRates.rates.USD,
      pricingConfig: pricingContext.smokingpipesPricing,
    });

    return {
      sourcePriceAmount,
      sourcePriceCurrency,
      msrpAmount: finiteNumber(price.msrpAmount),
      siteDisplayAmount: reference.siteDisplayAmount,
      siteDisplayCurrency: reference.siteDisplayCurrency,
      siteDisplayReady: reference.siteDisplayReady,
      sortPrice: reference.siteDisplayReady ? reference.siteDisplayAmount : null,
    };
  }

  const baseAmount = addDomesticShippingCny(
    finiteNumber(price.siteDisplayAmount)
  );
  const siteDisplayAmount = applyMinimumServiceFeeCny(baseAmount);

  return {
    sourcePriceAmount,
    sourcePriceCurrency,
    msrpAmount: finiteNumber(price.msrpAmount),
    siteDisplayAmount,
    siteDisplayCurrency: siteDisplayAmount !== null ? "CNY" : cleanText(price.siteDisplayCurrency),
    siteDisplayReady: bool(price.siteDisplayReady) && siteDisplayAmount !== null,
    sortPrice: siteDisplayAmount,
  };
}

function catalogFromRow(row, pricingContext) {
  const classification = row.classification || {};
  const eligibility = classification.eligibility || {};
  const measurements = row.measurements || {};
  const priceFields = publicPriceFieldsFromRow(row, pricingContext);
  const weightGrams = finiteNumber(measurements.weightGrams);
  return normalizePublicProduct({
    id: requiredText(row.id),
    source: requiredText(row.source),
    sourceProductId: requiredText(row.sourceProductId),
    brandName: cleanText(row.brand?.canonicalName),
    brandSlug: cleanText(row.brand?.slug),
    brandCountry: cleanText(row.brand?.country),
    displayName: cleanText(row.displayName),
    displayNameEn: cleanText(row.displayNameEn),
    rawTitle: cleanText(row.rawTitle),
    mainImage: cleanText(row.images?.main),
    sourcePriceAmount: priceFields.sourcePriceAmount,
    sourcePriceCurrency: priceFields.sourcePriceCurrency,
    msrpAmount: priceFields.msrpAmount,
    siteDisplayAmount: priceFields.siteDisplayAmount,
    siteDisplayCurrency: priceFields.siteDisplayCurrency,
    siteDisplayReady: priceFields.siteDisplayReady,
    inventoryStatus: cleanText(row.inventory?.status),
    inventoryConfidence: cleanText(row.inventory?.confidence),
    conditionType: cleanText(row.condition?.canonical),
    conditionLabel: cleanText(row.condition?.raw),
    galleryCount: Array.isArray(row.images?.gallery) ? uniqueStrings(row.images.gallery).length : 0,
    weightGrams,
    shape: cleanText(classification.shape),
    shapeZh: cleanText(classification.shapeZhName),
    finish: cleanText(classification.finish),
    finishZh: cleanText(classification.finishZhName),
    bowlMaterial: cleanText(classification.bowlMaterial),
    bowlMaterialZh: cleanText(classification.bowlMaterialZhName),
    stemMaterial: cleanText(classification.stemMaterial),
    stemMaterialZh: cleanText(classification.stemMaterialZhName),
    filter: cleanText(classification.filter),
    filterEligibility: {
      shape: bool(eligibility.shape),
      finish: bool(eligibility.finish),
      bowlMaterial: bool(eligibility.bowlMaterial),
      stemMaterial: bool(eligibility.stemMaterial),
      filter: bool(eligibility.filter),
    },
    sortKeys: {
      brand: requiredText(row.brand?.canonicalName).toLowerCase(),
      name: requiredText(row.displayNameEn || row.displayName || row.rawTitle).toLowerCase(),
      price: priceFields.sortPrice,
      sourceProductId: requiredText(row.sourceProductId),
    },
  });
}

function deriveShard(id) {
  const firstByteHex = crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);
  const bucket = Number.parseInt(firstByteHex, 16) % EXPECTED.detailShardCount;
  return bucket.toString(16).padStart(2, "0");
}

function deriveSeries(modelKey) {
  const key = cleanText(modelKey);
  if (!key) return null;
  const part = key.split("__").find((entry) => entry.startsWith("series-"));
  if (!part) return null;
  return part
    .slice("series-".length)
    .split("-")
    .filter(Boolean)
    .map((word) => (word.length ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

function deriveYear(row) {
  const text = `${row.rawTitle || ""} ${row.displayNameEn || ""} ${row.displayName || ""}`;
  const match = text.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function deriveProductCode(row) {
  const firstKeyword = cleanText(row.search?.keywords?.[0]);
  if (firstKeyword && /^\d{3}-\d{3}-[A-Za-z0-9.-]+$/.test(firstKeyword)) return firstKeyword;
  return null;
}

function measurementsFromRow(row) {
  const measurements = row.measurements || {};
  return {
    lengthMm: finiteNumber(measurements.lengthMm),
    heightMm: finiteNumber(measurements.heightMm),
    weightGrams: finiteNumber(measurements.weightGrams),
    chamberDepthMm: finiteNumber(measurements.chamberDepthMm),
    chamberDiameterMm: finiteNumber(measurements.chamberDiameterMm),
    outsideDiameterMm: finiteNumber(measurements.outsideDiameterMm),
  };
}

function normalizedSpecsFromRow(row) {
  const classification = row.classification || {};
  const measurements = measurementsFromRow(row);
  const specs = [
    ["brand", cleanText(row.brand?.canonicalName), null],
    ["country", cleanText(row.brand?.country), null],
    ["condition", cleanText(row.condition?.canonical), null],
    ["shape", cleanText(classification.shape), cleanText(classification.shapeZhName)],
    ["finish", cleanText(classification.finish), cleanText(classification.finishZhName)],
    ["bowlMaterial", cleanText(classification.bowlMaterial), cleanText(classification.bowlMaterialZhName)],
    ["stemMaterial", cleanText(classification.stemMaterial), cleanText(classification.stemMaterialZhName)],
    ["filter", cleanText(classification.filter), null],
    ["lengthMm", measurements.lengthMm, "mm"],
    ["heightMm", measurements.heightMm, "mm"],
    ["weightGrams", measurements.weightGrams, "g"],
    ["chamberDepthMm", measurements.chamberDepthMm, "mm"],
    ["chamberDiameterMm", measurements.chamberDiameterMm, "mm"],
    ["outsideDiameterMm", measurements.outsideDiameterMm, "mm"],
  ];
  return specs
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value, labelZhOrUnit]) => ({
      key,
      value,
      labelZh: typeof labelZhOrUnit === "string" && !["mm", "g"].includes(labelZhOrUnit) ? labelZhOrUnit : null,
      unit: ["mm", "g"].includes(labelZhOrUnit) ? labelZhOrUnit : null,
    }));
}

function detailFromRow(row, catalogProduct) {
  const gallery = uniqueStrings([...(Array.isArray(row.images?.gallery) ? row.images.gallery : [])]);
  const filterSizeMm = finiteNumber(row.classification?.filterSizeMm);
  const weightGrams = finiteNumber(row.measurements?.weightGrams);
  return {
    ...catalogProduct,
    displayNameZh: cleanText(row.displayNameZh),
    gallery,
    measurements: measurementsFromRow(row),
    model: {
      canonicalModelKey: cleanText(row.model?.canonicalModelKey),
      confidence: cleanText(row.model?.confidence),
    },
    series: deriveSeries(row.model?.canonicalModelKey),
    year: deriveYear(row),
    productCode: deriveProductCode(row),
    filterSizeMm,
    weightRange: getWeightRange(weightGrams),
    description: null,
    normalizedSpecs: normalizedSpecsFromRow(row),
    sourceUrl: cleanText(row.sourceUrl),
    sourceOriginalText: cleanText(row.rawTitle),
    priceRawText: cleanText(row.price?.rawText),
    msrpRawText: cleanText(row.price?.msrpRawText),
  };
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
  if (HIDDEN_PUBLIC_BRAND_KEYS.has(normalizeKey(value)) || HIDDEN_PUBLIC_BRAND_KEYS.has(slugKey(value))) return;
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

function buildFilters(catalog) {
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
    if (product.filterEligibility.shape) addFilterCount(maps.shape, product.shape, product.shape, product.shapeZh, product.id);
    if (product.filterEligibility.finish) addFilterCount(maps.finish, product.finish, product.finish, product.finishZh, product.id);
    if (product.filterEligibility.bowlMaterial) {
      addFilterCount(maps.bowlMaterial, product.bowlMaterial, product.bowlMaterial, product.bowlMaterialZh, product.id);
    }
    if (product.filterEligibility.stemMaterial) {
      addFilterCount(maps.stemMaterial, product.stemMaterial, product.stemMaterial, product.stemMaterialZh, product.id);
    }
    if (product.filterEligibility.filter) addFilterCount(maps.filter, product.filter, product.filter, null, product.id);
    addFilterCount(maps.inventoryStatus, product.inventoryStatus, product.inventoryStatus, null, product.id);
    if (product.sourcePriceCurrency === "USD" && product.sourcePriceAmount !== null) usdPrices.push(product.sourcePriceAmount);
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

function buildBrands(catalog) {
  const brands = new Map();
  for (const product of catalog) {
    if (isHiddenPublicBrand(product)) continue;
    const brandName = cleanText(product.brandName) || "(unknown)";
    const key = product.brandSlug || brandName;
    if (!brands.has(key)) {
      brands.set(key, {
        brandName,
        brandSlug: product.brandSlug,
        country: product.brandCountry,
        productCount: 0,
        sourceCounts: {},
        inventoryStatusCounts: {},
        productIds: [],
      });
    }
    const brand = brands.get(key);
    brand.productCount += 1;
    brand.sourceCounts[product.source] = (brand.sourceCounts[product.source] || 0) + 1;
    brand.inventoryStatusCounts[product.inventoryStatus] = (brand.inventoryStatusCounts[product.inventoryStatus] || 0) + 1;
    brand.productIds.push(product.id);
  }
  return {
    schemaVersion: 1,
    brands: [...brands.values()]
      .map((brand) => ({
        ...brand,
        sourceCounts: sortObject(brand.sourceCounts),
        inventoryStatusCounts: sortObject(brand.inventoryStatusCounts),
        productIds: brand.productIds.sort(stableCompare),
      }))
      .sort((a, b) => stableCompare(a.brandName, b.brandName) || stableCompare(a.brandSlug, b.brandSlug)),
  };
}

function countBy(items, getter) {
  const out = {};
  for (const item of items) {
    const key = requiredText(getter(item)) || "(missing)";
    out[key] = (out[key] || 0) + 1;
  }
  return sortObject(out);
}

function buildLookup(catalog) {
  const byId = {};
  const bySourceProduct = {};
  for (const product of catalog) {
    const shard = deriveShard(product.id);
    byId[product.id] = shard;
    bySourceProduct[`${product.source}:${product.sourceProductId}`] = {
      id: product.id,
      shard,
    };
  }
  return {
    schemaVersion: 1,
    byId: sortObject(byId),
    bySourceProduct: sortObject(bySourceProduct),
  };
}

function buildDetailShards(details) {
  const shards = new Map();
  for (let index = 0; index < EXPECTED.detailShardCount; index += 1) {
    shards.set(index.toString(16).padStart(2, "0"), []);
  }
  for (const detail of details) {
    shards.get(deriveShard(detail.id)).push(detail);
  }
  return [...shards.entries()].map(([shard, products]) => ({
    shard,
    file: path.join(DETAILS_DIR, `${shard}.json`),
    relativeFile: `data/generated/public-products/details/${shard}.json`,
    content: {
      schemaVersion: 1,
      shard,
      products: products.sort(sortById),
    },
  }));
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function makeFieldContract() {
  const rows = FIELD_CONTRACT_ROWS.map(
    ([sourceField, indexField, catalog, detail, transform, emptyRule, filterRule]) =>
      `| ${sourceField} | ${indexField} | ${catalog} | ${detail} | ${transform} | ${emptyRule} | ${filterRule} |`
  ).join("\n");
  return `# Round 5 Public Index Field Contract V1

This contract maps the read-only staging source fields into the new public product indexes. The generated data uses explicit allowlists and does not copy whole staging records, crawler raw objects, HTML, or audit objects.

| staging source field | new index field | catalog includes | detail includes | transform rule | null/empty rule | filter eligibility rule |
| --- | --- | --- | --- | --- | --- | --- |
${rows}
`;
}

function makeMarkdown(report) {
  const filterCounts = Object.entries(report.filterOptionCounts)
    .map(([key, count]) => `- ${key}: ${count}`)
    .join("\n");
  return `# Round 5 Public Product Index Build V1

Status: ${report.status}

## Counts

- catalog products: ${report.counts.publicProductCount}
- excluded products: ${report.counts.excludedProductCount}
- Danish public products: ${report.counts.sourceCounts.danish}
- Smokingpipes public products: ${report.counts.sourceCounts.smokingpipes}
- detail shards: ${report.counts.detailShardCount}
- detail records: ${report.counts.detailRecordCount}
- brands: ${report.counts.brandCount}

## Filters

${filterCounts}

## Performance

- staging bytes: ${report.performance.stagingBytes}
- catalog bytes: ${report.performance.catalogBytes}
- catalog average record bytes: ${report.performance.catalogAverageRecordBytes}
- catalog max record bytes: ${report.performance.catalogMaxRecordBytes}
- detail total bytes: ${report.performance.detailTotalBytes}
- detail max shard bytes: ${report.performance.detailMaxShardBytes}
- catalog to staging ratio: ${report.performance.catalogToStagingRatio}
- catalog reduction ratio: ${report.performance.catalogReductionRatio}

## Safety

- hidden records excluded: ${report.safety.hiddenRecordsExcluded}
- non-offer records excluded: ${report.safety.nonOfferRecordsExcluded}
- Falcon/AKB anomalies excluded: ${report.safety.falconAkbExcluded}
- needs-review Smokingpipes excluded: ${report.safety.smokingpipesNeedsReviewExcluded}

This build is data-only and does not modify frontend pages.
`;
}

function performanceForOutputs(stagingBytes, catalog, serializedFiles, detailShardStats) {
  const catalogText = serializedFiles["data/generated/public-products/catalog.json"];
  const catalogRecordSizes = catalog.map((product) => byteLength(compactJson(product)));
  const catalogBytes = byteLength(catalogText);
  const detailBytes = detailShardStats.map((item) => item.sizeBytes);
  return {
    stagingBytes,
    catalogBytes,
    catalogAverageRecordBytes: Math.round((catalogBytes / catalog.length) * 100) / 100,
    catalogMaxRecordBytes: Math.max(...catalogRecordSizes),
    lookupBytes: byteLength(serializedFiles["data/generated/public-products/detail-lookup.json"]),
    brandsBytes: byteLength(serializedFiles["data/generated/public-products/brands.json"]),
    filtersBytes: byteLength(serializedFiles["data/generated/public-products/filters.json"]),
    detailShardSizes: Object.fromEntries(detailShardStats.map((item) => [item.shard, item.sizeBytes])),
    detailShardRecordCounts: Object.fromEntries(detailShardStats.map((item) => [item.shard, item.recordCount])),
    detailMaxShardBytes: Math.max(...detailBytes),
    detailMinShardRecordCount: Math.min(...detailShardStats.map((item) => item.recordCount)),
    detailMaxShardRecordCount: Math.max(...detailShardStats.map((item) => item.recordCount)),
    detailTotalBytes: sum(detailBytes),
    catalogToStagingRatio: Math.round((catalogBytes / stagingBytes) * 1000000) / 1000000,
    catalogReductionRatio: Math.round((1 - catalogBytes / stagingBytes) * 1000000) / 1000000,
  };
}

function performanceBudgetStatus(performance) {
  return {
    catalogMaxBytes: performance.catalogBytes <= PERFORMANCE_BUDGETS.catalogMaxBytes,
    catalogAverageRecordMaxBytes:
      performance.catalogAverageRecordBytes <= PERFORMANCE_BUDGETS.catalogAverageRecordMaxBytes,
    catalogMaxRecordBytes: performance.catalogMaxRecordBytes <= PERFORMANCE_BUDGETS.catalogMaxRecordBytes,
    lookupMaxBytes: performance.lookupBytes <= PERFORMANCE_BUDGETS.lookupMaxBytes,
    brandsMaxBytes: performance.brandsBytes <= PERFORMANCE_BUDGETS.brandsMaxBytes,
    filtersMaxBytes: performance.filtersBytes <= PERFORMANCE_BUDGETS.filtersMaxBytes,
    detailShardMaxBytes: performance.detailMaxShardBytes <= PERFORMANCE_BUDGETS.detailShardMaxBytes,
  };
}

async function main() {
  const staging = await readJson(INPUTS.staging);
  const exchangeRates = await readExchangeRateMetadata(INPUTS.exchangeRates);
  const smokingpipesPricing = await readJson(INPUTS.smokingpipesPricing);
  const round3Validation = await readJson(INPUTS.round3Validation);
  const round4Audit = await readJson(INPUTS.round4Audit);
  const round4Validation = await readJson(INPUTS.round4Validation);
  await fs.readFile(INPUTS.contract, "utf8");

  if (!Array.isArray(staging)) throw new Error("Staging input is not an array.");

  const stagingSha256 = hashFileSync(INPUTS.staging);
  const inputHashes = Object.fromEntries(
    Object.entries(INPUTS).map(([key, filePath]) => [key, hashFileSync(filePath)])
  );

  const publicRows = staging
    .filter(shouldIncludePublic)
    .sort((a, b) => stableCompare(a.id, b.id));
  const excludedRows = staging.filter((row) => !shouldIncludePublic(row));
  const pricingContext = {
    exchangeRates,
    smokingpipesPricing,
  };
  const catalog = publicRows
    .map((row) => catalogFromRow(row, pricingContext))
    .sort(sortById);
  const details = publicRows.map((row, index) => detailFromRow(row, catalog[index])).sort(sortById);
  const lookup = buildLookup(catalog);
  const brands = buildBrands(catalog);
  const filters = buildFilters(catalog);
  const detailShards = buildDetailShards(details);

  const serializedFiles = {
    "data/generated/public-products/catalog.json": compactJson({
      schemaVersion: 1,
      products: catalog,
    }),
    "data/generated/public-products/detail-lookup.json": compactJson(lookup),
    "data/generated/public-products/brands.json": compactJson(brands),
    "data/generated/public-products/filters.json": compactJson(filters),
  };

  const detailShardStats = [];
  for (const shard of detailShards) {
    const text = compactJson(shard.content);
    serializedFiles[shard.relativeFile] = text;
    detailShardStats.push({
      shard: shard.shard,
      file: shard.relativeFile,
      recordCount: shard.content.products.length,
      sizeBytes: byteLength(text),
    });
  }

  const stagingBytes = fsSync.statSync(INPUTS.staging).size;
  const performance = performanceForOutputs(stagingBytes, catalog, serializedFiles, detailShardStats);
  const budgetStatus = performanceBudgetStatus(performance);
  const publicSourceCounts = countBy(catalog, (product) => product.source);
  const inventoryStatusCounts = countBy(catalog, (product) => product.inventoryStatus);
  const filterOptionCounts = Object.fromEntries(
    Object.entries(filters.options).map(([key, options]) => [key, options.length])
  );

  for (const [relativeFile, text] of Object.entries(serializedFiles)) {
    await writeFileAtomic(path.join(ROOT, relativeFile), text);
  }

  const generatedDataFiles = Object.keys(serializedFiles).sort();
  const fileHashes = Object.fromEntries(
    generatedDataFiles.map((relativeFile) => [relativeFile, hashFileSync(path.join(ROOT, relativeFile))])
  );
  const fileSizes = Object.fromEntries(
    generatedDataFiles.map((relativeFile) => [relativeFile, fsSync.statSync(path.join(ROOT, relativeFile)).size])
  );

  const manifest = {
    schemaVersion: 1,
    generatorVersion: "round5-public-product-indexes-v1",
    inputFiles: Object.fromEntries(Object.entries(INPUTS).map(([key, filePath]) => [key, relativePath(filePath)])),
    inputHashes,
    publicProductCount: catalog.length,
    excludedProductCount: excludedRows.length,
    sourceCounts: publicSourceCounts,
    inventoryStatusCounts,
    brandCount: brands.brands.length,
    detailShardCount: EXPECTED.detailShardCount,
    detailRecordCount: details.length,
    catalogFile: "data/generated/public-products/catalog.json",
    lookupFile: "data/generated/public-products/detail-lookup.json",
    brandsFile: "data/generated/public-products/brands.json",
    filtersFile: "data/generated/public-products/filters.json",
    detailFiles: detailShards.map((item) => item.relativeFile).sort(),
    fileHashes,
    fileSizes,
    fileHashScope: "Generated public-products files excluding manifest.json to avoid a self-hash cycle.",
    pricing: {
      smokingpipesReferencePricing: {
        exchangeRateEffectiveMonth: exchangeRates.effectiveMonth,
        exchangeRateBasisDate: exchangeRates.basisDate,
        usdToCny: exchangeRates.rates.USD,
        configFile: "data/pricing/smokingpipes-pricing.json",
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
      },
    },
    performanceBudgets: PERFORMANCE_BUDGETS,
    performance,
  };
  await writeFileAtomic(OUTPUTS.manifest, stableJson(manifest));

  const hiddenIds = new Set(excludedRows.map((row) => requiredText(row.id)));
  const catalogIds = new Set(catalog.map((product) => product.id));
  const falconAkbExcluded = EXPECTED.falconAkbSourceProductIds.every(
    (sourceProductId) => !catalog.some((product) => product.source === "smokingpipes" && product.sourceProductId === sourceProductId)
  );
  const safety = {
    hiddenRecordsExcluded: [...hiddenIds].every((id) => !catalogIds.has(id)),
    nonOfferRecordsExcluded: catalog.every((product) => {
      const row = publicRows.find((item) => item.id === product.id);
      return row?.entityType === "offer";
    }),
    falconAkbExcluded,
    smokingpipesNeedsReviewExcluded: catalog.every((product) => {
      const row = publicRows.find((item) => item.id === product.id);
      return !(row?.source === "smokingpipes" && row?.inventory?.status === "needs-review");
    }),
  };

  const status =
    stagingSha256 === EXPECTED.stagingSha256 &&
    round3Validation.hashes?.unifiedStaging === EXPECTED.stagingSha256 &&
    round4Audit.status === "passed" &&
    round4Validation.status === "passed" &&
    catalog.length === EXPECTED.publicProductCount &&
    excludedRows.length === EXPECTED.excludedProductCount &&
    publicSourceCounts.danish === EXPECTED.sourceCounts.danish &&
    publicSourceCounts.smokingpipes === EXPECTED.sourceCounts.smokingpipes &&
    Object.values(budgetStatus).every(Boolean) &&
    Object.values(safety).every(Boolean)
      ? "passed"
      : "failed";

  const report = {
    schemaVersion: 1,
    buildName: "round5-public-index-build-v1",
    status,
    expected: EXPECTED,
    inputs: {
      hashes: inputHashes,
      round3UnifiedStagingHash: round3Validation.hashes?.unifiedStaging ?? null,
      round4AuditStatus: round4Audit.status ?? null,
      round4ValidationStatus: round4Validation.status ?? null,
    },
    pricing: {
      smokingpipesReferencePricing: {
        exchangeRateEffectiveMonth: exchangeRates.effectiveMonth,
        exchangeRateBasisDate: exchangeRates.basisDate,
        usdToCny: exchangeRates.rates.USD,
        taxFactor: smokingpipesPricing.taxFactor,
        serviceFeeRate: smokingpipesPricing.serviceFeeRate,
        minServiceFeeCny: smokingpipesPricing.minServiceFeeCny,
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        defaultDiscountRate: smokingpipesPricing.defaultDiscountRate,
        brandDiscountRates: smokingpipesPricing.brandDiscountRates,
        shippingTiersUsd: smokingpipesPricing.shippingTiersUsd,
      },
    },
    counts: {
      stagingTotal: staging.length,
      publicProductCount: catalog.length,
      excludedProductCount: excludedRows.length,
      sourceCounts: publicSourceCounts,
      inventoryStatusCounts,
      detailShardCount: EXPECTED.detailShardCount,
      detailRecordCount: details.length,
      brandCount: brands.brands.length,
    },
    filterOptionCounts,
    safety,
    performance,
    performanceBudgets: PERFORMANCE_BUDGETS,
    performanceBudgetStatus: budgetStatus,
    outputFiles: {
      manifest: relativePath(OUTPUTS.manifest),
      catalog: relativePath(OUTPUTS.catalog),
      lookup: relativePath(OUTPUTS.lookup),
      brands: relativePath(OUTPUTS.brands),
      filters: relativePath(OUTPUTS.filters),
      details: detailShards.map((item) => item.relativeFile).sort(),
      fieldContract: relativePath(OUTPUTS.fieldContract),
    },
    manifestHash: hashFileSync(OUTPUTS.manifest),
    errors: status === "passed" ? [] : ["One or more round5 build checks failed; inspect status fields."],
    warnings: [],
  };

  await writeFileAtomic(OUTPUTS.fieldContract, makeFieldContract());
  await writeFileAtomic(OUTPUTS.buildJson, stableJson(report));
  await writeFileAtomic(OUTPUTS.buildMarkdown, makeMarkdown(report));

  console.log(`Round 5 public index build ${status}: ${catalog.length} catalog products, ${details.length} details.`);
  if (status !== "passed") process.exitCode = 1;
}

await main();
