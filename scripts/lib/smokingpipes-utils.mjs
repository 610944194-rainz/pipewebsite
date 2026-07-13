import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import {
  acquireBrowserProfileLock,
  buildSmokingpipesBrowserDescriptor,
  classifyBrowserProfileLaunchError,
  releaseBrowserProfileLock,
} from "./smokingpipes-browser-profile-v1.mjs";

export const SOURCE_SITE = "Smokingpipes";
export const rootDir = process.cwd();
export const rawDir = path.join(rootDir, "data", "raw");
export const runStatusPath = path.join(rawDir, "smokingpipes-run-status.json");
export const verificationScreenshotPath = path.join(rawDir, "smokingpipes-verification-latest.png");

export const verificationPollMs = Number.parseInt(
  process.env.SMOKINGPIPES_VERIFICATION_POLL_MS || "30000",
  10
);
export const verificationMaxWaitMs = Number.parseInt(
  process.env.SMOKINGPIPES_VERIFICATION_MAX_WAIT_MS || String(60 * 60 * 1000),
  10
);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasPositiveUsdPrice(value) {
  const match = normalizeText(value).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return Boolean(match && Number.parseFloat(match[1]) > 0);
}

export function classifySmokingpipesDetailStatusEvidence({
  rawText = "",
  purchaseAreaText = "",
  price = "",
  listInventoryStatus = "",
  addToCartEvidence = false,
  quantityEvidence = false,
  cartFormEvidence = false,
  disabledSoldButtonEvidence = false,
  structuredAvailability = "",
  globalSoldTextMatched = null,
} = {}) {
  const normalizedRawText = normalizeText(rawText);
  const normalizedPurchaseAreaText = normalizeText(purchaseAreaText);
  const normalizedListStatus = normalizeText(listInventoryStatus).toLowerCase();
  const normalizedAvailability = normalizeText(structuredAvailability).toLowerCase();
  const priceExists = hasPositiveUsdPrice(price);
  const availableEvidence = [];
  const soldEvidence = [];

  if (priceExists) availableEvidence.push("detail-price-present");
  if (addToCartEvidence) availableEvidence.push("add-to-cart-present");
  if (quantityEvidence) availableEvidence.push("quantity-input-present");
  if (cartFormEvidence) availableEvidence.push("cart-form-present");
  if (normalizedListStatus === "available") {
    availableEvidence.push("current-list-available");
  }
  if (/instock|in stock/i.test(normalizedAvailability)) {
    availableEvidence.push("structured-availability-instock");
  }

  if (/outofstock|out of stock|sold out|unavailable/i.test(normalizedAvailability)) {
    soldEvidence.push("structured-availability-out-of-stock");
  }
  if (disabledSoldButtonEvidence) {
    soldEvidence.push("disabled-sold-button");
  }
  if (/\b(?:sold out|out of stock|unavailable)\b/i.test(normalizedPurchaseAreaText)) {
    soldEvidence.push("purchase-area-sold-text");
  }

  const weakGlobalTextMatched =
    globalSoldTextMatched === null
      ? /\b(?:sold|out of stock|unavailable)\b/i.test(normalizedRawText)
      : Boolean(globalSoldTextMatched);
  if (weakGlobalTextMatched && !soldEvidence.length) {
    soldEvidence.push("weak/global-text-match");
  }

  const strongSoldEvidence = soldEvidence.filter(
    (item) => !item.startsWith("weak/")
  );
  const availableEvidencePresent = availableEvidence.length > 0;

  if (availableEvidencePresent && !strongSoldEvidence.length) {
    return {
      status: "available",
      rawStatusSource: weakGlobalTextMatched
        ? "available-evidence-overrides-weak-global-sold-text"
        : "available-evidence",
      soldEvidence,
      availableEvidence,
      warning: weakGlobalTextMatched
        ? "sold status has available evidence; treating sold signal as weak."
        : null,
    };
  }

  if (strongSoldEvidence.length) {
    return {
      status: "sold",
      rawStatusSource: "strong-sold-evidence",
      soldEvidence,
      availableEvidence,
      warning: availableEvidencePresent
        ? "strong sold evidence conflicts with available evidence."
        : null,
    };
  }

  return {
    status: "available",
    rawStatusSource: weakGlobalTextMatched
      ? "weak-global-sold-text-only"
      : "no-sold-evidence",
    soldEvidence,
    availableEvidence,
    warning: weakGlobalTextMatched
      ? "sold status signal came only from global page text and was ignored."
      : null,
  };
}

export function uniqueItems(items) {
  return Array.from(new Set(items.map(normalizeText).filter(Boolean)));
}

export function getSourceProductId(url) {
  const match = String(url || "").match(/[?&]product_id=(\d+)/i);
  return match ? match[1] : "";
}

export function parsePageNumber(url) {
  try {
    const parsed = new URL(url);
    return Number.parseInt(parsed.searchParams.get("page") || "1", 10);
  } catch {
    return 1;
  }
}

export function absolutizeUrl(value, baseUrl = "https://www.smokingpipes.com/") {
  const text = normalizeText(value);
  if (!text || text.startsWith("data:") || text.startsWith("javascript:")) return "";
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return "";
  }
}

export function getLargeProductImageUrl(url) {
  if (!url) return "";
  return url.replace("/products/tn/", "/products/");
}

export function getFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return "";
}

export function extractProductCode(text) {
  return getFirstMatch(text, [/\b(\d{3}-\d{3}-\d{4,6})\b/]);
}

export function parseMeasurementValue(text, unit) {
  const pattern = unit === "g" ? /([\d.]+)\s*g\b/i : /([\d.]+)\s*mm\b/i;
  const match = String(text || "").match(pattern);
  const value = match ? Number.parseFloat(match[1]) : null;
  return Number.isFinite(value) ? value : null;
}

