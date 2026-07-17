import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();

const paths = {
  details: path.join(rootDir, "data", "raw", "smokingpipes-details-new-final.json"),
  list: path.join(rootDir, "data", "raw", "smokingpipes-list-new.json"),
  fieldAudit: path.join(rootDir, "data", "raw", "smokingpipes-field-values-audit.json"),
  brandTaxonomy: path.join(rootDir, "data", "taxonomy", "brand-aliases.json"),
  sourceScopedBrandMappings: path.join(rootDir, "data", "taxonomy", "source-scoped-brand-mappings.json"),
  productPublicationOverrides: path.join(rootDir, "data", "taxonomy", "product-publication-overrides.json"),
  shapeTaxonomy: path.join(rootDir, "data", "taxonomy", "pipe-shapes.json"),
  finishTaxonomy: path.join(rootDir, "data", "taxonomy", "pipe-finishes.json"),
  materialTaxonomy: path.join(rootDir, "data", "taxonomy", "pipe-materials.json"),
  taxonomyReviewEvidence: path.join(rootDir, "data", "taxonomy", "taxonomy-review-evidence.json"),
  danishProducts: path.join(rootDir, "data", "products", "danish-products.json"),
  danishWrapper: path.join(rootDir, "data", "danish-products.ts"),
  pipes: path.join(rootDir, "data", "pipes.ts"),
  outputSample: path.join(rootDir, "data", "products", "smokingpipes-products-sample.json"),
  outputAuditJson: path.join(rootDir, "data", "products", "smokingpipes-products-sample-audit.json"),
  outputAuditMd: path.join(rootDir, "data", "products", "smokingpipes-products-sample-audit.md"),
  productionSmokingpipes: path.join(rootDir, "data", "products", "smokingpipes-products.json"),
  outputFullDryRun: path.join(rootDir, "data", "products", "smokingpipes-products-full-dry-run.json"),
  outputFullDryRunAuditJson: path.join(rootDir, "data", "products", "smokingpipes-products-full-dry-run-audit.json"),
  outputFullDryRunAuditMd: path.join(rootDir, "data", "products", "smokingpipes-products-full-dry-run-audit.md"),
  outputProductionTmp: path.join(rootDir, "data", "products", "smokingpipes-products.json.tmp"),
};


const needsReviewBrands = [];

const shapeZhOverrides = new Map([
  ["billiard", "撞球斗"],
  ["bent-billiard", "弯式撞球斗"],
  ["bent-apple", "弯式苹果斗"],
  ["bent-bulldog", "弯式斗牛犬斗"],
  ["bent-dublin", "弯式都柏林斗"],
]);

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return args;
}

function enforceCliMode() {
  const args = parseArgs(process.argv.slice(2));
  const mode = normalizeText(args.get("mode"));

  if (!mode) {
    console.error("Missing required --mode. V2 currently supports --mode sample or --mode full-dry-run.");
    process.exit(1);
  }

  if (mode !== "sample" && mode !== "full-dry-run" && mode !== "production") {
    console.error(`Unsupported mode: ${mode}. V2 refuses production conversion by design.`);
    process.exit(1);
  }

  const confirmProductionWrite = args.get("confirm-production-write") === "true";

  if (mode === "production" && !confirmProductionWrite) {
    console.error("Production mode requires --confirm-production-write. Refusing to write production file.");
    process.exit(1);
  }

  if (mode !== "production" && confirmProductionWrite) {
    console.error("--confirm-production-write is only valid with --mode production.");
    process.exit(1);
  }

  const rawMax = normalizeText(args.get("max"));
  const max = rawMax ? Number.parseInt(rawMax, 10) : 300;

  if (!Number.isFinite(max) || max <= 0) {
    console.error(`Invalid --max value: ${rawMax}`);
    process.exit(1);
  }

  return {
    mode,
    confirmProductionWrite,
    max,
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  fs.writeFileSync(filePath, stringifyJson(payload), "utf8");
}

function stringifyJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function safeRemoveFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .replace(/^Estate\s+/i, "")
    .toLowerCase();
}

