import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODES = new Set(["dry-run", "collect-only", "daily", "publish"]);
const RUN_TIME_ZONE = "Asia/Taipei";
const RUNTIME_PRODUCT_FIELDS = new Set([
  "updatedAt",
  "detailCollectedAt",
  "collectedAt",
  "fetchedAt",
  "generatedAt",
  "lastSeenAt",
  "runId",
  "rawPath",
  "checkpoint",
  "checkpointAt",
]);
const NUMERIC_PRODUCT_FIELDS = new Set([
  "id",
  "originalPriceValue",
  "estimatedCnyValue",
  "galleryCount",
  "estateRatingStars",
  "filterSizeMm",
  "weightGrams",
  "lengthMm",
  "heightMm",
  "chamberDiameterMm",
  "chamberDepthMm",
  "bowlOuterDiameterMm",
  "buttonWidthMm",
  "bitThicknessMm",
]);
const DEFAULT_RAW_ROOT = path.join(
  ROOT,
  "data/raw/danish-full-refresh/danish-v18-list-20260715-02"
);
const DETAIL_QUEUE_MAX_RATIO = 0.25;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function localDateParts(date = new Date()) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: RUN_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return values;
}

export function localRunTimestamp(date = new Date()) {
  const parts = localDateParts(date);
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

export function localRunTime(date = new Date()) {
  const parts = localDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${RUN_TIME_ZONE}`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const separator = token.indexOf("=");
    if (separator >= 0) {
      result[token.slice(2, separator)] = token.slice(separator + 1);
    } else {
      const next = argv[index + 1];
      result[token.slice(2)] = next && !next.startsWith("--") ? argv[++index] : true;
    }
  }
  return result;
}

function resolveMode(cli) {
  const aliases = [
    ["dry-run", "dry-run"],
    ["collect-only", "collect-only"],
    ["daily", "daily"],
    ["publish", "publish"],
  ].filter(([flag]) => cli[flag]);
  if (aliases.length > 1) throw new Error("Only one Danish daily mode may be selected.");
  const mode = compact(cli.mode || aliases[0]?.[1] || "dry-run").toLowerCase();
  if (!MODES.has(mode)) throw new Error(`Unsupported mode: ${mode}`);
  return mode;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeJson(temporaryPath, value);
  readJson(temporaryPath);
  fs.renameSync(temporaryPath, filePath);
}

function payloadProducts(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.products) ? payload.products : [];
}

export function getDanishId(item) {
  const direct = compact(item?.sourceProductId || item?.id).replace(/^danish-/i, "");
  if (/^\d+$/.test(direct)) return direct;
  return compact(item?.sourceUrl || item?.href || item?.originalUrl)
    .match(/-i(\d+)\.html/i)?.[1] || "";
}

function normalizedListUrl(value) {
  return normalizeUrlForComparison(value).replace(/[?#].*$/, "");
}

function productListUrl(product) {
  return compact(product?.href || product?.sourceUrl || product?.originalUrl);
}

function isHistoricalDanishStatus(value) {
  return /(?:\u5df2\u552e|sold|unavailable|out[-\s]?of[-\s]?stock|\u4e0b\u67b6|archived)/i.test(compact(value));
}

function isActivelyListedDanishProduct(item) {
  const status = compact(item?.status);
  return Boolean(status) && !isHistoricalDanishStatus(status);
}

function parseDanishListCurrency(price) {
  const value = compact(price);
  if (value.includes("€")) return "EUR";
  if (value.includes("£")) return "GBP";
  if (value.includes("¥")) return "CNY";
  return "USD";
}

function parseDanishListPriceValue(price) {
  let numeric = compact(price)
    .replace(/[^\d,.-]/g, "")
    .replace(/([,.])-$/, "$100")
    .replace(/-$/, "");
  if (!numeric || !/\d/.test(numeric)) return 0;
  const commaIndex = numeric.lastIndexOf(",");
  const dotIndex = numeric.lastIndexOf(".");
  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numeric = numeric.replace(new RegExp(`\\${thousandsSeparator}`, "g"), "").replace(decimalSeparator, ".");
  } else if (commaIndex >= 0 || dotIndex >= 0) {
    const separator = commaIndex >= 0 ? "," : ".";
    const segments = numeric.split(separator);
    const decimalPart = segments.at(-1) || "";
    numeric = segments.length === 2 && decimalPart.length > 0 && decimalPart.length <= 2
      ? `${segments[0]}.${decimalPart}`
      : segments.join("");
  }
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function buildDanishListPriceValues(price) {
  const originalPrice = compact(price);
  const originalCurrency = parseDanishListCurrency(originalPrice);
  const originalPriceValue = parseDanishListPriceValue(originalPrice);
  const hasUsdReference = originalPriceValue > 0 && originalCurrency === "USD";
  return {
    originalPrice,
    price: originalPrice,
    originalCurrency,
    originalPriceValue,
    estimatedCny: originalPriceValue === 0
      ? "\u4ef7\u683c\u5f85\u786e\u8ba4"
      : hasUsdReference
        ? `\u7ea6 \u00a5${Math.round(originalPriceValue * 7.3).toLocaleString("zh-CN")}`
        : "\u4eba\u6c11\u5e01\u53c2\u8003\u5f85\u786e\u8ba4",
    estimatedCnyValue: hasUsdReference ? Math.round(originalPriceValue * 7.3) : 999999,
  };
}

function priceValuesEquivalent(listPrice, productionItem) {
  const current = buildDanishListPriceValues(listPrice);
  return current.originalCurrency === compact(productionItem?.originalCurrency)
    && current.originalPriceValue === Number(productionItem?.originalPriceValue)
    && current.originalPriceValue > 0;
}

function urlProductId(value) {
  return compact(value).match(/-i(\d+)\.html/i)?.[1] || "";
}

function getIdentityOrUrlAnomaly(listItem, productionItem) {
  const stableId = getDanishId(listItem);
  const listUrlId = urlProductId(productListUrl(listItem));
  const productionUrlId = urlProductId(productListUrl(productionItem));
  if (!stableId || !listUrlId) return "list-url-stable-id-missing";
  if (stableId !== listUrlId) return "list-id-url-mismatch";
  if (productionUrlId && getDanishId(productionItem) !== productionUrlId) return "production-id-url-mismatch";
  if (productionUrlId && productionUrlId !== stableId) return "production-url-points-to-different-id";
  return "";
}

function missingRequiredProductionDetailFields(item) {
  const missing = [];
  if (!Array.isArray(item?.specsText) || item.specsText.length === 0) missing.push("specsText");
  if ((!Array.isArray(item?.galleryImages) || item.galleryImages.length === 0) && !compact(item?.imageUrl) && !compact(item?.detailImageUrl)) {
    missing.push("productImages");
  }
  return missing;
}

function recordListPatchChange(entry, field, oldValues, newValues) {
  entry.changedFields.push(field);
  Object.assign(entry.oldValues, oldValues);
  Object.assign(entry.newValues, newValues);
}

export function buildDanishListPatch({ listProducts, productionProducts, generatedAt = new Date().toISOString() }) {
  const productionById = new Map(productionProducts.map((item) => [getDanishId(item), item]).filter(([id]) => id));
  const seenIds = new Set();
  const products = [];
  const identityAnomalies = [];
  let productionMatchedCount = 0;
  let priceChangedCount = 0;
  let statusChangedCount = 0;
  let nameChangedCount = 0;
  let sourceUrlChangedCount = 0;
  let brandChangedCount = 0;
  let unchangedCount = 0;

  for (const listItem of listProducts) {
    const id = getDanishId(listItem);
    if (!id || seenIds.has(id) || isFalcon(listItem) || isBpk32447(listItem)) continue;
    seenIds.add(id);
    const productionItem = productionById.get(id);
    if (!productionItem) continue;
    productionMatchedCount += 1;
    const anomaly = getIdentityOrUrlAnomaly(listItem, productionItem);
    if (anomaly) {
      identityAnomalies.push({ id, name: compact(listItem?.name), href: productListUrl(listItem), reason: anomaly });
      continue;
    }
    const entry = { id, changedFields: [], oldValues: {}, newValues: {} };
    const listPrice = compact(listItem?.price);
    if (listPrice && !priceValuesEquivalent(listPrice, productionItem)) {
      const nextPriceValues = buildDanishListPriceValues(listPrice);
      recordListPatchChange(entry, "price", {
        originalPrice: productionItem.originalPrice,
        price: productionItem.price,
        originalCurrency: productionItem.originalCurrency,
        originalPriceValue: productionItem.originalPriceValue,
        estimatedCny: productionItem.estimatedCny,
        estimatedCnyValue: productionItem.estimatedCnyValue,
      }, nextPriceValues);
      priceChangedCount += 1;
    }
    if (compact(listItem?.status) && normalizeTextForComparison(listItem.status) !== normalizeTextForComparison(productionItem.status)) {
      recordListPatchChange(entry, "status", { status: productionItem.status }, { status: compact(listItem.status) });
      statusChangedCount += 1;
    }
    if (compact(listItem?.name) && normalizeTextForComparison(listItem.name) !== normalizeTextForComparison(productionItem.name)) {
      recordListPatchChange(entry, "name", { name: productionItem.name }, { name: compact(listItem.name) });
      nameChangedCount += 1;
    }
    const listUrl = productListUrl(listItem);
    if (listUrl && normalizedListUrl(listUrl) !== normalizedListUrl(productListUrl(productionItem))) {
      recordListPatchChange(entry, "sourceUrl", {
        sourceUrl: productionItem.sourceUrl,
        originalUrl: productionItem.originalUrl,
      }, { sourceUrl: listUrl, originalUrl: listUrl });
      sourceUrlChangedCount += 1;
    }
    if (compact(listItem?.brand) && normalizeTextForComparison(listItem.brand) !== normalizeTextForComparison(productionItem.brand)) {
      recordListPatchChange(entry, "brand", { brand: productionItem.brand }, { brand: compact(listItem.brand) });
      brandChangedCount += 1;
    }
    if (entry.changedFields.length > 0) products.push(entry);
    else unchangedCount += 1;
  }
  return {
    generatedAt,
    productionMatchedCount,
    priceChangedCount,
    statusChangedCount,
    nameChangedCount,
    sourceUrlChangedCount,
    brandChangedCount,
    unchangedCount,
    listPatchCount: products.length,
    identityAnomalyCount: identityAnomalies.length,
    identityAnomalies,
    products,
  };
}

export function applyDanishListPatch({ productionProducts, listPatch }) {
  const patchById = new Map((listPatch?.products || []).map((entry) => [compact(entry.id), entry]));
  return productionProducts.map((product) => {
    const entry = patchById.get(getDanishId(product));
    return entry ? { ...product, ...entry.newValues } : product;
  });
}

export function nonPublicDanishComponentIds(unifiedProducts) {
  return new Set(
    payloadProducts(unifiedProducts)
      .filter((item) => (
        compact(item?.source).toLowerCase() === "danish" &&
        item?.inventory?.publicIndexEligible === false &&
        /^component(?:-|$)/i.test(compact(item?.entityType))
      ))
      .map((item) => compact(item?.sourceProductId))
      .filter(Boolean)
  );
}

export function buildIncrementalDetailQueue({
  listProducts,
  productionProducts,
  listPatch = null,
  nonPublicComponentIds = new Set(),
  generatedAt = new Date().toISOString(),
}) {
  const productionById = new Map(productionProducts.map((item) => [getDanishId(item), item]).filter(([id]) => id));
  const seenIds = new Set();
  const products = [];
  let eligibleListCount = 0;
  let newCount = 0;
  let reappearedCount = 0;
  let missingRequiredProductionDataCount = 0;
  let identityAnomalyCount = 0;
  let reusedProductionCount = 0;
  let excludedCount = 0;
  let invalidStableIdCount = 0;
  let duplicateStableIdCount = 0;

  for (const listItem of listProducts) {
    const id = getDanishId(listItem);
    if (!id) {
      invalidStableIdCount += 1;
      continue;
    }
    if (seenIds.has(id)) {
      duplicateStableIdCount += 1;
      continue;
    }
    seenIds.add(id);
    if (isFalcon(listItem) || isBpk32447(listItem)) {
      excludedCount += 1;
      continue;
    }
    eligibleListCount += 1;
    const productionItem = productionById.get(id);
    let reason = "";
    const anomaly = listPatch?.identityAnomalies?.find((entry) => entry.id === id);
    if (!productionItem) {
      reason = "new-product";
      newCount += 1;
    } else if (anomaly) {
      reason = "identity-or-url-anomaly";
      identityAnomalyCount += 1;
    } else if (isHistoricalDanishStatus(productionItem.status)) {
      if (isActivelyListedDanishProduct(listItem)) {
        reason = "reappeared";
        reappearedCount += 1;
      } else {
        // A sold/history card can remain visible in the catalogue. It is not a reappearance.
        reusedProductionCount += 1;
      }
    } else {
      const missingFields = missingRequiredProductionDetailFields(productionItem);
      if (missingFields.length > 0) {
        if (nonPublicComponentIds.has(id)) {
          reusedProductionCount += 1;
        } else {
          reason = "missing-required-production-data";
          missingRequiredProductionDataCount += 1;
        }
      } else {
        reusedProductionCount += 1;
      }
    }
    if (reason) {
      products.push({
        id,
        name: compact(listItem?.name),
        href: productListUrl(listItem),
        url: productListUrl(listItem),
        reason,
        ...(reason === "missing-required-production-data" ? { missingFields: missingRequiredProductionDetailFields(productionItem) } : {}),
        ...(reason === "identity-or-url-anomaly" ? { anomaly: anomaly.reason } : {}),
      });
    }
  }

  return {
    generatedAt,
    listCount: listProducts.length,
    eligibleListCount,
    newCount,
    reappearedCount,
    missingRequiredProductionDataCount,
    identityAnomalyCount,
    reusedProductionCount,
    excludedCount,
    invalidStableIdCount,
    duplicateStableIdCount,
    queueCount: products.length,
    products,
  };
}

export function validateIncrementalDetailQueue({ detailQueue, productionProducts }) {
  const queue = detailQueue;
  const errors = [];
  if (!Array.isArray(productionProducts) || productionProducts.length === 0) errors.push("production-baseline-missing-or-empty");
  if (queue.invalidStableIdCount > 0) errors.push("list-stable-id-missing");
  if (queue.duplicateStableIdCount > 0) errors.push("list-stable-id-duplicates");
  const maxQueueCount = Math.floor(queue.eligibleListCount * DETAIL_QUEUE_MAX_RATIO);
  if (queue.queueCount > maxQueueCount) errors.push("detail-queue-abnormal-full-refresh-risk");
  if (queue.eligibleListCount > 0 && queue.reusedProductionCount === 0) errors.push("reused-production-count-zero");
  return { passed: errors.length === 0, errors, maxQueueCount };
}

function isDetailFailure(item) {
  return Boolean(item?.detailError || item?.error || item?.success === false);
}

function isFalcon(item) {
  return /(?:^|\b)falcon(?:\b|\s|,|-)/i.test(
    [item?.brand, item?.name, item?.title].map(compact).join(" ")
  );
}

function isBpk32447(item) {
  return getDanishId(item) === "32447" || compact(item?.name || item?.title) === "BPK, Barry, Seven (7) Pipes";
}

function meaningful(value) {
  return value !== undefined && value !== null && !(typeof value === "string" && !value.trim());
}

export function overlayFreshOverOld(fresh, old) {
  if (Array.isArray(fresh)) return fresh;
  if (fresh && typeof fresh === "object") {
    const result = { ...(old && typeof old === "object" ? old : {}) };
    for (const [key, value] of Object.entries(fresh)) {
      result[key] = meaningful(value) ? overlayFreshOverOld(value, old?.[key]) : old?.[key] ?? value;
    }
    return result;
  }
  return meaningful(fresh) ? fresh : old;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyText(value) {
  return compact(value).length > 0;
}

function createDegradedFieldFallbacks() {
  return {
    affectedProducts: 0,
    galleryImages: 0,
    specsText: 0,
    imageUrl: 0,
    detailImageUrl: 0,
    affectedIds: [],
  };
}

function protectDanishNonEmptyFields(fresh, old) {
  const protectedFresh = { ...fresh };
  const fields = [];
  if (Array.isArray(fresh?.galleryImages) && fresh.galleryImages.length === 0 && nonEmptyArray(old?.galleryImages)) {
    protectedFresh.galleryImages = old.galleryImages;
    protectedFresh.galleryCount = old.galleryImages.length;
    fields.push("galleryImages");
  }
  if (Array.isArray(fresh?.specsText) && fresh.specsText.length === 0 && nonEmptyArray(old?.specsText)) {
    protectedFresh.specsText = old.specsText;
    fields.push("specsText");
  }
  if (!nonEmptyText(fresh?.imageUrl) && nonEmptyText(old?.imageUrl)) {
    protectedFresh.imageUrl = old.imageUrl;
    fields.push("imageUrl");
  }
  if (!nonEmptyText(fresh?.detailImageUrl) && nonEmptyText(old?.detailImageUrl)) {
    protectedFresh.detailImageUrl = old.detailImageUrl;
    fields.push("detailImageUrl");
  }
  return { product: protectedFresh, fields };
}

export function parseConvertedProducts(source) {
  const marker = "export const danishProducts";
  const markerIndex = source.indexOf(marker);
  const equalsIndex = source.indexOf("=", markerIndex);
  const arrayStart = source.indexOf("[", equalsIndex);
  const arrayEnd = source.lastIndexOf("];");
  if (markerIndex < 0 || equalsIndex < 0 || arrayStart < 0 || arrayEnd < arrayStart) {
    throw new Error("Converted TypeScript does not contain danishProducts JSON.");
  }
  const products = JSON.parse(source.slice(arrayStart, arrayEnd + 1));
  if (!Array.isArray(products)) throw new Error("Converted Danish output is not an array.");
  return products;
}

function duplicateCount(items) {
  const seen = new Set();
  let duplicates = 0;
  for (const item of items) {
    const id = getDanishId(item);
    if (!id) continue;
    if (seen.has(id)) duplicates += 1;
    seen.add(id);
  }
  return duplicates;
}

export function validateCollection({ listPayload, detailsPayload, productionProducts, minimumRatio = 0.65, incremental = false, detailQueue = null }) {
  const listProducts = payloadProducts(listPayload);
  const detailProducts = payloadProducts(detailsPayload);
  const duplicates = duplicateCount(detailProducts);
  const invalidIds = detailProducts.filter((item) => !getDanishId(item)).length;
  const failedDetails = Math.max(
    Number(detailsPayload?.failCount || 0),
    detailProducts.filter(isDetailFailure).length
  );
  const baselineCount = productionProducts.length;
  const ratio = detailProducts.length / Math.max(1, baselineCount);
  const duplicateRatio = duplicates / Math.max(1, detailProducts.length);
  const errors = [];
  if (!listProducts.length) errors.push("list-empty");
  if (!incremental && !detailProducts.length) errors.push("details-empty");
  if (!incremental && baselineCount && ratio < minimumRatio) errors.push("collection-count-abnormal-drop");
  if (duplicateRatio > 0.01) errors.push("stable-id-duplicates-severe");
  if (invalidIds > Math.max(2, detailProducts.length * 0.01)) errors.push("stable-id-missing-severe");
  if (listPayload?.integrityGate === false || listPayload?.integrityGate?.complete === false) {
    errors.push("list-integrity-failed");
  }
  return {
    passed: errors.length === 0,
    errors,
    collectedCount: incremental ? Number(detailQueue?.queueCount || 0) : detailProducts.length,
    listCount: listProducts.length,
    baselineCount,
    countRatio: Number(ratio.toFixed(4)),
    duplicates,
    invalidIds,
    failedDetails,
  };
}

function detailQueueIdSet(detailQueue) {
  return new Set((detailQueue?.products || []).map((item) => compact(item?.id)).filter(Boolean));
}

function queuedDetailRecords(detailsPayload, detailQueue) {
  const queuedIds = detailQueueIdSet(detailQueue);
  return payloadProducts(detailsPayload).filter((item) => queuedIds.has(getDanishId(item)));
}

function successfulQueuedDetailRecords(detailsPayload, detailQueue) {
  return queuedDetailRecords(detailsPayload, detailQueue).filter((item) => !isDetailFailure(item));
}

function summarizeQueuedDetails(detailsPayload, detailQueue, alreadyCompletedDetailCount = 0) {
  const records = queuedDetailRecords(detailsPayload, detailQueue);
  const completed = records.filter((item) => !isDetailFailure(item));
  const failed = records.filter(isDetailFailure);
  return {
    alreadyCompletedDetailCount,
    fetchedDetailCount: Math.max(0, completed.length - alreadyCompletedDetailCount),
    failedDetailCount: failed.length,
    completedDetailCount: completed.length,
    unresolvedDetailCount: Math.max(0, Number(detailQueue?.queueCount || 0) - completed.length - failed.length),
  };
}

function buildConversionInput(detailsPayload, detailQueue) {
  const products = successfulQueuedDetailRecords(detailsPayload, detailQueue);
  return {
    source: detailsPayload?.source || "The Danish Pipe Shop",
    collectorVersion: detailsPayload?.collectorVersion || "v18-incremental",
    generatedAt: new Date().toISOString(),
    detailQueueCount: Number(detailQueue?.queueCount || 0),
    products,
  };
}

export function mergeConvertedWithProduction({ convertedProducts, productionProducts }) {
  const oldById = new Map(
    productionProducts.map((item) => [getDanishId(item), item]).filter(([id]) => id)
  );
  const merged = [];
  const convertedIds = new Set();
  const degradedFieldFallbacks = createDegradedFieldFallbacks();
  for (const fresh of convertedProducts) {
    const id = getDanishId(fresh);
    if (!id || convertedIds.has(id)) continue;
    convertedIds.add(id);
    const old = oldById.get(id);
    const protectedFields = protectDanishNonEmptyFields(fresh, old);
    if (protectedFields.fields.length > 0) {
      degradedFieldFallbacks.affectedProducts += 1;
      degradedFieldFallbacks.affectedIds.push(id);
      for (const field of protectedFields.fields) degradedFieldFallbacks[field] += 1;
    }
    merged.push(overlayFreshOverOld(protectedFields.product, old));
  }
  let retainedFromProduction = 0;
  for (const old of productionProducts) {
    const id = getDanishId(old);
    if (!id || convertedIds.has(id)) continue;
    merged.push(old);
    retainedFromProduction += 1;
  }
  degradedFieldFallbacks.affectedIds.sort((left, right) => Number(left) - Number(right));
  return { products: merged, retainedFromProduction, degradedFieldFallbacks };
}

export function evaluateDegradedFieldFallbacks(degradedFieldFallbacks, currentProductCount) {
  const imageFallbacks = degradedFieldFallbacks.galleryImages + degradedFieldFallbacks.imageUrl + degradedFieldFallbacks.detailImageUrl;
  const affectedLimit = Math.max(1, Math.floor(currentProductCount * 0.05));
  const errors = [];
  if (degradedFieldFallbacks.affectedProducts > affectedLimit) errors.push("degraded-fields-affected-products-exceeded");
  if (imageFallbacks > 100) errors.push("degraded-image-fields-exceeded");
  return {
    passed: errors.length === 0,
    errors,
    affectedLimit,
    imageFallbacks,
  };
}

function normalizeTextForComparison(value) {
  return String(value).trim().replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t]*/g, " ");
}

function normalizeUrlForComparison(value) {
  const text = normalizeTextForComparison(value);
  try {
    const url = new URL(text);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return text;
  }
}

function shouldNormalizeAsUrl(pathParts) {
  const key = pathParts.at(-1) || "";
  return /(?:Url|url)$/i.test(key) || pathParts.includes("galleryImages");
}

function shouldNormalizeAsNumber(pathParts) {
  return NUMERIC_PRODUCT_FIELDS.has(pathParts.at(-1));
}

function normalizeForComparison(value, pathParts = []) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const text = shouldNormalizeAsUrl(pathParts)
      ? normalizeUrlForComparison(value)
      : normalizeTextForComparison(value);
    if (shouldNormalizeAsNumber(pathParts) && /^[-+]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((entry, index) => normalizeForComparison(entry, [...pathParts, String(index)]));
    // Tags are a set. Gallery order remains untouched because the primary image is meaningful.
    if (pathParts.at(-1) === "tags") return normalized.slice().sort((left, right) => String(left).localeCompare(String(right), "en"));
    return normalized;
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (RUNTIME_PRODUCT_FIELDS.has(key)) continue;
      const rawValue = value[key];
      if (rawValue === undefined || rawValue === null) continue;
      const normalizedValue = normalizeForComparison(rawValue, [...pathParts, key]);
      if (normalizedValue === "") continue;
      normalized[key] = normalizedValue;
    }
    return normalized;
  }
  return value;
}

export function productsEquivalentForDiff(left, right) {
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right));
}

function changedTopLevelFields(left, right) {
  const previous = normalizeForComparison(left);
  const next = normalizeForComparison(right);
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return [...keys].filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]));
}

export function buildDifferenceSummary({ collectedCount, currentProducts, candidateProducts, convertedCount, productionProducts, failedDetails, duplicates, checkpoint }) {
  const oldById = new Map(productionProducts.map((item) => [getDanishId(item), item]).filter(([id]) => id));
  const nextById = new Map(candidateProducts.map((item) => [getDanishId(item), item]).filter(([id]) => id));
  const currentIds = new Set((currentProducts || candidateProducts).map(getDanishId).filter(Boolean));
  const changedFieldCounts = new Map();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const id of currentIds) {
    const old = oldById.get(id);
    const item = nextById.get(id);
    if (!old) added += 1;
    else if (!item || productsEquivalentForDiff(item, old)) unchanged += 1;
    else {
      updated += 1;
      for (const field of changedTopLevelFields(old, item)) {
        changedFieldCounts.set(field, (changedFieldCounts.get(field) || 0) + 1);
      }
    }
  }
  const disappeared = [...oldById.keys()].filter((id) => !currentIds.has(id)).length;
  return {
    collected: collectedCount,
    converted: convertedCount,
    production: productionProducts.length,
    added,
    updated,
    disappeared,
    unchanged,
    failedDetails,
    duplicates,
    checkpoint,
    changedFields: Object.fromEntries(
      [...changedFieldCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    ),
    allowPublish: false,
  };
}

export function validateConversion({ convertedProducts, collectedCount, mergedProducts, collection, incremental = false, detailQueue = null }) {
  const duplicates = duplicateCount(convertedProducts);
  const invalidIds = convertedProducts.filter((item) => !getDanishId(item)).length;
  const requiredMissing = convertedProducts.filter(
    (item) => !getDanishId(item) || !compact(item?.name) || !compact(item?.sourceUrl || item?.originalUrl) || !compact(item?.status)
  ).length;
  const unexplainedGap = Math.max(
    0,
    collectedCount - convertedProducts.length - collection.failedDetails -
      collection.falconCount - collection.bpk32447Count
  );
  const errors = [];
  if (!incremental && !convertedProducts.length) errors.push("conversion-empty");
  if (duplicates || invalidIds) errors.push("conversion-identity-invalid");
  if (requiredMissing > Math.max(2, convertedProducts.length * 0.1)) errors.push("required-fields-mass-missing");
  if (!incremental && unexplainedGap > Math.max(10, collectedCount * 0.05)) errors.push("conversion-count-gap-unexplained");
  if (mergedProducts.length < Math.max(convertedProducts.length, collection.baselineCount * 0.65)) {
    errors.push("merged-production-count-abnormal-drop");
  }
  return {
    passed: errors.length === 0,
    errors,
    convertedCount: convertedProducts.length,
    mergedCount: mergedProducts.length,
    duplicates,
    invalidIds,
    requiredMissing,
    unexplainedGap,
    exclusions: {
      failedDetails: collection.failedDetails,
      falcon: collection.falconCount,
      bpk32447: collection.bpk32447Count,
    },
    detailQueueCount: Number(detailQueue?.queueCount || 0),
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireDanishLock({ lockPath, mode, now = new Date(), isPidAlive = pidAlive }) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let recoveredStale = false;
  if (fs.existsSync(lockPath)) {
    let current = null;
    try { current = readJson(lockPath); } catch { current = null; }
    if (current && isPidAlive(current.pid)) {
      return { acquired: false, recoveredStale: false, current };
    }
    fs.unlinkSync(lockPath);
    recoveredStale = true;
  }
  const payload = { pid: process.pid, startedAt: now.toISOString(), startedAtLocal: localRunTime(now), timeZone: RUN_TIME_ZONE, mode };
  const handle = fs.openSync(lockPath, "wx");
  try { fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`, "utf8"); }
  finally { fs.closeSync(handle); }
  return { acquired: true, recoveredStale, payload };
}

