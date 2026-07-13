import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildSmokingpipesListUrl,
  detectSmokingpipesVerification,
  extractListProducts,
  getLargeProductImageUrl,
  launchSmokingpipesContext,
  saveVerificationScreenshot,
  summarizeSmokingpipesListProducts,
  waitForSmokingpipesManualRecovery,
} from "../lib/smokingpipes-utils.mjs";
import {
  PATHS,
  ROOT,
  isDirectExecution,
  normalizeText,
  parseCliOptions,
  parsePositiveInteger,
  relativePath,
  writeJsonAtomic,
} from "./inventory-common-v1.mjs";

const DEFAULT_DISPLAY_NUM = 48;
const DEFAULT_PAGE_DELAY_MIN_MS = 8000;
const DEFAULT_PAGE_DELAY_MAX_MS = 18000;
const DEFAULT_PAGE_WARMUP_MIN_MS = 3000;
const DEFAULT_PAGE_WARMUP_MAX_MS = 7000;
const DEFAULT_PAGE_BATCH_SIZE = 0;
const DEFAULT_PAGE_BATCH_COOLDOWN_MIN_MS = 0;
const DEFAULT_PAGE_BATCH_COOLDOWN_MAX_MS = 0;
const DEFAULT_CAPTCHA_COOLDOWN_MS = 60000;
const LIST_PRODUCT_SELECTOR =
  "a[href*='moreinfo.cfm'][href*='product_id=']";
const CHECKPOINT_PATH = path.join(
  ROOT,
  ".cache",
  "inventory-v1",
  "smokingpipes-current-list-checkpoint.json"
);
const FAILURE_SNAPSHOT_DIR = path.join(
  ROOT,
  "data",
  "review",
  "smokingpipes-failure-snapshots"
);
const OUT_OF_STOCK_TAIL_CACHE_PATH = path.join(
  ROOT,
  "data",
  "inventory",
  "smokingpipes-out-of-stock-tail-cache.json"
);
const FAILURE_SNAPSHOT_KEYWORDS = [
  "Cloudflare",
  "Just a moment",
  "Verify you are human",
  "Checking your browser",
  "challenge",
  "cf-chl",
  "Turnstile",
  "captcha",
  "Attention Required",
  "Access denied",
  "blocked",
];

function enabled(value) {
  return value === true || ["1", "true", "yes"].includes(
    String(value || "").toLowerCase()
  );
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveListPacingOptions(options = {}) {
  const hasLegacyFixedDelay =
    options.pageDelayMs !== undefined &&
    options.pageDelayMinMs === undefined &&
    options.pageDelayMaxMs === undefined;
  const pageDelayMinMs = hasLegacyFixedDelay
    ? nonNegativeInteger(options.pageDelayMs, DEFAULT_PAGE_DELAY_MIN_MS)
    : nonNegativeInteger(
        options.pageDelayMinMs,
        DEFAULT_PAGE_DELAY_MIN_MS
      );
  const requestedPageDelayMaxMs = hasLegacyFixedDelay
    ? pageDelayMinMs
    : nonNegativeInteger(
        options.pageDelayMaxMs,
        DEFAULT_PAGE_DELAY_MAX_MS
      );
  const pageWarmupMinMs = nonNegativeInteger(
    options.pageWarmupMinMs,
    DEFAULT_PAGE_WARMUP_MIN_MS
  );
  const requestedPageWarmupMaxMs = nonNegativeInteger(
    options.pageWarmupMaxMs,
    DEFAULT_PAGE_WARMUP_MAX_MS
  );
  const pageBatchSize = nonNegativeInteger(
    options.pageBatchSize,
    DEFAULT_PAGE_BATCH_SIZE
  );
  const pageBatchCooldownMinMs = nonNegativeInteger(
    options.pageBatchCooldownMinMs,
    DEFAULT_PAGE_BATCH_COOLDOWN_MIN_MS
  );
  const requestedPageBatchCooldownMaxMs = nonNegativeInteger(
    options.pageBatchCooldownMaxMs,
    DEFAULT_PAGE_BATCH_COOLDOWN_MAX_MS
  );

  return {
    pageDelayMinMs,
    pageDelayMaxMs: Math.max(pageDelayMinMs, requestedPageDelayMaxMs),
    pageWarmupMinMs,
    pageWarmupMaxMs: Math.max(
      pageWarmupMinMs,
      requestedPageWarmupMaxMs
    ),
    pageBatchSize,
    pageBatchCooldownMinMs,
    pageBatchCooldownMaxMs: Math.max(
      pageBatchCooldownMinMs,
      requestedPageBatchCooldownMaxMs
    ),
    captchaCooldownMs: nonNegativeInteger(
      options.captchaCooldownMs,
      DEFAULT_CAPTCHA_COOLDOWN_MS
    ),
  };
}

export function randomDelayMs(minimum, maximum, random = Math.random) {
  const min = Math.max(0, Math.floor(minimum));
  const max = Math.max(min, Math.floor(maximum));
  const sampled = min + Math.floor(random() * (max - min + 1));
  return Math.min(max, sampled);
}

export function shouldApplyPageBatchCooldown({
  pageNumber,
  maxPages,
  pageBatchSize,
}) {
  const batchSize = Math.max(0, Number(pageBatchSize) || 0);
  return (
    batchSize > 0 &&
    pageNumber < maxPages &&
    pageNumber % batchSize === 0
  );
}

function rangeInclusive(start, end) {
  const first = Math.max(1, Number(start) || 1);
  const last = Math.max(first - 1, Number(end) || 0);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) =>
    first + index
  );
}

export function detectSmokingpipesTotalPagesFromHtml(html = "") {
  const text = String(html || "");
  const pages = [];
  for (const match of text.matchAll(/[?&]page=(\d+)/gi)) {
    const pageNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pages.push(pageNumber);
    }
  }
  for (const match of text.matchAll(/\bpage\s+(\d+)\s+of\s+(\d+)\b/gi)) {
    const pageNumber = Number.parseInt(match[2], 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pages.push(pageNumber);
    }
  }
  for (const match of text.matchAll(/\b(?:last|末页|尾页)[^0-9]{0,40}(\d+)\b/gi)) {
    const pageNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pages.push(pageNumber);
    }
  }
  for (const match of text.matchAll(
    /<(?:a|span|button)[^>]*(?:page|pager|pagination|aria-label|aria-current)[^>]*>\s*(\d{1,4})\s*</gi
  )) {
    const pageNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      pages.push(pageNumber);
    }
  }
  const maxPage = pages.length ? Math.max(...pages) : 0;
  return maxPage > 1 ? maxPage : 0;
}