export function getMissingFields(item, fields) {
  return fields.filter((field) => {
    const value = item[field];
    if (Array.isArray(value)) return value.length === 0;
    return !normalizeText(value);
  });
}

export function readJson(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read JSON ${filePath}: ${error.message}`);
    return fallbackValue;
  }
}

export function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const content = `${JSON.stringify(payload, null, 2)}\n`;
  let lastError = null;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content, "utf8");
      return filePath;
    } catch (error) {
      lastError = error;

      console.warn(
        `writeJson attempt ${attempt}/10 failed for ${filePath}: ${error.message}`
      );

      const waitMs = Math.min(500 * attempt, 3000);
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        waitMs
      );
    }
  }

  const pendingPath = `${filePath}.pending`;

  try {
    fs.writeFileSync(pendingPath, content, "utf8");
    console.warn(
      `Main JSON was temporarily unavailable. Latest checkpoint saved to: ${pendingPath}`
    );
    return pendingPath;
  } catch (pendingError) {
    throw lastError || pendingError;
  }
}

export function buildSmokingpipesListUrl(listType, page, displayNum = 48) {
  const url = new URL("https://www.smokingpipes.com/pipes/");
  url.searchParams.set("DISPLAYNUM", String(displayNum));
  url.searchParams.set("newOrEstate", listType);
  url.searchParams.set("SORTOPT", "default");
  url.searchParams.set("page", String(page));
  return url.toString();
}

export async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

export function classifySmokingpipesVerificationSignals({
  pageKind = "detail",
  httpStatus = 0,
  url = "",
  title = "",
  bodyText = "",
  productLinkCount = 0,
  explicitChallengeElement = false,
  hasNormalDetailContent = false,
}) {
  const combinedText = `${title}\n${bodyText}`;
  const explicitChallengeText =
    /\b(?:captcha|hcaptcha|recaptcha|turnstile|verification|challenge)\b|verify you are human|human verification|security check|checking your browser|cloudflare ray id|attention required/i.test(
      combinedText
    );
  const challengeUrl =
    /(?:\/cdn-cgi\/challenge|[?&](?:captcha|challenge)=|\/(?:captcha|security-check|verification)(?:\/|$))/i.test(
      url
    );
  const statusLooksBlocked = [403, 429, 503].includes(Number(httpStatus));
  const hasListProducts =
    pageKind === "list" && Number(productLinkCount) > 0;
  const hasNormalContent =
    hasListProducts ||
    (pageKind !== "list" && hasNormalDetailContent);
  const weakVerificationSignals = [];
  const strongVerificationSignals = [];

  if (explicitChallengeText) {
    (hasNormalContent
      ? weakVerificationSignals
      : strongVerificationSignals
    ).push("verification-keyword");
  }
  if (explicitChallengeElement) {
    (hasNormalContent
      ? weakVerificationSignals
      : strongVerificationSignals
    ).push("challenge-dom");
  }
  if (challengeUrl) {
    (hasNormalContent
      ? weakVerificationSignals
      : strongVerificationSignals
    ).push("challenge-url");
  }

  if (hasListProducts) {
    return {
      verificationBlocked: false,
      classification: weakVerificationSignals.length
        ? "normal-content-with-verification-warning"
        : "normal-content",
      weakVerificationSignals,
      strongVerificationSignals,
      reasons: {
        httpStatus,
        statusLooksBlocked,
        explicitChallengeText,
        explicitChallengeElement,
        challengeUrl,
        productLinkCount: Number(productLinkCount),
        normalContentOverride: true,
        pageKind,
      },
    };
  }

  const explicitVerification = strongVerificationSignals.length > 0;
  const verificationBlocked =
    explicitVerification &&
    (pageKind === "list" || !hasNormalDetailContent);

  return {
    verificationBlocked,
    classification: verificationBlocked
      ? "strong-verification"
      : pageKind === "list"
        ? "empty-or-parse-failure"
        : hasNormalDetailContent
          ? "normal-content"
          : "unknown-or-parse-failure",
    weakVerificationSignals,
    strongVerificationSignals,
    reasons: {
      httpStatus,
      statusLooksBlocked,
      explicitChallengeText,
      explicitChallengeElement,
      challengeUrl,
      productLinkCount: Number(productLinkCount),
      normalContentOverride: false,
      pageKind,
    },
  };
}

export function summarizeSmokingpipesListProducts(products = []) {
  return {
    productCount: products.length,
    outOfStockCount: products.filter((item) =>
      /\b(?:out of stock|sold out|unavailable)\b/i.test(
        String(item.rawText || item.title || "")
      )
    ).length,
    missingPriceCount: products.filter(
      (item) => !String(item.price || "").trim()
    ).length,
  };
}

export async function detectSmokingpipesVerification(page, options = {}) {
  const httpStatus = options.httpStatus || 0;
  const pageKind = options.pageKind || "detail";
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const currentUrl = page.url();
  const pageSignals = await page
    .evaluate((kind) => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const text = document.body?.innerText || "";
      const productLinkCount = document.querySelectorAll(
        "a[href*='moreinfo.cfm'][href*='product_id=']"
      ).length;
      const hasListProductLinks = productLinkCount > 0;
      const explicitChallengeElement = Boolean(
        document.querySelector(
          [
            "iframe[src*='recaptcha']",
            "iframe[src*='hcaptcha']",
            "iframe[src*='challenge']",
            "iframe[src*='turnstile']",
            "form[action*='captcha']",
            "form[action*='challenge']",
            "#challenge-form",
            ".cf-turnstile",
            ".h-captcha",
            ".g-recaptcha",
            "[data-sitekey]",
          ].join(",")
        )
      );
      const hasProductTitle = Boolean(
        document.querySelector("h1, .product-title, .title")?.textContent?.trim()
      );
      const hasProductNumber = /Product Number|Product No|商品编号|产品编号|\b\d{3}-\d{3}-\d{4,6}\b/i.test(text);
      const hasPrice = /\$\s*[\d,]+(?:\.\d{2})?/.test(text);
      const hasDetailInfo =
        /尺寸|Length|Weight|Stem Material|Filter|Shape|Finish|Material|Country|Chamber|Bowl|Outside|闀垮害|閲嶉噺|鐑熷槾鏉愯川|婊よ姱|澶栧舰|楗伴潰|鏉愯川|鍥藉/i.test(
          text
        );
      const hasMainImage = Array.from(document.querySelectorAll("img, a[href]")).some((element) => {
        const candidates = [
          element.currentSrc,
          element.getAttribute?.("src"),
          element.getAttribute?.("href"),
          element.getAttribute?.("data-src"),
          element.getAttribute?.("data-large"),
          element.getAttribute?.("data-zoom-image"),
        ];
        return candidates.some((candidate) => /\/products\/.+\.(jpg|jpeg|png|webp)/i.test(candidate || ""));
      });
      const hasNormalListContent = kind === "list" && hasListProductLinks;
      const hasNormalDetailContent =
        kind !== "list" && hasProductTitle && hasProductNumber && hasPrice && hasDetailInfo && hasMainImage;

      return {
        bodyStart: normalizeText(text).slice(0, 600),
        productLinkCount,
        hasListProductLinks,
        explicitChallengeElement,
        hasProductTitle,
        hasProductNumber,
        hasPrice,
        hasDetailInfo,
        hasMainImage,
        hasNormalListContent,
        hasNormalDetailContent,
      };
    }, pageKind)
    .catch(() => ({
      bodyStart: "",
      productLinkCount: 0,
      hasListProductLinks: false,
      explicitChallengeElement: false,
      hasProductTitle: false,
      hasProductNumber: false,
      hasPrice: false,
      hasDetailInfo: false,
      hasMainImage: false,
      hasNormalListContent: false,
      hasNormalDetailContent: false,
    }));

  const classification = classifySmokingpipesVerificationSignals({
    pageKind,
    httpStatus,
    url: currentUrl,
    title,
    bodyText: `${bodyText}\n${pageSignals.bodyStart}`,
    productLinkCount: pageSignals.productLinkCount,
    explicitChallengeElement: pageSignals.explicitChallengeElement,
    hasNormalDetailContent: pageSignals.hasNormalDetailContent,
  });

  return {
    verificationBlocked: classification.verificationBlocked,
    classification: classification.classification,
    weakVerificationSignals: classification.weakVerificationSignals,
    strongVerificationSignals: classification.strongVerificationSignals,
    reasons: {
      ...classification.reasons,
      missingNormalFields:
        pageKind === "list"
          ? !pageSignals.hasNormalListContent
          : !pageSignals.hasNormalDetailContent,
    },
    signals: {
      title,
      ...pageSignals,
    },
  };
}

export function getNotificationConfigStatus() {
  return {
    pushDeer: Boolean(process.env.PUSHDEER_KEY),
    serverChan: Boolean(process.env.SERVER_CHAN_SENDKEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

export async function sendScraperAlert(message) {
  const config = getNotificationConfigStatus();
  const configured = config.pushDeer || config.serverChan || config.telegram;

  if (!configured) {
    console.warn(`Scraper alert not configured. Message:\n${message.title}\n${message.body}`);
    return { configured: false, sent: false, channels: config };
  }

  const results = [];

  if (config.pushDeer) {
    const url = new URL("https://api2.pushdeer.com/message/push");
    url.searchParams.set("pushkey", process.env.PUSHDEER_KEY);
    url.searchParams.set("text", message.title);
    url.searchParams.set("desp", message.body);

    try {
      const response = await fetch(url);
      results.push({ channel: "PushDeer", ok: response.ok, status: response.status });
    } catch (error) {
      console.warn(`PushDeer alert failed: ${error.message}`);
      results.push({ channel: "PushDeer", ok: false, error: error.message });
    }
  }

  if (config.serverChan) {
    const url = `https://sctapi.ftqq.com/${encodeURIComponent(process.env.SERVER_CHAN_SENDKEY)}.send`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title: message.title, desp: message.body }),
      });
      results.push({ channel: "ServerChan", ok: response.ok, status: response.status });
    } catch (error) {
      console.warn(`ServerChan alert failed: ${error.message}`);
      results.push({ channel: "ServerChan", ok: false, error: error.message });
    }
  }

  if (config.telegram) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `${message.title}\n\n${message.body}`,
          disable_web_page_preview: true,
        }),
      });
      results.push({ channel: "Telegram", ok: response.ok, status: response.status });
    } catch (error) {
      console.warn(`Telegram alert failed: ${error.message}`);
      results.push({ channel: "Telegram", ok: false, error: error.message });
    }
  }

  return { configured: true, sent: results.some((result) => result.ok), channels: config, results };
}

