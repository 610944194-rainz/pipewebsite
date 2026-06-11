import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium } from "playwright";

const SOURCE_SITE = "Smokingpipes";
const rootDir = process.cwd();
const outputPath = path.join(rootDir, "data", "raw", "smokingpipes-probe-v1.json");
const runStatusPath = path.join(rootDir, "data", "raw", "smokingpipes-run-status.json");
const verificationScreenshotPath = path.join(
  rootDir,
  "data",
  "raw",
  "smokingpipes-verification-latest.png"
);
const startUrls = [
  "https://www.smokingpipes.com/pipes/?DISPLAYNUM=48&newOrEstate=new&SORTOPT=default&page=1",
  "https://www.smokingpipes.com/pipes/?DISPLAYNUM=48&newOrEstate=new&SORTOPT=default&page=2",
];

const detailLimit = Number.parseInt(process.env.SMOKINGPIPES_DETAIL_LIMIT || "5", 10);
const headless = String(process.env.SMOKINGPIPES_HEADLESS || "false").toLowerCase() === "true";
const detailDelayMs = Number.parseInt(process.env.SMOKINGPIPES_DETAIL_DELAY_MS || "1500", 10);
const verificationPollMs = Number.parseInt(
  process.env.SMOKINGPIPES_VERIFICATION_POLL_MS || "30000",
  10
);
const verificationMaxWaitMs = Number.parseInt(
  process.env.SMOKINGPIPES_VERIFICATION_MAX_WAIT_MS || String(60 * 60 * 1000),
  10
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueItems(items) {
  return Array.from(new Set(items.map(normalizeText).filter(Boolean)));
}

function getSourceProductId(url) {
  const match = String(url || "").match(/[?&]product_id=(\d+)/i);
  return match ? match[1] : "";
}

function parsePageNumber(url) {
  const parsed = new URL(url);
  return Number.parseInt(parsed.searchParams.get("page") || "1", 10);
}

function absolutizeUrl(value, baseUrl) {
  const text = normalizeText(value);
  if (!text || text.startsWith("data:") || text.startsWith("javascript:")) return "";

  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return "";
  }
}

function getLargeProductImageUrl(url) {
  if (!url) return "";

  return url.replace("/products/tn/", "/products/");
}

function getFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeText(match[1]);
  }

  return "";
}

function extractProductCode(text) {
  return getFirstMatch(text, [/\b(\d{3}-\d{3}-\d{6})\b/]);
}

function extractPrice(text) {
  const normalized = normalizeText(text);
  const originalPrice = getFirstMatch(normalized, [/\bReg\.\s*(\$\s*[\d,]+(?:\.\d{2})?)/i]);
  const msrp = getFirstMatch(normalized, [/\bMSRP\s*:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i]);
  const priceMatches = [...normalized.matchAll(/\$\s*[\d,]+(?:\.\d{2})?/g)].map((match) =>
    normalizeText(match[0])
  );
  const price = priceMatches.find((item) => item !== originalPrice && item !== msrp) || "";

  return { price, originalPrice, msrp };
}

function extractLine(text, patterns) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(normalizeText)
    .filter(Boolean);

  return (
    lines.find((line) => patterns.some((pattern) => pattern.test(line))) ||
    getFirstMatch(normalizeText(text), patterns.map((pattern) => new RegExp(`(${pattern.source}[^\\n]*)`, pattern.flags)))
  );
}

function parseMeasurementValue(text, unit) {
  const pattern =
    unit === "g"
      ? /([\d.]+)\s*g\b/i
      : /([\d.]+)\s*mm\b/i;
  const match = String(text || "").match(pattern);
  const value = match ? Number.parseFloat(match[1]) : null;
  return Number.isFinite(value) ? value : null;
}