export function detectSmokingpipesPaginationFromHtml(html = "") {
  const text = String(html || "");
  const pageParams = [...text.matchAll(/[?&]page=(\d+)/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0);
  const detectedTotalPages = detectSmokingpipesTotalPagesFromHtml(text);
  const paginationLinksFound = pageParams.length;
  const paginationMaxPageParam = pageParams.length
    ? Math.max(...pageParams)
    : null;

  return {
    detectedTotalPages: detectedTotalPages || null,
    detectionConfidence: detectedTotalPages > 1 ? "high" : "low",
    paginationLinksFound,
    paginationMaxPageParam,
  };
}

async function detectSmokingpipesTotalPagesFromPage(page) {
  const html = await page.content().catch(() => "");
  return detectSmokingpipesPaginationFromHtml(html);
}

function normalizeTailStatus(value) {
  const text = normalizeText(value).toLowerCase();
  if (/out[\s-]+of[\s-]+stock|sold[\s-]+out|unavailable|sold/.test(text)) {
    return "out-of-stock";
  }
  if (text === "out-of-stock") return "out-of-stock";
  return text || "available";
}

function productStatusForTail(product) {
  return normalizeTailStatus(
    product?.rawListStatus ||
      product?.inventoryStatus ||
      product?.status ||
      product?.rawStatusText ||
      product?.rawText
  );
}

function pageProductsFromTailInput(pageSummary) {
  return Array.isArray(pageSummary?.products)
    ? pageSummary.products
    : Array.isArray(pageSummary?.normalizedProducts)
      ? pageSummary.normalizedProducts
      : [];
}

function isOutOfStockOnlyPage(pageSummary) {
  const products = pageProductsFromTailInput(pageSummary);
  const productCount = Number(pageSummary?.productCount || products.length || 0);
  const outOfStockCount = Number(pageSummary?.outOfStockCount || 0);
  if (productCount <= 0) return false;
  if (outOfStockCount >= productCount) return true;
  return (
    products.length > 0 &&
    products.every((product) => productStatusForTail(product) === "out-of-stock")
  );
}

function hashTailPageStatus(records) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(records))
    .digest("hex");
}

function buildOutOfStockTailCachePage(pageSummary) {
  const products = pageProductsFromTailInput(pageSummary);
  const statusRecords = products
    .map((product) => ({
      sourceProductId: normalizeText(product?.sourceProductId),
      status: productStatusForTail(product),
    }))
    .filter((item) => item.sourceProductId)
    .sort((a, b) => a.sourceProductId.localeCompare(b.sourceProductId));

  return {
    page: Number(pageSummary?.page),
    productCount: Number(pageSummary?.productCount || products.length || 0),
    outOfStockCount: Number(
      pageSummary?.outOfStockCount ||
        statusRecords.filter((item) => item.status === "out-of-stock").length
    ),
    productIds: statusRecords.map((item) => item.sourceProductId),
    statusHash: hashTailPageStatus(statusRecords),
  };
}

export function buildSmokingpipesOutOfStockTailCache({
  pages = [],
  tailStartPage,
  detectedTotalPages,
  confirmedAt = new Date().toISOString(),
} = {}) {
  const tailStart = Number(tailStartPage || 0);
  const totalPages = Number(detectedTotalPages || 0);
  const tailPages = pages
    .filter((page) => Number(page?.page) >= tailStart)
    .sort((a, b) => Number(a.page) - Number(b.page));

  return {
    version: "smokingpipes-out-of-stock-tail-cache-v1",
    source: "smokingpipes",
    confirmedAt,
    detectedTotalPages: totalPages,
    tailStartPage: tailStart,
    tailEndPage: totalPages,
    pages: tailPages.map(buildOutOfStockTailCachePage),
  };
}

export function evaluateSmokingpipesOutOfStockTail({
  pages = [],
  detectedTotalPages,
  confirmedAt = new Date().toISOString(),
} = {}) {
  const totalPages = Number(detectedTotalPages || 0);
  const byPage = new Map(
    pages.map((page) => [Number(page?.page), page]).filter(([page]) => page > 0)
  );
  let tailStart = null;

  for (let pageNumber = totalPages; pageNumber >= 1; pageNumber -= 1) {
    const pageSummary = byPage.get(pageNumber);
    if (!pageSummary || !isOutOfStockOnlyPage(pageSummary)) break;
    tailStart = pageNumber;
  }

  const tailCache = tailStart
    ? buildSmokingpipesOutOfStockTailCache({
        pages: rangeInclusive(tailStart, totalPages)
          .map((pageNumber) => byPage.get(pageNumber))
          .filter(Boolean),
        tailStartPage: tailStart,
        detectedTotalPages: totalPages,
        confirmedAt,
      })
    : null;

  return {
    firstOutOfStockOnlyPage: tailStart,
    tailCache,
  };
}

export function evaluateSmokingpipesOutOfStockTailCache({
  cache,
  detectedTotalPages,
  now = new Date().toISOString(),
  maxAgeHours = 24,
} = {}) {
  if (!cache || typeof cache !== "object") {
    return { usable: false, reason: "missing" };
  }
  if (cache.version !== "smokingpipes-out-of-stock-tail-cache-v1") {
    return { usable: false, reason: "version-mismatch" };
  }
  if (Number(cache.detectedTotalPages || 0) !== Number(detectedTotalPages || 0)) {
    return { usable: false, reason: "page-count-changed" };
  }
  const confirmedAt = new Date(cache.confirmedAt || 0);
  const nowDate = new Date(now);
  if (
    Number.isNaN(confirmedAt.getTime()) ||
    Number.isNaN(nowDate.getTime())
  ) {
    return { usable: false, reason: "invalid-timestamp" };
  }
  const ageHours = (nowDate.getTime() - confirmedAt.getTime()) / 3600000;
  if (ageHours < 0 || ageHours > Number(maxAgeHours || 0)) {
    return { usable: false, reason: "expired" };
  }
  const tailStart = Number(cache.tailStartPage || 0);
  const tailEnd = Number(cache.tailEndPage || 0);
  const expectedPageCount = Math.max(0, tailEnd - tailStart + 1);
  if (
    tailStart <= 0 ||
    tailEnd !== Number(detectedTotalPages || 0) ||
    !Array.isArray(cache.pages) ||
    cache.pages.length !== expectedPageCount
  ) {
    return { usable: false, reason: "incomplete-tail-cache" };
  }
  return {
    usable: true,
    reason: "valid",
    tailStartPage: tailStart,
    tailEndPage: tailEnd,
    skippedPages: rangeInclusive(tailStart, tailEnd),
  };
}