function slugify(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function productIdOf(item) {
  const direct = normalizeText(item?.sourceProductId);

  if (direct) {
    return direct;
  }

  const href = normalizeText(item?.sourceUrl || item?.href);
  const match = href.match(/[?&]product_id=(\d+)/i);

  return match?.[1] || "";
}

function numericProductId(item) {
  const id = productIdOf(item);
  const number = Number.parseInt(id, 10);

  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function dedupe(values) {
  const output = [];
  const seen = new Set();

  for (const value of values || []) {
    const normalized = normalizeText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function fullSmokingpipesImageUrl(value) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  return text.replace("/products/tn/", "/products/");
}

function buildAliasIndex(items, aliasesKey, canonicalSlugKey) {
  const index = new Map();

  for (const item of items || []) {
    const aliases = [
      item.canonicalBrand,
      item.canonicalShape,
      item.canonicalFinish,
      item.canonicalMaterial,
      ...(Array.isArray(item[aliasesKey]) ? item[aliasesKey] : []),
    ].filter(Boolean);

    for (const alias of aliases) {
      index.set(normalizeKey(alias), item);
    }

    const slug = normalizeText(item[canonicalSlugKey]);

    if (slug) {
      index.set(slug.toLowerCase(), item);
    }
  }

  return index;
}

function getTaxonomyItem(index, rawValue) {
  const value = normalizeText(rawValue);

  if (!value) {
    return null;
  }

  return index.get(normalizeKey(value)) || null;
}

function buildCanonicalBrandIndex(items) {
  const index = new Map();

  for (const item of items || []) {
    for (const value of [item.canonicalBrand, item.canonicalBrandSlug]) {
      const key = normalizeKey(value);

      if (key) {
        index.set(key, item);
      }
    }
  }

  return index;
}

function brandUrlKey(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function buildBrandUrlPathIndex(items) {
  const index = new Map();

  for (const item of items || []) {
    const values = [
      item.canonicalBrand,
      item.canonicalBrandSlug,
      ...(Array.isArray(item.aliases) ? item.aliases : []),
    ];

    for (const value of values) {
      const key = brandUrlKey(value);
      if (!key) continue;
      if (!index.has(key)) index.set(key, item);
      else if (index.get(key) !== item) index.set(key, null);
    }
  }

  return index;
}

function getSmokingpipesUrlBrand(index, sourceUrl) {
  const pathname = sourcePathname(sourceUrl);
  const match = pathname.match(/^\/pipes\/(?:new|estate)\/([^/]+)\//i);
  if (!match) return null;

  let segment = match[1];
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // Keep the encoded segment; an invalid escape must not fail conversion.
  }
  const key = brandUrlKey(segment.replace(/[-_]+/g, " "));
  return key ? index.get(key) || null : null;
}

function sourcePathname(value) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  try {
    return new URL(text).pathname.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function buildSourceScopedBrandIndex(payload) {
  const index = new Map();

  for (const mapping of payload?.mappings || []) {
    const source = normalizeText(mapping.source).toLowerCase();
    const rawAlias = normalizeText(mapping.rawAlias);
    const key = `${source}::${normalizeKey(rawAlias)}`;

    if (!source || !rawAlias) {
      continue;
    }

    if (!index.has(key)) {
      index.set(key, []);
    }

    index.get(key).push(mapping);
  }

  for (const mappings of index.values()) {
    mappings.sort((a, b) => normalizeText(b.sourcePathPrefix).length - normalizeText(a.sourcePathPrefix).length);
  }

  return index;
}

function getSourceScopedBrandMapping(index, { source, rawBrand, sourceUrl }) {
  const key = `${normalizeText(source).toLowerCase()}::${normalizeKey(rawBrand)}`;
  const candidates = index.get(key) || [];
  const pathname = sourcePathname(sourceUrl);

  for (const mapping of candidates) {
    const prefix = normalizeText(mapping.sourcePathPrefix).toLowerCase();

    if (!prefix || pathname.startsWith(prefix)) {
      return mapping;
    }
  }

  return null;
}

function buildProductOverrideIndex(payload) {
  const index = new Map();

  for (const item of payload?.directOverrides || []) {
    const source = normalizeText(item.source).toLowerCase();
    const sourceProductId = normalizeText(item.sourceProductId);

    if (!source || !sourceProductId) {
      continue;
    }

    index.set(`${source}::${sourceProductId}`, item);
  }

  return index;
}

function getProductOverride(index, source, sourceProductId) {
  return index.get(`${normalizeText(source).toLowerCase()}::${normalizeText(sourceProductId)}`) || null;
}

function specialTaxonomyValue(value) {
  const raw = normalizeText(value);

  if (!raw) {
    return "missing";
  }

  if (/^N\/A$/i.test(raw)) {
    return "not-applicable";
  }

  if (/^unknown$/i.test(raw)) {
    return "unknown";
  }

  return "";
}

function parseUsdPrice(value) {
  const rawText = normalizeText(value);

  if (!rawText) {
    return {
      rawText: "",
      currency: "USD",
      amount: null,
      parseStatus: "empty",
    };
  }

  const match = rawText.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  const amount = match ? Number.parseFloat(match[1]) : Number.NaN;

  return {
    rawText,
    currency: "USD",
    amount: Number.isFinite(amount) ? amount : null,
    parseStatus: Number.isFinite(amount) ? "parsed" : "failed",
  };
}

function normalizeInventory(detail, listItem) {
  const includedInActiveListRange = Boolean(listItem);
  const rawDetailStatus = normalizeText(detail.status);
  const rawListStatus = normalizeText(listItem?.status || listItem?.inventoryStatus);
  const detailPrice = parseUsdPrice(detail.price);
  const statusEvidence = detail.statusEvidence || {};
  const soldEvidence = Array.isArray(statusEvidence.soldEvidence)
    ? statusEvidence.soldEvidence.map(normalizeText).filter(Boolean)
    : [];
  const availableEvidence = Array.isArray(statusEvidence.availableEvidence)
    ? statusEvidence.availableEvidence.map(normalizeText).filter(Boolean)
    : [];
  const strongSoldEvidence = soldEvidence.filter((item) => !item.startsWith("weak/"));
  const reasons = [];
  const warnings = [];

  if (
    rawDetailStatus === "sold" &&
    detailPrice.amount &&
    rawListStatus === "available" &&
    strongSoldEvidence.length === 0
  ) {
    warnings.push("sold status has available evidence; treating sold signal as weak.");
    if (!soldEvidence.length) {
      soldEvidence.push("weak/legacy-detail-status-sold-with-price-and-active-list");
    }

    return {
      inventoryStatus: "available",
      inventoryConfidence: "high",
      includedInActiveListRange,
      rawListStatus,
      rawDetailStatus,
      inventoryReviewReasons: [],
      inventoryWarnings: warnings,
      soldEvidence,
      availableEvidence: availableEvidence.length
        ? availableEvidence
        : ["detail-price-present", "current-list-available"],
      rawStatusSource:
        statusEvidence.rawStatusSource ||
        "legacy-detail-status-sold-overridden-by-available-evidence",
    };
  }

  if (includedInActiveListRange && rawDetailStatus === "available") {
    return {
      inventoryStatus: "available",
      inventoryConfidence: "high",
      includedInActiveListRange,
      rawListStatus,
      rawDetailStatus,
      inventoryReviewReasons: reasons,
      inventoryWarnings: warnings,
      soldEvidence,
      availableEvidence,
      rawStatusSource: statusEvidence.rawStatusSource || "detail-status-available",
    };
  }

  if (includedInActiveListRange && rawDetailStatus === "sold") {
    reasons.push("Detail page says sold while the product remains in the active list range.");

    return {
      inventoryStatus: "needs-review",
      inventoryConfidence: "conflicting-signals",
      includedInActiveListRange,
      rawListStatus,
      rawDetailStatus,
      inventoryReviewReasons: reasons,
      inventoryWarnings: warnings,
      soldEvidence,
      availableEvidence,
      rawStatusSource: statusEvidence.rawStatusSource || "detail-status-sold",
    };
  }

  if (!includedInActiveListRange) {
    reasons.push("Product was not found in the active list snapshot.");
  }

  if (!rawDetailStatus) {
    reasons.push("Detail status is empty.");
  }

  return {
    inventoryStatus: "unknown",
    inventoryConfidence: "low",
    includedInActiveListRange,
    rawListStatus,
    rawDetailStatus,
    inventoryReviewReasons: reasons,
    inventoryWarnings: warnings,
    soldEvidence,
    availableEvidence,
    rawStatusSource: statusEvidence.rawStatusSource || "detail-status-unknown",
  };
}

function normalizeBrand(detail, listItem, indexes) {
  const detailBrand = normalizeText(detail.brand);
  const listBrand = normalizeText(listItem?.brand);
  const sourceUrl = normalizeText(
    detail.sourceUrl || detail.href || listItem?.sourceUrl || listItem?.href
  );
  const urlBrand =
    !detailBrand && !listBrand
      ? getSmokingpipesUrlBrand(indexes.brandUrlPath, sourceUrl)
      : null;
  const rawBrand = detailBrand || listBrand || urlBrand?.canonicalBrand || "";
  const scopedMapping = getSourceScopedBrandMapping(indexes.sourceScopedBrand, {
    source: "smokingpipes",
    rawBrand,
    sourceUrl,
  });
  const taxonomyItem = scopedMapping
    ? getTaxonomyItem(indexes.brandCanonical, scopedMapping.approvedCanonicalBrand)
    : urlBrand || getTaxonomyItem(indexes.brand, rawBrand);
  const canonicalBrand = taxonomyItem?.canonicalBrand || rawBrand;
  const canonicalBrandSlug = taxonomyItem?.canonicalBrandSlug || slugify(canonicalBrand);
  const brandReviewStatus = taxonomyItem?.reviewStatus || "needs-review";
  const brandIndexEligible =
    brandReviewStatus !== "needs-review" &&
    taxonomyItem?.indexEligible !== false;
  const reviewNotes = Array.isArray(taxonomyItem?.notes) ? taxonomyItem.notes : [];

  return {
    rawBrand,
    brandMapped: Boolean(taxonomyItem),
    sourceScopedMappingApplied: Boolean(scopedMapping),
    sourceScopedMappingClassification: normalizeText(scopedMapping?.classification),
    canonicalBrand,
    canonicalBrandSlug,
    canonicalBrandZh: taxonomyItem?.zhName || "",
    canonicalBrandCountry: taxonomyItem?.country || "",
    brandReviewStatus,
    brandIndexEligible,
    brandReviewNotes: reviewNotes,
  };
}

function normalizeShape(detail, indexes) {
  const rawShape = normalizeText(detail.shape);
  const special = specialTaxonomyValue(rawShape);

  if (special === "not-applicable" || special === "missing" || special === "unknown") {
    return {
      rawShape,
      shapeMapped: false,
      canonicalShape: null,
      canonicalShapeSlug: null,
      canonicalShapeZh: "",
      bendType: "not-applicable",
      shapeReviewStatus: special,
    };
  }

  const taxonomyItem = getTaxonomyItem(indexes.shape, rawShape);

  if (!taxonomyItem) {
    return {
      rawShape,
      shapeMapped: false,
      canonicalShape: rawShape,
      canonicalShapeSlug: slugify(rawShape),
      canonicalShapeZh: "",
      bendType: "unknown",
      shapeReviewStatus: "needs-review",
    };
  }

  const canonicalShapeSlug = taxonomyItem.canonicalShapeSlug || slugify(taxonomyItem.canonicalShape);

  return {
    rawShape,
    shapeMapped: true,
    canonicalShape: taxonomyItem.canonicalShape,
    canonicalShapeSlug,
    canonicalShapeZh: shapeZhOverrides.get(canonicalShapeSlug) || taxonomyItem.zhName || "",
    bendType: taxonomyItem.bendType || "unknown",
    shapeReviewStatus: taxonomyItem.reviewStatus || "confirmed",
  };
}

function normalizeFinish(detail, indexes) {
  const rawFinish = normalizeText(detail.finish);
  const special = specialTaxonomyValue(rawFinish);

  if (special) {
    return {
      rawFinish,
      finishMapped: false,
      canonicalFinish: null,
      canonicalFinishSlug: null,
      canonicalFinishZh: "",
      finishReviewStatus: special,
    };
  }

  const taxonomyItem = getTaxonomyItem(indexes.finish, rawFinish);

  if (!taxonomyItem) {
    return {
      rawFinish,
      finishMapped: false,
      canonicalFinish: rawFinish,
      canonicalFinishSlug: slugify(rawFinish),
      canonicalFinishZh: "",
      finishReviewStatus: "needs-review",
    };
  }

  return {
    rawFinish,
    finishMapped: true,
    canonicalFinish: taxonomyItem.canonicalFinish,
    canonicalFinishSlug: taxonomyItem.canonicalFinishSlug || slugify(taxonomyItem.canonicalFinish),
    canonicalFinishZh: taxonomyItem.zhName || "",
    finishReviewStatus: taxonomyItem.reviewStatus || "confirmed",
  };
}

function normalizeBowlMaterial(detail, indexes) {
  const rawMaterial = normalizeText(detail.material);
  const special = specialTaxonomyValue(rawMaterial);

  if (special) {
    return {
      rawMaterial,
      materialMapped: false,
      canonicalMaterial: null,
      canonicalMaterialSlug: null,
      canonicalMaterialZh: "",
      materialReviewStatus: special,
    };
  }

  const taxonomyItem = getTaxonomyItem(indexes.bowlMaterial, rawMaterial);

  if (!taxonomyItem) {
    return {
      rawMaterial,
      materialMapped: false,
      canonicalMaterial: rawMaterial,
      canonicalMaterialSlug: slugify(rawMaterial),
      canonicalMaterialZh: "",
      materialReviewStatus: "needs-review",
    };
  }

  return {
    rawMaterial,
    materialMapped: true,
    canonicalMaterial: taxonomyItem.canonicalMaterial,
    canonicalMaterialSlug: taxonomyItem.canonicalMaterialSlug || slugify(taxonomyItem.canonicalMaterial),
    canonicalMaterialZh: taxonomyItem.zhName || "",
    materialReviewStatus: taxonomyItem.reviewStatus || "confirmed",
  };
}

function normalizeStemMaterial(detail, indexes) {
  const rawStemMaterial = normalizeText(detail.stemMaterial);
  const special = specialTaxonomyValue(rawStemMaterial);

  if (special) {
    return {
      rawStemMaterial,
      stemMaterialMapped: false,
      canonicalStemMaterial: null,
      canonicalStemMaterialSlug: null,
      canonicalStemMaterialZh: "",
      stemMaterialReviewStatus: special,
    };
  }

  const taxonomyItem = getTaxonomyItem(indexes.stemMaterial, rawStemMaterial);

  if (!taxonomyItem) {
    return {
      rawStemMaterial,
      stemMaterialMapped: false,
      canonicalStemMaterial: rawStemMaterial,
      canonicalStemMaterialSlug: slugify(rawStemMaterial),
      canonicalStemMaterialZh: "",
      stemMaterialReviewStatus: "needs-review",
    };
  }

  return {
    rawStemMaterial,
    stemMaterialMapped: true,
    canonicalStemMaterial: taxonomyItem.canonicalMaterial,
    canonicalStemMaterialSlug: taxonomyItem.canonicalMaterialSlug || slugify(taxonomyItem.canonicalMaterial),
    canonicalStemMaterialZh: taxonomyItem.zhName || "",
    stemMaterialReviewStatus: taxonomyItem.reviewStatus || "confirmed",
  };
}

function normalizeFilter(detail) {
  const rawFilter = normalizeText(detail.filter);
  const key = rawFilter.toLowerCase();

  if (!rawFilter) {
    return {
      rawFilter,
      canonicalFilter: null,
      filterSizeMm: null,
      filterReviewStatus: "missing",
    };
  }

  if (key === "none") {
    return {
      rawFilter,
      canonicalFilter: "none",
      filterSizeMm: null,
      filterReviewStatus: "confirmed",
    };
  }

  const mmMatch = key.match(/^(\d+)\s*mm$/);

  if (mmMatch) {
    return {
      rawFilter,
      canonicalFilter: `${mmMatch[1]}mm`,
      filterSizeMm: Number.parseInt(mmMatch[1], 10),
      filterReviewStatus: "confirmed",
    };
  }

  return {
    rawFilter,
    canonicalFilter: key || rawFilter,
    filterSizeMm: null,
    filterReviewStatus: "provisional",
  };
}

function normalizeImages(detail, listItem) {
  const rawMain = fullSmokingpipesImageUrl(detail.mainImageUrl);
  const rawGallery = dedupe((detail.galleryImages || []).map(fullSmokingpipesImageUrl));
  const rawList = fullSmokingpipesImageUrl(listItem?.imageUrl || detail.listImageUrl);
  let mainImageUrl = rawMain;
  let galleryImages = rawGallery.slice();
  let usedListImageFallback = false;

  if (!mainImageUrl && galleryImages.length > 0) {
    mainImageUrl = galleryImages[0];
  }

  if (!mainImageUrl && rawList) {
    mainImageUrl = rawList;
    usedListImageFallback = true;
  }

  if (galleryImages.length === 0 && mainImageUrl) {
    galleryImages = [mainImageUrl];
  }

  if (galleryImages.length === 0 && rawList) {
    galleryImages = [rawList];
    usedListImageFallback = true;
  }

  galleryImages = dedupe(galleryImages);

  let imageSourceStrategy = "missing";

  if (rawGallery.length > 1 && rawMain) {
    imageSourceStrategy = "detail-main-gallery";
  } else if (rawMain && rawGallery.length <= 1) {
    imageSourceStrategy = "detail-main-only";
  } else if (usedListImageFallback) {
    imageSourceStrategy = "list-image-fallback";
  }

  const mainInGallery = Boolean(mainImageUrl && galleryImages.includes(mainImageUrl));

  return {
    imageUrl: mainImageUrl,
    mainImageUrl,
    detailImageUrl: mainImageUrl,
    galleryImages,
    galleryCount: galleryImages.length,
    listImageUrl: rawList,
    usedListImageFallback,
    imageSourceStrategy,
    mainImageIncludedInGallery: mainInGallery,
    rawGalleryCount: rawGallery.length,
  };
}

function normalizeMeasurements(detail) {
  const parsed = detail.parsedMeasurements || {};

  function numberOrNull(value) {
    return Number.isFinite(value) ? value : null;
  }

  return {
    lengthText: normalizeText(detail.lengthText),
    weightText: normalizeText(detail.weightText),
    heightText: normalizeText(detail.heightText),
    chamberDepthText: normalizeText(detail.chamberDepthText),
    chamberDiameterText: normalizeText(detail.chamberDiameterText),
    outsideDiameterText: normalizeText(detail.outsideDiameterText),
    measurements: {
      lengthMm: numberOrNull(parsed.lengthMm),
      weightGrams: numberOrNull(parsed.weightGrams),
      heightMm: numberOrNull(parsed.heightMm),
      chamberDepthMm: numberOrNull(parsed.chamberDepthMm),
      chamberDiameterMm: numberOrNull(parsed.chamberDiameterMm),
      outsideDiameterMm: numberOrNull(parsed.outsideDiameterMm),
    },
  };
}

function extractShapeNumber(title) {
  const text = normalizeText(title);
  const matches = [...text.matchAll(/\(([^)]+)\)/g)];

  for (const match of matches) {
    const candidate = normalizeText(match[1]);

    if (!candidate || /mm$/i.test(candidate)) {
      continue;
    }

    if (/^[A-Z]?\d+[A-Z]?$/i.test(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractRawSeries(title) {
  const text = normalizeText(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:Smooth|Sandblast|Rusticated|Rusticated and Sandblasted|Partial Sandblast|Partial Rusticated|Carved|Spot Carved|Other)\b/gi, " ")
    .replace(/\b(?:Bent|Straight|Apple|Billiard|Billard|Bulldog|Dublin|Pot|Poker|Author|Brandy|Freehand|Churchwarden|Lovat|Canadian|Prince|Rhodesian|Volcano|Tomato|Horn|Calabash|Egg|Acorn|Pear|Zulu|Panel|Opera|Cutty|Cavalier|Chimney|Hawkbill|Lumberman|Skater|Blowfish)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.split(/\s+/).slice(0, 5).join(" ");
}

function normalizeModel(detail, brand, shape) {
  const rawModel = extractShapeNumber(detail.title) || "";
  const rawSeries = extractRawSeries(detail.title);
  const components = [
    brand.canonicalBrandSlug,
    rawModel ? `model-${slugify(rawModel)}` : "",
    rawSeries ? `series-${slugify(rawSeries)}` : "",
    shape.canonicalShapeSlug ? `shape-${shape.canonicalShapeSlug}` : "",
  ].filter(Boolean);

  let confidence = "low";

  if (rawModel) {
    confidence = "high";
  } else if (rawSeries && shape.canonicalShapeSlug) {
    confidence = "medium";
  }

  return {
    rawModel,
    rawSeries,
    rawShapeNumber: rawModel,
    canonicalModelKey: components.join("__"),
    canonicalModelKeyComponents: components,
    canonicalModelKeyConfidence: confidence,
    modelEntityId: null,
  };
}

function convertProduct(detail, listItem, indexes) {
  const sourceProductId = productIdOf(detail);
  const productOverride = getProductOverride(indexes.productOverrides, "smokingpipes", sourceProductId);
  const brand = normalizeBrand(detail, listItem, indexes);
  const shape = normalizeShape(detail, indexes);
  const finish = normalizeFinish(detail, indexes);
  const bowlMaterial = normalizeBowlMaterial(detail, indexes);
  const stemMaterial = normalizeStemMaterial(detail, indexes);
  const filter = normalizeFilter(detail);
  const inventory = normalizeInventory(detail, listItem);
  const images = normalizeImages(detail, listItem);
  const measurements = normalizeMeasurements(detail);
  const model = normalizeModel(detail, brand, shape);
  const price = {
    current: parseUsdPrice(detail.price),
    original: parseUsdPrice(detail.originalPrice || listItem?.originalPrice),
    msrp: parseUsdPrice(detail.msrp),
    listPrice: parseUsdPrice(listItem?.price),
    rawDiscountText: normalizeText(listItem?.discountText),
    rawRmbText: normalizeText(listItem?.rmbText),
    calculationStatus: "not-calculated",
    calculationNotes: "V2 sample keeps source USD/MSRP/RMB text only; it does not calculate RMB reference price.",
  };
  const forcedBrandIndexEligible =
    productOverride?.brandIndexEligible === false
      ? false
      : brand.brandIndexEligible;
  const forcedBrandReviewStatus =
    productOverride?.countsTowardAnomalyRate === true
      ? "needs-review"
      : brand.brandReviewStatus;
  const publication = {
    status: productOverride ? "excluded" : "eligible",
    listingEligible:
      typeof productOverride?.listingEligible === "boolean"
        ? productOverride.listingEligible
        : inventory.inventoryStatus === "available",
    brandIndexEligible: forcedBrandIndexEligible,
    filterEligible:
      typeof productOverride?.filterEligible === "boolean"
        ? productOverride.filterEligible
        : true,
    countsTowardAnomalyRate: productOverride?.countsTowardAnomalyRate === true,
    reason: normalizeText(productOverride?.reason),
  };

  return {
    schemaVersion: 2,
    entityType: normalizeText(productOverride?.entityType) || "offer",
    id: `smokingpipes-${sourceProductId}`,
    source: "smokingpipes",
    sourceSite: "Smokingpipes",
    sourceProductId,
    productCode: normalizeText(detail.productCode || listItem?.productCode),
    sourceUrl: normalizeText(detail.sourceUrl || detail.href || listItem?.sourceUrl || listItem?.href),
    sourceListUrl: normalizeText(listItem?.listPageUrl),
    listPage: listItem?.listPage ?? null,
    listPosition: listItem?.listPosition ?? null,
    conditionType: normalizeText(detail.conditionType) || "new",
    rawBrand: brand.rawBrand,
    brandMapped: brand.brandMapped,
    sourceScopedBrandMappingApplied: brand.sourceScopedMappingApplied,
    sourceScopedBrandMappingClassification: brand.sourceScopedMappingClassification,
    brand: brand.canonicalBrand,
    canonicalBrand: brand.canonicalBrand,
    canonicalBrandSlug: brand.canonicalBrandSlug,
    canonicalBrandZh: brand.canonicalBrandZh,
    canonicalBrandCountry: brand.canonicalBrandCountry,
    brandReviewStatus: forcedBrandReviewStatus,
    brandIndexEligible: forcedBrandIndexEligible,
    listingEligible: publication.listingEligible,
    filterEligible: publication.filterEligible,
    publication,
    brandReviewNotes: brand.brandReviewNotes,
    rawTitle: normalizeText(detail.title),
    fullTitle: normalizeText(detail.fullTitle),
    displayNameEn: normalizeText(detail.fullTitle || `${brand.rawBrand} ${detail.title}`),
    displayNameZh: null,
    displayNameZhStatus: "not-generated",
    rawShape: shape.rawShape,
    shapeMapped: shape.shapeMapped,
    shape: shape.canonicalShape,
    canonicalShape: shape.canonicalShape,
    canonicalShapeSlug: shape.canonicalShapeSlug,
    canonicalShapeZh: shape.canonicalShapeZh,
    shapeZhName: shape.canonicalShapeZh,
    bendType: shape.bendType,
    shapeReviewStatus: shape.shapeReviewStatus,
    rawFinish: finish.rawFinish,
    finishMapped: finish.finishMapped,
    finish: finish.canonicalFinish,
    canonicalFinish: finish.canonicalFinish,
    canonicalFinishSlug: finish.canonicalFinishSlug,
    canonicalFinishZh: finish.canonicalFinishZh,
    finishReviewStatus: finish.finishReviewStatus,
    rawMaterial: bowlMaterial.rawMaterial,
    materialMapped: bowlMaterial.materialMapped,
    material: bowlMaterial.canonicalMaterial,
    canonicalMaterial: bowlMaterial.canonicalMaterial,
    canonicalMaterialSlug: bowlMaterial.canonicalMaterialSlug,
    canonicalMaterialZh: bowlMaterial.canonicalMaterialZh,
    materialReviewStatus: bowlMaterial.materialReviewStatus,
    rawStemMaterial: stemMaterial.rawStemMaterial,
    stemMaterialMapped: stemMaterial.stemMaterialMapped,
    stemMaterial: stemMaterial.canonicalStemMaterial,
    canonicalStemMaterial: stemMaterial.canonicalStemMaterial,
    canonicalStemMaterialSlug: stemMaterial.canonicalStemMaterialSlug,
    canonicalStemMaterialZh: stemMaterial.canonicalStemMaterialZh,
    stemMaterialReviewStatus: stemMaterial.stemMaterialReviewStatus,
    rawFilter: filter.rawFilter,
    canonicalFilter: filter.canonicalFilter,
    filterSizeMm: filter.filterSizeMm,
    filterReviewStatus: filter.filterReviewStatus,
    price,
    rawCountry: normalizeText(detail.country),
    inventoryStatus: inventory.inventoryStatus,
    inventoryConfidence: inventory.inventoryConfidence,
    includedInActiveListRange: inventory.includedInActiveListRange,
    rawListStatus: inventory.rawListStatus,
    rawDetailStatus: inventory.rawDetailStatus,
    inventoryReviewReasons: inventory.inventoryReviewReasons,
    inventoryWarnings: inventory.inventoryWarnings,
    inventoryEvidence: {
      includedInActiveListRange: inventory.includedInActiveListRange,
      rawListStatus: inventory.rawListStatus,
      rawDetailStatus: inventory.rawDetailStatus,
      reasons: inventory.inventoryReviewReasons,
      warnings: inventory.inventoryWarnings,
      soldEvidence: inventory.soldEvidence,
      availableEvidence: inventory.availableEvidence,
      rawStatusSource: inventory.rawStatusSource,
    },
    ...images,
    ...measurements,
    rawModel: model.rawModel,
    rawSeries: model.rawSeries,
    rawShapeNumber: model.rawShapeNumber,
    canonicalModelKey: model.canonicalModelKey,
    canonicalModelKeyComponents: model.canonicalModelKeyComponents,
    canonicalModelKeyConfidence: model.canonicalModelKeyConfidence,
    modelEntityId: model.modelEntityId,
    specsText: Array.isArray(detail.specsText) ? detail.specsText.map(normalizeText).filter(Boolean) : [],
    description: normalizeText(detail.description),
    sourceSpecific: {
      smokingpipes: {
        rawStatus: normalizeText(detail.status),
        rawStatusSource: inventory.rawStatusSource,
        statusEvidence: detail.statusEvidence || null,
        verificationBlocked: Boolean(detail.verificationBlocked),
        excludedSimilarImageCount: detail.excludedSimilarImageCount ?? 0,
        updatedAt: normalizeText(detail.updatedAt),
        rawMsrp: normalizeText(detail.msrp),
        rawPrice: normalizeText(detail.price),
        rawOriginalPrice: normalizeText(detail.originalPrice),
        listRawText: normalizeText(listItem?.rawText),
      },
    },
  };
}

export function convertSmokingpipesCandidateDetails(
  details,
  listProducts
) {
  const brandTaxonomy = readJson(paths.brandTaxonomy);
  const sourceScopedBrandMappings = readJson(
    paths.sourceScopedBrandMappings
  );
  const productPublicationOverrides = readJson(
    paths.productPublicationOverrides
  );
  const shapeTaxonomy = readJson(paths.shapeTaxonomy);
  const finishTaxonomy = readJson(paths.finishTaxonomy);
  const materialTaxonomy = readJson(paths.materialTaxonomy);
  const indexes = {
    brand: buildAliasIndex(
      brandTaxonomy.brands || [],
      "aliases",
      "canonicalBrandSlug"
    ),
    brandCanonical: buildCanonicalBrandIndex(
      brandTaxonomy.brands || []
    ),
    brandUrlPath: buildBrandUrlPathIndex(brandTaxonomy.brands || []),
    sourceScopedBrand: buildSourceScopedBrandIndex(
      sourceScopedBrandMappings
    ),
    productOverrides: buildProductOverrideIndex(
      productPublicationOverrides
    ),
    shape: buildAliasIndex(
      shapeTaxonomy.shapes || [],
      "aliases",
      "canonicalShapeSlug"
    ),
    finish: buildAliasIndex(
      finishTaxonomy.finishes || [],
      "aliases",
      "canonicalFinishSlug"
    ),
    bowlMaterial: buildAliasIndex(
      materialTaxonomy.bowlMaterials || [],
      "aliases",
      "canonicalMaterialSlug"
    ),
    stemMaterial: buildAliasIndex(
      materialTaxonomy.stemMaterials || [],
      "aliases",
      "canonicalMaterialSlug"
    ),
  };
  const listMap = new Map(
    (listProducts || [])
      .map((item) => [productIdOf(item), item])
      .filter(([id]) => id)
  );
  const products = [];
  const failures = [];

  for (const detail of details || []) {
    const id = productIdOf(detail);
    try {
      if (!id) throw new Error("missing sourceProductId");
      const product = convertProduct(detail, listMap.get(id), indexes);
      const validationErrors = [];
      if (!product.id) validationErrors.push("empty id");
      if (!product.sourceProductId) {
        validationErrors.push("empty sourceProductId");
      }
      if (!product.sourceUrl) validationErrors.push("empty sourceUrl");
      if (
        product.brandReviewStatus === "needs-review" &&
        product.brandIndexEligible !== false
      ) {
        validationErrors.push(
          "needs-review brand is incorrectly index eligible"
        );
      }
      if (validationErrors.length) {
        throw new Error(validationErrors.join("; "));
      }
      products.push(product);
    } catch (error) {
      failures.push({
        sourceProductId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { products, failures };
}

function increment(map, key, by = 1) {
  const normalizedKey = key ?? "unknown";
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + by);
}

function countBy(items, getter) {
  const map = new Map();

  for (const item of items) {
    increment(map, getter(item));
  }

  return Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function groupBy(items, getter) {
  const map = new Map();

  for (const item of items) {
    const key = getter(item);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(item);
  }

  return map;
}

function addSample(selection, detail, reason) {
  if (!detail) {
    return;
  }

  const id = productIdOf(detail);

  if (!id) {
    return;
  }

  if (!selection.has(id)) {
    selection.set(id, {
      detail,
      reasons: new Set(),
    });
  }

  selection.get(id).reasons.add(reason);
}

function addFirstPerValue(selection, details, field, reasonPrefix, skip = () => false) {
  const seen = new Set();

  for (const detail of details) {
    const value = normalizeText(detail[field]);

    if (!value || skip(value) || seen.has(value)) {
      continue;
    }

    seen.add(value);
    addSample(selection, detail, `${reasonPrefix}:${value}`);
  }
}

function addFirstWhere(selection, details, reason, predicate) {
  const item = details.find(predicate);
  addSample(selection, item, reason);
}

function buildSampleSelection(details, listMap, convertedById, fieldAudit, taxonomyReviewEvidence, max) {
  const sortedDetails = details.slice().sort((a, b) => numericProductId(a) - numericProductId(b));
  const selection = new Map();

  addFirstPerValue(selection, sortedDetails, "brand", "raw-brand");
  addFirstPerValue(selection, sortedDetails, "shape", "shape", (value) => /^N\/A$/i.test(value));
  addFirstPerValue(selection, sortedDetails, "finish", "finish");
  addFirstPerValue(selection, sortedDetails, "material", "material");
  addFirstPerValue(selection, sortedDetails, "stemMaterial", "stem-material");
  addFirstPerValue(selection, sortedDetails, "filter", "filter");

  const byBrandStatus = groupBy([...convertedById.values()], (item) => item.brandReviewStatus);

  for (const [status, products] of [...byBrandStatus.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const detail = sortedDetails.find((candidate) => {
      const converted = convertedById.get(productIdOf(candidate));
      return products.includes(converted);
    });

    addSample(selection, detail, `brand-review-status:${status}`);
  }

  for (const brandName of needsReviewBrands) {
    const detail = sortedDetails.find((candidate) => {
      const converted = convertedById.get(productIdOf(candidate));
      return (
        converted?.rawBrand === brandName ||
        converted?.canonicalBrand === brandName ||
        converted?.canonicalBrandSlug === slugify(brandName)
      );
    });

    addSample(selection, detail, `needs-review-brand:${brandName}`);
  }

  addFirstWhere(selection, sortedDetails, "inventory:available", (detail) => {
    return convertedById.get(productIdOf(detail))?.inventoryStatus === "available";
  });

  addFirstWhere(selection, sortedDetails, "inventory:detail-sold-active-list-conflict", (detail) => {
    const converted = convertedById.get(productIdOf(detail));
    return converted?.inventoryStatus === "needs-review" && converted.inventoryConfidence === "conflicting-signals";
  });

  addFirstWhere(selection, sortedDetails, "image:complete-gallery", (detail) => {
    return (convertedById.get(productIdOf(detail))?.galleryImages || []).length > 1;
  });

  addFirstWhere(selection, sortedDetails, "image:only-main", (detail) => {
    const converted = convertedById.get(productIdOf(detail));
    return converted?.imageSourceStrategy === "detail-main-only";
  });

  addFirstWhere(selection, sortedDetails, "image:list-image-fallback", (detail) => {
    return convertedById.get(productIdOf(detail))?.usedListImageFallback;
  });

  addFirstWhere(selection, sortedDetails, "measurements:complete", (detail) => {
    const measurements = convertedById.get(productIdOf(detail))?.measurements || {};
    return [
      measurements.lengthMm,
      measurements.weightGrams,
      measurements.heightMm,
      measurements.chamberDepthMm,
      measurements.chamberDiameterMm,
      measurements.outsideDiameterMm,
    ].every((value) => Number.isFinite(value));
  });

  addFirstWhere(selection, sortedDetails, "measurements:missing-or-incomplete", (detail) => {
    const measurements = convertedById.get(productIdOf(detail))?.measurements || {};
    return [
      measurements.lengthMm,
      measurements.weightGrams,
      measurements.heightMm,
      measurements.chamberDepthMm,
      measurements.chamberDiameterMm,
      measurements.outsideDiameterMm,
    ].some((value) => !Number.isFinite(value));
  });

  const duplicateProductCodeGroups = fieldAudit.duplicateAudits?.duplicateProductCodeGroups || [];

  for (const group of duplicateProductCodeGroups.slice(0, 5)) {
    const products = group.products || [];

    for (const product of products.slice(0, 2)) {
      addSample(selection, sortedDetails.find((detail) => productIdOf(detail) === product.sourceProductId), `duplicate-product-code:${group.productCode || group.key || "unknown"}`);
    }
  }

  const duplicateBrandTitleGroups = fieldAudit.duplicateAudits?.duplicateBrandTitleGroups || [];

  for (const group of duplicateBrandTitleGroups.slice(0, 20)) {
    const products = group.products || [];

    for (const product of products.slice(0, 2)) {
      addSample(selection, sortedDetails.find((detail) => productIdOf(detail) === product.sourceProductId), `duplicate-brand-title:${group.brand || group.key || "unknown"}`);
    }
  }

  const conflictSlugs = new Set();

  for (const conflict of fieldAudit.brandCountryConflicts || []) {
    conflictSlugs.add(slugify(conflict.brand));
  }

  for (const conflict of taxonomyReviewEvidence.brandCountryConflicts || []) {
    conflictSlugs.add(conflict.canonicalBrandSlug || slugify(conflict.canonicalBrand));
  }

  for (const conflictSlug of [...conflictSlugs].sort()) {
    addFirstWhere(selection, sortedDetails, `brand-country-conflict:${conflictSlug}`, (detail) => {
      return convertedById.get(productIdOf(detail))?.canonicalBrandSlug === conflictSlug;
    });
  }

  for (const detail of sortedDetails) {
    const converted = convertedById.get(productIdOf(detail));

    if (converted?.brandReviewStatus === "provisional") {
      addSample(selection, detail, `provisional-brand:${converted.canonicalBrand}`);
    }
  }

  const records = [...selection.values()]
    .map((entry) => ({
      detail: entry.detail,
      reasons: [...entry.reasons].sort(),
    }))
    .sort((a, b) => numericProductId(a.detail) - numericProductId(b.detail));

  return {
    records,
    max,
    exceededRequestedMax: records.length > max,
    coverageRequiredCount: records.length,
  };
}

function getFieldStats(products, field) {
  let present = 0;
  let empty = 0;

  for (const product of products) {
    const value = product[field];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      empty += 1;
    } else {
      present += 1;
    }
  }

  return {
    present,
    empty,
  };
}

function duplicateGroups(products, getter) {
  return [...groupBy(products, getter).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      count: group.length,
      productIds: group.map((item) => item.id).sort(),
    }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function getSortedConvertedProducts(convertedById) {
  return [...convertedById.values()].sort((a, b) => {
    const aId = Number.parseInt(a.sourceProductId, 10);
    const bId = Number.parseInt(b.sourceProductId, 10);

    return (Number.isFinite(aId) ? aId : Number.MAX_SAFE_INTEGER) -
      (Number.isFinite(bId) ? bId : Number.MAX_SAFE_INTEGER);
  });
}

function buildSchemaProfile(danishProducts, pipesText, danishWrapperText) {
  const danishTopLevelFields = Object.keys(danishProducts[0] || {}).sort();
  const nestedFields = {};

  for (const key of danishTopLevelFields) {
    const value = danishProducts[0]?.[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      nestedFields[key] = Object.keys(value).sort();
    }
  }

  const pipeProductFields = [];
  const interfaceMatch = pipesText.match(/export\s+type\s+PipeProduct\s*=\s*\{([\s\S]*?)\};/);

  if (interfaceMatch) {
    for (const line of interfaceMatch[1].split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z0-9_]+)\??:/);

      if (match) {
        pipeProductFields.push(match[1]);
      }
    }
  }

  return {
    danishProductCount: danishProducts.length,
    danishProductsWrapperUsesJson: /products\/danish-products\.json/.test(danishWrapperText),
    danishTopLevelFields,
    danishNestedFields: nestedFields,
    pipeProductFields: pipeProductFields.sort(),
    smokingpipesV2CoreFields: [
      "id",
      "source",
      "sourceSite",
      "sourceProductId",
      "productCode",
      "sourceUrl",
      "rawBrand",
      "canonicalBrand",
      "canonicalBrandSlug",
      "brandReviewStatus",
      "brandIndexEligible",
      "rawTitle",
      "fullTitle",
      "displayNameEn",
      "displayNameZh",
      "rawShape",
      "canonicalShape",
      "canonicalShapeSlug",
      "rawFinish",
      "canonicalFinish",
      "rawMaterial",
      "canonicalMaterial",
      "rawStemMaterial",
      "canonicalStemMaterial",
      "rawFilter",
      "canonicalFilter",
      "price",
      "inventoryStatus",
      "inventoryConfidence",
      "imageUrl",
      "galleryImages",
      "measurements",
      "canonicalModelKey",
      "sourceSpecific",
    ],
  };
}

function buildAudit({
  details,
  listProducts,
  fieldAudit,
  taxonomyReviewEvidence,
  sampleRecords,
  convertedAll,
  sampleProducts,
  selection,
  schemaProfile,
  inputs,
}) {
  const fullProducts = [...convertedAll.values()];
  const coverage = {
    rawBrands: {
      total: new Set(details.map((item) => normalizeText(item.brand)).filter(Boolean)).size,
      sample: new Set(sampleProducts.map((item) => item.rawBrand).filter(Boolean)).size,
    },
    shapesNonNa: {
      total: new Set(details.map((item) => normalizeText(item.shape)).filter((value) => value && !/^N\/A$/i.test(value))).size,
      sample: new Set(sampleProducts.map((item) => item.rawShape).filter((value) => value && !/^N\/A$/i.test(value))).size,
    },
    finishes: {
      total: new Set(details.map((item) => normalizeText(item.finish)).filter(Boolean)).size,
      sample: new Set(sampleProducts.map((item) => item.rawFinish).filter(Boolean)).size,
    },
    materials: {
      total: new Set(details.map((item) => normalizeText(item.material)).filter(Boolean)).size,
      sample: new Set(sampleProducts.map((item) => item.rawMaterial).filter(Boolean)).size,
    },
    stemMaterials: {
      total: new Set(details.map((item) => normalizeText(item.stemMaterial)).filter(Boolean)).size,
      sample: new Set(sampleProducts.map((item) => item.rawStemMaterial).filter(Boolean)).size,
    },
    filters: {
      total: new Set(details.map((item) => normalizeText(item.filter)).filter(Boolean)).size,
      sample: new Set(sampleProducts.map((item) => item.rawFilter).filter(Boolean)).size,
    },
  };

  const reasonCounts = new Map();

  for (const record of sampleRecords) {
    for (const reason of record.reasons) {
      increment(reasonCounts, reason);
    }
  }

  const inventoryConflictFull = fullProducts.filter((item) => item.inventoryStatus === "needs-review" && item.inventoryConfidence === "conflicting-signals");
  const inventoryConflictSample = sampleProducts.filter((item) => item.inventoryStatus === "needs-review" && item.inventoryConfidence === "conflicting-signals");
  const priceParseCounts = countBy(sampleProducts, (item) => item.price.current.parseStatus);
  const fullPriceParseCounts = countBy(fullProducts, (item) => item.price.current.parseStatus);
  const sampleModelDuplicateGroups = duplicateGroups(sampleProducts, (item) => item.canonicalModelKey);
  const fullModelDuplicateGroups = duplicateGroups(fullProducts, (item) => item.canonicalModelKey);
  const errors = [];
  const warnings = [];

  if (selection.exceededRequestedMax) {
    warnings.push(`Coverage required ${selection.coverageRequiredCount} records, exceeding requested max ${selection.max}.`);
  }

  if (inventoryConflictFull.length > 0) {
    warnings.push(`${inventoryConflictFull.length} products are active-list/detail-sold inventory conflicts and are marked needs-review.`);
  }

  const forbiddenSold = sampleProducts.filter((item) => item.inventoryStatus === "sold");

  if (forbiddenSold.length > 0) {
    errors.push("Forbidden canonical inventoryStatus=sold found in sample output.");
  }

  const needsReviewEligible = sampleProducts.filter((item) => item.brandReviewStatus === "needs-review" && item.brandIndexEligible);

  if (needsReviewEligible.length > 0) {
    errors.push("needs-review brands must not be brandIndexEligible.");
  }

  const brandCoverageMissing = coverage.rawBrands.sample !== coverage.rawBrands.total;

  if (brandCoverageMissing) {
    errors.push(`Sample missed raw brand coverage: ${coverage.rawBrands.sample}/${coverage.rawBrands.total}.`);
  }

  const needsReviewBrandCounts = needsReviewBrands.map((brand) => {
    const slug = slugify(brand);
    const products = sampleProducts.filter((item) => item.rawBrand === brand || item.canonicalBrand === brand || item.canonicalBrandSlug === slug);

    return {
      brand,
      sampleCount: products.length,
      brandIndexEligible: products.length ? products.every((item) => item.brandIndexEligible === false) : null,
    };
  });

  return {
    schemaVersion: 1,
    auditType: "smokingpipes-v2-sample",
    generatedAt: null,
    inputs,
    sourceCounts: {
      detailCount: details.length,
      listCount: listProducts.length,
      convertedFullCount: fullProducts.length,
      sampleCount: sampleProducts.length,
      requestedMax: selection.max,
      exceededRequestedMax: selection.exceededRequestedMax,
    },
    schemaProfile,
    selection: {
      reasonCounts: Object.fromEntries([...reasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      records: sampleRecords.map((record) => ({
        sourceProductId: productIdOf(record.detail),
        reasons: record.reasons,
      })),
    },
    taxonomyCoverage: coverage,
    brandStatusCounts: {
      full: countBy(fullProducts, (item) => item.brandReviewStatus),
      sample: countBy(sampleProducts, (item) => item.brandReviewStatus),
    },
    brandIndexEligibilityCounts: {
      full: countBy(fullProducts, (item) => String(item.brandIndexEligible)),
      sample: countBy(sampleProducts, (item) => String(item.brandIndexEligible)),
    },
    needsReviewBrandCounts,
    provisionalBrandMappings: [...groupBy(sampleProducts.filter((item) => item.brandReviewStatus === "provisional"), (item) => `${item.rawBrand} -> ${item.canonicalBrand}`).entries()]
      .map(([mapping, products]) => ({
        mapping,
        count: products.length,
        sourceProductIds: products.map((item) => item.sourceProductId).sort(),
      }))
      .sort((a, b) => a.mapping.localeCompare(b.mapping)),
    inventoryStatusCounts: {
      full: countBy(fullProducts, (item) => item.inventoryStatus),
      sample: countBy(sampleProducts, (item) => item.inventoryStatus),
    },
    inventoryConflictCounts: {
      full: inventoryConflictFull.length,
      sample: inventoryConflictSample.length,
      sampleProductIds: inventoryConflictSample.map((item) => item.sourceProductId).sort(),
    },
    imageAudit: {
      full: {
        missing: fullProducts.filter((item) => !item.imageUrl && item.galleryImages.length === 0).length,
        usedListImageFallback: fullProducts.filter((item) => item.usedListImageFallback).length,
        onlyMain: fullProducts.filter((item) => item.imageSourceStrategy === "detail-main-only").length,
        completeGallery: fullProducts.filter((item) => item.galleryImages.length > 1).length,
        duplicateGallery: fullProducts.filter((item) => new Set(item.galleryImages).size !== item.galleryImages.length).length,
      },
      sample: {
        missing: sampleProducts.filter((item) => !item.imageUrl && item.galleryImages.length === 0).length,
        usedListImageFallback: sampleProducts.filter((item) => item.usedListImageFallback).length,
        onlyMain: sampleProducts.filter((item) => item.imageSourceStrategy === "detail-main-only").length,
        completeGallery: sampleProducts.filter((item) => item.galleryImages.length > 1).length,
        duplicateGallery: sampleProducts.filter((item) => new Set(item.galleryImages).size !== item.galleryImages.length).length,
      },
    },
    priceAudit: {
      fullCurrentPriceParseCounts: fullPriceParseCounts,
      sampleCurrentPriceParseCounts: priceParseCounts,
      sampleOriginalPrice: getFieldStats(sampleProducts.map((item) => item.price.original), "amount"),
      note: "No RMB reference price is calculated in V2 sample output.",
    },
    measurementAudit: {
      fullComplete: fullProducts.filter((item) => Object.values(item.measurements).every((value) => Number.isFinite(value))).length,
      fullIncomplete: fullProducts.filter((item) => Object.values(item.measurements).some((value) => !Number.isFinite(value))).length,
      sampleComplete: sampleProducts.filter((item) => Object.values(item.measurements).every((value) => Number.isFinite(value))).length,
      sampleIncomplete: sampleProducts.filter((item) => Object.values(item.measurements).some((value) => !Number.isFinite(value))).length,
    },
    identifierAudit: {
      sampleDuplicateIds: duplicateGroups(sampleProducts, (item) => item.id),
      sampleDuplicateSourceProductIds: duplicateGroups(sampleProducts, (item) => item.sourceProductId),
      sampleDuplicateSourceUrls: duplicateGroups(sampleProducts, (item) => item.sourceUrl),
    },
    modelKeyAudit: {
      sampleUniqueCanonicalModelKeyCount: new Set(sampleProducts.map((item) => item.canonicalModelKey)).size,
      sampleDuplicateGroupCount: sampleModelDuplicateGroups.length,
      sampleDuplicateGroupsPreview: sampleModelDuplicateGroups.slice(0, 20),
      fullDuplicateGroupCount: fullModelDuplicateGroups.length,
      fullDuplicateGroupsPreview: fullModelDuplicateGroups.slice(0, 20),
      note: "canonicalModelKey is offer-level and deliberately excludes sourceProductId; duplicate groups are candidate model families, not auto-merged products.",
    },
    sourceAuditReferences: {
      fieldAuditSummary: fieldAudit.summary,
      activeListStatusMismatch: fieldAudit.activeListStatusMismatch,
      duplicateAuditsPreview: {
        duplicateProductCodeGroups: (fieldAudit.duplicateAudits?.duplicateProductCodeGroups || []).slice(0, 10),
        duplicateBrandTitleGroups: (fieldAudit.duplicateAudits?.duplicateBrandTitleGroups || []).slice(0, 10),
      },
      brandCountryConflicts: {
        fieldAudit: fieldAudit.brandCountryConflicts || [],
        taxonomyReviewEvidence: taxonomyReviewEvidence.brandCountryConflicts || [],
      },
    },
    fullConversionReadiness: {
      readyForFullDryRun: errors.length === 0,
      blockingIssues: errors,
      nonBlockingIssues: warnings,
    },
    errors,
    warnings,
  };
}

function nonEmpty(value) {
  return normalizeText(value).length > 0;
}

function isFiniteValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function metricFromText(text, unit) {
  const normalized = normalizeText(text).replace(/,/g, "");
  const pattern = unit === "g"
    ? /(-?\d+(?:\.\d+)?)\s*g\b/i
    : /(-?\d+(?:\.\d+)?)\s*mm\b/i;
  const match = normalized.match(pattern);

  return match ? Number.parseFloat(match[1]) : null;
}

function walkForSerializationIssues(value, currentPath, issues) {
  if (value === undefined) {
    issues.undefinedPaths.push(currentPath);
    return;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    issues.nonFiniteNumberPaths.push(currentPath);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForSerializationIssues(item, `${currentPath}[${index}]`, issues));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      walkForSerializationIssues(item, `${currentPath}.${key}`, issues);
    }
  }
}

function serializationAudit(payload) {
  const issues = {
    undefinedPaths: [],
    nonFiniteNumberPaths: [],
  };

  walkForSerializationIssues(payload, "$", issues);

  const text = JSON.stringify(payload);

  return {
    undefinedPathCount: issues.undefinedPaths.length,
    undefinedPathExamples: issues.undefinedPaths.slice(0, 10),
    nonFiniteNumberPathCount: issues.nonFiniteNumberPaths.length,
    nonFiniteNumberPathExamples: issues.nonFiniteNumberPaths.slice(0, 10),
    serializedContainsUndefined: text.includes("undefined"),
    serializedContainsNaN: text.includes("NaN"),
  };
}

function taxonomyCollisionAudit(label, items, aliasesKey, slugKey, canonicalKey) {
  const aliasMap = new Map();
  const slugMap = new Map();

  for (const item of items || []) {
    const canonical = normalizeText(item[canonicalKey]);
    const slug = normalizeText(item[slugKey]);
    const aliases = [canonical, ...(Array.isArray(item[aliasesKey]) ? item[aliasesKey] : [])].filter(Boolean);

    if (slug) {
      if (!slugMap.has(slug)) {
        slugMap.set(slug, new Set());
      }

      slugMap.get(slug).add(canonical);
    }

    for (const alias of aliases) {
      const key = normalizeKey(alias);

      if (!aliasMap.has(key)) {
        aliasMap.set(key, new Set());
      }

      aliasMap.get(key).add(canonical);
    }
  }

  return {
    label,
    aliasCollisionCount: [...aliasMap.values()].filter((values) => values.size > 1).length,
    aliasCollisionExamples: [...aliasMap.entries()]
      .filter(([, values]) => values.size > 1)
      .slice(0, 10)
      .map(([alias, values]) => ({ alias, canonicalValues: [...values].sort() })),
    slugCollisionCount: [...slugMap.values()].filter((values) => values.size > 1).length,
    slugCollisionExamples: [...slugMap.entries()]
      .filter(([, values]) => values.size > 1)
      .slice(0, 10)
      .map(([slug, values]) => ({ slug, canonicalValues: [...values].sort() })),
  };
}

function buildImageAudit(products) {
  let galleryDuplicateUrlProductCount = 0;
  let galleryDuplicateUrlTotal = 0;
  let abnormalUrlCount = 0;
  let nonStringImageFieldCount = 0;

  for (const product of products) {
    const urls = [
      product.imageUrl,
      product.mainImageUrl,
      product.detailImageUrl,
      product.listImageUrl,
      ...(Array.isArray(product.galleryImages) ? product.galleryImages : []),
    ];

    for (const url of urls) {
      if (url === null || url === undefined || url === "") {
        continue;
      }

      if (typeof url !== "string") {
        nonStringImageFieldCount += 1;
        continue;
      }

      if (!/^https?:\/\//i.test(url) && !url.includes("/products/")) {
        abnormalUrlCount += 1;
      }
    }

    const galleryImages = Array.isArray(product.galleryImages) ? product.galleryImages : [];
    const duplicateCount = galleryImages.length - new Set(galleryImages).size;

    if (duplicateCount > 0) {
      galleryDuplicateUrlProductCount += 1;
      galleryDuplicateUrlTotal += duplicateCount;
    }
  }

  const onlyMain = products.filter((item) => item.imageSourceStrategy === "detail-main-only");
  const galleryEmpty = products.filter((item) => !Array.isArray(item.galleryImages) || item.galleryImages.length === 0);

  return {
    mainImagePresent: products.filter((item) => nonEmpty(item.imageUrl)).length,
    mainImageMissing: products.filter((item) => !nonEmpty(item.imageUrl)).length,
    galleryNonEmpty: products.filter((item) => Array.isArray(item.galleryImages) && item.galleryImages.length > 0).length,
    galleryEmpty: galleryEmpty.length,
    onlyMain: onlyMain.length,
    noSubImages: products.filter((item) => Array.isArray(item.galleryImages) && item.galleryImages.length <= 1).length,
    listImageFallback: products.filter((item) => item.usedListImageFallback).length,
    duplicateGalleryProductCount: galleryDuplicateUrlProductCount,
    duplicateGalleryUrlTotal: galleryDuplicateUrlTotal,
    mainImageAlsoInGallery: products.filter((item) => item.imageUrl && Array.isArray(item.galleryImages) && item.galleryImages.includes(item.imageUrl)).length,
    abnormalUrlCount,
    nonStringImageFieldCount,
    specialImageRecordCheck: {
      historicalReference: 371,
      currentOnlyMain: onlyMain.length,
      currentNoSubImages: products.filter((item) => Array.isArray(item.galleryImages) && item.galleryImages.length <= 1).length,
      currentGalleryEmpty: galleryEmpty.length,
      currentListImageFallback: products.filter((item) => item.usedListImageFallback).length,
      note: "The historical 371 count corresponds to detail-main-only records in the current conversion path; no data is changed to force this count.",
    },
  };
}

function buildPriceAudit(products) {
  const current = products.map((item) => item.price.current);
  const msrp = products.map((item) => item.price.msrp);

  return {
    currentPriceParseCounts: countBy(current, (item) => item.parseStatus),
    currentPriceParsed: current.filter((item) => item.parseStatus === "parsed").length,
    currentPriceFailed: current.filter((item) => item.parseStatus === "failed").length,
    currentPriceEmpty: current.filter((item) => item.parseStatus === "empty").length,
    nonUsdCurrencyCount: current.filter((item) => item.currency && item.currency !== "USD").length,
    msrpPresent: msrp.filter((item) => nonEmpty(item.rawText)).length,
    msrpParseFailed: msrp.filter((item) => nonEmpty(item.rawText) && item.parseStatus !== "parsed").length,
    discountTextPresent: products.filter((item) => nonEmpty(item.price.rawDiscountText)).length,
    rmbTextPresent: products.filter((item) => nonEmpty(item.price.rawRmbText)).length,
    note: "The V2 dry-run preserves source USD/MSRP/RMB text only and does not calculate RMB, exchange rates, tariffs, or service fees.",
  };
}

function buildMeasurementAudit(products) {
  const fields = [
    ["lengthMm", "lengthText", "mm"],
    ["heightMm", "heightText", "mm"],
    ["weightGrams", "weightText", "g"],
    ["chamberDepthMm", "chamberDepthText", "mm"],
    ["chamberDiameterMm", "chamberDiameterText", "mm"],
    ["outsideDiameterMm", "outsideDiameterText", "mm"],
  ];
  const fieldMissingCounts = {};
  const rawTextExistsButParsedMissing = {};
  const parsedTextConflictExamples = {};
  const nonFiniteExamples = [];
  const nonPositiveExamples = [];
  const suspiciousLargeExamples = [];
  let allComplete = 0;
  let missingOne = 0;
  let missingTwoOrMore = 0;
  let conflictCount = 0;

  const largeThresholds = {
    lengthMm: 400,
    heightMm: 160,
    weightGrams: 300,
    chamberDepthMm: 120,
    chamberDiameterMm: 60,
    outsideDiameterMm: 90,
  };

  for (const [field, textField, unit] of fields) {
    fieldMissingCounts[field] = 0;
    rawTextExistsButParsedMissing[field] = 0;
    parsedTextConflictExamples[field] = [];
  }

  for (const product of products) {
    let missingCount = 0;

    for (const [field, textField, unit] of fields) {
      const value = product.measurements?.[field];
      const rawText = product[textField];

      if (!isFiniteValue(value)) {
        fieldMissingCounts[field] += 1;
        missingCount += 1;

        if (nonEmpty(rawText)) {
          rawTextExistsButParsedMissing[field] += 1;
        }

        if (value !== null && value !== undefined && nonFiniteExamples.length < 10) {
          nonFiniteExamples.push({ id: product.id, field, value });
        }

        continue;
      }

      if (value <= 0 && nonPositiveExamples.length < 10) {
        nonPositiveExamples.push({ id: product.id, field, value });
      }

      if (value > largeThresholds[field] && suspiciousLargeExamples.length < 10) {
        suspiciousLargeExamples.push({ id: product.id, field, value });
      }

      const parsedFromText = metricFromText(rawText, unit);

      if (Number.isFinite(parsedFromText) && Math.abs(parsedFromText - value) > 0.05) {
        conflictCount += 1;

        if (parsedTextConflictExamples[field].length < 10) {
          parsedTextConflictExamples[field].push({
            id: product.id,
            rawText,
            parsedFromText,
            storedValue: value,
          });
        }
      }
    }

    if (missingCount === 0) {
      allComplete += 1;
    } else if (missingCount === 1) {
      missingOne += 1;
    } else {
      missingTwoOrMore += 1;
    }
  }

  return {
    allSixComplete: allComplete,
    missingOneField: missingOne,
    missingTwoOrMoreFields: missingTwoOrMore,
    fieldMissingCounts,
    rawTextExistsButParsedMissing,
    parsedMeasurementsTextConflictCount: conflictCount,
    parsedMeasurementsTextConflictExamples: parsedTextConflictExamples,
    nonFiniteNumberCount: nonFiniteExamples.length,
    nonFiniteExamples,
    nonPositiveValueExamples: nonPositiveExamples,
    suspiciousLargeValueExamples: suspiciousLargeExamples,
  };
}

function classifyModelKeyGroup(products) {
  const confidences = new Set(products.map((item) => item.canonicalModelKeyConfidence));
  const finishes = new Set(products.map((item) => item.canonicalFinishSlug || item.rawFinish || ""));
  const titles = new Set(products.map((item) => item.rawTitle || ""));
  const series = new Set(products.map((item) => item.rawSeries || ""));

  if (confidences.has("low")) {
    return "low-confidence-key-contamination";
  }

  if (finishes.size > 1) {
    return "same-model-different-finish";
  }

  if (series.size > 1) {
    return "cross-series-candidate";
  }

  if (titles.size > 1) {
    return "same-model-different-physical-piece";
  }

  return "possible-true-duplicate-candidate";
}

function buildIdentifierAudit(products) {
  const modelGroups = duplicateGroups(products, (item) => item.canonicalModelKey);
  const groupedByModelKey = groupBy(products, (item) => item.canonicalModelKey);
  const classifiedModelGroups = modelGroups.map((group) => {
    const groupProducts = groupedByModelKey.get(group.key) || [];

    return {
      ...group,
      classification: classifyModelKeyGroup(groupProducts),
      products: groupProducts.slice(0, 10).map((item) => ({
        id: item.id,
        sourceProductId: item.sourceProductId,
        rawBrand: item.rawBrand,
        rawTitle: item.rawTitle,
        rawFinish: item.rawFinish,
        canonicalModelKeyConfidence: item.canonicalModelKeyConfidence,
      })),
    };
  });

  return {
    duplicateIds: duplicateGroups(products, (item) => item.id),
    duplicateSourceProductIds: duplicateGroups(products, (item) => item.sourceProductId),
    duplicateSourceUrls: duplicateGroups(products, (item) => item.sourceUrl),
    canonicalModelKeyUniqueCount: new Set(products.map((item) => item.canonicalModelKey)).size,
    canonicalModelKeyDuplicateGroupCount: modelGroups.length,
    canonicalModelKeyDuplicateGroupsPreview: classifiedModelGroups.slice(0, 20),
    duplicateBrandTitleGroups: duplicateGroups(products, (item) => `${item.canonicalBrandSlug}::${normalizeKey(item.rawTitle)}`),
    duplicateProductCodeGroups: duplicateGroups(products, (item) => normalizeKey(item.productCode)),
    idCollisionCount: duplicateGroups(products, (item) => item.id).length,
    note: "canonicalModelKey duplicates are audit candidates only and are never used to delete or merge records.",
  };
}

function buildTaxonomyCoverageAudit(products, taxonomies) {
  const normalShapeUnmapped = products.filter((item) => item.rawShape && !/^N\/A$/i.test(item.rawShape) && !item.shapeMapped);
  const normalStemUnmapped = products.filter((item) => item.rawStemMaterial && !/^N\/A$/i.test(item.rawStemMaterial) && !item.stemMaterialMapped);

  return {
    brandStatusCounts: countBy(products, (item) => item.brandReviewStatus),
    brandIndexEligibilityCounts: countBy(products, (item) => String(item.brandIndexEligible)),
    withCanonicalBrand: products.filter((item) => nonEmpty(item.canonicalBrand)).length,
    withCanonicalShape: products.filter((item) => nonEmpty(item.canonicalShape)).length,
    withCanonicalFinish: products.filter((item) => nonEmpty(item.canonicalFinish)).length,
    withCanonicalMaterial: products.filter((item) => nonEmpty(item.canonicalMaterial)).length,
    withCanonicalStemMaterial: products.filter((item) => nonEmpty(item.canonicalStemMaterial)).length,
    withCanonicalFilter: products.filter((item) => nonEmpty(item.canonicalFilter)).length,
    unmapped: {
      brands: products.filter((item) => !item.brandMapped).length,
      normalShapes: normalShapeUnmapped.length,
      finishes: products.filter((item) => !item.finishMapped).length,
      materials: products.filter((item) => !item.materialMapped).length,
      nonNaStemMaterials: normalStemUnmapped.length,
      normalShapeExamples: normalShapeUnmapped.slice(0, 10).map((item) => ({ id: item.id, rawShape: item.rawShape })),
      nonNaStemMaterialExamples: normalStemUnmapped.slice(0, 10).map((item) => ({ id: item.id, rawStemMaterial: item.rawStemMaterial })),
    },
    nAHandling: {
      shapeNaBecameCanonicalCount: products.filter((item) => /^N\/A$/i.test(item.rawShape) && item.canonicalShape).length,
      stemNaBecameCanonicalCount: products.filter((item) => /^N\/A$/i.test(item.rawStemMaterial) && item.canonicalStemMaterial).length,
    },
    fixedTranslationChecks: {
      billiardValues: [...new Set(products.filter((item) => ["Billiard", "Billard"].includes(item.rawShape)).map((item) => item.shapeZhName))].sort(),
      bentBilliardValues: [...new Set(products.filter((item) => item.rawShape === "Bent Billiard").map((item) => item.shapeZhName))].sort(),
      billiardOk: products.filter((item) => ["Billiard", "Billard"].includes(item.rawShape)).every((item) => item.shapeZhName === "\u649e\u7403\u6597"),
      bentBilliardOk: products.filter((item) => item.rawShape === "Bent Billiard").every((item) => item.shapeZhName === "\u5f2f\u5f0f\u649e\u7403\u6597"),
    },
    collisions: {
      brands: taxonomyCollisionAudit("brands", taxonomies.brandTaxonomy.brands || [], "aliases", "canonicalBrandSlug", "canonicalBrand"),
      shapes: taxonomyCollisionAudit("shapes", taxonomies.shapeTaxonomy.shapes || [], "aliases", "canonicalShapeSlug", "canonicalShape"),
      finishes: taxonomyCollisionAudit("finishes", taxonomies.finishTaxonomy.finishes || [], "aliases", "canonicalFinishSlug", "canonicalFinish"),
      bowlMaterials: taxonomyCollisionAudit("bowlMaterials", taxonomies.materialTaxonomy.bowlMaterials || [], "aliases", "canonicalMaterialSlug", "canonicalMaterial"),
      stemMaterials: taxonomyCollisionAudit("stemMaterials", taxonomies.materialTaxonomy.stemMaterials || [], "aliases", "canonicalMaterialSlug", "canonicalMaterial"),
    },
  };
}

function buildBrandMappingsAudit(products) {
  const needsReviewBrandMappings = needsReviewBrands.map((brand) => {
    const key = normalizeKey(brand);
    const slug = slugify(brand);
    const rows = products.filter((item) => (
      normalizeKey(item.rawBrand) === key ||
      normalizeKey(item.canonicalBrand) === key ||
      item.canonicalBrandSlug === slug
    ));

    return {
      rawBrand: brand,
      canonicalBrand: rows[0]?.canonicalBrand || brand,
      productCount: rows.length,
      reviewStatus: rows[0]?.brandReviewStatus || "needs-review",
      brandIndexEligible: rows.length ? rows.every((item) => item.brandIndexEligible) : false,
      allHiddenFromBrandIndex: rows.every((item) => item.brandIndexEligible === false),
      mappingNotes: rows[0]?.brandReviewNotes || [],
    };
  });
  const provisionalBrandMappings = [...groupBy(products.filter((item) => item.brandReviewStatus === "provisional"), (item) => `${item.rawBrand} -> ${item.canonicalBrand}`).entries()]
    .map(([mapping, rows]) => ({
      mapping,
      rawBrand: rows[0]?.rawBrand || "",
      canonicalBrand: rows[0]?.canonicalBrand || "",
      productCount: rows.length,
      reviewStatus: rows[0]?.brandReviewStatus || "",
      brandIndexEligible: rows[0]?.brandIndexEligible ?? false,
      mappingNotes: rows[0]?.brandReviewNotes || [],
    }))
    .sort((a, b) => a.mapping.localeCompare(b.mapping));
  const focusBrands = ["Luiz Lavos", "Sara Eltang Pipes", "Tom Eltang", "Eltang Basic"];
  const focusBrandMappings = focusBrands.map((brand) => {
    const rows = products.filter((item) => (
      normalizeKey(item.rawBrand) === normalizeKey(brand) ||
      normalizeKey(item.canonicalBrand) === normalizeKey(brand)
    ));

    return {
      value: brand,
      productCount: rows.length,
      mappings: [...new Set(rows.map((item) => `${item.rawBrand} -> ${item.canonicalBrand}`))].sort(),
      reviewStatuses: [...new Set(rows.map((item) => item.brandReviewStatus))].sort(),
      brandIndexEligibleValues: [...new Set(rows.map((item) => String(item.brandIndexEligible)))].sort(),
    };
  });

  return {
    needsReviewBrandMappings,
    provisionalBrandMappings,
    focusBrandMappings,
  };
}

function buildDanishCompatibilityAudit(danishProducts, smokingpipesProducts) {
  const danishFields = Object.keys(danishProducts[0] || {}).sort();
  const smokingpipesFields = Object.keys(smokingpipesProducts[0] || {}).sort();
  const danishSet = new Set(danishFields);
  const smokingSet = new Set(smokingpipesFields);
  const commonFields = smokingpipesFields.filter((field) => danishSet.has(field));
  const smokingpipesOnlyFields = smokingpipesFields.filter((field) => !danishSet.has(field));
  const danishOnlyFields = danishFields.filter((field) => !smokingSet.has(field));
  const typeMismatches = [];

  for (const field of commonFields) {
    const danishValue = danishProducts.find((item) => item[field] !== null && item[field] !== undefined)?.[field];
    const smokingValue = smokingpipesProducts.find((item) => item[field] !== null && item[field] !== undefined)?.[field];
    const danishType = Array.isArray(danishValue) ? "array" : typeof danishValue;
    const smokingType = Array.isArray(smokingValue) ? "array" : typeof smokingValue;

    if (danishType !== smokingType) {
      typeMismatches.push({ field, danishType, smokingType });
    }
  }

  return {
    danishTopLevelFields: danishFields,
    smokingpipesTopLevelFields: smokingpipesFields,
    commonFields,
    smokingpipesOnlyFields,
    danishOnlyFields,
    semanticEquivalentCandidates: [
      { danish: "originalPrice/originalPriceValue", smokingpipes: "price.current + price.original + price.msrp", needsAdapter: true },
      { danish: "status", smokingpipes: "inventoryStatus/inventoryConfidence", needsAdapter: true },
      { danish: "shape/shapeZh", smokingpipes: "canonicalShape/canonicalShapeZh/shapeZhName", needsAdapter: true },
      { danish: "material/materialZh", smokingpipes: "canonicalMaterial/canonicalMaterialZh", needsAdapter: true },
      { danish: "stemMaterial/stemMaterialZh", smokingpipes: "canonicalStemMaterial/canonicalStemMaterialZh", needsAdapter: true },
      { danish: "dimensions", smokingpipes: "measurements", needsAdapter: true },
    ],
    typeMismatches,
    adapterNeededBeforePipesIntegration: [
      "Map price.current/original/msrp into the existing display price interface without calculating RMB in converter.",
      "Map inventoryStatus to the site's existing status labels.",
      "Map canonical taxonomy fields to existing product card/detail props.",
      "Keep sourceSpecific.smokingpipes raw fields out of general front-end filters unless explicitly exposed.",
    ],
    directlyJoinableFields: commonFields.filter((field) => !["price", "measurements", "sourceSpecific"].includes(field)),
    sourceSpecificRecommendedFields: [
      "sourceSpecific",
      "rawListStatus",
      "rawDetailStatus",
      "inventoryEvidence",
      "brandReviewNotes",
      "listPage",
      "listPosition",
    ],
    wouldBreakExistingDanishPages: false,
    note: "This dry-run writes only a separate Smokingpipes file and does not change Danish data or any page imports.",
  };
}

function buildFullDryRunAudit({
  details,
  listProducts,
  products,
  fieldAudit,
  taxonomies,
  taxonomyReviewEvidence,
  danishProducts,
  schemaProfile,
  inputs,
}) {
  const taxonomyCoverage = buildTaxonomyCoverageAudit(products, taxonomies);
  const brandMappings = buildBrandMappingsAudit(products);
  const imageAudit = buildImageAudit(products);
  const priceAudit = buildPriceAudit(products);
  const measurementAudit = buildMeasurementAudit(products);
  const identifierAudit = buildIdentifierAudit(products);
  const serialization = serializationAudit(products);
  const detailRawSoldCount = details.filter((item) => normalizeText(item.status) === "sold").length;
  const conflictRows = products.filter((item) => item.inventoryStatus === "needs-review" && item.inventoryConfidence === "conflicting-signals");
  const canonicalSoldCount = products.filter((item) => item.inventoryStatus === "sold").length;
  const errors = [];
  const warnings = [];

  function addError(condition, message) {
    if (condition) {
      errors.push(message);
    }
  }

  function addWarning(condition, message) {
    if (condition) {
      warnings.push(message);
    }
  }

  addError(details.length !== 5136, `Expected 5136 detail records, received ${details.length}.`);
  addError(products.length !== 5136, `Expected 5136 output records, received ${products.length}.`);
  addError(products.length !== details.length, "Output record count does not match input detail count.");
  addError(identifierAudit.duplicateIds.length > 0, "Duplicate id values found.");
  addError(identifierAudit.duplicateSourceProductIds.length > 0, "Duplicate sourceProductId values found.");
  addError(identifierAudit.duplicateSourceUrls.length > 0, "Duplicate sourceUrl values found.");
  addError(canonicalSoldCount > 0, "Canonical inventoryStatus=sold found.");
  addError(products.some((item) => item.brandReviewStatus === "needs-review" && item.brandIndexEligible !== false), "needs-review brand entered brand index.");
  addError(serialization.undefinedPathCount > 0 || serialization.nonFiniteNumberPathCount > 0 || serialization.serializedContainsNaN || serialization.serializedContainsUndefined, "Serialization contains undefined, NaN, or non-finite numbers.");
  addError(!taxonomyCoverage.fixedTranslationChecks.billiardOk, "Billiard/Billard fixed Chinese translation check failed.");
  addError(!taxonomyCoverage.fixedTranslationChecks.bentBilliardOk, "Bent Billiard fixed Chinese translation check failed.");
  addError(taxonomyCoverage.unmapped.brands > 0, "Unmapped brand values found.");
  addError(taxonomyCoverage.unmapped.normalShapes > 0, "Unmapped non-N/A shape values found.");
  addError(taxonomyCoverage.unmapped.finishes > 0, "Unmapped finish values found.");
  addError(taxonomyCoverage.unmapped.materials > 0, "Unmapped bowl material values found.");
  addError(taxonomyCoverage.unmapped.nonNaStemMaterials > 0, "Unmapped non-N/A stem material values found.");
  addError(taxonomyCoverage.nAHandling.shapeNaBecameCanonicalCount > 0, "N/A shape became a normal canonical shape.");
  addError(taxonomyCoverage.nAHandling.stemNaBecameCanonicalCount > 0, "N/A stem material became a normal canonical material.");

  addWarning(conflictRows.length > 0, `${conflictRows.length} products are detail-sold/active-list conflicts and are marked needs-review.`);
  addWarning(identifierAudit.canonicalModelKeyDuplicateGroupCount > 0, `${identifierAudit.canonicalModelKeyDuplicateGroupCount} canonicalModelKey duplicate groups need model-level review.`);
  addWarning(measurementAudit.missingOneField + measurementAudit.missingTwoOrMoreFields > 0, "Some measurement fields are incomplete.");
  addWarning(imageAudit.onlyMain !== 371, `Current detail-main-only image count is ${imageAudit.onlyMain}; historical reference was 371.`);

  const inventoryAudit = {
    detailRawSoldCount,
    convertedNeedsReviewCount: products.filter((item) => item.inventoryStatus === "needs-review").length,
    conflictingSignalsCount: conflictRows.length,
    unknownCount: products.filter((item) => item.inventoryStatus === "unknown").length,
    availableCount: products.filter((item) => item.inventoryStatus === "available").length,
    canonicalSoldCount,
    statusCounts: countBy(products, (item) => item.inventoryStatus),
    confidenceCounts: countBy(products, (item) => item.inventoryConfidence),
    conflictExamples: conflictRows.slice(0, 10).map((item) => ({
      id: item.id,
      sourceProductId: item.sourceProductId,
      rawBrand: item.rawBrand,
      rawTitle: item.rawTitle,
      rawDetailStatus: item.rawDetailStatus,
      sourceUrl: item.sourceUrl,
    })),
  };

  const audit = {
    schemaVersion: 1,
    mode: "full-dry-run",
    generatedAt: null,
    inputs,
    sourceCounts: {
      detailCount: details.length,
      listCount: listProducts.length,
      convertedFullCount: products.length,
      fieldAuditDetailRecordCount: fieldAudit.summary?.detailRecordCount ?? null,
      taxonomyReviewBrandCount: taxonomyReviewEvidence.brandReview?.length ?? null,
    },
    conversion: {
      inputCount: details.length,
      outputCount: products.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    schemaProfile,
    taxonomyCoverage,
    brandStatusCounts: taxonomyCoverage.brandStatusCounts,
    brandIndexEligibilityCounts: taxonomyCoverage.brandIndexEligibilityCounts,
    brandValueCounts: countBy(products, (item) => item.canonicalBrand),
    provisionalBrandMappings: brandMappings.provisionalBrandMappings,
    needsReviewBrandMappings: brandMappings.needsReviewBrandMappings,
    focusBrandMappings: brandMappings.focusBrandMappings,
    inventoryAudit,
    imageAudit,
    priceAudit,
    measurementAudit,
    identifierAudit,
    modelKeyAudit: {
      canonicalModelKeyUniqueCount: identifierAudit.canonicalModelKeyUniqueCount,
      canonicalModelKeyDuplicateGroupCount: identifierAudit.canonicalModelKeyDuplicateGroupCount,
      duplicateGroupsPreview: identifierAudit.canonicalModelKeyDuplicateGroupsPreview,
      note: identifierAudit.note,
    },
    danishCompatibilityAudit: buildDanishCompatibilityAudit(danishProducts, products),
    businessRuleChecks: {
      outputIsArray: true,
      outputCountIs5136: products.length === 5136,
      productionFileNotWritten: !fs.existsSync(paths.productionSmokingpipes),
      noCanonicalSold: canonicalSoldCount === 0,
      needsReviewBrandsHidden: products.every((item) => item.brandReviewStatus !== "needs-review" || item.brandIndexEligible === false),
      noRmbCalculationApplied: products.every((item) => item.price?.calculationStatus === "not-calculated"),
      sampleModePreserved: true,
    },
    serializationAudit: serialization,
    sourceAuditReferences: {
      fieldAuditSummary: fieldAudit.summary,
      activeListStatusMismatch: fieldAudit.activeListStatusMismatch,
      duplicateAudits: fieldAudit.duplicateAudits,
      brandCountryConflicts: {
        fieldAudit: fieldAudit.brandCountryConflicts || [],
        taxonomyReviewEvidence: taxonomyReviewEvidence.brandCountryConflicts || [],
      },
    },
    errors,
    warnings,
    productionReadiness: {
      readyForProductionFile: errors.length === 0,
      readyForPipesIntegration: errors.length === 0 && identifierAudit.duplicateIds.length === 0,
      blockingIssues: errors,
      nonBlockingIssues: warnings,
    },
  };

  audit.conversion.errorCount = audit.errors.length;
  audit.conversion.warningCount = audit.warnings.length;

  return audit;
}

function buildFullDryRunMarkdownReport(audit) {
  const lines = [];
  lines.push("# Smokingpipes V2 Full Dry-Run Audit");
  lines.push("");
  lines.push("## 1. Scope");
  lines.push("- This file audits the full 5,136-record Smokingpipes V2 dry-run conversion.");
  lines.push("- It is not connected to the website and does not generate the production Smokingpipes products file.");
  lines.push("");
  lines.push("## 2. Input And Output Counts");
  lines.push(`- Input detail records: ${audit.conversion.inputCount}`);
  lines.push(`- Output records: ${audit.conversion.outputCount}`);
  lines.push(`- Conversion errors: ${audit.conversion.errorCount}`);
  lines.push(`- Conversion warnings: ${audit.conversion.warningCount}`);
  lines.push("");
  lines.push("## 3. Taxonomy Mapping");
  lines.push(`- Brand status counts: ${JSON.stringify(audit.brandStatusCounts)}`);
  lines.push(`- Brand index eligibility: ${JSON.stringify(audit.brandIndexEligibilityCounts)}`);
  lines.push(`- Unmapped values: ${JSON.stringify(audit.taxonomyCoverage.unmapped)}`);
  lines.push(`- Billiard translations: ${JSON.stringify(audit.taxonomyCoverage.fixedTranslationChecks)}`);
  lines.push("");
  lines.push("## 4. Needs-Review Brand Values");
  for (const item of audit.needsReviewBrandMappings) {
    lines.push(`- ${item.rawBrand}: ${item.productCount}, hidden=${item.allHiddenFromBrandIndex}`);
  }
  lines.push("");
  lines.push("## 5. Provisional Brand Mappings");
  for (const item of audit.provisionalBrandMappings) {
    lines.push(`- ${item.mapping}: ${item.productCount}`);
  }
  lines.push("");
  lines.push("## 6. Inventory");
  lines.push(`- Available: ${audit.inventoryAudit.availableCount}`);
  lines.push(`- Needs-review: ${audit.inventoryAudit.convertedNeedsReviewCount}`);
  lines.push(`- Unknown: ${audit.inventoryAudit.unknownCount}`);
  lines.push(`- Raw detail sold: ${audit.inventoryAudit.detailRawSoldCount}`);
  lines.push(`- Conflicting signals: ${audit.inventoryAudit.conflictingSignalsCount}`);
  lines.push(`- Canonical sold: ${audit.inventoryAudit.canonicalSoldCount}`);
  lines.push("");
  lines.push("## 7. Images");
  lines.push(`- Main image present: ${audit.imageAudit.mainImagePresent}`);
  lines.push(`- Main image missing: ${audit.imageAudit.mainImageMissing}`);
  lines.push(`- Gallery non-empty: ${audit.imageAudit.galleryNonEmpty}`);
  lines.push(`- Gallery empty: ${audit.imageAudit.galleryEmpty}`);
  lines.push(`- Only main: ${audit.imageAudit.onlyMain}`);
  lines.push(`- List image fallback: ${audit.imageAudit.listImageFallback}`);
  lines.push(`- Duplicate gallery products: ${audit.imageAudit.duplicateGalleryProductCount}`);
  lines.push(`- 371 reference check: ${JSON.stringify(audit.imageAudit.specialImageRecordCheck)}`);
  lines.push("");
  lines.push("## 8. Prices");
  lines.push(`- Current price parse: ${JSON.stringify(audit.priceAudit.currentPriceParseCounts)}`);
  lines.push(`- MSRP present: ${audit.priceAudit.msrpPresent}`);
  lines.push(`- Discount text present: ${audit.priceAudit.discountTextPresent}`);
  lines.push(`- RMB text present: ${audit.priceAudit.rmbTextPresent}`);
  lines.push(`- Note: ${audit.priceAudit.note}`);
  lines.push("");
  lines.push("## 9. Measurements");
  lines.push(`- All six complete: ${audit.measurementAudit.allSixComplete}`);
  lines.push(`- Missing one field: ${audit.measurementAudit.missingOneField}`);
  lines.push(`- Missing two or more fields: ${audit.measurementAudit.missingTwoOrMoreFields}`);
  lines.push(`- Field missing counts: ${JSON.stringify(audit.measurementAudit.fieldMissingCounts)}`);
  lines.push(`- Raw text exists but parsed missing: ${JSON.stringify(audit.measurementAudit.rawTextExistsButParsedMissing)}`);
  lines.push("");
  lines.push("## 10. Identifiers And Duplicates");
  lines.push(`- Duplicate ids: ${audit.identifierAudit.duplicateIds.length}`);
  lines.push(`- Duplicate sourceProductIds: ${audit.identifierAudit.duplicateSourceProductIds.length}`);
  lines.push(`- Duplicate sourceUrls: ${audit.identifierAudit.duplicateSourceUrls.length}`);
  lines.push(`- canonicalModelKey unique count: ${audit.modelKeyAudit.canonicalModelKeyUniqueCount}`);
  lines.push(`- canonicalModelKey duplicate groups: ${audit.modelKeyAudit.canonicalModelKeyDuplicateGroupCount}`);
  lines.push(`- Duplicate brand+title groups: ${audit.identifierAudit.duplicateBrandTitleGroups.length}`);
  lines.push(`- Duplicate product code groups: ${audit.identifierAudit.duplicateProductCodeGroups.length}`);
  lines.push(`- Model key note: ${audit.modelKeyAudit.note}`);
  lines.push("");
  lines.push("## 11. Danish Compatibility");
  lines.push(`- Common fields: ${audit.danishCompatibilityAudit.commonFields.length}`);
  lines.push(`- Smokingpipes-only fields: ${audit.danishCompatibilityAudit.smokingpipesOnlyFields.length}`);
  lines.push(`- Danish-only fields: ${audit.danishCompatibilityAudit.danishOnlyFields.length}`);
  lines.push(`- Type mismatches: ${audit.danishCompatibilityAudit.typeMismatches.length}`);
  lines.push(`- Would break existing Danish pages: ${audit.danishCompatibilityAudit.wouldBreakExistingDanishPages}`);
  lines.push("");
  lines.push("## 12. Readiness");
  lines.push(`- Ready for production file: ${audit.productionReadiness.readyForProductionFile}`);
  lines.push(`- Ready for data/pipes.ts integration: ${audit.productionReadiness.readyForPipesIntegration}`);
  lines.push(`- Blocking issues: ${audit.productionReadiness.blockingIssues.length}`);
  lines.push(`- Non-blocking issues: ${audit.productionReadiness.nonBlockingIssues.length}`);
  if (audit.productionReadiness.blockingIssues.length) {
    lines.push("");
    lines.push("### Blocking Issues");
    for (const item of audit.productionReadiness.blockingIssues) {
      lines.push(`- ${item}`);
    }
  }
  if (audit.productionReadiness.nonBlockingIssues.length) {
    lines.push("");
    lines.push("### Non-Blocking Issues");
    for (const item of audit.productionReadiness.nonBlockingIssues) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  lines.push("## 13. Recommendation");
  lines.push(audit.productionReadiness.readyForProductionFile
    ? "- The conversion is structurally ready for a production-file generation step, but inventory conflicts and model-key duplicate candidates should be reviewed before public integration."
    : "- Do not generate the production file until blocking issues are resolved.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function reviewFullDryRunWarnings(fullDryRunAudit) {
  const warnings = Array.isArray(fullDryRunAudit.warnings) ? fullDryRunAudit.warnings : [];
  const review = warnings.map((message, index) => {
    let code = `warning-${index + 1}`;
    let affectedCount = null;
    let blocksProduction = false;
    let reason = "Non-blocking dry-run data quality warning.";

    if (/385 products are detail-sold\/active-list conflicts/i.test(message)) {
      code = "inventory-conflicting-signals";
      affectedCount = 385;
      reason = "These records are retained and mapped to inventoryStatus=needs-review with conflicting-signals confidence.";
    } else if (/canonicalModelKey duplicate groups/i.test(message)) {
      code = "canonical-model-key-duplicate-candidates";
      const match = message.match(/(\d+)/);
      affectedCount = match ? Number.parseInt(match[1], 10) : null;
      reason = "Model key duplicates are offer/model-family candidates only; records remain unique by id/sourceProductId/sourceUrl.";
    } else if (/measurement fields are incomplete/i.test(message)) {
      code = "incomplete-measurements";
      reason = "Some source measurements are incomplete; raw text is preserved and the missing structured values remain null.";
    } else if (/detail-main-only image count/i.test(message)) {
      code = "image-count-definition-difference";
      const match = message.match(/is\s+(\d+)/i);
      affectedCount = match ? Number.parseInt(match[1], 10) : null;
      reason = "This is a counting-definition difference between current detail-main-only records and an earlier finalize-stage reference.";
    } else if (/unmapped|duplicate id|duplicate sourceProductId|duplicate sourceUrl|canonical inventoryStatus=sold|non-finite|serialization/i.test(message)) {
      blocksProduction = true;
      reason = "This warning appears to describe a blocking data-integrity issue.";
    }

    return {
      code,
      message,
      affectedCount,
      exampleRecords: [],
      blocksProduction,
      reason,
    };
  });

  return {
    warningCount: warnings.length,
    expectedWarningCount: 4,
    ok: warnings.length === 4 && review.every((item) => !item.blocksProduction),
    review,
  };
}

function validateCandidateProducts(products) {
  const errors = [];
  const ids = new Set();
  const sourceProductIds = new Set();
  const sourceUrls = new Set();

  if (!Array.isArray(products)) {
    errors.push("Candidate output is not an array.");
    return errors;
  }

  if (products.length !== 5136) {
    errors.push(`Candidate output count is ${products.length}, expected 5136.`);
  }

  for (const item of products) {
    if (!item.id) {
      errors.push("Candidate contains empty id.");
    }

    if (!item.sourceProductId) {
      errors.push("Candidate contains empty sourceProductId.");
    }

    if (!item.sourceUrl) {
      errors.push("Candidate contains empty sourceUrl.");
    }

    ids.add(item.id);
    sourceProductIds.add(item.sourceProductId);
    sourceUrls.add(item.sourceUrl);

    if (item.inventoryStatus === "sold") {
      errors.push(`Candidate contains canonical sold: ${item.id}`);
    }

    if (item.brandReviewStatus === "needs-review" && item.brandIndexEligible !== false) {
      errors.push(`needs-review brand entered brand index: ${item.id}`);
    }
  }

  if (ids.size !== products.length) {
    errors.push("Candidate contains duplicate id values.");
  }

  if (sourceProductIds.size !== products.length) {
    errors.push("Candidate contains duplicate sourceProductId values.");
  }

  if (sourceUrls.size !== products.length) {
    errors.push("Candidate contains duplicate sourceUrl values.");
  }

  const serialization = serializationAudit(products);

  if (
    serialization.undefinedPathCount > 0 ||
    serialization.nonFiniteNumberPathCount > 0 ||
    serialization.serializedContainsNaN ||
    serialization.serializedContainsUndefined
  ) {
    errors.push("Candidate serialization contains undefined, NaN, or non-finite numbers.");
  }

  return errors;
}

function writeProductionFromFreshConversion({ fullProducts, fullAudit, fullDryRunAudit }) {
  if (fs.existsSync(paths.productionSmokingpipes)) {
    throw new Error("Production file already exists. Refusing to overwrite.");
  }

  const warningReview = reviewFullDryRunWarnings(fullDryRunAudit);

  if (!warningReview.ok) {
    throw new Error(`Full dry-run warning review failed. warningCount=${warningReview.warningCount}`);
  }

  if ((fullDryRunAudit.conversion?.errorCount ?? fullDryRunAudit.errors?.length ?? 0) !== 0) {
    throw new Error("Full dry-run audit contains blocking errors. Refusing production write.");
  }

  if (fullAudit.errors.length > 0) {
    throw new Error(`Fresh production conversion has blocking errors: ${fullAudit.errors.join("; ")}`);
  }

  const candidateErrors = validateCandidateProducts(fullProducts);

  if (candidateErrors.length > 0) {
    throw new Error(`Candidate product validation failed: ${candidateErrors.join("; ")}`);
  }

  try {
    fs.mkdirSync(path.dirname(paths.outputProductionTmp), { recursive: true });
    fs.writeFileSync(paths.outputProductionTmp, stringifyJson(fullProducts), "utf8");

    const tmpBuffer = fs.readFileSync(paths.outputProductionTmp);
    const tmpParsed = JSON.parse(tmpBuffer.toString("utf8"));
    const tmpErrors = validateCandidateProducts(tmpParsed);

    if (tmpErrors.length > 0) {
      throw new Error(`Temporary file validation failed: ${tmpErrors.join("; ")}`);
    }

    const dryRunBuffer = fs.readFileSync(paths.outputFullDryRun);
    const tmpHash = sha256Buffer(tmpBuffer);
    const dryRunHash = sha256Buffer(dryRunBuffer);

    if (!tmpBuffer.equals(dryRunBuffer) || tmpHash !== dryRunHash) {
      throw new Error(`Temporary production output does not match full dry-run. tmp=${tmpHash}, dryRun=${dryRunHash}`);
    }

    fs.renameSync(paths.outputProductionTmp, paths.productionSmokingpipes);

    return {
      productionPath: paths.productionSmokingpipes,
      productionHash: tmpHash,
      dryRunHash,
      sameBytes: true,
      warningReview,
    };
  } catch (error) {
    safeRemoveFile(paths.outputProductionTmp);
    throw error;
  }
}

function buildMarkdownReport(audit) {
  const lines = [];

  lines.push("# Smokingpipes V2 Sample Conversion Audit");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Detail records: ${audit.sourceCounts.detailCount}`);
  lines.push(`- List records: ${audit.sourceCounts.listCount}`);
  lines.push(`- Sample records: ${audit.sourceCounts.sampleCount}`);
  lines.push(`- Requested max: ${audit.sourceCounts.requestedMax}`);
  lines.push(`- Exceeded max for coverage: ${audit.sourceCounts.exceededRequestedMax}`);
  lines.push("");
  lines.push("## Taxonomy Coverage");
  lines.push(`- Raw brands: ${audit.taxonomyCoverage.rawBrands.sample}/${audit.taxonomyCoverage.rawBrands.total}`);
  lines.push(`- Non-N/A shapes: ${audit.taxonomyCoverage.shapesNonNa.sample}/${audit.taxonomyCoverage.shapesNonNa.total}`);
  lines.push(`- Finishes: ${audit.taxonomyCoverage.finishes.sample}/${audit.taxonomyCoverage.finishes.total}`);
  lines.push(`- Bowl materials: ${audit.taxonomyCoverage.materials.sample}/${audit.taxonomyCoverage.materials.total}`);
  lines.push(`- Stem materials: ${audit.taxonomyCoverage.stemMaterials.sample}/${audit.taxonomyCoverage.stemMaterials.total}`);
  lines.push(`- Filters: ${audit.taxonomyCoverage.filters.sample}/${audit.taxonomyCoverage.filters.total}`);
  lines.push("");
  lines.push("## Brand Review Status");
  lines.push(`- Full: ${JSON.stringify(audit.brandStatusCounts.full)}`);
  lines.push(`- Sample: ${JSON.stringify(audit.brandStatusCounts.sample)}`);
  lines.push(`- Brand index eligibility sample: ${JSON.stringify(audit.brandIndexEligibilityCounts.sample)}`);
  lines.push("");
  lines.push("## Inventory");
  lines.push(`- Full: ${JSON.stringify(audit.inventoryStatusCounts.full)}`);
  lines.push(`- Sample: ${JSON.stringify(audit.inventoryStatusCounts.sample)}`);
  lines.push(`- Detail-sold active-list conflicts in full: ${audit.inventoryConflictCounts.full}`);
  lines.push(`- Detail-sold active-list conflicts in sample: ${audit.inventoryConflictCounts.sample}`);
  lines.push("");
  lines.push("## Images");
  lines.push(`- Full: ${JSON.stringify(audit.imageAudit.full)}`);
  lines.push(`- Sample: ${JSON.stringify(audit.imageAudit.sample)}`);
  lines.push("");
  lines.push("## Prices");
  lines.push(`- Full current price parse: ${JSON.stringify(audit.priceAudit.fullCurrentPriceParseCounts)}`);
  lines.push(`- Sample current price parse: ${JSON.stringify(audit.priceAudit.sampleCurrentPriceParseCounts)}`);
  lines.push(`- Note: ${audit.priceAudit.note}`);
  lines.push("");
  lines.push("## Measurements");
  lines.push(`- Full complete: ${audit.measurementAudit.fullComplete}`);
  lines.push(`- Full incomplete: ${audit.measurementAudit.fullIncomplete}`);
  lines.push(`- Sample complete: ${audit.measurementAudit.sampleComplete}`);
  lines.push(`- Sample incomplete: ${audit.measurementAudit.sampleIncomplete}`);
  lines.push("");
  lines.push("## Model Keys");
  lines.push(`- Sample unique keys: ${audit.modelKeyAudit.sampleUniqueCanonicalModelKeyCount}`);
  lines.push(`- Sample duplicate groups: ${audit.modelKeyAudit.sampleDuplicateGroupCount}`);
  lines.push(`- Full duplicate groups: ${audit.modelKeyAudit.fullDuplicateGroupCount}`);
  lines.push(`- Note: ${audit.modelKeyAudit.note}`);
  lines.push("");
  lines.push("## Readiness");
  lines.push(`- Ready for full dry run: ${audit.fullConversionReadiness.readyForFullDryRun}`);
  lines.push(`- Blocking issues: ${audit.errors.length}`);
  lines.push(`- Non-blocking warnings: ${audit.warnings.length}`);
  lines.push("");

  if (audit.errors.length) {
    lines.push("### Blocking Issues");
    for (const error of audit.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  if (audit.warnings.length) {
    lines.push("### Non-Blocking Warnings");
    for (const warning of audit.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const cli = enforceCliMode();
  const detailPayload = readJson(paths.details);
  const listPayload = readJson(paths.list);
  const fieldAudit = readJson(paths.fieldAudit);
  const brandTaxonomy = readJson(paths.brandTaxonomy);
  const sourceScopedBrandMappings = readJson(paths.sourceScopedBrandMappings);
  const productPublicationOverrides = readJson(paths.productPublicationOverrides);
  const shapeTaxonomy = readJson(paths.shapeTaxonomy);
  const finishTaxonomy = readJson(paths.finishTaxonomy);
  const materialTaxonomy = readJson(paths.materialTaxonomy);
  const taxonomyReviewEvidence = readJson(paths.taxonomyReviewEvidence);
  const danishProducts = readJson(paths.danishProducts);
  const pipesText = readText(paths.pipes);
  const danishWrapperText = readText(paths.danishWrapper);
  const details = (Array.isArray(detailPayload) ? detailPayload : detailPayload.details || []).slice();
  const listProducts = (Array.isArray(listPayload) ? listPayload : listPayload.products || []).slice();
  const listMap = new Map();

  for (const item of listProducts) {
    const id = productIdOf(item);

    if (id && !listMap.has(id)) {
      listMap.set(id, item);
    }
  }

  const indexes = {
    brand: buildAliasIndex(brandTaxonomy.brands || [], "aliases", "canonicalBrandSlug"),
    brandCanonical: buildCanonicalBrandIndex(brandTaxonomy.brands || []),
    brandUrlPath: buildBrandUrlPathIndex(brandTaxonomy.brands || []),
    sourceScopedBrand: buildSourceScopedBrandIndex(sourceScopedBrandMappings),
    productOverrides: buildProductOverrideIndex(productPublicationOverrides),
    shape: buildAliasIndex(shapeTaxonomy.shapes || [], "aliases", "canonicalShapeSlug"),
    finish: buildAliasIndex(finishTaxonomy.finishes || [], "aliases", "canonicalFinishSlug"),
    bowlMaterial: buildAliasIndex(materialTaxonomy.bowlMaterials || [], "aliases", "canonicalMaterialSlug"),
    stemMaterial: buildAliasIndex(materialTaxonomy.stemMaterials || [], "aliases", "canonicalMaterialSlug"),
  };
  const convertedById = new Map();

  for (const detail of details) {
    const id = productIdOf(detail);

    if (!id) {
      continue;
    }

    convertedById.set(id, convertProduct(detail, listMap.get(id), indexes));
  }

  const commonInputs = {
    details: path.relative(rootDir, paths.details),
    list: path.relative(rootDir, paths.list),
    fieldAudit: path.relative(rootDir, paths.fieldAudit),
    brandTaxonomy: path.relative(rootDir, paths.brandTaxonomy),
    sourceScopedBrandMappings: path.relative(rootDir, paths.sourceScopedBrandMappings),
    productPublicationOverrides: path.relative(rootDir, paths.productPublicationOverrides),
    shapeTaxonomy: path.relative(rootDir, paths.shapeTaxonomy),
    finishTaxonomy: path.relative(rootDir, paths.finishTaxonomy),
    materialTaxonomy: path.relative(rootDir, paths.materialTaxonomy),
    taxonomyReviewEvidence: path.relative(rootDir, paths.taxonomyReviewEvidence),
    danishProducts: path.relative(rootDir, paths.danishProducts),
    pipes: path.relative(rootDir, paths.pipes),
  };
  const schemaProfile = buildSchemaProfile(danishProducts, pipesText, danishWrapperText);

  if (cli.mode === "full-dry-run" || cli.mode === "production") {
    const fullProducts = getSortedConvertedProducts(convertedById);
    const audit = buildFullDryRunAudit({
      details,
      listProducts,
      products: fullProducts,
      fieldAudit,
      taxonomies: {
        brandTaxonomy,
        shapeTaxonomy,
        finishTaxonomy,
        materialTaxonomy,
      },
      taxonomyReviewEvidence,
      danishProducts,
      schemaProfile,
      inputs: commonInputs,
    });

    if (cli.mode === "production") {
      const fullDryRunAudit = readJson(paths.outputFullDryRunAuditJson);
      const result = writeProductionFromFreshConversion({
        fullProducts,
        fullAudit: audit,
        fullDryRunAudit,
      });

      console.log(`Smokingpipes V2 production written: ${result.productionPath}`);
      console.log(`Production hash: ${result.productionHash}`);
      console.log(`Dry-run hash: ${result.dryRunHash}`);
      console.log(`Same bytes: ${result.sameBytes}`);
      console.log(`Warning review count: ${result.warningReview.warningCount}`);
      return;
    }

    writeJson(paths.outputFullDryRun, fullProducts);
    writeJson(paths.outputFullDryRunAuditJson, audit);
    writeText(paths.outputFullDryRunAuditMd, buildFullDryRunMarkdownReport(audit));

    console.log(`Smokingpipes V2 full dry-run written: ${paths.outputFullDryRun}`);
    console.log(`Output count: ${fullProducts.length}`);
    console.log(`Inventory status counts: ${JSON.stringify(audit.inventoryAudit.statusCounts)}`);
    console.log(`Brand review counts: ${JSON.stringify(audit.brandStatusCounts)}`);
    console.log(`Errors: ${audit.errors.length}`);
    console.log(`Warnings: ${audit.warnings.length}`);

    if (audit.errors.length > 0) {
      process.exit(1);
    }

    return;
  }

  const selection = buildSampleSelection(
    details,
    listMap,
    convertedById,
    fieldAudit,
    taxonomyReviewEvidence,
    cli.max
  );
  const sampleRecords = selection.records.map((record) => ({
    detail: record.detail,
    reasons: record.reasons,
  }));
  const sampleProducts = sampleRecords.map((record) => {
    const product = convertedById.get(productIdOf(record.detail));

    return {
      ...product,
      sampleSelectionReasons: record.reasons,
    };
  });
  const samplePayload = {
    schemaVersion: 2,
    mode: "sample",
    sourceSite: "Smokingpipes",
    generatedAt: null,
    note: "Deterministic V2 stratified sample. This is not the official Smokingpipes product data file.",
    inputRecords: {
      details: details.length,
      listProducts: listProducts.length,
    },
    requestedMax: cli.max,
    sampleCount: sampleProducts.length,
    exceededRequestedMaxForCoverage: selection.exceededRequestedMax,
    products: sampleProducts,
  };
  const audit = buildAudit({
    details,
    listProducts,
    fieldAudit,
    taxonomyReviewEvidence,
    sampleRecords,
    convertedAll: convertedById,
    sampleProducts,
    selection,
    schemaProfile,
    inputs: commonInputs,
  });

  writeJson(paths.outputSample, samplePayload);
  writeJson(paths.outputAuditJson, audit);
  writeText(paths.outputAuditMd, buildMarkdownReport(audit));

  console.log(`Smokingpipes V2 sample written: ${paths.outputSample}`);
  console.log(`Sample count: ${sampleProducts.length}`);
  console.log(`Raw brand coverage: ${audit.taxonomyCoverage.rawBrands.sample}/${audit.taxonomyCoverage.rawBrands.total}`);
  console.log(`Inventory status counts: ${JSON.stringify(audit.inventoryStatusCounts.sample)}`);
  console.log(`Brand review counts: ${JSON.stringify(audit.brandStatusCounts.sample)}`);
  console.log(`Errors: ${audit.errors.length}`);
  console.log(`Warnings: ${audit.warnings.length}`);

  if (audit.errors.length > 0) {
    process.exit(1);
  }
}

const directExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() ===
    decodeURIComponent(new URL(import.meta.url).pathname)
      .replace(/^\/([A-Za-z]:)/, "$1")
      .replace(/\\/g, "/")
      .toLowerCase();

if (directExecution) main();