async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function detectSmokingpipesVerification(page, options = {}) {
  const httpStatus = options.httpStatus || 0;
  const pageKind = options.pageKind || "detail";
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const pageSignals = await page
    .evaluate((kind) => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const text = document.body?.innerText || "";
      const hasListProductLinks = Boolean(
        document.querySelector("a[href*='moreinfo.cfm'][href*='product_id=']")
      );
      const hasProductTitle = Boolean(
        document.querySelector("h1, .product-title, .title")?.textContent?.trim()
      );
      const hasProductNumber = /Product Number|Product No|产品编号|\b\d{3}-\d{3}-\d{6}\b/i.test(text);
      const hasPrice = /\$\s*[\d,]+(?:\.\d{2})?/.test(text);
      const hasDetailInfo =
        /尺寸及其他详细信息|Length|Weight|Stem Material|Filter|Shape|Finish|Material|Country|Chamber|Bowl|Outside/i.test(
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
      const hasNormalListContent = kind === "list" && hasListProductLinks && hasPrice;
      const hasNormalDetailContent =
        kind !== "list" && hasProductTitle && hasProductNumber && hasPrice && hasDetailInfo && hasMainImage;

      return {
        bodyStart: normalizeText(text).slice(0, 600),
        hasListProductLinks,
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
      hasListProductLinks: false,
      hasProductTitle: false,
      hasProductNumber: false,
      hasPrice: false,
      hasDetailInfo: false,
      hasMainImage: false,
      hasNormalListContent: false,
      hasNormalDetailContent: false,
    }));
  const combinedText = `${title}\n${bodyText}\n${pageSignals.bodyStart}`;
  const textLooksBlocked =
    /\b(verify|verification|captcha|challenge|blocked|forbidden)\b|access denied|checking your browser/i.test(
      combinedText
    );
  const statusLooksBlocked = [403, 429, 503].includes(Number(httpStatus));
  const missingNormalFields =
    pageKind === "list" ? !pageSignals.hasNormalListContent : !pageSignals.hasNormalDetailContent;
  const bodyLooksLikeBlock =
    /cloudflare|akamai|request blocked|enable cookies|security check|human verification|robot|bot/i.test(
      combinedText
    );

  const hasNormalContent =
    pageKind === "list" ? pageSignals.hasNormalListContent : pageSignals.hasNormalDetailContent;
  const textBlockIsActionable = (textLooksBlocked || bodyLooksLikeBlock) && !hasNormalContent;

  return {
    verificationBlocked: Boolean(statusLooksBlocked || textBlockIsActionable || missingNormalFields),
    reasons: {
      httpStatus,
      textLooksBlocked,
      textBlockIsActionable,
      statusLooksBlocked,
      missingNormalFields,
      bodyLooksLikeBlock,
      pageKind,
    },
    signals: {
      title,
      ...pageSignals,
    },
  };
}

function getNotificationConfigStatus() {
  return {
    pushDeer: Boolean(process.env.PUSHDEER_KEY),
    serverChan: Boolean(process.env.SERVER_CHAN_SENDKEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

async function sendScraperAlert(message) {
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

  return {
    configured: true,
    sent: results.some((result) => result.ok),
    channels: config,
    results,
  };
}

function writeRunStatus(status) {
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

async function saveVerificationScreenshot(page) {
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    promise: rl
      .question("Press Enter after manual verification, or wait for auto recovery: ")
      .then(() => true),
    close() {
      rl.close();
    },
  };
}

async function waitForManualVerification(page, options) {
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
    `Smokingpipes verification detected. Waiting up to ${Math.round(
      verificationMaxWaitMs / 60000
    )} minutes.`
  );

  try {
    while (Date.now() - startedAt < verificationMaxWaitMs) {
      const remainingMs = verificationMaxWaitMs - (Date.now() - startedAt);
      const waitMs = Math.min(verificationPollMs, Math.max(1000, remainingMs));
      const enterResult = await Promise.race([sleep(waitMs).then(() => false), enterWaiter.promise]);

      if (enterResult) {
        await waitForStablePage(page);
      }

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
    message:
      "Manual verification timed out. Checkpoint saved; the next run will skip completed details.",
    screenshotPath,
    notification,
  });
  await saveCheckpoint?.();

  return { recovered: false, verificationBlocked: true, notification, timedOut: true };
}

async function extractListProducts(page, listPageUrl) {
  return page.evaluate(
    ({ listPageUrl, listPage }) => {
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
        const match = String(text || "").match(/\b(\d{3}-\d{3}-\d{6})\b/);
        return match ? match[1] : "";
      };
      const firstPrice = (text) => {
        const normalized = normalizeText(text);
        const original = normalized.match(/\bReg\.\s*(\$\s*[\d,]+(?:\.\d{2})?)/i)?.[1] || "";
        const prices = [...normalized.matchAll(/\$\s*[\d,]+(?:\.\d{2})?/g)].map((match) =>
          normalizeText(match[0])
        );
        return prices.find((price) => price !== normalizeText(original)) || "";
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

          if (hasImage && hasPrice) return current;
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
          image?.currentSrc ||
            image?.getAttribute("data-src") ||
            srcsetCandidate ||
            image?.getAttribute("src") ||
            ""
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
            listPageUrl,
            listPage,
            listPosition: index + 1,
            brand: brandFrom(title, href),
            title,
            productCode: productCode(rawText),
            href,
            sourceProductId: sourceProductId(href),
            imageUrl: imageFromCard(card),
            price: firstPrice(rawText),
            originalPrice: originalPrice(rawText),
            rmbText: lineFor(rawText, [/人民币|CNY|¥|￥/i]),
            discountText: lineFor(rawText, [/\b\d+%\s+Off\b/i, /\bOff\b/i]),
            lengthText: lineFor(rawText, [/Length|长度/i]),
            weightText: lineFor(rawText, [/Weight|重量/i]),
            filterText: lineFor(rawText, [/Filter|滤芯/i]),
            rawText: normalizeText(rawText),
          };
        })
        .filter(Boolean);
    },
    { listPageUrl, listPage: parsePageNumber(listPageUrl) }
  );
}

