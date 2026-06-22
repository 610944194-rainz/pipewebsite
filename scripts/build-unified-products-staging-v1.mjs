import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateSmokingpipesPublicReadiness } from "./lib/smokingpipes-public-readiness-v1.mjs";

const ROOT = process.cwd();
const DANISH_INPUT = path.join(ROOT, "data", "products", "danish-products.json");
const SMOKINGPIPES_INPUT = path.join(
  ROOT,
  "data",
  "products",
  "smokingpipes-products.json"
);
const BRAND_TAXONOMY_INPUT = path.join(
  ROOT,
  "data",
  "taxonomy",
  "brand-aliases.json"
);
const SOURCE_SCOPED_BRAND_MAPPINGS_INPUT = path.join(
  ROOT,
  "data",
  "taxonomy",
  "source-scoped-brand-mappings.json"
);
const PRODUCT_PUBLICATION_OVERRIDES_INPUT = path.join(
  ROOT,
  "data",
  "taxonomy",
  "product-publication-overrides.json"
);
const SHAPE_TAXONOMY_INPUT = path.join(ROOT, "data", "taxonomy", "pipe-shapes.json");
const FINISH_TAXONOMY_INPUT = path.join(ROOT, "data", "taxonomy", "pipe-finishes.json");
const MATERIAL_TAXONOMY_INPUT = path.join(ROOT, "data", "taxonomy", "pipe-materials.json");
const OUTPUT = process.env.UNIFIED_STAGING_OUTPUT
  ? path.resolve(ROOT, process.env.UNIFIED_STAGING_OUTPUT)
  : path.join(ROOT, "data", "products", "unified-products-staging.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleepSync(milliseconds) {
  const state = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(state, 0, 0, milliseconds);
}

function replaceFileWithRetry(tmpPath, filePath, attempts = 20, delayMs = 750) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o666);
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        sleepSync(delayMs);
      }
    }
  }

  throw lastError ?? new Error(`Unable to replace output file: ${filePath}`);
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const json = `${JSON.stringify(data, null, 2)}\n`;
    fs.writeFileSync(tmpPath, json, "utf8");
    replaceFileWithRetry(tmpPath, filePath);
    return crypto.createHash("sha256").update(json).digest("hex").toUpperCase();
  } catch (error) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
    throw error;
  }
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nullableText(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (/^(unknown|n\/a|null|undefined)$/i.test(normalized)) return null;
  return normalized;
}

function numberOrNull(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeKey(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/å/g, "a")
    .replace(/Å/g, "A")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, "-") || "unknown";
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function loadBrandTaxonomy() {
  if (!fs.existsSync(BRAND_TAXONOMY_INPUT)) {
    return { bySlug: new Map(), byAlias: new Map() };
  }

  const taxonomy = readJson(BRAND_TAXONOMY_INPUT);
  const bySlug = new Map();
  const byAlias = new Map();

  for (const brand of taxonomy.brands || []) {
    const slug = text(brand.canonicalBrandSlug);
    if (slug) bySlug.set(slug, brand);

    const names = [
      brand.canonicalBrand,
      brand.canonicalBrandSlug,
      ...(Array.isArray(brand.aliases) ? brand.aliases : []),
    ];

    for (const name of names) {
      const key = normalizeKey(name);
      if (key) byAlias.set(key, brand);
    }
  }

  return { bySlug, byAlias };
}

