import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import {
  buildSmokingpipesListUrl,
  detectSmokingpipesVerification,
  extractListProducts,
  getLargeProductImageUrl,
  launchSmokingpipesContext,
  summarizeSmokingpipesListProducts,
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

const DEFAULT_EXPECTED_PAGES = 107;
const DEFAULT_DISPLAY_NUM = 48;
const DEFAULT_PAGE_DELAY_MIN_MS = 8000;
const DEFAULT_PAGE_DELAY_MAX_MS = 18000;
const DEFAULT_PAGE_WARMUP_MIN_MS = 3000;
const DEFAULT_PAGE_WARMUP_MAX_MS = 7000;
const DEFAULT_CAPTCHA_COOLDOWN_MS = 60000;
const CHECKPOINT_PATH = path.join(
  ROOT,
  ".cache",
  "inventory-v1",
  "smokingpipes-current-list-checkpoint.json"
);

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

  return {
    pageDelayMinMs,
    pageDelayMaxMs: Math.max(pageDelayMinMs, requestedPageDelayMaxMs),
    pageWarmupMinMs,
    pageWarmupMaxMs: Math.max(
      pageWarmupMinMs,
      requestedPageWarmupMaxMs
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

async function waitForListProducts(page) {
  await page.waitForSelector(
    "a[href*='moreinfo.cfm'][href*='product_id=']",
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);
}

export async function fetchSmokingpipesCurrentList(options = {}) {
  const maxPages = parsePositiveInteger(options.maxPages, 3);
  const expectedPages = parsePositiveInteger(
    options.expectedPages,
    DEFAULT_EXPECTED_PAGES
  );
  const displayNum = parsePositiveInteger(
    options.displayNum,
    DEFAULT_DISPLAY_NUM
  );
  const pacing = resolveListPacingOptions(options);
  const verbose = enabled(options.verbose);
  const allowManualVerification = enabled(options.allowManualVerification);
  const manualVerificationTimeoutMs = parsePositiveInteger(
    options.manualVerificationTimeoutMs,
    10 * 60 * 1000
  );
  const startedAt = new Date().toISOString();
  const checkpoint = readCheckpoint(maxPages, expectedPages, displayNum);
  const pages = checkpoint?.pages || [];
  const collected = checkpoint?.products || [];
  const firstPage = pages.length
    ? Math.max(...pages.map((item) => Number(item.page) || 0)) + 1
    : 1;
  let captchaDetected = false;
  const captchaPages = [];

  process.env.SMOKINGPIPES_HEADLESS = allowManualVerification
    ? "false"
    : process.env.SMOKINGPIPES_HEADLESS || "true";

  const context = await launchSmokingpipesContext();
  const page = context.pages()[0] || (await context.newPage());

  try {
    if (checkpoint) {
      console.log(
        `Resuming dry-run checkpoint at page ${firstPage}/${maxPages} with ${collected.length} products.`
      );
    }

    for (
      let pageNumber = firstPage;
      pageNumber <= maxPages;
      pageNumber += 1
    ) {
      const url = buildSmokingpipesListUrl("new", pageNumber, displayNum);
      console.log(
        verbose
          ? `fetching page ${pageNumber}/${maxPages}`
          : `Fetching Smokingpipes list page ${pageNumber}/${maxPages}`
      );

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const warmupDelayMs = randomDelayMs(
        pacing.pageWarmupMinMs,
        pacing.pageWarmupMaxMs
      );
      if (verbose) console.log(`warmup delay: ${warmupDelayMs} ms`);
      if (warmupDelayMs > 0) {
        await page.waitForTimeout(warmupDelayMs);
      }

      let detection = await detectSmokingpipesVerification(page, {
        pageKind: "list",
        httpStatus: response?.status() || 0,
      });

      if (detection.verificationBlocked) {
        captchaDetected = true;
        captchaPages.push(pageNumber);
        console.warn(
          `Smokingpipes CAPTCHA detected on page ${pageNumber}. Manual verification is required; no automatic bypass will be attempted.`
        );
        if (pacing.captchaCooldownMs > 0) {
          console.warn(
            `CAPTCHA cooldown: ${pacing.captchaCooldownMs} ms before manual verification or blocked exit.`
          );
          await page.waitForTimeout(pacing.captchaCooldownMs);
        }

        if (!allowManualVerification) {
          throw new Error(
            `Smokingpipes CAPTCHA blocked page ${pageNumber}. Re-run with --allow-manual-verification=true only after user confirmation; dry-run output was not replaced.`
          );
        }

        const recovered = await waitForManualVerification(
          page,
          url,
          manualVerificationTimeoutMs
        );
        if (!recovered) {
          throw new Error(
            `Smokingpipes manual verification timed out on page ${pageNumber}; dry-run output was not replaced.`
          );
        }
      }

      await waitForListProducts(page);
      const extracted = await extractListProducts(page, url, "new");

      if (extracted.length === 0) {
        throw new Error(
          `No products were extracted from requested page ${pageNumber}; dry-run output was not replaced.`
        );
      }

      const scrapedAt = new Date().toISOString();
      const normalized = extracted.map((item) =>
        normalizeListProduct(item, scrapedAt)
      );
      const pageProductSummary =
        summarizeSmokingpipesListProducts(extracted);
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
      pages.push({
        page: pageNumber,
        url,
        httpStatus: response?.status() || null,
        productCount: normalized.length,
        outOfStockCount: pageProductSummary.outOfStockCount,
        missingPriceCount: pageProductSummary.missingPriceCount,
        scrapedAt,
      });

      await writeCheckpoint({
        version: "smokingpipes-current-list-checkpoint-v1",
        updatedAt: new Date().toISOString(),
        config: {
          maxPages,
          expectedPages,
          displayNum,
          ...pacing,
        },
        pages,
        products: collected,
      });

      if (pageNumber < maxPages) {
        const nextPageDelayMs = randomDelayMs(
          pacing.pageDelayMinMs,
          pacing.pageDelayMaxMs
        );
        if (verbose) console.log(`next page delay: ${nextPageDelayMs} ms`);
        if (nextPageDelayMs > 0) {
          await page.waitForTimeout(nextPageDelayMs);
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  const deduped = dedupeCurrentProducts(collected);
  const completedAt = new Date().toISOString();
  const payload = {
    version: "smokingpipes-current-list-dry-run-v1",
    generatedAt: completedAt,
    source: "smokingpipes",
    scrapeType: "new-list-current-dry-run",
    config: {
      maxPages,
      expectedPages,
      displayNum,
      ...pacing,
      allowManualVerification,
      manualVerification: allowManualVerification,
      partialScan: maxPages < expectedPages,
    },
    startedAt,
    completedAt,
    pages,
    products: deduped.products,
    summary: {
      pagesRequested: maxPages,
      pagesScanned: pages.length,
      expectedPages,
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
      completeRequestedRange: pages.length === maxPages,
      fullExpectedRangeScanned: pages.length >= expectedPages,
    },
  };

  await writeJsonAtomic(PATHS.currentList, payload);
  await fs.promises.rm(CHECKPOINT_PATH, { force: true }).catch(() => {});
  console.log(`Current list dry-run written: ${relativePath(PATHS.currentList)}`);
  console.log(JSON.stringify(payload.summary, null, 2));
  return payload;
}

if (isDirectExecution(import.meta.url)) {
  const cli = parseCliOptions();
  await fetchSmokingpipesCurrentList({
    maxPages: cli["max-pages"],
    expectedPages: cli["expected-pages"],
    displayNum: cli["display-num"],
    pageDelayMs: cli["page-delay-ms"],
    pageDelayMinMs: cli["page-delay-min-ms"],
    pageDelayMaxMs: cli["page-delay-max-ms"],
    pageWarmupMinMs: cli["page-warmup-min-ms"],
    pageWarmupMaxMs: cli["page-warmup-max-ms"],
    captchaCooldownMs: cli["captcha-cooldown-ms"],
    allowManualVerification: cli["allow-manual-verification"],
    manualVerificationTimeoutMs: cli["manual-verification-timeout-ms"],
    verbose: cli.verbose,
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