export function writeRunStatus(status) {
  fs.mkdirSync(path.dirname(runStatusPath), { recursive: true });
  fs.writeFileSync(
    runStatusPath,
    `${JSON.stringify(
      {
        sourceSite: SOURCE_SITE,
        ...status,
        lastUpdatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function saveVerificationScreenshot(page) {
  try {
    fs.mkdirSync(path.dirname(verificationScreenshotPath), { recursive: true });
    await page.screenshot({ path: verificationScreenshotPath, fullPage: true });
    return verificationScreenshotPath;
  } catch (error) {
    console.warn(`Verification screenshot failed: ${error.message}`);
    return "";
  }
}

function createEnterWaiter() {
  if (!process.stdin.isTTY) {
    return {
      promise: new Promise(() => {}),
      close() {},
    };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    promise: rl
      .question("Press Enter after manual verification, or wait for auto recovery: ")
      .then(() => true),
    close() {
      rl.close();
    },
  };
}

export function isNormalSmokingpipesDetail(
  detail,
  expectedSourceProductId
) {
  const identityMatches =
    normalizeText(detail?.sourceProductId) ===
    normalizeText(expectedSourceProductId);
  const hasTitle = Boolean(
    normalizeText(detail?.fullTitle || detail?.title)
  );
  const hasImage = Boolean(
    normalizeText(detail?.mainImageUrl) ||
      (Array.isArray(detail?.galleryImages) &&
        detail.galleryImages.some((item) => normalizeText(item)))
  );
  const hasStructuredDetail = Boolean(
    normalizeText(detail?.productCode) ||
      normalizeText(detail?.shape) ||
      (Array.isArray(detail?.specsText) &&
        detail.specsText.some((item) => normalizeText(item)))
  );
  return (
    identityMatches &&
    hasTitle &&
    hasImage &&
    hasStructuredDetail
  );
}

export async function waitForSmokingpipesManualRecovery(
  page,
  options = {}
) {
  const pageKind = options.pageKind || "detail";
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs) || verificationMaxWaitMs
  );
  const pollMs = Math.max(
    1,
    Number(options.pollMs) || verificationPollMs
  );
  const nowMs = options.nowMs || (() => Date.now());
  const detectVerification =
    options.detectVerification ||
    ((targetPage) =>
      detectSmokingpipesVerification(targetPage, {
        pageKind,
      }));
  const verifyNormalContent =
    options.verifyNormalContent ||
    (async () => ({ valid: false, parsedValue: null }));
  const restoreTargetPage =
    options.restoreTargetPage || (async () => {});
  const wait =
    options.wait ||
    ((delayMs) => page.waitForTimeout(delayMs));
  const verificationDetectedAt = new Date().toISOString();
  const startedAtMs = nowMs();
  const enterWaiter =
    options.waitForEnter === false
      ? {
          promise: new Promise(() => {}),
          close() {},
        }
      : createEnterWaiter();
  let enterConsumed = false;

  await page.bringToFront?.().catch(() => {});
  if (options.verbose !== false) {
    console.warn(
      `Smokingpipes strong verification detected. Complete it in the opened browser within ${Math.round(
        timeoutMs / 60000
      )} minutes.`
    );
  }

  try {
    while (nowMs() - startedAtMs < timeoutMs) {
      const remainingMs =
        timeoutMs - (nowMs() - startedAtMs);
      const waitMs = Math.min(
        pollMs,
        Math.max(1, remainingMs)
      );
      const enterPressed = await Promise.race([
        wait(waitMs).then(() => false),
        enterConsumed
          ? new Promise(() => {})
          : enterWaiter.promise,
      ]);
      if (enterPressed) {
        enterConsumed = true;
        await waitForStablePage(page);
      }

      const detection = await detectVerification(page);
      if (detection.verificationBlocked) continue;

      await restoreTargetPage(page);
      const confirmationDetection =
        await detectVerification(page);
      if (confirmationDetection.verificationBlocked) continue;

      const parsed = await verifyNormalContent(page);
      if (parsed?.valid === true) {
        return {
          recovered: true,
          verificationDetectedAt,
          manualVerificationAllowed: true,
          manualVerificationRecovered: true,
          timedOut: false,
          detection: confirmationDetection,
          parsedValue: parsed.parsedValue ?? null,
        };
      }
    }
  } finally {
    enterWaiter.close();
  }

  return {
    recovered: false,
    verificationDetectedAt,
    manualVerificationAllowed: true,
    manualVerificationRecovered: false,
    timedOut: true,
    parsedValue: null,
  };
}

export async function waitForManualVerification(page, options) {
  const {
    pageKind,
    currentUrl,
    currentProductUrl,
    currentProductTitle,
    currentIndex,
    totalCount,
    successCount,
    failCount,
    httpStatus,
    saveCheckpoint,
  } = options;

  const firstDetection = await detectSmokingpipesVerification(page, { pageKind, httpStatus });
  if (!firstDetection.verificationBlocked) {
    return { recovered: true, verificationBlocked: false, notification: null };
  }

  const message = {
    title: "Smokingpipes scraper needs manual verification",
    body: [
      `Progress: ${currentIndex} / ${totalCount}`,
      `Current product: ${currentProductTitle || "list page"}`,
      `Current URL: ${currentProductUrl || currentUrl}`,
      "The script is paused and the browser remains open. Complete verification on this computer, then the script will continue automatically or after Enter is pressed.",
    ].join("\n"),
  };

  const screenshotPath = await saveVerificationScreenshot(page);
  writeRunStatus({
    status: "waiting_for_verification",
    currentUrl,
    currentProductUrl,
    currentIndex,
    totalCount,
    successCount,
    failCount,
    message: message.body,
    screenshotPath,
    detection: firstDetection,
  });
  await saveCheckpoint?.();
  const notification = await sendScraperAlert(message);
  const enterWaiter = createEnterWaiter();
  const startedAt = Date.now();

  console.warn(
    `Smokingpipes verification detected. Waiting up to ${Math.round(verificationMaxWaitMs / 60000)} minutes.`
  );

  try {
    while (Date.now() - startedAt < verificationMaxWaitMs) {
      const remainingMs = verificationMaxWaitMs - (Date.now() - startedAt);
      const waitMs = Math.min(verificationPollMs, Math.max(1000, remainingMs));
      const enterResult = await Promise.race([sleep(waitMs).then(() => false), enterWaiter.promise]);
      if (enterResult) await waitForStablePage(page);

      const detection = await detectSmokingpipesVerification(page, { pageKind });
      if (!detection.verificationBlocked) {
        writeRunStatus({
          status: "running",
          currentUrl: page.url(),
          currentProductUrl,
          currentIndex,
          totalCount,
          successCount,
          failCount,
          message: "Manual verification recovered. Continuing scrape.",
          notification,
        });
        return { recovered: true, verificationBlocked: true, notification };
      }

      writeRunStatus({
        status: "waiting_for_verification",
        currentUrl: page.url(),
        currentProductUrl,
        currentIndex,
        totalCount,
        successCount,
        failCount,
        message: message.body,
        screenshotPath,
        detection,
        notification,
      });
      await saveCheckpoint?.();
    }
  } finally {
    enterWaiter.close();
  }

  writeRunStatus({
    status: "verification_timeout",
    currentUrl: page.url(),
    currentProductUrl,
    currentIndex,
    totalCount,
    successCount,
    failCount,
    message: "Manual verification timed out. Checkpoint saved; the next run will skip completed details.",
    screenshotPath,
    notification,
  });
  await saveCheckpoint?.();

  return { recovered: false, verificationBlocked: true, notification, timedOut: true };
}

export function resolveSmokingpipesBrowserLaunch(
  browserChannel,
  environmentChannel = process.env.SMOKINGPIPES_BROWSER_CHANNEL || ""
) {
  const explicit = String(browserChannel || "").toLowerCase();
  if (explicit) {
    return {
      explicit: true,
      candidates: [explicit === "chromium" ? "" : explicit],
    };
  }

  return {
    explicit: false,
    candidates: Array.from(
      new Set([environmentChannel, "", "msedge", "chrome"])
    ),
  };
}

export async function launchSmokingpipesContext(options = {}) {
  const launchRoot = options.root || rootDir;
  const browserDescriptor = buildSmokingpipesBrowserDescriptor({
    root: launchRoot,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
    localAppData: options.localAppData,
    environmentUserDataDir: options.environmentUserDataDir,
    platform: options.platform,
    headless: options.headless,
  });
  const userDataDir = browserDescriptor.profileDir;
  const userDataDirCreated = !fs.existsSync(userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });

  const baseOptions = {
    headless: browserDescriptor.headless,
    viewport: { width: 1365, height: 900 },
  };
  const launchSelection = resolveSmokingpipesBrowserLaunch(
    browserDescriptor.effectiveBrowserChannel,
    options.environmentChannel
  );
  const channelCandidates = launchSelection.candidates;
  const launchPersistentContext =
    options.launchPersistentContext ||
    chromium.launchPersistentContext.bind(chromium);
  const profileLockPath =
    options.profileLockPath ||
    path.join(
      launchRoot,
      "data",
      "inventory",
      "state",
      "smokingpipes-chrome-profile.lock"
    );
  let profileLock = null;
  let lastError = null;

  try {
    if (browserDescriptor.profileLockRequired) {
      profileLock = acquireBrowserProfileLock(
        profileLockPath,
        {
          runId:
            options.runId ||
            `browser-${process.pid}-${Date.now()}`,
          profileDir: userDataDir,
          mode: options.mode || "inventory",
        },
        options.profileLockOptions
      );
    }

    for (const channel of channelCandidates) {
      try {
        const launchOptions = channel
          ? { ...baseOptions, channel }
          : baseOptions;
        console.log(
          channel
            ? `Launching browser channel: ${channel}`
            : "Launching Playwright Chromium"
        );
        const context = await launchPersistentContext(
          userDataDir,
          launchOptions
        );
        const executablePath =
          context.browser?.()?.executablePath?.() || null;
        const browser = {
          ...browserDescriptor,
          effectiveBrowserChannel: channel || "chromium",
          userDataDirCreated,
          executablePath,
          profileLockPath: profileLock?.lockPath || null,
          staleProfileLockRecovered:
            profileLock?.staleLockRecovered || false,
        };
        let closed = false;
        return {
          context,
          browser,
          profileLock,
          async close() {
            if (closed) return;
            closed = true;
            try {
              await context.close().catch(() => {});
            } finally {
              if (profileLock) {
                releaseBrowserProfileLock(profileLock);
              }
            }
          },
        };
      } catch (error) {
        lastError = classifyBrowserProfileLaunchError(
          error,
          browserDescriptor
        );
        console.warn(
          channel
            ? `Browser channel ${channel} failed: ${lastError.message}`
            : `Playwright Chromium failed: ${lastError.message}`
        );
        if (launchSelection.explicit) break;
      }
    }
  } finally {
    if (lastError && profileLock) {
      releaseBrowserProfileLock(profileLock);
    }
  }

  throw lastError;
}

export async function extractListProducts(page, listPageUrl, listType = "new") {
  return page.evaluate(
    ({ listPageUrl, listPage, listType, sourceSite }) => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const absolutizeUrl = (value) => {
        const text = normalizeText(value);
        if (!text || text.startsWith("data:") || text.startsWith("javascript:")) return "";
        try {
          return new URL(text, document.baseURI).toString();
        } catch {
          return "";
        }
      };
      const sourceProductId = (url) => {
        const match = String(url || "").match(/[?&]product_id=(\d+)/i);
        return match ? match[1] : "";
      };
      const productCode = (text) => {
        const match = String(text || "").match(/\b(\d{3}-\d{3}-\d{4,6})\b/);
        return match ? match[1] : "";
      };
      const firstPrice = (text) => {
        const normalized = normalizeText(text);
        const original = normalized.match(/\bReg\.\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1] || "";
        const msrp = normalized.match(/\bMSRP\s*:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1] || "";
        const prices = [...normalized.matchAll(/\$\s*[\d,]+(?:\.\d{2})?/g)].map((match) => normalizeText(match[0]));
        return prices.find((price) => price !== normalizeText(original) && price !== normalizeText(msrp)) || "";
      };
      const originalPrice = (text) =>
        normalizeText(String(text || "").match(/\bReg\.\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[0] || "");
      const lineFor = (text, patterns) =>
        String(text || "")
          .split(/\n+/)
          .map(normalizeText)
          .find((line) => patterns.some((pattern) => pattern.test(line))) || "";
      const climbCard = (anchor) => {
        let current = anchor;
        for (let index = 0; index < 8 && current; index += 1) {
          const text = current.innerText || "";
          const hasImage = Boolean(current.querySelector("img"));
          const hasPrice = /\$\s*[\d,]+/.test(text);
          const hasStockState =
            /\b(?:out of stock|sold out|unavailable)\b/i.test(text);
          if (hasImage && (hasPrice || hasStockState)) return current;
          current = current.parentElement;
        }
        return anchor.closest("li, article, .product, .product-card, .pipe, .grid-item, .item") || anchor.parentElement || anchor;
      };
      const imageFromCard = (card) => {
        const image = card.querySelector("img");
        const srcset = image?.getAttribute("srcset") || image?.getAttribute("data-srcset") || "";
        const srcsetCandidate = srcset
          .split(",")
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean)
          .pop();
        return absolutizeUrl(
          image?.currentSrc || image?.getAttribute("data-src") || srcsetCandidate || image?.getAttribute("src") || ""
        );
      };
      const titleFromCard = (card, anchor) => {
        const heading =
          card.querySelector("h1, h2, h3, h4, .title, .product-title, .name")?.innerText ||
          anchor.innerText ||
          anchor.getAttribute("title") ||
          "";
        return normalizeText(heading);
      };
      const brandFrom = (title, href) => {
        if (title.includes(":")) return normalizeText(title.split(":")[0]);
        const match = String(href || "").match(/\/pipes\/(?:new|estate)\/([^/]+)\//i);
        return match
          ? match[1]
              .split("-")
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" ")
          : "";
      };
      const anchors = Array.from(document.querySelectorAll("a[href*='moreinfo.cfm'][href*='product_id=']"));
      const seen = new Set();
      return anchors
        .map((anchor, index) => {
          const href = absolutizeUrl(anchor.getAttribute("href") || "");
          if (!href || seen.has(href)) return null;
          seen.add(href);
          const card = climbCard(anchor);
          const rawText = card.innerText || anchor.innerText || "";
          const title = titleFromCard(card, anchor);
          return {
            sourceSite,
            listType,
            conditionType: listType === "estate" ? "estate" : "new",
            listPageUrl,
            listPage,
            listPosition: index + 1,
            brand: brandFrom(title, href),
            title,
            productCode: productCode(rawText),
            href,
            sourceUrl: href,
            sourceProductId: sourceProductId(href),
            imageUrl: imageFromCard(card),
            price: firstPrice(rawText),
            originalPrice: originalPrice(rawText),
            rmbText: lineFor(rawText, [/CNY|人民币|楼|¥|锟/i]),
            discountText: lineFor(rawText, [/\b\d+%\s+Off\b/i, /\bOff\b/i]),
            lengthText: lineFor(rawText, [/Length|长度|闀垮害/i]),
            weightText: lineFor(rawText, [/Weight|重量|閲嶉噺/i]),
            filterText: lineFor(rawText, [/Filter|滤芯|婊よ姱/i]),
            rawText: normalizeText(rawText),
          };
        })
        .filter(Boolean);
    },
    { listPageUrl, listPage: parsePageNumber(listPageUrl), listType, sourceSite: SOURCE_SITE }
  );
}


export function shouldSaveSmokingpipesRawText() {
  return String(process.env.SMOKINGPIPES_SAVE_RAW_TEXT || "false").toLowerCase() === "true";
}

export function shouldSaveSmokingpipesDebugImages() {
  return String(process.env.SMOKINGPIPES_SAVE_DEBUG_IMAGES || "false").toLowerCase() === "true";
}

export async function extractDetailProduct(page, listItem, listType = "new") {
  const saveRawText = shouldSaveSmokingpipesRawText();
  const saveDebugImages = shouldSaveSmokingpipesDebugImages();

  const detail = await page.evaluate(
    ({ listItem, sourceSite, listType, saveRawText, saveDebugImages }) => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

      const absolutizeUrl = (value) => {
        const text = normalizeText(value);
        if (!text || text.startsWith("data:") || text.startsWith("javascript:")) return "";

        try {
          return new URL(text, document.baseURI).toString();
        } catch {
          return "";
        }
      };

      const getLargeProductImageUrl = (url) => String(url || "").replace("/products/tn/", "/products/");

      const sourceProductId = (url) => {
        const match = String(url || "").match(/[?&]product_id=(\d+)/i);
        return match ? match[1] : "";
      };

      const productCode = (text) => {
        const match = String(text || "").match(/\b(\d{3}-\d{3}-\d{4,6})\b/);
        return match ? match[1] : "";
      };

      const isInsideExcludedSection = (element) => {
        let current = element;

        while (current && current !== document.body) {
          const marker = normalizeText(
            `${current.id || ""} ${current.className || ""} ${current.getAttribute?.("aria-label") || ""} ${
              current.querySelector?.("h1,h2,h3,h4")?.textContent || ""
            }`
          ).toLowerCase();

          if (
            /similar pipes|similar products|related products|recently viewed|customers also|you may also|footer/.test(
              marker
            )
          ) {
            return true;
          }

          current = current.parentElement;
        }

        return false;
      };

      const rootCandidates = [
        ...document.querySelectorAll(
          ".product-detail, .productDetails, .pipe-detail, .product_page, #product_info, #product-info, main, #main, #content, .content"
        ),
        document.body,
      ].filter(Boolean);

      const usefulRoot =
        rootCandidates.sort((left, right) => (right.innerText || "").length - (left.innerText || "").length)[0] ||
        document.body;

      const collectImageUrls = () => {
        const largeUrls = [];
        const excludedImages = [];
        const elements = Array.from(
          usefulRoot.querySelectorAll("a[href], img, [data-image], [data-large], [data-src], [data-zoom-image]")
        );

        for (const element of elements) {
          const excluded = isInsideExcludedSection(element);
          const rawCandidates = [
            element.getAttribute?.("href"),
            element.getAttribute?.("src"),
            element.getAttribute?.("data-src"),
            element.getAttribute?.("data-image"),
            element.getAttribute?.("data-large"),
            element.getAttribute?.("data-zoom-image"),
            element.currentSrc,
          ];

          const srcset = element.getAttribute?.("srcset") || element.getAttribute?.("data-srcset") || "";

          srcset
            .split(",")
            .map((part) => part.trim().split(/\s+/)[0])
            .filter(Boolean)
            .forEach((candidate) => rawCandidates.push(candidate));

          for (const rawUrl of rawCandidates) {
            const url = absolutizeUrl(rawUrl || "");
            if (!url || !/\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(url)) continue;
            // Smokingpipes serves legacy gallery assets from /products/ and
            // current detail galleries from /images/products-hr/. Both are
            // first-party product image paths; retain the path allow-list so
            // site chrome and related-product images are not collected.
            if (!/\/(?:products|images\/products-hr)\//i.test(url)) continue;

            const largeUrl = getLargeProductImageUrl(url);

            if (excluded) {
              excludedImages.push(largeUrl);
              continue;
            }

            // Only persist large product images. Thumbnails create duplicate entries.
            largeUrls.push(largeUrl);
          }
        }

        return {
          galleryImages: Array.from(new Set(largeUrls)),
          excludedSimilarImageCount: Array.from(new Set(excludedImages)).length,
          excludedImages: Array.from(new Set(excludedImages)),
        };
      };

      const rawText = usefulRoot.innerText || document.body.innerText || "";

      const fullTitle = normalizeText(
        document.querySelector("h1")?.innerText ||
          document.querySelector(".product-title, .title")?.innerText ||
          listItem.title ||
          ""
      );

      const titleParts = fullTitle.split(":").map(normalizeText);
      const brand = titleParts.length > 1 ? titleParts[0] : listItem.brand || "";
      const title = titleParts.length > 1 ? titleParts.slice(1).join(":").trim() : fullTitle;

      const priceText = normalizeText(rawText);
      const prices = [...priceText.matchAll(/\$\s*[\d,]+(?:\.\d{2})?/g)].map((match) => normalizeText(match[0]));
      const originalPrice = normalizeText(priceText.match(/\bReg\.\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[0] || "");
      const msrp = normalizeText(priceText.match(/\bMSRP\s*:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1] || "");
      const price = prices.find((item) => item !== originalPrice && item !== msrp) || listItem.price || "";

      const purchaseElements = Array.from(
        usefulRoot.querySelectorAll(
          "form, button, input, a, [role='button'], .cart, .add-to-cart, .product-price, .price, .availability, .stock, .purchase"
        )
      ).filter((element) => !isInsideExcludedSection(element));
      const purchaseAreaText = normalizeText(
        purchaseElements
          .map((element) =>
            [
              element.innerText,
              element.textContent,
              element.getAttribute?.("value"),
              element.getAttribute?.("aria-label"),
              element.getAttribute?.("title"),
            ]
              .map(normalizeText)
              .filter(Boolean)
              .join(" ")
          )
          .filter(Boolean)
          .join("\n")
      ).slice(0, 4000);
      const buttons = purchaseElements.filter((element) =>
        /^(button|input|a)$/i.test(element.tagName || "") ||
        element.getAttribute?.("role") === "button"
      );
      const buttonText = (element) =>
        normalizeText(
          [
            element.innerText,
            element.textContent,
            element.getAttribute?.("value"),
            element.getAttribute?.("aria-label"),
            element.getAttribute?.("title"),
          ]
            .filter(Boolean)
            .join(" ")
        );
      const isDisabled = (element) =>
        Boolean(
          element.disabled ||
            element.getAttribute?.("disabled") !== null ||
            element.getAttribute?.("aria-disabled") === "true" ||
            /\bdisabled\b/i.test(element.className || "")
        );
      const addToCartEvidence = buttons.some(
        (element) =>
          /\badd\s+to\s+(?:cart|bag|basket)\b/i.test(buttonText(element)) &&
          !isDisabled(element)
      );
      const disabledSoldButtonEvidence = buttons.some(
        (element) =>
          isDisabled(element) &&
          /\b(?:sold\s*out|out\s*of\s*stock|unavailable)\b/i.test(
            buttonText(element)
          )
      );
      const cartFormEvidence = purchaseElements.some(
        (element) =>
          /^form$/i.test(element.tagName || "") &&
          /cart|basket|bag/i.test(
            `${element.getAttribute?.("action") || ""} ${element.id || ""} ${element.className || ""}`
          )
      );
      const quantityEvidence = purchaseElements.some(
        (element) =>
          /^input$/i.test(element.tagName || "") &&
          /^(?:qty|quantity)$/i.test(
            element.getAttribute?.("name") || element.id || ""
          )
      );
      const structuredAvailability = normalizeText(
        document.querySelector("[itemprop='availability'], meta[property='product:availability'], link[itemprop='availability']")?.getAttribute("content") ||
          document.querySelector("[itemprop='availability'], meta[property='product:availability'], link[itemprop='availability']")?.getAttribute("href") ||
          ""
      );
      const globalSoldTextMatched = /\b(?:sold|out of stock|unavailable)\b/i.test(rawText);

      const rawLines = String(rawText).split(/\n+/).map(normalizeText).filter(Boolean);

      const findSpecLine = (patterns) =>
        rawLines.find((line) => patterns.some((pattern) => pattern.test(line))) || "";

      const specValue = (patterns) => {
        const line = findSpecLine(patterns);
        const parts = line.split(/[:：]/);
        return parts.length > 1 ? normalizeText(parts.slice(1).join(":")) : line;
      };

      const specPairs = [
        ["length", [/^(Length|长度|闀垮害)\s*[:：]/i]],
        ["weight", [/^(Weight|重量|閲嶉噺)\s*[:：]/i]],
        ["height", [/^(Height|斗高|鏂楅珮)\s*[:：]/i]],
        ["chamberDepth", [/^(Chamber Depth|钵深|閽垫繁)\s*[:：]/i]],
        ["chamberDiameter", [/^(Chamber Diameter|Chamber Dia|钵径|閽靛緞)\s*[:：]/i]],
        ["outsideDiameter", [/^(Outside Diameter|外径|澶栧緞)\s*[:：]/i]],
        ["stemMaterial", [/^(Stem Material|烟嘴材质|鐑熧槾鏉愯川|鐑熚槾鏉愯川|鐑熷槾鏉愯川)\s*[:：]/i]],
        ["filter", [/^(Filter|滤芯|婊よ姱)\s*[:：]/i]],
        ["shape", [/^(Shape|外形|澶栧舰)\s*[:：]/i]],
        ["finish", [/^(Finish|饰面|楗伴潰)\s*[:：]/i]],
        ["material", [/^(Material|材质|鏉愯川)\s*[:：]/i]],
        ["country", [/^(Country|国家|鍥藉)\s*[:：]/i]],
      ];

      const specsText = specPairs.map(([, patterns]) => findSpecLine(patterns)).filter(Boolean);
      const images = collectImageUrls();

      return {
        sourceSite,
        sourceUrl: window.location.href,
        sourceProductId: sourceProductId(window.location.href) || listItem.sourceProductId || "",
        productCode: productCode(rawText) || listItem.productCode || "",
        conditionType: listType === "estate" ? "estate" : "new",
        brand,
        title,
        fullTitle,
        price,
        originalPrice: originalPrice || listItem.originalPrice || "",
        msrp,
        status: "available",
        statusSignals: {
          purchaseAreaText,
          addToCartEvidence,
          quantityEvidence,
          cartFormEvidence,
          disabledSoldButtonEvidence,
          structuredAvailability,
          globalSoldTextMatched,
          listInventoryStatus: listItem.status || listItem.inventoryStatus || "",
        },
        mainImageUrl: images.galleryImages[0] || "",
        galleryImages: images.galleryImages,
        galleryCount: images.galleryImages.length,
        excludedSimilarImageCount: images.excludedSimilarImageCount,
        specsText: Array.from(new Set(specsText)),
        lengthText: specValue([/^(Length|长度|闀垮害)\s*[:：]/i]),
        weightText: specValue([/^(Weight|重量|閲嶉噺)\s*[:：]/i]),
        heightText: specValue([/^(Height|斗高|鏂楅珮)\s*[:：]/i]),
        chamberDepthText: specValue([/^(Chamber Depth|钵深|閽垬繁)\s*[:：]/i]),
        chamberDiameterText: specValue([/^(Chamber Diameter|Chamber Dia|钵径|閽靛緞)\s*[:：]/i]),
        outsideDiameterText: specValue([/^(Outside Diameter|外径|澶栧緞)\s*[:：]/i]),
        stemMaterial: specValue([/^(Stem Material|烟嘴材质|鐑熧槾鏉愯川|鐑熚槾鏉愯川|鐑熷槾鏉愯川)\s*[:：]/i]),
        filter: specValue([/^(Filter|滤芯|婊よ姱)\s*[:：]/i]),
        shape: specValue([/^(Shape|外形|澶栧舰)\s*[:：]/i]),
        finish: specValue([/^(Finish|饰面|楗伴潰)\s*[:：]/i]),
        material: specValue([/^(Material|材质|鏉愯川)\s*[:：]/i]),
        country: specValue([/^(Country|国家|鍥藉)\s*[:：]/i]),
        ...(saveRawText ? { rawText: normalizeText(rawText).slice(0, 12000) } : {}),
        ...(saveDebugImages
          ? {
              debug: {
                excludedSimilarImageCount: images.excludedSimilarImageCount,
                excludedSimilarImages: images.excludedImages.slice(0, 12),
              },
            }
          : {}),
      };
    },
    { listItem, sourceSite: SOURCE_SITE, listType, saveRawText, saveDebugImages }
  );

  const statusEvidence = classifySmokingpipesDetailStatusEvidence({
    ...(detail.statusSignals || {}),
    rawText: detail.rawText || "",
    price: detail.price,
    listInventoryStatus:
      detail.statusSignals?.listInventoryStatus ||
      listItem?.status ||
      listItem?.inventoryStatus ||
      "",
  });
  return {
    ...detail,
    status: statusEvidence.status,
    statusEvidence,
    rawStatusSource: statusEvidence.rawStatusSource,
  };
}



export function addParsedMeasurements(detail) {
  return {
    ...detail,
    parsedMeasurements: {
      lengthMm: parseMeasurementValue(detail.lengthText, "mm"),
      weightGrams: parseMeasurementValue(detail.weightText, "g"),
      heightMm: parseMeasurementValue(detail.heightText, "mm"),
      chamberDepthMm: parseMeasurementValue(detail.chamberDepthText, "mm"),
      chamberDiameterMm: parseMeasurementValue(detail.chamberDiameterText, "mm"),
      outsideDiameterMm: parseMeasurementValue(detail.outsideDiameterText, "mm"),
    },
  };
}

export function dedupeProducts(products) {
  const seen = new Set();
  const result = [];
  let duplicateCount = 0;
  for (const item of products) {
    const key = item.sourceProductId || item.sourceUrl || item.href || item.productCode;
    if (!key) continue;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return { products: result, duplicateCount };
}