function sourcePathname(value) {
  const normalized = text(value);
  if (!normalized) return "";

  try {
    return new URL(normalized).pathname.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function loadSourceScopedBrandMappings() {
  if (!fs.existsSync(SOURCE_SCOPED_BRAND_MAPPINGS_INPUT)) {
    return new Map();
  }

  const payload = readJson(SOURCE_SCOPED_BRAND_MAPPINGS_INPUT);
  const index = new Map();

  for (const mapping of payload.mappings || []) {
    const source = text(mapping.source).toLowerCase();
    const rawAlias = text(mapping.rawAlias);
    if (!source || !rawAlias) continue;

    const key = `${source}::${normalizeKey(rawAlias)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(mapping);
  }

  for (const mappings of index.values()) {
    mappings.sort(
      (a, b) => text(b.sourcePathPrefix).length - text(a.sourcePathPrefix).length
    );
  }

  return index;
}

function loadProductPublicationOverrides() {
  if (!fs.existsSync(PRODUCT_PUBLICATION_OVERRIDES_INPUT)) {
    return {
      direct: new Map(),
      rules: [],
      classificationExclusions: [],
    };
  }

  const payload = readJson(PRODUCT_PUBLICATION_OVERRIDES_INPUT);
  const direct = new Map();

  for (const item of payload.directOverrides || []) {
    const source = text(item.source).toLowerCase();
    const sourceProductId = text(item.sourceProductId);
    if (!source || !sourceProductId) continue;
    direct.set(`${source}::${sourceProductId}`, item);
  }

  return {
    direct,
    rules: Array.isArray(payload.ruleOverrides) ? payload.ruleOverrides : [],
    classificationExclusions: Array.isArray(payload.classificationExclusions)
      ? payload.classificationExclusions
      : [],
  };
}

const brandTaxonomy = loadBrandTaxonomy();
const sourceScopedBrandMappings = loadSourceScopedBrandMappings();
const productPublicationOverrides = loadProductPublicationOverrides();
const termTaxonomy = loadTermTaxonomy();

function findSourceScopedBrandMapping({ source, rawName, sourceUrl }) {
  const key = `${text(source).toLowerCase()}::${normalizeKey(rawName)}`;
  const candidates = sourceScopedBrandMappings.get(key) || [];
  const pathname = sourcePathname(sourceUrl);

  for (const mapping of candidates) {
    const prefix = text(mapping.sourcePathPrefix).toLowerCase();
    if (!prefix || pathname.startsWith(prefix)) return mapping;
  }

  return null;
}

function findBrandTaxonomy({ source, rawName, name, slug, sourceUrl }) {
  const scopedMapping = findSourceScopedBrandMapping({
    source,
    rawName,
    sourceUrl,
  });

  if (scopedMapping) {
    const scopedName = text(scopedMapping.approvedCanonicalBrand);
    const scopedSlug = slugify(scopedName);

    if (brandTaxonomy.bySlug.has(scopedSlug)) {
      return brandTaxonomy.bySlug.get(scopedSlug);
    }

    const scopedKey = normalizeKey(scopedName);
    if (scopedKey && brandTaxonomy.byAlias.has(scopedKey)) {
      return brandTaxonomy.byAlias.get(scopedKey);
    }
  }

  const rawKey = normalizeKey(rawName);
  if (rawKey && brandTaxonomy.byAlias.has(rawKey)) {
    return brandTaxonomy.byAlias.get(rawKey);
  }

  const normalizedSlug = text(slug);
  if (normalizedSlug && brandTaxonomy.bySlug.has(normalizedSlug)) {
    return brandTaxonomy.bySlug.get(normalizedSlug);
  }

  const nameKey = normalizeKey(name);
  if (nameKey && brandTaxonomy.byAlias.has(nameKey)) {
    return brandTaxonomy.byAlias.get(nameKey);
  }

  return undefined;
}

function makeBrand({
  source,
  sourceUrl,
  rawName,
  canonicalName,
  canonicalSlug,
  zhName,
  country,
  reviewStatus,
  indexEligible,
}) {
  const fallbackName = nullableText(canonicalName) || nullableText(rawName) || "Unknown";
  const taxonomy = findBrandTaxonomy({
    source,
    sourceUrl,
    rawName,
    name: fallbackName,
    slug: canonicalSlug,
  });
  const finalReviewStatus =
    text(taxonomy?.reviewStatus) ||
    text(reviewStatus) ||
    "confirmed";
  const eligible =
    typeof taxonomy?.indexEligible === "boolean"
      ? taxonomy.indexEligible
      : typeof indexEligible === "boolean"
        ? indexEligible
        : finalReviewStatus !== "needs-review";
  const slug =
    eligible && finalReviewStatus !== "needs-review"
      ? nullableText(taxonomy?.canonicalBrandSlug) ||
        nullableText(canonicalSlug) ||
        slugify(fallbackName)
      : null;

  return {
    rawName: text(rawName),
    canonicalName:
      nullableText(taxonomy?.canonicalBrand) || nullableText(canonicalName) || fallbackName,
    slug,
    zhName:
      taxonomy && Object.prototype.hasOwnProperty.call(taxonomy, "zhName")
        ? nullableText(taxonomy.zhName)
        : nullableText(zhName),
    country:
      taxonomy && Object.prototype.hasOwnProperty.call(taxonomy, "country")
        ? nullableText(taxonomy.country)
        : nullableText(country),
    reviewStatus: finalReviewStatus,
    indexEligible: Boolean(eligible && finalReviewStatus !== "needs-review"),
  };
}

function buildTermMap(items, canonicalField, slugField) {
  const bySlug = new Map();
  const byAlias = new Map();

  for (const item of items || []) {
    const canonical = text(item[canonicalField]);
    const slug = text(item[slugField]) || slugify(canonical);
    if (!canonical) continue;

    const normalized = {
      name: canonical,
      slug,
      zhName: nullableText(item.zhName),
      reviewStatus: nullableText(item.reviewStatus),
    };
    bySlug.set(slug, normalized);
    for (const alias of [canonical, slug, ...(Array.isArray(item.aliases) ? item.aliases : [])]) {
      const key = normalizeKey(alias);
      if (key) byAlias.set(key, normalized);
    }
  }

  return { bySlug, byAlias };
}

function loadTermTaxonomy() {
  const empty = { bySlug: new Map(), byAlias: new Map() };
  const shapes = fs.existsSync(SHAPE_TAXONOMY_INPUT)
    ? readJson(SHAPE_TAXONOMY_INPUT).shapes
    : [];
  const finishes = fs.existsSync(FINISH_TAXONOMY_INPUT)
    ? readJson(FINISH_TAXONOMY_INPUT).finishes
    : [];
  const materials = fs.existsSync(MATERIAL_TAXONOMY_INPUT)
    ? readJson(MATERIAL_TAXONOMY_INPUT)
    : {};

  return {
    shape: buildTermMap(shapes, "canonicalShape", "canonicalShapeSlug") || empty,
    finish: buildTermMap(finishes, "canonicalFinish", "canonicalFinishSlug") || empty,
    bowlMaterial: buildTermMap(
      materials.bowlMaterials || [],
      "canonicalMaterial",
      "canonicalMaterialSlug"
    ) || empty,
    stemMaterial: buildTermMap(
      materials.stemMaterials || [],
      "canonicalMaterial",
      "canonicalMaterialSlug"
    ) || empty,
  };
}

function normalizeClassificationValue({ kind, value, slug, zhName }) {
  const name = nullableText(value);
  const taxonomy = kind ? termTaxonomy[kind] : null;
  const taxonomyRecord =
    (slug && taxonomy?.bySlug.get(text(slug))) ||
    (name && taxonomy?.byAlias.get(normalizeKey(name)));

  if (taxonomyRecord) {
    return {
      name: taxonomyRecord.name,
      slug: taxonomyRecord.slug,
      zhName: nullableText(zhName) || taxonomyRecord.zhName,
    };
  }

  return {
    name,
    slug: name ? nullableText(slug) || slugify(name) : null,
    zhName: name ? nullableText(zhName) : null,
  };
}

function applyClassificationExclusion(kind, normalized) {
  if (!normalized?.name) return normalized;

  const exclusion = productPublicationOverrides.classificationExclusions.find(
    (item) =>
      text(item.field) === kind &&
      normalizeKey(item.canonicalValue) === normalizeKey(normalized.name)
  );

  if (!exclusion) return normalized;

  return {
    name: null,
    slug: null,
    zhName: null,
  };
}

function normalizePublicFilter(value) {
  const normalized = nullableText(value);
  if (!normalized) return null;

  const exclusion = productPublicationOverrides.classificationExclusions.find(
    (item) =>
      text(item.field) === "filter" &&
      normalizeKey(item.canonicalValue) === normalizeKey(normalized)
  );

  return exclusion ? null : normalized;
}

function getPublicationOverride(product) {
  const direct = productPublicationOverrides.direct.get(
    `${text(product.source).toLowerCase()}::${text(product.sourceProductId)}`
  );
  if (direct) return direct;

  for (const rule of productPublicationOverrides.rules) {
    if (text(rule.source).toLowerCase() !== text(product.source).toLowerCase()) {
      continue;
    }

    if (
      rule.rawBrandEquals &&
      normalizeKey(rule.rawBrandEquals) !== normalizeKey(product.brand?.rawName)
    ) {
      continue;
    }

    if (
      rule.titleIncludes &&
      !text(product.rawTitle).toLowerCase().includes(text(rule.titleIncludes).toLowerCase())
    ) {
      continue;
    }

    return rule;
  }

  return null;
}

function applyPublicationOverride(product) {
  const override = getPublicationOverride(product);
  const classification = product.classification || {};

  const withEligibility = {
    ...product,
    classification: {
      ...classification,
      eligibility: {
        shape: Boolean(classification.shape),
        finish: Boolean(classification.finish),
        bowlMaterial: Boolean(classification.bowlMaterial),
        stemMaterial: Boolean(classification.stemMaterial),
        filter: Boolean(classification.filter),
      },
    },
  };

  if (!override) {
    const publicIndexEligible = Boolean(
      withEligibility.inventory?.publicIndexEligible ??
        withEligibility.inventory?.listingEligible
    );
    return {
      ...withEligibility,
      publication: {
        status: publicIndexEligible ? "eligible" : "excluded",
        listingEligible: publicIndexEligible,
        publicIndexEligible,
        publiclySellable: Boolean(
          withEligibility.inventory?.publiclySellable
        ),
        brandIndexEligible: Boolean(withEligibility.brand?.indexEligible),
        filterEligible: true,
        countsTowardAnomalyRate: false,
        reason: withEligibility.inventory?.reason || "",
      },
    };
  }

  const listingEligible =
    typeof override.listingEligible === "boolean"
      ? override.listingEligible
      : Boolean(withEligibility.inventory?.listingEligible);
  const publicIndexEligible = listingEligible;
  const publiclySellable =
    publicIndexEligible &&
    Boolean(withEligibility.inventory?.publiclySellable);
  const brandIndexEligible =
    typeof override.brandIndexEligible === "boolean"
      ? override.brandIndexEligible
      : Boolean(withEligibility.brand?.indexEligible);

  return {
    ...withEligibility,
    entityType: text(override.entityType) || withEligibility.entityType,
    brand: {
      ...withEligibility.brand,
      indexEligible: brandIndexEligible,
    },
    inventory: {
      ...withEligibility.inventory,
      listingEligible,
      publicIndexEligible,
      publiclySellable,
      reason: text(override.reason) || withEligibility.inventory?.reason || "",
    },
    publication: {
      status: listingEligible ? "eligible" : "excluded",
      listingEligible,
      publicIndexEligible,
      publiclySellable,
      brandIndexEligible,
      filterEligible:
        typeof override.filterEligible === "boolean"
          ? override.filterEligible
          : true,
      countsTowardAnomalyRate: override.countsTowardAnomalyRate === true,
      reason: text(override.reason),
    },
  };
}

function normalizeImages(mainValue, galleryValue) {
  const gallery = uniqueStrings(Array.isArray(galleryValue) ? galleryValue : []);
  const main = nullableText(mainValue) || gallery[0] || "";
  const withMain = uniqueStrings([main, ...gallery]);

  return {
    main,
    gallery: withMain,
  };
}

function getDanishSourceProductId(product) {
  const fromUrl = text(product.sourceUrl || product.originalUrl).match(/-i(\d+)\.html/i);
  return fromUrl ? fromUrl[1] : text(product.id);
}

function getDanishId(product) {
  const rawId = text(product.id);
  return rawId.startsWith("danish-") ? rawId : `danish-${rawId}`;
}

function mapDanishInventory(product) {
  const status = text(product.status);
  if (/已售|sold/i.test(status)) {
    return {
      status: "sold",
      confidence: "source-status",
      listingEligible: true,
      publicIndexEligible: true,
      publiclySellable: false,
      reason: "Danish sold-reference products are retained; frontend sold filter decides visibility.",
    };
  }

  if (/可购买|available|in stock/i.test(status)) {
    return {
      status: "available",
      confidence: "source-status",
      listingEligible: true,
      publicIndexEligible: true,
      publiclySellable: true,
      reason: "Danish source status indicates available.",
    };
  }

  return {
    status: "unknown",
    confidence: "unknown",
    listingEligible: false,
    publicIndexEligible: false,
    publiclySellable: false,
    reason: "Danish source status could not be mapped safely.",
  };
}

function mapSmokingpipesInventory(product) {
  const status = text(product.inventoryStatus).toLowerCase();
  const readiness = evaluateSmokingpipesPublicReadiness(product);
  const normalizedStatus = [
    "sold",
    "unavailable",
    "out-of-stock",
    "out_of_stock",
    "soldout",
    "sold-out",
  ].includes(status)
    ? "sold"
    : status;
  if (normalizedStatus === "available" || normalizedStatus === "sold") {
    return {
      status: normalizedStatus,
      confidence: text(product.inventoryConfidence) || "high",
      listingEligible: readiness.publicIndexEligible,
      publicIndexEligible: readiness.publicIndexEligible,
      publiclySellable: readiness.publiclySellable,
      reason: readiness.reason,
    };
  }

  if (status === "needs-review") {
    return {
      status: "needs-review",
      confidence: text(product.inventoryConfidence) || "conflicting-signals",
      listingEligible: false,
      publicIndexEligible: false,
      publiclySellable: false,
      reason:
        uniqueStrings(product.inventoryReviewReasons || []).join(" | ") ||
        "Smokingpipes active-list/detail conflict retained for manual review.",
    };
  }

  return {
    status: status || "unknown",
    confidence: text(product.inventoryConfidence) || "unknown",
    listingEligible: false,
    publicIndexEligible: false,
    publiclySellable: false,
    reason: "Smokingpipes inventory status is not safe for public listing.",
  };
}

function getDanishMeasurements(product) {
  const dimensions = product.dimensions || {};
  return {
    lengthMm: numberOrNull(dimensions.lengthMm),
    heightMm: numberOrNull(dimensions.heightMm),
    weightGrams: numberOrNull(product.weightGrams),
    chamberDepthMm: numberOrNull(dimensions.chamberDepthMm),
    chamberDiameterMm: numberOrNull(dimensions.chamberDiameterMm),
    outsideDiameterMm: numberOrNull(dimensions.bowlOuterDiameterMm),
  };
}

function getSmokingpipesMeasurements(product) {
  const measurements = product.measurements || {};
  return {
    lengthMm: numberOrNull(measurements.lengthMm),
    heightMm: numberOrNull(measurements.heightMm),
    weightGrams: numberOrNull(measurements.weightGrams),
    chamberDepthMm: numberOrNull(measurements.chamberDepthMm),
    chamberDiameterMm: numberOrNull(measurements.chamberDiameterMm),
    outsideDiameterMm: numberOrNull(measurements.outsideDiameterMm),
  };
}

function makeSearch({ brand, title, keywords }) {
  return {
    brand: text(brand),
    title: text(title),
    keywords: uniqueStrings(keywords),
  };
}

function mapDanishProduct(product) {
  const rawBrand = text(product.brand);
  const canonicalBrand = text(product.canonicalBrand) || rawBrand;
  const sourceProductId = getDanishSourceProductId(product);
  const sourceUrl = text(product.sourceUrl || product.originalUrl);
  const brand = makeBrand({
    source: "danish",
    sourceUrl,
    rawName: rawBrand,
    canonicalName: canonicalBrand,
    canonicalSlug: product.canonicalBrandSlug,
    country: product.brandCountryEn || product.brandCountry,
    reviewStatus: "confirmed",
    indexEligible: true,
  });
  const shape = normalizeClassificationValue({
    kind: "shape",
    value: product.shape,
    zhName: product.shapeZh,
  });
  const finish = applyClassificationExclusion("finish", normalizeClassificationValue({
    kind: "finish",
    value: product.finish,
    zhName: product.finishZh,
  }));
  const material = applyClassificationExclusion("bowlMaterial", normalizeClassificationValue({
    kind: "bowlMaterial",
    value: product.material,
    zhName: product.materialZh,
  }));
  const stemMaterial = applyClassificationExclusion("stemMaterial", normalizeClassificationValue({
    kind: "stemMaterial",
    value: product.stemMaterial,
    zhName: product.stemMaterialZh,
  }));
  const images = normalizeImages(
    product.detailImageUrl || product.imageUrl,
    product.galleryImages
  );
  const adapterWarnings = [];
  if (!images.main) adapterWarnings.push("image:missing");
  if (!shape.name) adapterWarnings.push("shape:null");
  if (!finish.name) adapterWarnings.push("finish:null");
  if (!material.name) adapterWarnings.push("bowlMaterial:null");

  return {
    id: getDanishId(product),
    source: "danish",
    sourceProductId,
    sourceUrl,
    entityType: "offer",
    displayName: text(product.nameZh || product.name),
    displayNameEn: text(product.name),
    displayNameZh: nullableText(product.nameZh),
    rawTitle: text(product.name),
    brand,
    classification: {
      shape: shape.name,
      shapeSlug: shape.slug,
      shapeZhName: shape.zhName,
      finish: finish.name,
      finishSlug: finish.slug,
      finishZhName: finish.zhName,
      bowlMaterial: material.name,
      bowlMaterialSlug: material.slug,
      bowlMaterialZhName: material.zhName,
      stemMaterial: stemMaterial.name,
      stemMaterialSlug: stemMaterial.slug,
      stemMaterialZhName: stemMaterial.zhName,
      filter: null,
      filterSizeMm: null,
    },
    condition: {
      raw: nullableText(product.conditionLabel || product.condition),
      canonical: nullableText(product.conditionType) || "unknown",
    },
    inventory: mapDanishInventory(product),
    price: {
      currency: nullableText(product.originalCurrency) || "USD",
      amount: numberOrNull(product.originalPriceValue),
      rawText: nullableText(product.originalPrice || product.price),
      msrpAmount: null,
      msrpRawText: null,
      siteDisplayAmount: numberOrNull(product.estimatedCnyValue),
      siteDisplayCurrency: numberOrNull(product.estimatedCnyValue) ? "CNY" : null,
      siteDisplayReady: Boolean(numberOrNull(product.estimatedCnyValue)),
    },
    images,
    measurements: getDanishMeasurements(product),
    model: {
      canonicalModelKey: null,
      confidence: null,
    },
    search: makeSearch({
      brand: brand.canonicalName,
      title: product.name,
      keywords: [
        product.nameZh,
        product.productCode,
        product.brandCountry,
        product.brandCountryEn,
        product.conditionLabel,
        product.shape,
        product.shapeZh,
        product.finish,
        product.finishZh,
        product.material,
        product.materialZh,
        product.stemMaterial,
        product.stemMaterialZh,
        ...(Array.isArray(product.tags) ? product.tags : []),
        ...(Array.isArray(product.parsedTags) ? product.parsedTags : []),
      ],
    }),
    integration: {
      legacyPipeCompatible: true,
      legacyMissingFields: [],
      adapterWarnings,
    },
  };
}

function mapSmokingpipesProduct(product) {
  const rawBrand = text(product.rawBrand || product.brand);
  const canonicalBrand = text(product.canonicalBrand || product.brand || rawBrand);
  const brandIndexEligible =
    product.brandReviewStatus === "needs-review"
      ? false
      : product.brandIndexEligible === true;
  const sourceUrl = text(product.sourceUrl);
  const brand = makeBrand({
    source: "smokingpipes",
    sourceUrl,
    rawName: rawBrand,
    canonicalName: canonicalBrand,
    canonicalSlug: product.canonicalBrandSlug,
    zhName: product.canonicalBrandZh,
    country: product.canonicalBrandCountry,
    reviewStatus: text(product.brandReviewStatus) || "needs-review",
    indexEligible: brandIndexEligible,
  });
  const shape = normalizeClassificationValue({
    kind: "shape",
    value: product.canonicalShape || product.shape,
    slug: product.canonicalShapeSlug,
    zhName: product.canonicalShapeZh || product.shapeZhName,
  });
  const finish = applyClassificationExclusion("finish", normalizeClassificationValue({
    kind: "finish",
    value: product.canonicalFinish || product.finish,
    slug: product.canonicalFinishSlug,
    zhName: product.canonicalFinishZh,
  }));
  const material = applyClassificationExclusion("bowlMaterial", normalizeClassificationValue({
    kind: "bowlMaterial",
    value: product.canonicalMaterial || product.material,
    slug: product.canonicalMaterialSlug,
    zhName: product.canonicalMaterialZh,
  }));
  const stemMaterial = applyClassificationExclusion("stemMaterial", normalizeClassificationValue({
    kind: "stemMaterial",
    value: product.canonicalStemMaterial || product.stemMaterial,
    slug: product.canonicalStemMaterialSlug,
    zhName: product.canonicalStemMaterialZh,
  }));
  const price = product.price || {};
  const currentPrice = price.current || {};
  const msrp = price.msrp || {};
  const images = normalizeImages(
    product.mainImageUrl || product.detailImageUrl || product.imageUrl,
    product.galleryImages
  );
  const adapterWarnings = [];
  if (!images.main) adapterWarnings.push("image:missing");
  if (!brand.indexEligible) adapterWarnings.push("brand:not-index-eligible");
  if (product.inventoryStatus === "needs-review") {
    adapterWarnings.push("inventory:needs-review");
  }
  if (!shape.name && text(product.rawShape).toLowerCase() !== "n/a") {
    adapterWarnings.push("shape:null");
  }

  return {
    id: text(product.id),
    source: "smokingpipes",
    sourceProductId: text(product.sourceProductId),
    sourceUrl,
    entityType: "offer",
    displayName: text(product.displayNameZh || product.displayNameEn || product.fullTitle),
    displayNameEn: text(product.displayNameEn || product.fullTitle || product.rawTitle),
    displayNameZh: nullableText(product.displayNameZh),
    rawTitle: text(product.rawTitle || product.fullTitle),
    brand,
    classification: {
      shape: shape.name,
      shapeSlug: shape.slug,
      shapeZhName: shape.zhName,
      finish: finish.name,
      finishSlug: finish.slug,
      finishZhName: finish.zhName,
      bowlMaterial: material.name,
      bowlMaterialSlug: material.slug,
      bowlMaterialZhName: material.zhName,
      stemMaterial: stemMaterial.name,
      stemMaterialSlug: stemMaterial.slug,
      stemMaterialZhName: stemMaterial.zhName,
      filter: normalizePublicFilter(product.canonicalFilter),
      filterSizeMm: normalizePublicFilter(product.canonicalFilter)
        ? numberOrNull(product.filterSizeMm)
        : null,
    },
    condition: {
      raw: nullableText(product.conditionType),
      canonical: nullableText(product.conditionType) || "unknown",
    },
    inventory: mapSmokingpipesInventory(product),
    price: {
      currency: nullableText(currentPrice.currency) || "USD",
      amount: numberOrNull(currentPrice.amount),
      rawText: nullableText(currentPrice.rawText),
      msrpAmount: numberOrNull(msrp.amount),
      msrpRawText: nullableText(msrp.rawText),
      siteDisplayAmount: null,
      siteDisplayCurrency: null,
      siteDisplayReady: false,
    },
    images,
    measurements: getSmokingpipesMeasurements(product),
    model: {
      canonicalModelKey: nullableText(product.canonicalModelKey),
      confidence: nullableText(product.canonicalModelKeyConfidence),
    },
    search: makeSearch({
      brand: brand.canonicalName,
      title: product.fullTitle || product.displayNameEn || product.rawTitle,
      keywords: [
        product.productCode,
        product.rawShape,
        product.rawFinish,
        product.rawMaterial,
        product.rawStemMaterial,
        product.rawFilter,
        product.rawCountry,
        product.canonicalShapeZh,
        product.canonicalFinishZh,
        product.canonicalMaterialZh,
        product.canonicalStemMaterialZh,
      ],
    }),
    integration: {
      legacyPipeCompatible: false,
      legacyMissingFields: [
        "estimatedCny",
        "estimatedCnyValue",
        "status",
        "updatedAt",
        "audience",
        "comment",
        "detail",
      ],
      adapterWarnings,
    },
  };
}

function sortUnifiedProducts(products) {
  const sourceRank = { danish: 0, smokingpipes: 1 };
  return [...products].sort((a, b) => {
    const rankDiff = (sourceRank[a.source] ?? 99) - (sourceRank[b.source] ?? 99);
    if (rankDiff) return rankDiff;

    const numericA = Number(a.sourceProductId);
    const numericB = Number(b.sourceProductId);
    if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) {
      return numericA - numericB;
    }

    return `${a.sourceProductId} ${a.id}`.localeCompare(
      `${b.sourceProductId} ${b.id}`,
      "en"
    );
  });
}

function assertNoDuplicateIds(products) {
  const seen = new Set();
  for (const product of products) {
    if (seen.has(product.id)) {
      throw new Error(`Duplicate unified id: ${product.id}`);
    }
    seen.add(product.id);
  }
}

export function buildUnifiedProductsFromInputs({
  danishProducts,
  smokingpipesProducts,
}) {
  const unifiedProducts = sortUnifiedProducts([
    ...(danishProducts || []).map(mapDanishProduct),
    ...(smokingpipesProducts || []).map(mapSmokingpipesProduct),
  ]).map(applyPublicationOverride);
  assertNoDuplicateIds(unifiedProducts);
  return unifiedProducts;
}

function main() {
  const danishProducts = readJson(DANISH_INPUT);
  const smokingpipesProducts = readJson(SMOKINGPIPES_INPUT);
  const unifiedProducts = buildUnifiedProductsFromInputs({
    danishProducts,
    smokingpipesProducts,
  });

  const hash = atomicWriteJson(OUTPUT, unifiedProducts);
  const counts = unifiedProducts.reduce((acc, product) => {
    acc[product.source] = (acc[product.source] || 0) + 1;
    return acc;
  }, {});

  console.log(`Unified staging written: ${OUTPUT}`);
  console.log(
    JSON.stringify(
      {
        count: unifiedProducts.length,
        sources: counts,
        sha256: hash,
      },
      null,
      2
    )
  );
}

const directExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() ===
    decodeURIComponent(new URL(import.meta.url).pathname)
      .replace(/^\/([A-Za-z]:)/, "$1")
      .replace(/\\/g, "/")
      .toLowerCase();

if (directExecution) main();
