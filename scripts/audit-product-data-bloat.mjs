import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const productsPath = path.join(rootDir, "data", "danish-products.ts");
const productsJsonPath = path.join(rootDir, "data", "products", "danish-products.json");
const outputPath = path.join(rootDir, "data", "product-data-audit.json");

const PRODUCTION_NEEDED_FIELDS = [
  "id",
  "name",
  "nameZh",
  "brand",
  "brandZh",
  "brandCountry",
  "brandCountryEn",
  "source",
  "sourceUrl",
  "status",
  "condition",
  "conditionType",
  "conditionLabel",
  "originalPrice",
  "originalPriceValue",
  "imageUrl",
  "detailImageUrl",
  "galleryImages",
  "galleryCount",
  "shape",
  "shapeZh",
  "bendType",
  "finish",
  "finishZh",
  "material",
  "materialZh",
  "stemMaterial",
  "stemMaterialZh",
  "grainPattern",
  "grainPatternZh",
  "engineeringFeature",
  "engineeringFeatureZh",
  "weightGrams",
  "dimensions",
  "tags",
  "updatedAt",
];

const RAW_ARCHIVE_ONLY_FIELDS = [
  "rawText",
  "v17",
  "rawGalleryImages",
  "stableFieldReport",
  "missingFields",
  "optionalMissingFields",
  "imageMatchNotes",
  "conditionNotes",
  "imageMatchStatus",
  "qualityWarnings",
  "estimatedCny",
  "estimatedCnyValue",
  "detailBodyTextStart",
  "detailImageDebug",
  "detailGalleryImages",
  "detailSpecsText",
];