export function releaseDanishLock({ lockPath }) {
  if (!fs.existsSync(lockPath)) return false;
  let current = null;
  try { current = readJson(lockPath); } catch { return false; }
  if (Number(current?.pid) !== process.pid) return false;
  fs.unlinkSync(lockPath);
  return true;
}

async function executeCommand({ command, args, cwd, env, timeoutSeconds, onOutput }) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-12000);
      onOutput?.("stdout", text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-12000);
      onOutput?.("stderr", text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, stdout, stderr });
    });
  });
}

function requireStage(result, stage) {
  if (result?.exitCode !== 0 || result?.timedOut) {
    throw new Error(`${stage}-failed exitCode=${result?.exitCode ?? "null"} timedOut=${Boolean(result?.timedOut)} ${compact(result?.stderr).slice(-600)}`);
  }
}

function checkpointStatus(checkpointPath, detailsPayload) {
  return {
    path: checkpointPath,
    exists: fs.existsSync(checkpointPath),
    outputMarkedCheckpoint: Boolean(detailsPayload?.checkpoint),
    checkpointAt: compact(detailsPayload?.checkpointAt),
  };
}

function createLogger(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return (event, value = "") => {
    const now = new Date();
    const line = `${localRunTime(now)} (${now.toISOString()}) [${event}] ${typeof value === "string" ? value : JSON.stringify(value)}`;
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  };
}