export function buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages,
  expectedPages,
  detectedTotalPages = 0,
  detectionConfidence = null,
  paginationLinksFound = 0,
  paginationMaxPageParam = null,
  startPage = 1,
  tailCache = null,
  now = new Date().toISOString(),
  tailCacheMaxAgeHours = 24,
} = {}) {
  const requested = Math.max(1, Number(requestedMaxPages || 1));
  const fallbackExpected = Math.max(1, Number(expectedPages || requested));
  const detected = Math.max(0, Number(detectedTotalPages || 0));
  const resolvedExpectedPages = detected || fallbackExpected || requested;
  const requestedUpperBound = detected ? resolvedExpectedPages : requested;
  const cacheEvaluation = evaluateSmokingpipesOutOfStockTailCache({
    cache: tailCache,
    detectedTotalPages: resolvedExpectedPages,
    now,
    maxAgeHours: tailCacheMaxAgeHours,
  });
  const tailCacheUsed = cacheEvaluation.usable === true;
  const firstOutOfStockOnlyPage = tailCacheUsed
    ? cacheEvaluation.tailStartPage
    : null;
  const lastPageToVisit = tailCacheUsed
    ? Math.max(0, cacheEvaluation.tailStartPage - 1)
    : requestedUpperBound;
  const pagesToVisit = rangeInclusive(startPage, lastPageToVisit);
  const skippedOutOfStockTailPages = tailCacheUsed
    ? cacheEvaluation.skippedPages
    : [];

  return {
    requestedMaxPages: requested,
    detectedTotalPages: detected || null,
    detectionConfidence: detected
      ? detectionConfidence || "high"
      : "low",
    paginationLinksFound: Number(paginationLinksFound || 0),
    paginationMaxPageParam:
      paginationMaxPageParam === null || paginationMaxPageParam === undefined
        ? null
        : Number(paginationMaxPageParam),
    expectedPages: resolvedExpectedPages,
    pagesToVisit,
    effectiveLastPageToVisit: lastPageToVisit,
    effectiveScannedPages: pagesToVisit.length + skippedOutOfStockTailPages.length,
    firstOutOfStockOnlyPage,
    skippedOutOfStockTailPages,
    tailCacheUsed,
    tailCacheReason: cacheEvaluation.reason,
    safety: {
      soldByAbsenceAllowed: !tailCacheUsed,
      disappearedApplyAllowed: !tailCacheUsed,
    },
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSnapshotTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
}

export function classifySmokingpipesFailureSnapshotText({
  title = "",
  html = "",
  bodyText = "",
} = {}) {
  const haystack = `${title}\n${html}\n${bodyText}`;
  const keywordsFound = FAILURE_SNAPSHOT_KEYWORDS.filter((keyword) =>
    new RegExp(escapeRegExp(keyword), "i").test(haystack)
  );
  const cloudflareSuspected = keywordsFound.some((keyword) =>
    /cloudflare|just a moment|checking your browser|cf-chl|turnstile/i.test(
      keyword
    )
  );
  const verificationSuspected = keywordsFound.some((keyword) =>
    /verify|challenge|turnstile|captcha|attention required|access denied|blocked|cf-chl/i.test(
      keyword
    )
  );

  return {
    cloudflareSuspected,
    verificationSuspected,
    blockedPageSuspected:
      cloudflareSuspected ||
      verificationSuspected ||
      keywordsFound.length > 0,
    keywordsFound,
  };
}

export function shouldTreatSmokingpipesEmptyListPageAsEndOfList({
  pageNumber = 1,
  productCount = 0,
  detectionConfidence = "low",
  detectedTotalPages = null,
  classification = {},
  strongVerificationSignals = [],
} = {}) {
  const parsedProductCount = Number(productCount || 0);
  const currentPageNumber = Number(pageNumber || 0);
  const blockedOrVerificationSignal =
    classification.cloudflareSuspected === true ||
    classification.verificationSuspected === true ||
    classification.blockedPageSuspected === true ||
    (Array.isArray(classification.keywordsFound) &&
      classification.keywordsFound.length > 0) ||
    (Array.isArray(strongVerificationSignals) &&
      strongVerificationSignals.length > 0);

  if (parsedProductCount > 0) {
    return {
      endOfList: false,
      reason: "products-parsed",
      shouldWriteFailureSnapshot: false,
    };
  }

  if (currentPageNumber <= 1) {
    return {
      endOfList: false,
      reason: "first-page-empty",
      shouldWriteFailureSnapshot: true,
    };
  }

  if (blockedOrVerificationSignal) {
    return {
      endOfList: false,
      reason: "blocked-or-verification-signal",
      shouldWriteFailureSnapshot: true,
    };
  }

  const hasHighConfidenceTotal =
    detectionConfidence === "high" && Number(detectedTotalPages || 0) > 1;
  if (hasHighConfidenceTotal) {
    return {
      endOfList: false,
      reason: "outside-fallback-scan",
      shouldWriteFailureSnapshot: true,
    };
  }

  return {
    endOfList: true,
    reason: "empty-out-of-range-page",
    endOfListPage: currentPageNumber,
    effectiveLastProductPage: currentPageNumber - 1,
    shouldWriteFailureSnapshot: false,
  };
}

export function buildSmokingpipesFailureSnapshotMetadata({
  source = "smokingpipes",
  stage = "current-list",
  page: pageNumber = null,
  url = "",
  title = "",
  html = "",
  bodyText = "",
  errorMessage = "",
  selector = LIST_PRODUCT_SELECTOR,
  screenshotPath = null,
  htmlPath = null,
  capturedAt = new Date().toISOString(),
} = {}) {
  const classification = classifySmokingpipesFailureSnapshotText({
    title,
    html,
    bodyText,
  });

  return {
    source,
    stage,
    page: pageNumber,
    url,
    title,
    capturedAt,
    errorMessage,
    selector,
    ...classification,
    screenshotPath,
    htmlPath,
  };
}

export async function writeSmokingpipesFailureSnapshot({
  page: browserPage,
  pageNumber,
  url,
  stage = "current-list",
  errorMessage,
  selector = LIST_PRODUCT_SELECTOR,
  snapshotDir = FAILURE_SNAPSHOT_DIR,
} = {}) {
  await fs.promises.mkdir(snapshotDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const timestamp = toSnapshotTimestamp(new Date(capturedAt));
  const baseName = `smokingpipes-${stage}-page-${pageNumber}-${timestamp}`;
  const absoluteHtmlPath = path.join(snapshotDir, `${baseName}.html`);
  const absoluteScreenshotPath = path.join(snapshotDir, `${baseName}.png`);
  const absoluteMetadataPath = path.join(snapshotDir, `${baseName}.json`);
  let title = "";
  let html = "";
  let screenshotPath = relativePath(absoluteScreenshotPath);

  try {
    title = await browserPage.title();
  } catch {
    title = "";
  }

  try {
    html = await browserPage.content();
  } catch (error) {
    html = `<!-- failed to capture html: ${error.message} -->`;
  }

  await fs.promises.writeFile(absoluteHtmlPath, html, "utf8");

  try {
    await browserPage.screenshot({
      path: absoluteScreenshotPath,
      fullPage: true,
    });
  } catch {
    screenshotPath = null;
  }

  const metadata = buildSmokingpipesFailureSnapshotMetadata({
    source: "smokingpipes",
    stage,
    page: pageNumber,
    url,
    title,
    html,
    errorMessage,
    selector,
    screenshotPath,
    htmlPath: relativePath(absoluteHtmlPath),
    capturedAt,
  });
  await fs.promises.writeFile(
    absoluteMetadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );

  return {
    metadata,
    metadataPath: relativePath(absoluteMetadataPath),
    htmlPath: metadata.htmlPath,
    screenshotPath: metadata.screenshotPath,
  };
}

async function waitForManualVerification(page, targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatusAt = 0;

  await page.bringToFront().catch(() => {});
  console.warn(
    `Smokingpipes CAPTCHA detected. Complete it in the opened browser within ${Math.round(
      timeoutMs / 60000
    )} minutes.`
  );
  console.warn(`Waiting on the script-controlled page: ${targetUrl}`);

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    let detection = await detectSmokingpipesVerification(page, {
      pageKind: "list",
    });

    if (detection.signals?.hasListProductLinks) {
      return true;
    }

    if (!detection.verificationBlocked) {
      console.warn(
        "Verification cleared; returning to requested list page for confirmation."
      );

      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      detection = await detectSmokingpipesVerification(page, {
        pageKind: "list",
        httpStatus: response?.status() || 0,
      });

      if (detection.signals?.hasListProductLinks) {
        return true;
      }
    }

    if (Date.now() - lastStatusAt >= 30000) {
      lastStatusAt = Date.now();
      console.warn(
        JSON.stringify(
          {
            verificationWaiting: true,
            url: page.url(),
            title: detection.signals?.title || "",
            productLinks: detection.signals?.hasListProductLinks || false,
            hasPrice: detection.signals?.hasPrice || false,
            reasons: detection.reasons,
          },
          null,
          2
        )
      );
    }
  }

  return false;
}

function normalizeListProduct(item, scrapedAt) {
  const sourceUrl = normalizeText(item.sourceUrl || item.href);
  const sourceProductId =
    normalizeText(item.sourceProductId) ||
    sourceUrl.match(/[?&]product_id=(\d+)/i)?.[1] ||
    "";
  const title = normalizeText(item.title);
  const mainImage = getLargeProductImageUrl(
    normalizeText(item.imageUrl || item.mainImage)
  );
  const rawText = normalizeText(item.rawText);
  const rawListStatus =
    /\b(?:out[\s-]+of[\s-]+stock|sold[\s-]+out|unavailable)\b/i.test(
      rawText
    )
      ? "out-of-stock"
      : "";

  return {
    source: "smokingpipes",
    sourceProductId,
    sourceUrl,
    title,
    rawTitle: title,
    brand: normalizeText(item.brand),
    price: normalizeText(item.price),
    originalPrice: normalizeText(item.originalPrice),
    image: mainImage,
    mainImage,
    productCode: normalizeText(item.productCode),
    rawListStatus,
    rawText,
    listPage: Number(item.listPage) || null,
    listPosition: Number(item.listPosition) || null,
    scrapedAt,
  };
}

function dedupeCurrentProducts(products) {
  const byId = new Map();
  const duplicateIds = [];

  for (const product of products) {
    const key = product.sourceProductId || product.sourceUrl;
    if (!key) continue;
    if (byId.has(key)) duplicateIds.push(product.sourceProductId || key);
    else byId.set(key, product);
  }

  return {
    products: [...byId.values()],
    duplicateIds: [...new Set(duplicateIds)],
  };
}

function readCheckpoint(maxPages, expectedPages, displayNum) {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;

  try {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    const matches =
      checkpoint?.version === "smokingpipes-current-list-checkpoint-v1" &&
      checkpoint?.config?.maxPages === maxPages &&
      checkpoint?.config?.expectedPages === expectedPages &&
      checkpoint?.config?.displayNum === displayNum &&
      Array.isArray(checkpoint.pages) &&
      Array.isArray(checkpoint.products);

    return matches ? checkpoint : null;
  } catch {
    return null;
  }
}

async function writeCheckpoint(payload) {
  await fs.promises.mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  const tempPath = `${CHECKPOINT_PATH}.tmp-${process.pid}`;
  await fs.promises.writeFile(
    tempPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  JSON.parse(await fs.promises.readFile(tempPath, "utf8"));
  await fs.promises.copyFile(tempPath, CHECKPOINT_PATH);
  await fs.promises.rm(tempPath, { force: true });
}

function readOutOfStockTailCache(cachePath = OUT_OF_STOCK_TAIL_CACHE_PATH) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8").replace(/^\ufeff/, ""));
  } catch {
    return null;
  }
}