function findMatchingBracket(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractExportedArray(text, exportName) {
  const exportIndex = text.indexOf(`export const ${exportName}`);
  const assignmentIndex = text.indexOf("=", exportIndex);
  const startIndex = text.indexOf("[", assignmentIndex);
  const endIndex = findMatchingBracket(text, startIndex, "[", "]");

  if (exportIndex < 0 || startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not extract ${exportName}.`);
  }

  return text.slice(startIndex, endIndex + 1);
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function fieldContributionBytes(fieldName, value) {
  return Math.max(0, Buffer.byteLength(JSON.stringify({ [fieldName]: value }), "utf8") - 2);
}

function formatMb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(3));
}

function formatKb(bytes) {
  return Number((bytes / 1024).toFixed(3));
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePriceNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  let numeric = value
    .replace(/[^\d,.-]/g, "")
    .replace(/,-$/, ",00")
    .replace(/\.-$/, ".00")
    .replace(/-/g, "");

  if (!numeric) return null;

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    numeric =
      lastComma > lastDot
        ? numeric.replace(/\./g, "").replace(",", ".")
        : numeric.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = numeric.split(",");
    const decimalPart = parts[parts.length - 1] || "";
    numeric =
      parts.length === 2 && decimalPart.length > 0 && decimalPart.length <= 2
        ? numeric.replace(",", ".")
        : numeric.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractProductIdFromUrl(value) {
  const match = String(value || "").match(/-i(\d+)\.html/i);
  return match ? match[1] : "";
}

function getProductId(product) {
  return String(
    product.id ||
      extractProductIdFromUrl(
        product.sourceUrl || product.originalUrl || product.href || product.detailPageUrl
      ) ||
      ""
  );
}

function getSourceUrl(product) {
  return String(product.sourceUrl || product.originalUrl || product.href || product.detailPageUrl || "");
}

function getFirstImage(product) {
  return String(product.imageUrl || product.detailImageUrl || product.galleryImages?.[0] || "");
}

function getFirstImageId(product) {
  const image = getFirstImage(product);
  const imageIdMatch = image.match(/img-(\d+)/i);
  if (imageIdMatch) return imageIdMatch[1];
  return normalizeText(image).slice(0, 160);
}

function getGallerySignature(product) {
  const images = Array.isArray(product.galleryImages) ? product.galleryImages : [];
  return images.map(String).filter(Boolean).join("|");
}

function productSummary(product) {
  return {
    id: getProductId(product),
    name: product.name || "",
    brand: product.brand || product.canonicalBrand || "",
    sourceUrl: getSourceUrl(product),
    price: product.price || product.originalPrice || "",
  };
}

function addDuplicateGroups(groups, duplicateType, confidence, grouped) {
  for (const [key, products] of grouped.entries()) {
    if (!key || products.length < 2) continue;

    groups.push({
      duplicateType,
      confidence,
      key,
      count: products.length,
      products: products.map(productSummary),
    });
  }
}

function groupBy(products, keyGetter) {
  const grouped = new Map();

  for (const product of products) {
    const key = keyGetter(product);
    if (!key) continue;

    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(product);
  }

  return grouped;
}

function findDuplicateGroups(products) {
  const groups = [];

  addDuplicateGroups(
    groups,
    "sourceUrlOrOriginalUrlExact",
    "high",
    groupBy(products, getSourceUrl)
  );

  addDuplicateGroups(
    groups,
    "sourceAndSourceProductIdExact",
    "high",
    groupBy(products, (product) => {
      const sourceProductId =
        product.sourceProductId ||
        product.productCode ||
        extractProductIdFromUrl(getSourceUrl(product));
      return sourceProductId ? `${normalizeText(product.source)}|${sourceProductId}` : "";
    })
  );

  addDuplicateGroups(
    groups,
    "normalizedBrandAndEnglishName",
    "medium",
    groupBy(products, (product) => `${normalizeText(product.brand)}|${normalizeText(product.name)}`)
  );

  addDuplicateGroups(
    groups,
    "normalizedBrandPriceAndFirstImageId",
    "medium",
    groupBy(products, (product) => {
      const price = product.originalPriceValue ?? parsePriceNumber(product.price || product.originalPrice);
      const imageId = getFirstImageId(product);
      return price && imageId ? `${normalizeText(product.brand)}|${price}|${imageId}` : "";
    })
  );

  addDuplicateGroups(
    groups,
    "galleryImagesExact",
    "medium",
    groupBy(products, getGallerySignature)
  );

  addDuplicateGroups(
    groups,
    "firstImageSame",
    "low",
    groupBy(products, (product) => normalizeText(getFirstImage(product)))
  );

  return groups.sort((left, right) => {
    const confidenceRank = { high: 0, medium: 1, low: 2 };
    return (
      confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
      right.count - left.count ||
      left.duplicateType.localeCompare(right.duplicateType)
    );
  });
}

function buildFieldStats(products, totalBytes) {
  const stats = new Map();

  for (const product of products) {
    for (const [fieldName, value] of Object.entries(product)) {
      const fieldBytes = fieldContributionBytes(fieldName, value);
      const existing = stats.get(fieldName) || {
        fieldName,
        totalBytes: 0,
        averageBytes: 0,
        presenceCount: 0,
        percentageOfTotalSize: 0,
      };

      existing.totalBytes += fieldBytes;
      existing.presenceCount += 1;
      stats.set(fieldName, existing);
    }
  }

  return Array.from(stats.values())
    .map((item) => ({
      ...item,
      averageBytes: Math.round(item.totalBytes / item.presenceCount),
      totalMB: formatMb(item.totalBytes),
      percentageOfTotalSize: Number(((item.totalBytes / totalBytes) * 100).toFixed(2)),
    }))
    .sort((left, right) => right.totalBytes - left.totalBytes);
}

function buildFieldCountDistribution(products) {
  const counts = products.map((product) => Object.keys(product).length);
  const distribution = {};

  for (const count of counts) {
    distribution[count] = (distribution[count] || 0) + 1;
  }

  return {
    min: Math.min(...counts),
    max: Math.max(...counts),
    average: Number((counts.reduce((sum, count) => sum + count, 0) / counts.length).toFixed(2)),
    distribution,
  };
}

function buildAnomalies(products) {
  const idGroups = groupBy(products, (product) => getProductId(product));
  const duplicateIds = Array.from(idGroups.entries())
    .filter(([id, items]) => id && items.length > 1)
    .map(([id, items]) => ({ id, count: items.length, products: items.map(productSummary) }));

  return {
    missingId: products.filter((product) => !getProductId(product)).map(productSummary),
    duplicateIds,
    missingSourceUrlOrOriginalUrl: products.filter((product) => !getSourceUrl(product)).map(productSummary),
    missingImageUrlAndGalleryImages: products
      .filter((product) => !product.imageUrl && (!product.galleryImages || product.galleryImages.length === 0))
      .map(productSummary),
    missingOriginalPriceValueAndUnparseablePrice: products
      .filter((product) => {
        const parsed = product.originalPriceValue ?? parsePriceNumber(product.price || product.originalPrice);
        return !(Number.isFinite(parsed) && parsed > 0);
      })
      .map(productSummary),
    emptyBrand: products.filter((product) => !String(product.brand || "").trim()).map(productSummary),
    emptyNameZh: products.filter((product) => !String(product.nameZh || "").trim()).map(productSummary),
    shapeUnknownCount: products.filter((product) => product.shape === "unknown" || !product.shape).length,
    countryEmptyCount: products.filter((product) => !String(product.brandCountry || product.country || "").trim()).length,
  };
}

function buildArchiveSavings(products, fieldStats) {
  const byName = new Map(fieldStats.map((field) => [field.fieldName, field]));
  const archiveFields = RAW_ARCHIVE_ONLY_FIELDS.filter((fieldName) => byName.has(fieldName));
  const bytes = archiveFields.reduce((sum, fieldName) => sum + byName.get(fieldName).totalBytes, 0);

  return {
    archiveFields,
    estimatedReducibleBytes: bytes,
    estimatedReducibleMB: formatMb(bytes),
    note: "Estimate is based on top-level JSON field contribution, including field keys. Actual bundled output may differ after minification/compression.",
  };
}

function loadProducts() {
  if (fs.existsSync(productsJsonPath)) {
    return JSON.parse(fs.readFileSync(productsJsonPath, "utf8"));
  }

  const sourceText = fs.readFileSync(productsPath, "utf8");
  return JSON.parse(extractExportedArray(sourceText, "danishProducts"));
}

const products = loadProducts();
const totalBytes = jsonBytes(products);
const productSizes = products
  .map((product) => ({
    ...productSummary(product),
    sizeBytes: jsonBytes(product),
    sizeKB: formatKb(jsonBytes(product)),
    fieldCount: Object.keys(product).length,
  }))
  .sort((left, right) => right.sizeBytes - left.sizeBytes);
const fieldStats = buildFieldStats(products, totalBytes);
const duplicateGroups = findDuplicateGroups(products);
const anomalies = buildAnomalies(products);
const archiveSavings = buildArchiveSavings(products, fieldStats);
const highConfidenceDuplicateGroups = duplicateGroups.filter((group) => group.confidence === "high");

const audit = {
  generatedAt: new Date().toISOString(),
  sourceFiles: {
    productsPath: path.relative(rootDir, productsPath),
    productsJsonPath: fs.existsSync(productsJsonPath) ? path.relative(rootDir, productsJsonPath) : "",
    pipesPath: "data/pipes.ts",
  },
  overall: {
    productCount: products.length,
    totalJsonBytes: totalBytes,
    totalJsonMB: formatMb(totalBytes),
    averageProductBytes: Math.round(totalBytes / products.length),
    averageProductKB: formatKb(totalBytes / products.length),
    top20LargestProducts: productSizes.slice(0, 20),
    fieldCountDistribution: buildFieldCountDistribution(products),
  },
  fieldSizeRanking: fieldStats,
  duplicates: {
    groupCount: duplicateGroups.length,
    highConfidenceGroupCount: highConfidenceDuplicateGroups.length,
    groups: duplicateGroups,
  },
  anomalies,
  frontendFieldGuidance: {
    productionNeeded: PRODUCTION_NEEDED_FIELDS,
    rawArchiveOnly: RAW_ARCHIVE_ONLY_FIELDS,
    notes: [
      "The lists are coarse guidance based on current product, brand, and detail pages.",
      "Keep rawArchiveOnly fields in source archives rather than production product bundles.",
      "Dimensions can be flattened later if the frontend only needs selected millimeter values.",
    ],
  },
  summary: {
    archiveCandidates: archiveSavings.archiveFields,
    estimatedArchiveSavingsMB: archiveSavings.estimatedReducibleMB,
    suspectedDuplicateGroupCount: duplicateGroups.length,
    highConfidenceDuplicateGroupCount: highConfidenceDuplicateGroups.length,
    suggestedNextDataFiles: [
      "data/products/production/danish-products-lite.ts",
      "data/products/archive/danish-products-raw.json",
      "data/products/index.ts for merging per-site lite data",
      "data/products/search-index.ts or generated compact search fields",
    ],
    recommendations: [
      "Move raw/debug fields to an archive JSON that is not imported by the app router.",
      "Keep production product rows flat and only include fields used by listing, detail, and brand pages.",
      "Split future sources by site so one large file does not force every route to parse all source data.",
      "Generate search/filter indexes separately if product count approaches 10k.",
      "Review high-confidence duplicate groups manually before deleting anything.",
    ],
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

console.log(`Product data audit written: ${outputPath}`);
console.log(
  JSON.stringify(
    {
      productCount: audit.overall.productCount,
      totalJsonMB: audit.overall.totalJsonMB,
      averageProductKB: audit.overall.averageProductKB,
      top10Fields: audit.fieldSizeRanking.slice(0, 10).map((field) => ({
        fieldName: field.fieldName,
        totalMB: field.totalMB,
        percentageOfTotalSize: field.percentageOfTotalSize,
        presenceCount: field.presenceCount,
      })),
      highConfidenceDuplicateGroupCount: audit.duplicates.highConfidenceGroupCount,
      estimatedArchiveSavingsMB: audit.summary.estimatedArchiveSavingsMB,
    },
    null,
    2
  )
);