async function extractDetailProduct(page, listItem) {
  return page.evaluate(
    ({ listItem, sourceSite }) => {
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
        const match = String(text || "").match(/\b(\d{3}-\d{3}-\d{6})\b/);
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
        rootCandidates.sort(
          (left, right) => (right.innerText || "").length - (left.innerText || "").length
        )[0] || document.body;
      const collectImageUrls = () => {
        const urls = [];
        const elements = Array.from(
          usefulRoot.querySelectorAll("a[href], img, [data-image], [data-large], [data-src], [data-zoom-image]")
        );
        const excludedImages = [];

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
            if (!/\/products\//i.test(url)) continue;

            if (excluded) {
              excludedImages.push(url);
              continue;
            }

            urls.push(url);

            const largeUrl = getLargeProductImageUrl(url);
            if (largeUrl !== url) urls.push(largeUrl);
          }
        }

        return {
          galleryImages: Array.from(new Set(urls)),
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
      const lineFor = (patterns) =>
        String(rawText)
          .split(/\n+/)
          .map(normalizeText)
          .find((line) => patterns.some((pattern) => pattern.test(line))) || "";
      const specLines = String(rawText)
        .split(/\n+/)
        .map(normalizeText)
        .filter((line) =>
          /Length|Weight|Height|Chamber|Bowl|Outside|Stem Material|Filter|Shape|Finish|Material|Country|长度|重量|斗高|钵深|钵径|外径|烟嘴材质|滤芯|外形|饰面|材质|国家/i.test(
            line
          )
        );
      const description =
        Array.from(usefulRoot.querySelectorAll("p"))
          .filter((element) => !isInsideExcludedSection(element))
          .map((element) => normalizeText(element.innerText))
          .filter((text) => text.length > 80)
          .slice(0, 2)
          .join("\n\n") || "";
      const specValue = (patterns) => {
        const line = lineFor(patterns);
        const parts = line.split(/[:：]/);
        return parts.length > 1 ? normalizeText(parts.slice(1).join(":")) : line;
      };
      const images = collectImageUrls();

      return {
        sourceSite,
        sourceUrl: window.location.href,
        sourceProductId: sourceProductId(window.location.href) || listItem.sourceProductId || "",
        productCode: productCode(rawText) || listItem.productCode || "",
        conditionType: "new",
        brand,
        title,
        fullTitle,
        price,
        originalPrice: originalPrice || listItem.originalPrice || "",
        msrp,
        status: /sold|out of stock|unavailable/i.test(rawText) ? "sold" : "available",
        mainImageUrl: images.galleryImages[0] || "",
        galleryImages: images.galleryImages,
        galleryCount: images.galleryImages.length,
        specsText: Array.from(new Set(specLines)),
        description,
        lengthText: specValue([/Length|长度/i]),
        weightText: specValue([/Weight|重量/i]),
        heightText: specValue([/Height|斗高/i]),
        chamberDepthText: specValue([/Chamber Depth|钵深/i]),
        chamberDiameterText: specValue([/Chamber Diameter|Chamber Dia|钵径/i]),
        outsideDiameterText: specValue([/Outside Diameter|外径/i]),
        stemMaterial: specValue([/Stem Material|烟嘴材质/i]),
        filter: specValue([/Filter|滤芯/i]),
        shape: specValue([/Shape|外形/i]),
        finish: specValue([/Finish|饰面/i]),
        material: specValue([/^Material|材质/i]),
        country: specValue([/Country|国家/i]),
        parsedMeasurements: {
          lengthMm: null,
          weightGrams: null,
          heightMm: null,
          chamberDepthMm: null,
          chamberDiameterMm: null,
          outsideDiameterMm: null,
        },
        rawText: normalizeText(rawText).slice(0, 12000),
        debug: {
          excludedSimilarImageCount: images.excludedImages.length,
          excludedSimilarImages: images.excludedImages.slice(0, 12),
        },
      };
    },
    { listItem, sourceSite: SOURCE_SITE }
  );
}

function addParsedMeasurements(detail) {
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

function getMissingFields(item, fields) {
  return fields.filter((field) => {
    const value = item[field];
    if (Array.isArray(value)) return value.length === 0;
    return !normalizeText(value);
  });
}

function summarize(listProducts, details, errors) {
  const uniqueDetailLinks = uniqueItems(listProducts.map((item) => item.href));
  const galleryCounts = details.map((item) => ({
    sourceProductId: item.sourceProductId,
    galleryCount: item.galleryCount,
  }));
  const detailMissingFields = details.map((item) => ({
    sourceProductId: item.sourceProductId,
    missingFields: getMissingFields(item, [
      "brand",
      "title",
      "productCode",
      "price",
      "mainImageUrl",
      "galleryImages",
      "specsText",
      "description",
    ]),
  }));
  const similarPipesImageRisk = details.some((item) => item.debug?.excludedSimilarImageCount > 0);
  const verificationBlockedCount = details.filter((item) => item.verificationBlocked).length;

  return {
    listProductCount: listProducts.length,
    uniqueDetailLinkCount: uniqueDetailLinks.length,
    detailTargetCount: Math.min(detailLimit, uniqueDetailLinks.length),
    detailSuccessCount: details.length,
    detailFailCount: errors.length,
    verificationBlockedCount,
    notificationConfigured: getNotificationConfigStatus(),
    galleryCounts,
    similarPipesImageRisk,
    detailMissingFields,
  };
}

function loadPreviousProbeOutput() {
  if (!fs.existsSync(outputPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    console.warn(`Could not read previous probe output: ${error.message}`);
    return null;
  }
}

function isReusableDetail(detail) {
  return Boolean(
    detail?.sourceProductId &&
      detail.verificationBlocked !== true &&
      detail.mainImageUrl &&
      Array.isArray(detail.galleryImages) &&
      detail.galleryImages.length > 0 &&
      Array.isArray(detail.specsText) &&
      detail.specsText.length > 0
  );
}

function buildProbeOutput({ startedAt, completedAt, listPages, listProducts, details, errors }) {
  return {
    sourceSite: SOURCE_SITE,
    probeVersion: "v1",
    startedAt,
    completedAt,
    config: {
      startUrls,
      detailLimit,
      headless,
      detailDelayMs,
      verificationPollMs,
      verificationMaxWaitMs,
    },
    listPages,
    listProducts,
    uniqueProducts: Array.from(new Map(listProducts.map((item) => [item.href, item])).values()),
    details,
    errors,
    summary: summarize(listProducts, details, errors),
  };
}

function saveProbeOutput(output) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date().toISOString();

  console.log("Smokingpipes probe v1 starting...");
  console.log(
    JSON.stringify(
      {
        headless,
        detailLimit,
        detailDelayMs,
        outputPath,
        listPages: startUrls.length,
      },
      null,
      2
    )
  );

  const userDataDir =
    process.env.SMOKINGPIPES_USER_DATA_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "pipewebsite-smokingpipes-probe-"));
  const context = await launchProbeContext(userDataDir);
  const page = context.pages()[0] || (await context.newPage());
  const previousOutput = loadPreviousProbeOutput();
  const listPages = [];
  const listProducts = [];
  const details = (previousOutput?.details || []).filter(isReusableDetail);
  const errors = [];
  const completedDetailIds = new Set(details.map((detail) => String(detail.sourceProductId)));
  const saveCheckpoint = async () => {
    saveProbeOutput(
      buildProbeOutput({
        startedAt,
        completedAt: new Date().toISOString(),
        listPages,
        listProducts,
        details,
        errors,
      })
    );
  };

  try {
    for (const url of startUrls) {
      console.log(`Opening list page: ${url}`);
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForStablePage(page);
      const listVerification = await waitForManualVerification(page, {
        pageKind: "list",
        currentUrl: page.url(),
        currentProductUrl: "",
        currentProductTitle: `List page ${parsePageNumber(url)}`,
        currentIndex: parsePageNumber(url),
        totalCount: startUrls.length,
        successCount: listProducts.length,
        failCount: errors.length,
        httpStatus: response?.status() || 0,
        saveCheckpoint,
      });

      if (!listVerification.recovered) {
        return;
      }

      const products = await extractListProducts(page, url);
      listPages.push({
        url,
        page: parsePageNumber(url),
        productCount: products.length,
        verificationBlocked: listVerification.verificationBlocked,
      });
      listProducts.push(...products);
      console.log(`List page ${parsePageNumber(url)} products: ${products.length}`);

      if (listVerification.verificationBlocked && products.length === 0) {
        errors.push({
          href: url,
          sourceProductId: "",
          title: `List page ${parsePageNumber(url)}`,
          error: "List page still appears to be verification-blocked.",
        });
      }
    }

    const uniqueByHref = new Map();
    for (const item of listProducts) {
      if (item.href && !uniqueByHref.has(item.href)) {
        uniqueByHref.set(item.href, item);
      }
    }

    const detailTargets = Array.from(uniqueByHref.values()).slice(0, detailLimit);

    for (const [index, item] of detailTargets.entries()) {
      if (completedDetailIds.has(String(item.sourceProductId))) {
        console.log(`Skipping completed detail ${index + 1}/${detailTargets.length}: ${item.href}`);
        continue;
      }

      console.log(`Opening detail ${index + 1}/${detailTargets.length}: ${item.href}`);

      try {
        const response = await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 60000 });
        await waitForStablePage(page);
        const detailVerification = await waitForManualVerification(page, {
          pageKind: "detail",
          currentUrl: page.url(),
          currentProductUrl: item.href,
          currentProductTitle: item.title,
          currentIndex: index + 1,
          totalCount: detailTargets.length,
          successCount: details.length,
          failCount: errors.length,
          httpStatus: response?.status() || 0,
          saveCheckpoint,
        });

        if (!detailVerification.recovered) {
          return;
        }

        const detail = addParsedMeasurements(await extractDetailProduct(page, item));
        detail.verificationBlocked = detailVerification.verificationBlocked;
        details.push(detail);
        completedDetailIds.add(String(detail.sourceProductId));
        console.log(
          `Detail ${index + 1} ok: product_id=${detail.sourceProductId}, gallery=${detail.galleryCount}`
        );
        await saveCheckpoint();
      } catch (error) {
        errors.push({
          href: item.href,
          sourceProductId: item.sourceProductId,
          title: item.title,
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn(`Detail ${index + 1} failed: ${item.href}`);
      }

      await sleep(detailDelayMs);
    }
  } finally {
    await context.close().catch(() => {});
  }

  const completedAt = new Date().toISOString();
  const output = buildProbeOutput({
    startedAt,
    completedAt,
    listPages,
    listProducts,
    details,
    errors,
  });

  saveProbeOutput(output);
  writeRunStatus({
    status: "completed",
    currentUrl: page.url(),
    currentProductUrl: "",
    currentIndex: output.summary.detailTargetCount,
    totalCount: output.summary.detailTargetCount,
    successCount: details.length,
    failCount: errors.length,
    message: "Smokingpipes probe completed.",
  });

  console.log(`Smokingpipes probe written: ${outputPath}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

async function launchProbeContext(userDataDir) {
  const baseOptions = {
    headless,
    viewport: { width: 1365, height: 900 },
  };
  const channelCandidates = Array.from(new Set([
    process.env.SMOKINGPIPES_BROWSER_CHANNEL || "",
    "",
    "msedge",
    "chrome",
  ]));
  let lastError = null;

  for (const channel of channelCandidates) {
    try {
      const options = channel ? { ...baseOptions, channel } : baseOptions;
      console.log(channel ? `Launching browser channel: ${channel}` : "Launching Playwright Chromium");
      return await chromium.launchPersistentContext(userDataDir, options);
    } catch (error) {
      lastError = error;
      console.warn(
        channel
          ? `Browser channel ${channel} failed: ${error.message}`
          : `Playwright Chromium failed: ${error.message}`
      );
    }
  }

  throw lastError;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