async function writeOutOfStockTailCache(
  cache,
  cachePath = OUT_OF_STOCK_TAIL_CACHE_PATH
) {
  if (!cache) return;
  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.promises.writeFile(
    cachePath,
    `${JSON.stringify(cache, null, 2)}\n`,
    "utf8"
  );
}

async function waitForListProducts(page) {
  await page.waitForSelector(
    LIST_PRODUCT_SELECTOR,
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);
}

async function gotoSmokingpipesListPageWithRetry({ page, url }) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    try {
      return await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (error) {
      lastError = error;
      if (retry === maxRetries) break;

      const retryDelayMs = randomDelayMs(2000, 5000);
      console.warn(
        `Smokingpipes list navigation failed; retry ${retry + 1}/${maxRetries} after ${retryDelayMs} ms: ${error.message}`
      );
      if (retryDelayMs > 0) await page.waitForTimeout(retryDelayMs);
    }
  }

  throw lastError;
}

export async function fetchSmokingpipesCurrentList(options = {}) {
  const maxPages = parsePositiveInteger(options.maxPages, 3);
  const expectedPages = parsePositiveInteger(
    options.expectedPages,
    maxPages
  );
  const displayNum = parsePositiveInteger(
    options.displayNum,
    DEFAULT_DISPLAY_NUM
  );
  const pacing = resolveListPacingOptions(options);
  const verbose = enabled(options.verbose);
  const onPageTelemetry =
    typeof options.onPageTelemetry === "function"
      ? options.onPageTelemetry
      : async () => {};
  const allowManualVerification = enabled(options.allowManualVerification);
  const manualVerificationTimeoutMs = parsePositiveInteger(
    options.manualVerificationTimeoutMs,
    10 * 60 * 1000
  );
  const checkpoint =
    options.useCheckpoint === false
      ? null
      : readCheckpoint(maxPages, expectedPages, displayNum);
  const startedAt =
    checkpoint?.startedAt || new Date().toISOString();
  const pages = checkpoint?.pages || [];
  const collected = checkpoint?.products || [];
  const failedPages = Array.isArray(checkpoint?.failedPages)
    ? checkpoint.failedPages
    : [];
  const outOfStockTailPageInputs = [];
  const firstPage = pages.length
    ? Math.max(...pages.map((item) => Number(item.page) || 0)) + 1
    : 1;
  let detectedTotalPages = Number(checkpoint?.detectedTotalPages || 0) || null;
  let detectionConfidence = checkpoint?.detectionConfidence || "low";
  let paginationLinksFound = Number(checkpoint?.paginationLinksFound || 0);
  let paginationMaxPageParam =
    checkpoint?.paginationMaxPageParam === undefined
      ? null
      : checkpoint.paginationMaxPageParam;
  let adaptivePlan = buildSmokingpipesAdaptiveScanPlan({
    requestedMaxPages: maxPages,
    expectedPages,
    detectedTotalPages,
    detectionConfidence,
    paginationLinksFound,
    paginationMaxPageParam,
    startPage: firstPage,
  });
  let effectiveMaxPages = adaptivePlan.effectiveLastPageToVisit;
  let firstOutOfStockOnlyPage = null;
  let skippedOutOfStockTailPages = [];
  let tailCacheUsed = false;
  let tailCacheReason = "not-evaluated";
  const outOfStockTailCachePath =
    options.outOfStockTailCachePath || OUT_OF_STOCK_TAIL_CACHE_PATH;
  const outOfStockTailCache =
    options.useOutOfStockTailCache === false
      ? null
      : readOutOfStockTailCache(outOfStockTailCachePath);
  let captchaDetected = false;
  const captchaPages = [];
  const weakVerificationPages = [];
  let verificationDetectedAt = null;
  let manualVerificationRecovered = false;
  let endedByEmptyOutOfRangePage = false;
  let endOfListPage = null;
  const writeCurrentCheckpoint = async () => {
    if (options.useCheckpoint === false) return;
    await writeCheckpoint({
      version: "smokingpipes-current-list-checkpoint-v1",
      startedAt,
      updatedAt: new Date().toISOString(),
      config: {
        maxPages,
        expectedPages,
        detectedTotalPages,
        detectionConfidence,
        paginationLinksFound,
        paginationMaxPageParam,
        effectiveMaxPages,
        displayNum,
        ...pacing,
      },
      detectedTotalPages,
      detectionConfidence,
      paginationLinksFound,
      paginationMaxPageParam,
      pages,
      failedPages,
      products: collected,
    });
  };

  process.env.SMOKINGPIPES_HEADLESS = allowManualVerification
    ? "false"
    : process.env.SMOKINGPIPES_HEADLESS || "true";

  const browserSession = await launchSmokingpipesContext({
    root: options.root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
    profileLockPath: options.browserProfileLockPath,
    runId: options.runId,
    mode: options.mode || "list-fetch",
  });
  const context = browserSession.context;
  const browser = browserSession.browser;
  const page = context.pages()[0] || (await context.newPage());

  try {
    if (checkpoint) {
      console.log(
        `Resuming dry-run checkpoint at page ${firstPage}/${effectiveMaxPages} with ${collected.length} products.`
      );
    }

    for (
      let pageNumber = firstPage;
      pageNumber <= effectiveMaxPages;
      pageNumber += 1
    ) {
      const url = buildSmokingpipesListUrl("new", pageNumber, displayNum);
      const pageStartedAt = new Date().toISOString();
      let pageVerificationDetectedAt = null;
      let pageManualVerificationRecovered = false;
      console.log(
        verbose
          ? `fetching page ${pageNumber}/${effectiveMaxPages}`
          : `Fetching Smokingpipes list page ${pageNumber}/${effectiveMaxPages}`
      );

      let response;
      try {
        response = await gotoSmokingpipesListPageWithRetry({
          page,
          url,
        });
      } catch (error) {
        if (!failedPages.includes(pageNumber)) failedPages.push(pageNumber);
        await writeCurrentCheckpoint();
        const pageEndedAt = new Date().toISOString();
        await onPageTelemetry({
          page: pageNumber,
          url,
          startedAt: pageStartedAt,
          endedAt: pageEndedAt,
          durationMs: Date.parse(pageEndedAt) - Date.parse(pageStartedAt),
          warmupMs: 0,
          delayMs: 0,
          batchCooldownMs: 0,
          productsParsed: 0,
          outOfStockProducts: 0,
          missingPriceProducts: 0,
          weakVerificationSignals: [],
          strongVerificationSignals: [],
          finalClassification: "navigation-failed",
          navigationError: error instanceof Error ? error.message : String(error),
          screenshotPath: null,
          htmlSamplePath: null,
          verificationDetectedAt: null,
          manualVerificationAllowed: allowManualVerification,
          manualVerificationRecovered: false,
        });
        console.warn(
          `Smokingpipes list page ${pageNumber} failed after 3 retries; preserving completed pages and continuing.`
        );
        continue;
      }
      const warmupDelayMs = randomDelayMs(
        pacing.pageWarmupMinMs,
        pacing.pageWarmupMaxMs
      );
      if (verbose) console.log(`warmup delay: ${warmupDelayMs} ms`);
      if (warmupDelayMs > 0) {
        await page.waitForTimeout(warmupDelayMs);
      }

      const paginationDetection =
        await detectSmokingpipesTotalPagesFromPage(page).catch(() => ({
          detectedTotalPages: null,
          detectionConfidence: "low",
          paginationLinksFound: 0,
          paginationMaxPageParam: null,
        }));
      detectionConfidence = paginationDetection.detectionConfidence || "low";
      paginationLinksFound = Number(paginationDetection.paginationLinksFound || 0);
      paginationMaxPageParam =
        paginationDetection.paginationMaxPageParam ?? null;
      if (
        paginationDetection.detectedTotalPages &&
        paginationDetection.detectedTotalPages !== detectedTotalPages
      ) {
        detectedTotalPages = paginationDetection.detectedTotalPages;
        adaptivePlan = buildSmokingpipesAdaptiveScanPlan({
          requestedMaxPages: maxPages,
          expectedPages,
          detectedTotalPages,
          detectionConfidence,
          paginationLinksFound,
          paginationMaxPageParam,
          startPage: pageNumber,
          tailCache: outOfStockTailCache,
          now: new Date().toISOString(),
          tailCacheMaxAgeHours: nonNegativeInteger(
            options.outOfStockTailCacheMaxAgeHours,
            24
          ),
        });
        effectiveMaxPages = adaptivePlan.effectiveLastPageToVisit;
        firstOutOfStockOnlyPage = adaptivePlan.firstOutOfStockOnlyPage;
        skippedOutOfStockTailPages =
          adaptivePlan.skippedOutOfStockTailPages;
        tailCacheUsed = adaptivePlan.tailCacheUsed;
        tailCacheReason = adaptivePlan.tailCacheReason;
        if (verbose) {
          console.log(
            `detected pagination total pages: ${detectedTotalPages}; effective last page: ${effectiveMaxPages}; tail cache: ${tailCacheReason}`
          );
        }
      } else if (!detectedTotalPages) {
        adaptivePlan = buildSmokingpipesAdaptiveScanPlan({
          requestedMaxPages: maxPages,
          expectedPages,
          detectedTotalPages: 0,
          detectionConfidence,
          paginationLinksFound,
          paginationMaxPageParam,
          startPage: pageNumber,
        });
      }

      const detection = await detectSmokingpipesVerification(page, {
        pageKind: "list",
        httpStatus: response?.status() || 0,
      });

      let waitError = null;
      await waitForListProducts(page).catch((error) => {
        waitError = error;
      });
      let extracted = await extractListProducts(page, url, "new").catch(
        () => []
      );
      const verificationSignals = [
        ...(detection.weakVerificationSignals || []),
        ...(detection.strongVerificationSignals || []),
      ];
      const parsedNormalProducts = extracted.length > 0;
      let finalWeakSignals = parsedNormalProducts
        ? verificationSignals
        : detection.weakVerificationSignals || [];
      let finalStrongSignals = parsedNormalProducts
        ? []
        : detection.strongVerificationSignals || [];
      let finalClassification = parsedNormalProducts
        ? finalWeakSignals.length
          ? "normal-content-with-verification-warning"
          : "normal-content"
        : finalStrongSignals.length
          ? "strong-verification"
          : "empty-or-parse-failure";

      if (!parsedNormalProducts && finalStrongSignals.length) {
        pageVerificationDetectedAt = new Date().toISOString();
        verificationDetectedAt ||= pageVerificationDetectedAt;
        let recovery = null;
        if (allowManualVerification) {
          recovery =
            await waitForSmokingpipesManualRecovery(page, {
              pageKind: "list",
              timeoutMs: manualVerificationTimeoutMs,
              verbose,
              restoreTargetPage: async (targetPage) => {
                await targetPage.goto(url, {
                  waitUntil: "domcontentloaded",
                  timeout: 60000,
                });
              },
              verifyNormalContent: async (targetPage) => {
                await waitForListProducts(targetPage).catch(
                  () => {}
                );
                const products = await extractListProducts(
                  targetPage,
                  url,
                  "new"
                ).catch(() => []);
                return {
                  valid: products.some(
                    (item) =>
                      item.sourceProductId && item.sourceUrl
                  ),
                  parsedValue: products,
                };
              },
            });
          verificationDetectedAt =
            recovery.verificationDetectedAt ||
            verificationDetectedAt;
          pageVerificationDetectedAt =
            recovery.verificationDetectedAt ||
            pageVerificationDetectedAt;
          manualVerificationRecovered =
            recovery.manualVerificationRecovered;
          pageManualVerificationRecovered =
            recovery.manualVerificationRecovered;
        }

        if (recovery?.recovered) {
          extracted = recovery.parsedValue || [];
          finalWeakSignals = [];
          finalStrongSignals = [];
          finalClassification = "normal-content";
          console.warn(
            `Smokingpipes manual verification recovered on page ${pageNumber}; normal product cards were parsed successfully.`
          );
        } else {
          captchaDetected = true;
          captchaPages.push(pageNumber);
          const screenshotPath =
            await saveVerificationScreenshot(page);
          const pageEndedAt = new Date().toISOString();
          const pageTelemetry = {
            page: pageNumber,
            url,
            startedAt: pageStartedAt,
            endedAt: pageEndedAt,
            durationMs:
              Date.parse(pageEndedAt) -
              Date.parse(pageStartedAt),
            warmupMs: warmupDelayMs,
            delayMs: 0,
            productsParsed: 0,
            outOfStockProducts: 0,
            missingPriceProducts: 0,
            weakVerificationSignals: finalWeakSignals,
            strongVerificationSignals: finalStrongSignals,
            finalClassification,
            screenshotPath: screenshotPath || null,
            htmlSamplePath: null,
            verificationDetectedAt:
              pageVerificationDetectedAt,
            manualVerificationAllowed:
              allowManualVerification,
            manualVerificationRecovered: false,
          };
          await onPageTelemetry(pageTelemetry);
          console.warn(
            `Smokingpipes strong verification detected on page ${pageNumber}. Access is stopping immediately; no automatic bypass will be attempted.`
          );
          const error = Object.assign(
            new Error(
              `Smokingpipes strong verification blocked page ${pageNumber}; no further pages were requested.`
            ),
            {
              code: "CAPTCHA_REQUIRED",
              pageNumber,
              pageTelemetry,
              captchaDetected: true,
              browser,
              verificationDetectedAt:
                pageVerificationDetectedAt,
              manualVerificationRecovered: false,
            }
          );
          throw error;
        }
      }

      if (extracted.length === 0) {
        const emptyPageTitle = await page.title().catch(() => "");
        const emptyPageHtml = await page.content().catch(() => "");
        const emptyPageClassification =
          classifySmokingpipesFailureSnapshotText({
            title: emptyPageTitle,
            html: emptyPageHtml,
          });
        const emptyEndDecision =
          shouldTreatSmokingpipesEmptyListPageAsEndOfList({
            pageNumber,
            productCount: extracted.length,
            detectionConfidence,
            detectedTotalPages,
            classification: emptyPageClassification,
            strongVerificationSignals: finalStrongSignals,
          });

        if (emptyEndDecision.endOfList) {
          endedByEmptyOutOfRangePage = true;
          endOfListPage = emptyEndDecision.endOfListPage;
          effectiveMaxPages = emptyEndDecision.effectiveLastProductPage;
          if (verbose) {
            console.log(
              `normal end-of-list detected at page ${pageNumber}; treating page ${effectiveMaxPages} as the final product page`
            );
          }
          await onPageTelemetry({
            page: pageNumber,
            url,
            startedAt: pageStartedAt,
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - Date.parse(pageStartedAt),
            warmupMs: warmupDelayMs,
            delayMs: 0,
            batchCooldownMs: 0,
            productsParsed: 0,
            outOfStockProducts: 0,
            missingPriceProducts: 0,
            weakVerificationSignals: finalWeakSignals,
            strongVerificationSignals: [],
            finalClassification: "empty-out-of-range-end-of-list",
            screenshotPath: null,
            htmlSamplePath: null,
            verificationDetectedAt: null,
            manualVerificationAllowed: allowManualVerification,
            manualVerificationRecovered: false,
          });
          break;
        }

        const parseFailureMessage =
          `No products were extracted from requested page ${pageNumber}; parse failure${waitError ? `: ${waitError.message}` : ""}.`;
        const failureSnapshot =
          await writeSmokingpipesFailureSnapshot({
            page,
            pageNumber,
            url,
            stage: "current-list",
            errorMessage: parseFailureMessage,
            selector: LIST_PRODUCT_SELECTOR,
          }).catch((error) => ({
            errorMessage: `failed to write failure snapshot: ${error.message}`,
          }));
        if (failureSnapshot?.metadataPath) {
          console.warn(
            `Smokingpipes current-list failure snapshot written: ${failureSnapshot.metadataPath}`
          );
        } else if (failureSnapshot?.errorMessage) {
          console.warn(failureSnapshot.errorMessage);
        }
        throw Object.assign(new Error(parseFailureMessage), {
          code: "CURRENT_LIST_PARSE_FAILURE",
          pageNumber,
          failureSnapshot,
        });
      }

      const scrapedAt = new Date().toISOString();
      const normalized = extracted.map((item) =>
        normalizeListProduct(item, scrapedAt)
      );
      const pageProductSummary =
        summarizeSmokingpipesListProducts(extracted);
      if (finalWeakSignals.length) {
        weakVerificationPages.push(pageNumber);
      }
      if (verbose) {
        console.log(`page parsed: ${normalized.length} products`);
        console.log(
          `out-of-stock products on page: ${pageProductSummary.outOfStockCount}`
        );
        console.log(
          `missing-price products on page: ${pageProductSummary.missingPriceCount}`
        );
      }
      collected.push(...normalized);
      const pageBatchCooldownMs =
        pageNumber < effectiveMaxPages &&
        shouldApplyPageBatchCooldown({
          pageNumber,
          maxPages: effectiveMaxPages,
          pageBatchSize: pacing.pageBatchSize,
        })
          ? randomDelayMs(
              pacing.pageBatchCooldownMinMs,
              pacing.pageBatchCooldownMaxMs
            )
          : 0;
      const nextPageDelayMs =
        pageNumber < effectiveMaxPages
          ? randomDelayMs(
              pacing.pageDelayMinMs,
              pacing.pageDelayMaxMs
            )
          : 0;
      const pageEndedAt = new Date().toISOString();
      pages.push({
        page: pageNumber,
        url,
        httpStatus: response?.status() || null,
        productCount: normalized.length,
        outOfStockCount: pageProductSummary.outOfStockCount,
        missingPriceCount: pageProductSummary.missingPriceCount,
        outOfStockOnly:
          normalized.length > 0 &&
          pageProductSummary.outOfStockCount >= normalized.length,
        scrapedAt,
        weakVerificationSignals: finalWeakSignals,
        strongVerificationSignals: [],
        finalClassification,
      });
      outOfStockTailPageInputs.push({
        page: pageNumber,
        productCount: normalized.length,
        outOfStockCount: pageProductSummary.outOfStockCount,
        products: normalized,
      });
      await onPageTelemetry({
        page: pageNumber,
        url,
        startedAt: pageStartedAt,
        endedAt: pageEndedAt,
        durationMs: Date.parse(pageEndedAt) - Date.parse(pageStartedAt),
        warmupMs: warmupDelayMs,
        delayMs: nextPageDelayMs,
        batchCooldownMs: pageBatchCooldownMs,
        productsParsed: normalized.length,
        outOfStockProducts: pageProductSummary.outOfStockCount,
        missingPriceProducts: pageProductSummary.missingPriceCount,
        weakVerificationSignals: finalWeakSignals,
        strongVerificationSignals: [],
        finalClassification,
        screenshotPath: null,
        htmlSamplePath: null,
        verificationDetectedAt: pageVerificationDetectedAt,
        manualVerificationAllowed: allowManualVerification,
        manualVerificationRecovered:
          pageManualVerificationRecovered,
      });

      await writeCurrentCheckpoint();

      if (pageNumber < effectiveMaxPages) {
        if (pageBatchCooldownMs > 0) {
          if (verbose) {
            console.log(
              `page batch cooldown after ${pageNumber} pages: ${pageBatchCooldownMs} ms`
            );
          }
          await page.waitForTimeout(pageBatchCooldownMs);
        }
        if (verbose) console.log(`next page delay: ${nextPageDelayMs} ms`);
        if (nextPageDelayMs > 0) {
          await page.waitForTimeout(nextPageDelayMs);
        }
      }
    }
  } finally {
    await browserSession.close();
  }

  const detectedTotalPagesForSummary = detectedTotalPages || null;
  const emptyOutOfRangeExpectedPages =
    endedByEmptyOutOfRangePage && endOfListPage
      ? Math.max(0, Number(endOfListPage) - 1)
      : null;
  const resolvedExpectedPages =
    detectedTotalPagesForSummary ||
    emptyOutOfRangeExpectedPages ||
    Math.max(maxPages, expectedPages);
  if (!tailCacheUsed) {
    const tailEvaluation = evaluateSmokingpipesOutOfStockTail({
      pages: outOfStockTailPageInputs,
      detectedTotalPages: resolvedExpectedPages,
      confirmedAt: new Date().toISOString(),
    });
    firstOutOfStockOnlyPage = tailEvaluation.firstOutOfStockOnlyPage;
    if (
      tailEvaluation.tailCache &&
      options.writeOutOfStockTailCache !== false
    ) {
      await writeOutOfStockTailCache(
        tailEvaluation.tailCache,
        outOfStockTailCachePath
      ).catch((error) => {
        console.warn(`failed to write OOS tail cache: ${error.message}`);
      });
    }
  }

  const deduped = dedupeCurrentProducts(collected);
  const completedAt = new Date().toISOString();
  const effectiveScannedPages =
    pages.length + skippedOutOfStockTailPages.length;
  const lastSuccessfulPage = pages.length
    ? Math.max(...pages.map((item) => Number(item.page) || 0))
    : 0;
  const soldByAbsenceAllowed = !tailCacheUsed;
  const disappearedApplyAllowed = !tailCacheUsed;
  const payload = {
    version: "smokingpipes-current-list-dry-run-v1",
    generatedAt: completedAt,
    source: "smokingpipes",
    scrapeType: "new-list-current-dry-run",
    config: {
      maxPages,
      requestedMaxPages: maxPages,
      expectedPages: resolvedExpectedPages,
      detectedTotalPages: detectedTotalPagesForSummary,
      detectionConfidence,
      paginationLinksFound,
      paginationMaxPageParam,
      endedByEmptyOutOfRangePage,
      endOfListPage,
      displayNum,
      ...pacing,
      allowManualVerification,
      manualVerification: allowManualVerification,
      browser,
      partialScan:
        failedPages.length > 0 ||
        effectiveScannedPages < resolvedExpectedPages,
    },
    startedAt,
    completedAt,
    pages,
    products: deduped.products,
    summary: {
      pagesRequested: maxPages,
      pagesScanned: pages.length,
      pagesCompleted: pages.length,
      pagesFailed: failedPages.length,
      failedPages: [...failedPages],
      lastSuccessfulPage,
      expectedPages: resolvedExpectedPages,
      detectedTotalPages: detectedTotalPagesForSummary,
      detectionConfidence,
      paginationLinksFound,
      paginationMaxPageParam,
      effectiveScannedPages,
      endedByEmptyOutOfRangePage,
      endOfListPage,
      firstOutOfStockOnlyPage,
      skippedOutOfStockTailPages,
      tailCacheUsed,
      tailCacheReason,
      soldByAbsenceAllowed,
      disappearedApplyAllowed,
      productsExtracted: collected.length,
      uniqueProducts: deduped.products.length,
      duplicateSourceProductIds: deduped.duplicateIds,
      outOfStockProducts: pages.reduce(
        (total, item) => total + Number(item.outOfStockCount || 0),
        0
      ),
      missingPriceProducts: pages.reduce(
        (total, item) => total + Number(item.missingPriceCount || 0),
        0
      ),
      captchaDetected,
      captchaPages: [...new Set(captchaPages)],
      verificationDetectedAt,
      manualVerificationAllowed: allowManualVerification,
      manualVerificationRecovered,
      weakVerificationDetected: weakVerificationPages.length > 0,
      weakVerificationPages: [...new Set(weakVerificationPages)],
      completeRequestedRange:
        failedPages.length === 0 &&
        effectiveScannedPages >= resolvedExpectedPages,
      fullExpectedRangeScanned:
        failedPages.length === 0 &&
        effectiveScannedPages >= resolvedExpectedPages,
    },
  };

  if (options.writeCurrentList !== false) {
    await writeJsonAtomic(PATHS.currentList, payload);
  }
  if (options.useCheckpoint !== false) {
    await fs.promises.rm(CHECKPOINT_PATH, { force: true }).catch(() => {});
  }
  if (options.writeCurrentList !== false) {
    console.log(`Current list dry-run written: ${relativePath(PATHS.currentList)}`);
  }
  console.log(JSON.stringify(payload.summary, null, 2));
  return payload;
}

