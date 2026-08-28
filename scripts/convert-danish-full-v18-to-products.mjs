import fs from "node:fs";
import path from "node:path";
import { parseDanishSpecs } from "./inventory/danish-specs-parser-v1.mjs";

const preferredDefaultInputPath = path.join(process.cwd(), "data", "danish-details-full.json");
const legacyDefaultInputPath = path.join(process.cwd(), "data", "danish-full-v17-test-500.json");
const defaultInputPath = fs.existsSync(preferredDefaultInputPath)
  ? preferredDefaultInputPath
  : legacyDefaultInputPath;
const defaultOutputPath = path.join(process.cwd(), "data", "danish-products.ts");
const inputPath = resolvePath(process.env.DANISH_FULL_INPUT, defaultInputPath);
const outputPath = resolvePath(process.env.DANISH_PRODUCTS_OUTPUT, defaultOutputPath);
const sourceName = "The Danish Pipe Shop";
const usdToCny = 7.3;

function resolvePath(value, fallback) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback;
  }

  return path.isAbsolute(normalized) ? normalized : path.join(process.cwd(), normalized);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || "";
}

function dedupe(values) {
  const seen = new Set();
  const result = [];

  for (const value of values.map(normalizeText).filter(Boolean)) {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function getProductIdFromUrl(url) {
  const match = String(url || "").match(/-i(\d+)\.html/i);
  return match ? Number(match[1]) : 0;
}

function getBrandFromName(name) {
  const value = normalizeText(name);

  if (!value.includes(",")) {
    return "";
  }

  return normalizeText(value.split(",")[0]);
}

const brandCorrections = new Map(
  [
    ["Corn Cob Pipe", "Missouri Meerschaum"],
    ["Dagner Poker Cob Pipe", "Missouri Meerschaum"],
    ["BPK Smooth Churchwarden Pipe", "BPK"],
    ["BPK Brushed Churchwarden Pipe", "BPK"],
    ["BPK Mini Churchwarden Pipe", "BPK"],
    ["BPK Rusticated Churchwarden Pipe", "BPK"],
    ["BPK Churchwarden", "BPK"],
    ["BPK Churchwarden's", "BPK"],
    ["Estate Bentley by Former", "Bentley by Former"],
    ["Estate Georg Jensen", "Georg Jensen"],
    ["Estate S. Bang", "S. Bang"],
    ["Estate Stanwell", "Stanwell"],
    ["Flávia Rodrigues 手工烟斗 | 巴西艺术烟斗", "Flávia Rodrigues"],
    ["罗普 Etudiant J20 斗牛犬型 喷砂款", "Ropp"],
  ].map(([from, to]) => [normalizeText(from).toLowerCase(), to])
);

const modelLikeBrandAllowList = new Set(
  [
    "Dagner Pipes",
    "Berggreen Pipes",
    "Nuttens Pipes",
    "Henri Pipes",
    "Johs Pipes",
    "Ken Pipes",
  ].map((brand) => normalizeText(brand).toLowerCase())
);

const brandsRequiringManualReview = new Set(
  ["Dollar Kapten Pipe"].map((brand) => normalizeText(brand).toLowerCase())
);

function normalizeConvertedBrand(product) {
  const originalBrand = firstNonEmpty(product.brand, getBrandFromName(product.name));
  const correction = brandCorrections.get(originalBrand.toLowerCase());

  if (correction) {
    return {
      brand: correction,
      originalBrand,
      correctionReason: "brandCorrection",
    };
  }

  if (/^estate\s+/i.test(originalBrand)) {
    return {
      brand: normalizeText(originalBrand.replace(/^estate\s+/i, "")),
      originalBrand,
      correctionReason: "estatePrefixRemoved",
    };
  }

  if (/^bpk\b.*churchwarden/i.test(originalBrand)) {
    return {
      brand: "BPK",
      originalBrand,
      correctionReason: "bpkChurchwardenNormalized",
    };
  }

  return {
    brand: originalBrand,
    originalBrand,
    correctionReason: "",
  };
}

function isModelLikeBrand(brand) {
  const normalizedBrand = normalizeText(brand).toLowerCase();

  if (!normalizedBrand || modelLikeBrandAllowList.has(normalizedBrand)) {
    return false;
  }

  return /\b(?:pipe|cob|churchwarden|smooth|brushed|mini|rusticated|etudiant|bulldog|poker|seven|set)\b/i.test(
    brand
  );
}

function getSuspiciousBrandWarnings(product, brandInfo) {
  const warnings = [];
  const name = normalizeText(product.name);
  const originalBrand = normalizeText(brandInfo.originalBrand);
  const normalizedBrand = normalizeText(brandInfo.brand);

  if (!originalBrand) {
    return warnings;
  }

  if (originalBrand.toLowerCase() === name.toLowerCase()) {
    warnings.push({
      reason: "brandEqualsName",
      brand: originalBrand,
      normalizedBrand,
      name,
      href: normalizeText(product.href),
    });
  }

  if (/^estate\s+/i.test(originalBrand)) {
    warnings.push({
      reason: "estatePrefixBrand",
      brand: originalBrand,
      normalizedBrand,
      name,
      href: normalizeText(product.href),
    });
  }

  if (isModelLikeBrand(originalBrand)) {
    warnings.push({
      reason: "modelLikeBrand",
      brand: originalBrand,
      normalizedBrand,
      name,
      href: normalizeText(product.href),
    });
  }

  if (brandsRequiringManualReview.has(originalBrand.toLowerCase())) {
    warnings.push({
      reason: "manualReviewRequired",
      brand: originalBrand,
      normalizedBrand,
      name,
      href: normalizeText(product.href),
    });
  }

  if (
    brandInfo.correctionReason &&
    originalBrand.toLowerCase() !== normalizedBrand.toLowerCase()
  ) {
    warnings.push({
      reason: brandInfo.correctionReason,
      brand: originalBrand,
      normalizedBrand,
      name,
      href: normalizeText(product.href),
    });
  }

  return warnings;
}

function parseCurrency(price) {
  const value = normalizeText(price);

  if (value.includes("€")) return "EUR";
  if (value.includes("£")) return "GBP";
  if (value.includes("¥")) return "CNY";

  return "USD";
}

function parsePriceValue(price) {
  const value = normalizeText(price);

  if (!value) {
    return 0;
  }

  let numeric = value
    .replace(/[^\d,.-]/g, "")
    .replace(/([,.])-$/, "$100")
    .replace(/-$/, "");

  if (!numeric || !/\d/.test(numeric)) {
    return 0;
  }

  const commaIndex = numeric.lastIndexOf(",");
  const dotIndex = numeric.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    /*
     * 最右侧分隔符视为小数点：
     * 1,234.56 -> 1234.56
     * 1.234,56 -> 1234.56
     */
    const decimalSeparator =
      commaIndex > dotIndex ? "," : ".";

    const thousandsSeparator =
      decimalSeparator === "," ? "." : ",";

    numeric = numeric
      .replace(
        new RegExp(`\\${thousandsSeparator}`, "g"),
        ""
      )
      .replace(decimalSeparator, ".");
  } else if (
    commaIndex >= 0 ||
    dotIndex >= 0
  ) {
    const separator =
      commaIndex >= 0 ? "," : ".";

    const segments = numeric.split(separator);
    const decimalPart = segments.at(-1) || "";

    if (
      segments.length === 2 &&
      decimalPart.length > 0 &&
      decimalPart.length <= 2
    ) {
      numeric = `${segments[0]}.${decimalPart}`;
    } else {
      numeric = segments.join("");
    }
  }

  const parsed = Number.parseFloat(numeric);

  return Number.isFinite(parsed)
    ? Number(parsed.toFixed(2))
    : 0;
}

function formatCny(value, currency) {
  if (!value) {
    return "价格待确认";
  }

  if (currency !== "USD") {
    return "人民币参考待确认";
  }

  return `约 ¥${Math.round(value * usdToCny).toLocaleString("zh-CN")}`;
}

function estimatedCnyValue(value, currency) {
  if (!value) {
    return 999999;
  }

  if (currency !== "USD") {
    return 999999;
  }

  return Math.round(value * usdToCny);
}

function normalizeStatus(status) {
  const value = normalizeText(status);

  if (/已售|sold/i.test(value)) {
    return "已售";
  }

  if (/可购买|现在购买|in\s+stock|add\s+to\s+(?:basket|cart)|buy\s+now/i.test(value)) {
    return "可购买";
  }

  return "需人工确认";
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

function isSuccessfulInput(product) {
  return !product?.error;
}

function isExcludedDisplayProduct(product) {
  const href = normalizeText(
    product?.href ||
    product?.sourceUrl ||
    product?.originalUrl
  );

  const id = getProductIdFromUrl(href);
  const name = normalizeText(product?.name);

  return (
    id === 32447 ||
    /i32447\b/i.test(href) ||
    name === "BPK, Barry, Seven (7) Pipes"
  );
}

function isFalconProduct(product) {
  const brand = firstNonEmpty(
    product?.brand,
    getBrandFromName(product?.name)
  );

  const name = normalizeText(product?.name);

  return (
    /^falcon(?:\b|\s|,|-)/i.test(brand) ||
    /^falcon(?:\b|\s|,|-)/i.test(name)
  );
}

function shouldSkipProduct(product) {
  if (isFalconProduct(product)) {
    return "excludedFalcon";
  }

  if (isExcludedDisplayProduct(product)) {
    return "excludedBpkBarrySeven";
  }

  if (!isSuccessfulInput(product)) {
    return "detailError";
  }

  if (["missing", "mismatch"].includes(product.imageMatchStatus)) {
    return `image${product.imageMatchStatus[0].toUpperCase()}${product.imageMatchStatus.slice(1)}`;
  }

  return "";
}

function getAudience(product, estimatedValue) {
  if (normalizeStatus(product.status) === "已售") {
    return "已售参考 / 款式比较";
  }

  if (product.conditionType === "estate") {
    return "Estate 烟斗关注者 / 人工确认咨询";
  }

  if (estimatedValue >= 30000 && estimatedValue < 999999) {
    return "高端收藏 / 人工确认咨询";
  }

  return "海外烟斗器具关注者 / 人工确认咨询";
}

function getComment(product) {
  if (normalizeStatus(product.status) === "已售") {
    return "该商品采集时显示已售，可作为同品牌、同斗型和价格区间参考。";
  }

  return "来自 The Danish Pipe Shop 的公开库存信息，价格、库存和品相需以人工确认为准。";
}

function getDetail(product) {
  return [
    `${product.name} 来自 The Danish Pipe Shop 公开页面。`,
    "页面价格、库存状态、图片和参数为采集时参考信息。",
    "实际购买前需人工确认库存、最终价格、国际运费、预计税费和代购服务费用。",
  ].join("");
}

function buildTags(product, galleryImages, specsText, status, brand) {
  return dedupe([
    sourceName,
    brand,
    status,
    product.conditionLabel,
    product.conditionType === "estate" ? "Estate" : "",
    galleryImages.length > 1 ? "多图完整" : "图片可用",
    specsText.length === 0 ? "参数待补充" : "",
  ]);
}

function buildDisplayTags(product, status, brand) {
  return dedupe([
    product.conditionLabel,
    status,
    brand,
  ]).slice(0, 3);
}

function mapProduct(product, collectedAt, suspiciousBrandWarnings) {
  const id = getProductIdFromUrl(product.href || product.sourceUrl);
  const brandInfo = normalizeConvertedBrand(product);
  const brand = brandInfo.brand;
  suspiciousBrandWarnings.push(
    ...getSuspiciousBrandWarnings(product, brandInfo)
  );
  const price = normalizeText(product.price) || "价格待确认";
  const originalCurrency = parseCurrency(price);
  const originalPriceValue = parsePriceValue(price);
  const cnyValue = estimatedCnyValue(originalPriceValue, originalCurrency);
  const galleryImages = Array.isArray(product.galleryImages)
    ? dedupe(product.galleryImages)
    : [];
  const specsText = Array.isArray(product.specsText)
    ? product.specsText.map(normalizeText).filter(Boolean)
    : [];
  const status = normalizeStatus(product.status);
  const conditionLabel = firstNonEmpty(product.conditionLabel, "状态待确认");
  const sourceUrl = firstNonEmpty(product.href, product.sourceUrl, product.originalUrl);
  const structuredSpecs = parseDanishSpecs(product);

  return {
    id,
    brand,
    name: normalizeText(product.name),
    originalPrice: price,
    originalCurrency,
    originalPriceValue,
    estimatedCny: formatCny(originalPriceValue, originalCurrency),
    estimatedCnyValue: cnyValue,
    source: sourceName,
    sourceUrl,
    imageUrl: normalizeText(product.imageUrl),
    galleryImages,
    specsText,
    condition: conditionLabel,
    status,
    updatedAt: formatDateTime(collectedAt),
    audience: getAudience(product, cnyValue),
    comment: getComment(product),
    detail: getDetail(product),
    tags: buildDisplayTags(product, status, brand),
    detailImageUrl: normalizeText(product.detailImageUrl),
    productCode: normalizeText(product.productCode),
    originalUrl: sourceUrl,
    price,
    conditionType: firstNonEmpty(product.conditionType, "unknown"),
    smokedStatus: firstNonEmpty(product.smokedStatus, "unknown"),
    conditionLabel,
    conditionSource: firstNonEmpty(product.conditionSource, "unknown"),
    conditionNotes: normalizeText(product.conditionNotes),
    estateStatus: product.v17?.estateStatus ?? null,
    estateRatingStars: product.v17?.estateRatingStars ?? null,
    estateRatingLabel: normalizeText(product.v17?.estateRatingLabel),
    estateRatingNotes: normalizeText(product.v17?.estateRatingNotes),
    imageMatchStatus: normalizeText(product.imageMatchStatus),
    imageMatchNotes: normalizeText(product.imageMatchNotes),
    galleryCount: galleryImages.length,
    shape: structuredSpecs.shape,
    shapeZh: structuredSpecs.shapeZh,
    finish: structuredSpecs.finish,
    finishZh: structuredSpecs.finishZh,
    material: structuredSpecs.material,
    materialZh: structuredSpecs.materialZh,
    stemMaterial: structuredSpecs.stemMaterial,
    stemMaterialZh: structuredSpecs.stemMaterialZh,
    filter: structuredSpecs.filter,
    filterSizeMm: structuredSpecs.filterSizeMm,
    filterSpec: structuredSpecs.filterSpec,
    country: structuredSpecs.country,
    weightGrams: structuredSpecs.weightGrams,
    dimensions: structuredSpecs.dimensions,
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = normalizeText(value) || "未标记";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function createOutputFile(products) {
  const serializedProducts = JSON.stringify(products, null, 2);

  return `import type { PipeProduct } from "./pipes";

export type DanishPipeProduct = PipeProduct & {
  detailImageUrl: string;
  productCode: string;
  originalUrl: string;
  price: string;
  conditionType: string;
  smokedStatus: string;
  conditionLabel: string;
  conditionSource: string;
  conditionNotes: string;
  estateStatus: string | null;
  estateRatingStars: number | null;
  estateRatingLabel: string;
  estateRatingNotes: string;
  imageMatchStatus: string;
  imageMatchNotes: string;
  galleryCount: number;
  filter: string | null;
  filterSizeMm: number | null;
  filterSpec: string | null;
};

export const danishProducts: DanishPipeProduct[] = ${serializedProducts};
`;
}

function assertSafeOutput(products) {
  const invalidIdProducts = products.filter(
    (product) =>
      !Number.isInteger(product.id) ||
      product.id <= 0
  );

  if (invalidIdProducts.length > 0) {
    const samples = invalidIdProducts
      .slice(0, 10)
      .map(
        (product) =>
          product.sourceUrl ||
          product.name ||
          "(unknown)"
      )
      .join(" | ");

    throw new Error(
      `Refusing to write output: ` +
      `${invalidIdProducts.length} converted products ` +
      `have invalid IDs. Samples: ${samples}`
    );
  }

  const productsById = new Map();

  for (const product of products) {
    const existing = productsById.get(product.id);

    if (existing) {
      throw new Error(
        `Refusing to write output: ` +
        `duplicate product ID ${product.id}. ` +
        `${existing.sourceUrl || existing.name} | ` +
        `${product.sourceUrl || product.name}`
      );
    }

    productsById.set(product.id, product);
  }
}

function writeOutputAtomic(filePath, content) {
  fs.mkdirSync(
    path.dirname(filePath),
    { recursive: true }
  );

  const stamp =
    `${process.pid}.${Date.now()}`;

  const temporaryPath =
    `${filePath}.${stamp}.tmp`;

  const previousPath =
    `${filePath}.${stamp}.previous`;

  let previousMoved = false;

  fs.writeFileSync(
    temporaryPath,
    content,
    "utf8"
  );

  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(
        filePath,
        previousPath
      );

      previousMoved = true;
    }

    fs.renameSync(
      temporaryPath,
      filePath
    );

    if (
      previousMoved &&
      fs.existsSync(previousPath)
    ) {
      fs.rmSync(
        previousPath,
        { force: true }
      );
    }
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(
        temporaryPath,
        { force: true }
      );
    }

    if (
      previousMoved &&
      fs.existsSync(previousPath) &&
      !fs.existsSync(filePath)
    ) {
      fs.renameSync(
        previousPath,
        filePath
      );
    }

    throw error;
  }
}

function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `Danish input file not found: ${inputPath}`
    );
  }

  if (
    path.resolve(inputPath) ===
    path.resolve(outputPath)
  ) {
    throw new Error(
      "Danish input and output paths must be different."
    );
  }

  const raw = JSON.parse(
    fs
      .readFileSync(inputPath, "utf8")
      .replace(/^\uFEFF/, "")
  );

  if (!Array.isArray(raw.products)) {
    throw new Error(
      `Danish input does not contain a products array: ` +
      `${inputPath}`
    );
  }

  const inputProducts = raw.products;
  const successInputCount = inputProducts.filter(isSuccessfulInput).length;
  const skipped = [];
  const converted = [];
  const suspiciousBrandWarnings = [];

  for (const product of inputProducts) {
    const skipReason = shouldSkipProduct(product);

    if (skipReason) {
      skipped.push({
        name: normalizeText(product?.name),
        href: normalizeText(product?.href),
        reason: skipReason,
      });
      continue;
    }

    converted.push(
      mapProduct(product, raw.completedAt || raw.collectedAt, suspiciousBrandWarnings)
    );
  }

  const brandCounts = Object.entries(
    countBy(converted.map((product) => product.brand))
  ).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0], "en");
  });
  const uniqueSuspiciousBrandWarnings = Array.from(
    new Map(
      suspiciousBrandWarnings.map((warning) => [
        [
          warning.reason,
          warning.brand,
          warning.normalizedBrand,
          warning.name,
          warning.href,
        ].join("|"),
        warning,
      ])
    ).values()
  );
  const summary = {
    inputCount: inputProducts.length,
    successInputCount,
    skippedCount: skipped.length,
    outputCount: converted.length,
    brandCount: brandCounts.length,
    topBrandCounts: brandCounts.slice(0, 80).map(([brand, count]) => ({
      brand,
      count,
    })),
    imageMissingCount: converted.filter(
      (product) => !product.imageUrl || !product.detailImageUrl || product.galleryImages.length === 0
    ).length,
    noBrandCount: converted.filter((product) => !product.brand).length,
    noProductCodeCount: converted.filter((product) => !product.productCode).length,
    noSpecsCount: converted.filter((product) => product.specsText.length === 0).length,
    conditionSummary: countBy(converted.map((product) => product.conditionLabel)),
    suspiciousBrandWarnings: uniqueSuspiciousBrandWarnings,
    skipped,
  };

  assertSafeOutput(converted);

  writeOutputAtomic(
    outputPath,
    createOutputFile(converted)
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Danish products written: ${outputPath}`);
}

main();