function collectionExclusions(detailsPayload) {
  const entries = payloadProducts(detailsPayload);
  return {
    falconCount: entries.filter(isFalcon).length,
    bpk32447Count: entries.filter(isBpk32447).length,
  };
}

export async function runDanishDaily(options = {}, dependencies = {}) {
  const root = path.resolve(options.root || ROOT);
  const mode = options.mode || "dry-run";
  if (!MODES.has(mode)) throw new Error(`Unsupported mode: ${mode}`);
  const runId = compact(options.runId || `danish-daily-${localRunTimestamp()}`);
  const timeoutSeconds = Math.max(30, Number(options.timeoutSeconds || 14400));
  const rawRoot = path.resolve(options.rawRoot || (mode === "dry-run" ? DEFAULT_RAW_ROOT : path.join(root, "data/raw/danish-full-refresh", runId)));
  const runRoot = path.resolve(options.runRoot || path.join(root, "data/inventory/danish-daily", runId));
  const productionPath = path.resolve(options.productionPath || path.join(root, "data/products/danish-products.json"));
  const unifiedProductsPath = path.join(root, "data/products/unified-products-staging.json");
  const backupRoot = path.resolve(options.backupRoot || path.join(root, "data/backups/danish-daily", runId));
  const logPath = path.resolve(options.logPath || path.join(root, "data/logs", `danish-daily-${localRunTimestamp()}.log`));
  const lockPath = path.resolve(options.lockPath || path.join(root, "data/inventory/state/danish-daily.lock"));
  const listPath = path.join(rawRoot, "list.json");
  const detailsPath = path.join(rawRoot, "details.json");
  const errorsPath = path.join(rawRoot, "detail-errors.json");
  const checkpointPath = path.join(rawRoot, "details.partial.json");
  const listPatchPath = path.join(runRoot, "list-patch.json");
  const detailQueuePath = path.join(runRoot, "detail-queue.json");
  const conversionInputPath = path.join(runRoot, "details-for-conversion.json");
  const convertedTsPath = path.join(runRoot, "danish-products-converted.ts");
  const convertedJsonPath = path.join(runRoot, "danish-products-converted.json");
  const summaryPath = path.join(runRoot, "run-summary.json");
  const collectorScript = path.join(root, "scripts/collect-danish-full-v18.mjs");
  const converterScript = path.join(root, "scripts/convert-danish-full-v18-to-products.mjs");
  const execute = dependencies.execute || executeCommand;
  const log = createLogger(logPath);
  const report = {
    runId,
    mode,
    status: "running",
    timeZone: RUN_TIME_ZONE,
    startedAt: new Date().toISOString(),
    startedAtLocal: localRunTime(),
    paths: { collectorScript, rawRoot, listPath, detailsPath, errorsPath, checkpointPath, listPatchPath, detailQueuePath, conversionInputPath, converterScript, convertedJsonPath, productionPath, backupRoot, logPath },
    stages: {},
    collection: null,
    conversion: null,
    diff: null,
    listPatch: null,
    detailQueue: null,
    detailProgress: null,
    detailQueueCount: 0,
    listPatchCount: 0,
    pricePatchCount: 0,
    statusPatchCount: 0,
    otherListPatchCount: 0,
    newDetailCount: 0,
    reappearedDetailCount: 0,
    missingDetailCount: 0,
    identityAnomalyCount: 0,
    reusedProductionCount: 0,
    alreadyCompletedDetailCount: 0,
    fetchedDetailCount: 0,
    failedDetailCount: 0,
    remainingDetailCount: 0,
    degradedFieldFallbacks: createDegradedFieldFallbacks(),
    productionWritten: false,
    backupCreated: false,
    buildPassed: false,
    commitExecuted: false,
    pushExecuted: false,
    allowPublish: false,
    failureReason: null,
  };
  let lock = null;
  const runStage = async (stage, command, args, env = {}) => {
    log("stage-start", { stage, command, args });
    const result = await execute({
      stage,
      command,
      args,
      cwd: root,
      env,
      timeoutSeconds,
      onOutput: (stream, chunk) => {
        const message = String(chunk || "").replace(/\r/g, "").trim();
        if (message) log("stage-output", { stage, stream, message });
      },
    });
    report.stages[stage] = { exitCode: result?.exitCode ?? null, timedOut: Boolean(result?.timedOut) };
    log("stage-result", { stage, ...report.stages[stage] });
    requireStage(result, stage);
    return result;
  };
  try {
    fs.mkdirSync(runRoot, { recursive: true });
    log("start", { runId, mode, collectorScript, converterScript, rawRoot, checkpointPath, productionPath });
    lock = acquireDanishLock({ lockPath, mode, isPidAlive: dependencies.isPidAlive || pidAlive });
    if (!lock.acquired) throw new Error(`danish-lock-active pid=${lock.current?.pid || "unknown"} mode=${lock.current?.mode || "unknown"}`);
    log("lock", { recoveredStale: lock.recoveredStale, pid: process.pid, mode });

    if (!fs.existsSync(productionPath)) throw new Error(`production-baseline-missing ${productionPath}`);
    const productionProducts = payloadProducts(readJson(productionPath));
    if (!productionProducts.length) throw new Error(`production-baseline-empty ${productionPath}`);
    log("production-baseline-loaded", { productionPath, count: productionProducts.length });
    const knownNonPublicComponentIds = fs.existsSync(unifiedProductsPath)
      ? nonPublicDanishComponentIds(readJson(unifiedProductsPath))
      : new Set();
    log("non-public-components-loaded", { unifiedProductsPath, count: knownNonPublicComponentIds.size });

    if (mode !== "dry-run" && !fs.existsSync(listPath)) {
      await runStage("collect-list", process.execPath, [collectorScript], {
        DANISH_MODE: "list",
        DANISH_LIST_OUTPUT: listPath,
        DANISH_OUTPUT: detailsPath,
        DANISH_ERRORS_OUTPUT: errorsPath,
        DANISH_BROWSER_PROFILE: path.join(root, "data/runtime/danish-browser-profile"),
        DANISH_CHECKPOINT_EVERY: compact(options.checkpointEvery || 10),
      });
    } else if (mode !== "dry-run") {
      report.stages["collect-list"] = { exitCode: 0, skipped: true, reason: "existing-list-reused" };
      log("existing-list-reused", { listPath });
    } else {
      report.stages["collect-list"] = { exitCode: 0, skipped: true, reason: "dry-run-reuses-raw" };
      log("stage-result", { stage: "collect-list", skipped: true, rawRoot });
    }

    if (!fs.existsSync(listPath)) throw new Error(`required-file-missing ${listPath}`);
    const listPayload = readJson(listPath);
    const listPatch = buildDanishListPatch({
      listProducts: payloadProducts(listPayload),
      productionProducts,
    });
    writeJson(listPatchPath, listPatch);
    const otherListPatchCount = listPatch.products.filter((entry) => entry.changedFields.some((field) => !["price", "status"].includes(field))).length;
    report.listPatch = listPatch;
    report.listPatchCount = listPatch.listPatchCount;
    report.pricePatchCount = listPatch.priceChangedCount;
    report.statusPatchCount = listPatch.statusChangedCount;
    report.otherListPatchCount = otherListPatchCount;
    report.identityAnomalyCount = listPatch.identityAnomalyCount;
    log("list-patch-built", { listPatchPath });
    log("list-patch-summary", { ...listPatch, products: undefined, identityAnomalies: undefined, otherListPatchCount });
    const detailQueue = buildIncrementalDetailQueue({
      listProducts: payloadProducts(listPayload),
      productionProducts,
      listPatch,
      nonPublicComponentIds: knownNonPublicComponentIds,
    });
    writeJson(detailQueuePath, detailQueue);
    const detailQueueGate = validateIncrementalDetailQueue({ detailQueue, productionProducts });
    report.detailQueue = { ...detailQueue, gate: detailQueueGate };
    report.detailQueueCount = detailQueue.queueCount;
    report.newDetailCount = detailQueue.newCount;
    report.reappearedDetailCount = detailQueue.reappearedCount;
    report.missingDetailCount = detailQueue.missingRequiredProductionDataCount;
    report.identityAnomalyCount = detailQueue.identityAnomalyCount;
    report.reusedProductionCount = detailQueue.reusedProductionCount;
    log("detail-queue-built", { detailQueuePath });
    log("detail-queue-summary", report.detailQueue);
    if (!detailQueueGate.passed) throw new Error(`detail-queue-validation-failed ${detailQueueGate.errors.join(",")}`);

    const preexistingDetailsPayload = fs.existsSync(detailsPath) ? readJson(detailsPath) : { products: [] };
    const alreadyCompletedDetailCount = successfulQueuedDetailRecords(preexistingDetailsPayload, detailQueue).length;
    if (mode !== "dry-run" && detailQueue.queueCount > 0) {
      await runStage("collect-details", process.execPath, [collectorScript], {
        DANISH_MODE: "details",
        DANISH_DETAIL_MODE: "incremental",
        DANISH_DETAIL_QUEUE_PATH: detailQueuePath,
        DANISH_LIST_OUTPUT: listPath,
        DANISH_OUTPUT: detailsPath,
        DANISH_ERRORS_OUTPUT: errorsPath,
        DANISH_BROWSER_PROFILE: path.join(root, "data/runtime/danish-browser-profile"),
        DANISH_CHECKPOINT_EVERY: compact(options.checkpointEvery || 10),
      });
    } else {
      report.stages["collect-details"] = { exitCode: 0, skipped: true, reason: detailQueue.queueCount === 0 ? "detail-queue-empty" : "dry-run-reuses-raw" };
      log("stage-result", { stage: "collect-details", ...report.stages["collect-details"] });
    }

    const detailsPayload = fs.existsSync(detailsPath) ? readJson(detailsPath) : { products: [], failCount: 0 };
    let errorPayload = { errors: [], failCount: Number(detailsPayload?.failCount || 0) };
    if (fs.existsSync(errorsPath)) errorPayload = readJson(errorsPath);
    const exclusions = collectionExclusions(detailsPayload);
    const collection = {
      ...validateCollection({
        listPayload,
        detailsPayload,
        productionProducts,
        minimumRatio: Number(options.minimumRatio || 0.65),
        incremental: true,
        detailQueue,
      }),
      ...exclusions,
      failureRecordCount: Math.max(
        Number(errorPayload?.failCount || 0),
        Array.isArray(errorPayload?.errors) ? errorPayload.errors.length : 0
      ),
      checkpoint: checkpointStatus(checkpointPath, detailsPayload),
    };
    report.collection = collection;
    report.detailProgress = summarizeQueuedDetails(detailsPayload, detailQueue, alreadyCompletedDetailCount);
    report.alreadyCompletedDetailCount = report.detailProgress.alreadyCompletedDetailCount;
    report.fetchedDetailCount = report.detailProgress.fetchedDetailCount;
    report.failedDetailCount = report.detailProgress.failedDetailCount;
    report.remainingDetailCount = report.detailProgress.unresolvedDetailCount;
    log("collection-summary", collection);
    log("detail-resume-state", report.detailProgress);
    if (!collection.passed) throw new Error(`collection-validation-failed ${collection.errors.join(",")}`);
    if (mode === "collect-only") {
      report.status = "collect-only-passed";
      return report;
    }

    const conversionInput = buildConversionInput(detailsPayload, detailQueue);
    writeJson(conversionInputPath, conversionInput);
    let convertedProducts = [];
    if (conversionInput.products.length > 0) {
      await runStage("convert", process.execPath, [converterScript], {
        DANISH_FULL_INPUT: conversionInputPath,
        DANISH_PRODUCTS_OUTPUT: convertedTsPath,
      });
      if (!fs.existsSync(convertedTsPath)) throw new Error(`conversion-output-missing ${convertedTsPath}`);
      convertedProducts = parseConvertedProducts(fs.readFileSync(convertedTsPath, "utf8"));
    } else {
      report.stages.convert = { exitCode: 0, skipped: true, reason: "no-successful-queued-details" };
      log("stage-result", { stage: "convert", ...report.stages.convert });
    }
    writeJson(convertedJsonPath, convertedProducts);
    const merged = mergeConvertedWithProduction({ convertedProducts, productionProducts });
    const candidateProducts = applyDanishListPatch({
      productionProducts: merged.products,
      listPatch,
    });
    const degradedFallbackGate = evaluateDegradedFieldFallbacks(
      merged.degradedFieldFallbacks,
      payloadProducts(listPayload).filter((item) => !isFalcon(item) && !isBpk32447(item)).length
    );
    report.degradedFieldFallbacks = merged.degradedFieldFallbacks;
    const conversion = {
      ...validateConversion({
        convertedProducts,
        collectedCount: collection.collectedCount,
        mergedProducts: candidateProducts,
        collection,
        incremental: true,
        detailQueue,
      }),
      retainedFromProduction: merged.retainedFromProduction,
    };
    report.conversion = conversion;
    report.diff = buildDifferenceSummary({
      collectedCount: collection.collectedCount,
      currentProducts: payloadProducts(listPayload).filter((item) => !isFalcon(item) && !isBpk32447(item)),
      candidateProducts,
      convertedCount: convertedProducts.length,
      productionProducts,
      failedDetails: collection.failedDetails,
      duplicates: collection.duplicates,
      checkpoint: collection.checkpoint,
    });
    report.diff.detailQueueCount = detailQueue.queueCount;
    report.diff.newDetailCount = detailQueue.newCount;
    report.diff.reappearedDetailCount = detailQueue.reappearedCount;
    report.diff.missingDetailCount = detailQueue.missingRequiredProductionDataCount;
    report.diff.identityAnomalyCount = detailQueue.identityAnomalyCount;
    report.diff.reusedProductionCount = detailQueue.reusedProductionCount;
    report.diff.listPatchCount = listPatch.listPatchCount;
    report.diff.pricePatchCount = listPatch.priceChangedCount;
    report.diff.statusPatchCount = listPatch.statusChangedCount;
    report.diff.otherListPatchCount = otherListPatchCount;
    report.diff.alreadyCompletedDetailCount = report.detailProgress.alreadyCompletedDetailCount;
    report.diff.fetchedDetailCount = report.detailProgress.fetchedDetailCount;
    report.diff.failedDetailCount = report.detailProgress.failedDetailCount;
    report.diff.remainingDetailCount = report.detailProgress.unresolvedDetailCount;
    report.allowPublish = conversion.passed && degradedFallbackGate.passed;
    report.diff.allowPublish = report.allowPublish;
    log("conversion-summary", conversion);
    log("degraded-field-fallbacks", { ...report.degradedFieldFallbacks, gate: degradedFallbackGate });
    log("difference-summary", report.diff);
    if (!conversion.passed) throw new Error(`conversion-validation-failed ${conversion.errors.join(",")}`);
    if (mode === "publish" && !report.allowPublish) {
      throw new Error(`publish-blocked-by-degraded-field-fallbacks ${degradedFallbackGate.errors.join(",")}`);
    }
    if (mode === "dry-run") {
      report.status = "dry-run-passed";
      return report;
    }

    fs.mkdirSync(backupRoot, { recursive: true });
    const backupPath = path.join(backupRoot, "danish-products.before.json");
    if (!fs.existsSync(backupPath)) fs.copyFileSync(productionPath, backupPath);
    report.backupCreated = true;
    log("backup", { created: true, path: backupPath });
    atomicWriteJson(productionPath, candidateProducts);
    report.productionWritten = true;
    log("production-write", { count: candidateProducts.length, productionPath });

    await runStage("rebuild-unified", process.execPath, [path.join(root, "scripts/build-unified-products-staging-v1.mjs")]);
    await runStage("rebuild-public", process.execPath, [path.join(root, "scripts/build-public-product-indexes-v1.mjs")]);
      await runStage("build", "cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"]);
    report.buildPassed = true;

    if (mode === "publish") {
      await runStage("git-diff-check", "git", ["diff", "--check"]);
      await runStage("git-add", "git", ["add", "--", "data/products/danish-products.json", "data/products/unified-products-staging.json", "data/generated/public-products"]);
      await runStage("git-commit", "git", ["commit", "-m", `chore: update Danish daily inventory ${runId}`]);
      report.commitExecuted = true;
      await runStage("git-push", "git", ["push", "origin", "HEAD"]);
      report.pushExecuted = true;
    }
    report.status = mode === "publish" ? "publish-passed" : "daily-passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.allowPublish = false;
    report.failureReason = compact(error?.message || error);
    log("failure", report.failureReason);
    return report;
  } finally {
    if (lock?.acquired) releaseDanishLock({ lockPath });
    report.finishedAt = new Date().toISOString();
    report.finishedAtLocal = localRunTime();
    report.durationSeconds = Number(((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000).toFixed(2));
    writeJson(summaryPath, report);
    log("final", { status: report.status, allowPublish: report.allowPublish, productionWritten: report.productionWritten, buildPassed: report.buildPassed, commitExecuted: report.commitExecuted, pushExecuted: report.pushExecuted, failureReason: report.failureReason });
  }
}

async function main() {
  const cli = parseArgs();
  const report = await runDanishDaily({
    mode: resolveMode(cli),
    runId: cli["run-id"],
    rawRoot: cli["raw-root"],
    runRoot: cli["run-root"],
    productionPath: cli["production-path"],
    backupRoot: cli["backup-root"],
    logPath: cli["log-path"],
    lockPath: cli["lock-path"],
    timeoutSeconds: cli["timeout-seconds"],
    checkpointEvery: cli["checkpoint-every"],
    minimumRatio: cli["minimum-ratio"],
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