if (isDirectExecution(import.meta.url)) {
  const cli = parseCliOptions();
  await fetchSmokingpipesCurrentList({
    maxPages: cli["max-pages"],
    expectedPages: cli["expected-pages"],
    displayNum: cli["display-num"],
    browserChannel: cli["browser-channel"],
    browserProfile: cli["browser-profile"],
    browserProfileDir: cli["browser-profile-dir"],
    pageDelayMs: cli["page-delay-ms"],
    pageDelayMinMs: cli["page-delay-min-ms"],
    pageDelayMaxMs: cli["page-delay-max-ms"],
    pageWarmupMinMs: cli["page-warmup-min-ms"],
    pageWarmupMaxMs: cli["page-warmup-max-ms"],
    pageBatchSize: cli["page-batch-size"],
    pageBatchCooldownMinMs: cli["page-batch-cooldown-min-ms"],
    pageBatchCooldownMaxMs: cli["page-batch-cooldown-max-ms"],
    captchaCooldownMs: cli["captcha-cooldown-ms"],
    allowManualVerification: cli["allow-manual-verification"],
    manualVerificationTimeoutMs: cli["manual-verification-timeout-ms"],
    outOfStockTailCachePath: cli["out-of-stock-tail-cache"],
    outOfStockTailCacheMaxAgeHours: cli["out-of-stock-tail-cache-max-age-hours"],
    useOutOfStockTailCache: cli["use-out-of-stock-tail-cache"] !== "false",
    verbose: cli.verbose,
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
