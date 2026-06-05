import fs from "node:fs";
import path from "node:path";

const defaultInputPath = path.join(process.cwd(), "data", "danish-full-v17-test-500.json");
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
    .replace(/,-$/, ",00")
    .replace(/\.-$/, ".00");

  if (!numeric) {
    return 0;
  }

  if (numeric.includes(",") && numeric.includes(".")) {
    numeric = numeric.replace(/\./g, "").replace(",", ".");
  } else if (numeric.includes(",")) {
    const [, decimalPart = ""] = numeric.split(",");
    numeric = decimalPart.length > 0 && decimalPart.length <= 2
      ? numeric.replace(",", ".")
      : numeric.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
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

function shouldSkipProduct(product) {
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

function mapProduct(product, collectedAt) {
  const id = getProductIdFromUrl(product.href || product.sourceUrl);
  const brand = firstNonEmpty(product.brand, getBrandFromName(product.name));
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
    tags: buildTags(product, galleryImages, specsText, status, brand),
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
};

export const danishProducts: DanishPipeProduct[] = ${serializedProducts};
`;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const inputProducts = Array.isArray(raw.products) ? raw.products : [];
  const successInputCount = inputProducts.filter(isSuccessfulInput).length;
  const skipped = [];
  const converted = [];

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

    converted.push(mapProduct(product, raw.completedAt || raw.collectedAt));
  }

  const summary = {
    inputCount: inputProducts.length,
    successInputCount,
    skippedCount: skipped.length,
    outputCount: converted.length,
    imageMissingCount: converted.filter(
      (product) => !product.imageUrl || !product.detailImageUrl || product.galleryImages.length === 0
    ).length,
    noBrandCount: converted.filter((product) => !product.brand).length,
    noProductCodeCount: converted.filter((product) => !product.productCode).length,
    noSpecsCount: converted.filter((product) => product.specsText.length === 0).length,
    conditionSummary: countBy(converted.map((product) => product.conditionLabel)),
    skipped,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createOutputFile(converted), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Danish products written: ${outputPath}`);
}

main();
