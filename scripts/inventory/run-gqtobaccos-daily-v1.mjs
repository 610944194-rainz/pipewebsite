import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import {
  acquireRunLock,
  formatRunId,
  getRunnerPaths,
  releaseRunLock,
  writeJsonAtomic,
} from "./inventory-runner-core-v1.mjs";
import { buildInventoryDiff } from "./smokingpipes-diff-inventory-v1.mjs";
import { calculateReferencePrice } from "../../lib/pricing/reference-price.mjs";
import { sendGqDailyPushDeerNotification } from "./gqtobaccos-pushdeer-notification-v1.mjs";

const SOURCE = "gqtobaccos";
const SOURCE_ORIGIN = "https://www.gqtobaccos.com";
const CATEGORY_PATH = "/pipes/";
const SOURCE_CURRENCY = "GBP";
const FIXED_INTERNATIONAL_SHIPPING_GBP = 20;
const MAX_PAGINATION_GUARD = 500;
const LIST_PAGE_DELAY_RANGE_MS = [2_000, 5_000];
const LIST_RATE_LIMIT_BACKOFF_RANGES_MS = [
  [30_000, 45_000],
  [60_000, 90_000],
  [120_000, 180_000],
];
const COMPONENT_PATTERNS = [
  /\b(?:replacement\s+)?stem(?:\s+only)?\b/i,
  /\b(?:replacement\s+)?bowl(?:\s+only)?\b/i,
  /\b(?:replacement\s+)?mouthpiece(?:\s+only)?\b/i,
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&pound;/gi, "\u00a3")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(value) {
  return normalizeText(
    decodeHtml(String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
  );
}

function htmlToLines(value) {
  return decodeHtml(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
}

function attribute(html, name) {
  const pattern = new RegExp(
    `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = String(html ?? "").match(pattern);
  return cleanNullableText(decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? ""));
}

function firstMatch(html, pattern) {
  return String(html ?? "").match(pattern)?.[1] ?? "";
}

export function parseGbpAmount(value) {
  const text = normalizeText(decodeHtml(value));
  if (!text) return null;
  const match = text.match(/(?:GBP|\u00a3)?\s*([\d][\d,]*(?:\.\d{1,2})?)/i);
  const amount = Number.parseFloat((match?.[1] || "").replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function absoluteUrl(value) {
  const normalized = cleanNullableText(value);
  if (!normalized) return "";
  try {
    return new URL(normalized, SOURCE_ORIGIN).toString();
  } catch {
    return "";
  }
}

function parsePageNumber(value) {
  const decoded = decodeHtml(value);
  const match = decoded.match(/[?&]page=(\d+)/i);
  const page = Number.parseInt(match?.[1] || "", 10);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function extractPaginationMax(html) {
  const pages = [];
  for (const match of String(html ?? "").matchAll(/aria-label\s*=\s*["']Page\s+\d+\s+of\s+(\d+)["']/gi)) {
    const page = Number.parseInt(match[1], 10);
    if (Number.isInteger(page) && page > 0) pages.push(page);
  }
  for (const match of String(html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const page = parsePageNumber(match[1]);
    if (page) pages.push(page);
  }
  return pages.length ? Math.max(...pages) : null;
}

function extractCardArticles(gridHtml) {
  return [...String(gridHtml ?? "").matchAll(/<article\b[\s\S]*?<\/article>/gi)]
    .map((match) => match[0])
    .filter((card) => Boolean(attribute(card, "data-entity-id")));
}

function priceTextFromCard(card) {
  const normalized = htmlToText(card);
  const nowMatch = normalized.match(
    /\b(?:now|sale\s*price)\s*:?\s*(?:GBP|\u00a3)\s*([\d][\d,]*(?:\.\d{1,2})?)/i
  );
  if (nowMatch) return `GBP ${nowMatch[1]}`;

  const dataPrice = attribute(card, "data-product-price");
  if (parseGbpAmount(dataPrice) !== null) return `GBP ${dataPrice}`;

  const regularPrice = firstMatch(
    card,
    /<span\b[^>]*data-product-price-with-tax[^>]*>([\s\S]*?)<\/span>/i
  );
  if (parseGbpAmount(regularPrice) !== null) return regularPrice;

  const values = [...normalized.matchAll(/(?:GBP|\u00a3)\s*([\d][\d,]*(?:\.\d{1,2})?)/gi)];
  return values.length ? `GBP ${values.at(-1)[1]}` : "";
}

function msrpTextFromCard(card) {
  const normalized = htmlToText(card);
  const match = normalized.match(
    /\b(?:msrp|rrp|was)\s*:?\s*(?:GBP|\u00a3)\s*([\d][\d,]*(?:\.\d{1,2})?)/i
  );
  return match ? `GBP ${match[1]}` : "";
}

function categoryBrand(card) {
  const categories = decodeHtml(attribute(card, "data-product-category") || "");
  const category = categories
    .split(",")
    .map(normalizeText)
    .find((value) => /^pipes\//i.test(value));
  if (!category) return "";
  const segments = category.split("/").map(normalizeText).filter(Boolean);
  return segments.length >= 2 ? segments[1] : "";
}

function classifyGqPublicEligibility({ title, brand }) {
  const normalizedBrand = normalizeText(brand).toLowerCase();
  const normalizedTitle = normalizeText(title);
  if (normalizedBrand === "falcon" || /^falcon(?:\s|[-–—])/i.test(normalizedTitle)) {
    return {
      publicIndexEligible: false,
      entityType: "excluded-brand",
      reason: "Falcon is globally excluded before the detail queue.",
    };
  }
  const componentPattern = COMPONENT_PATTERNS.find((pattern) => pattern.test(normalizedTitle));
  if (componentPattern) {
    return {
      publicIndexEligible: false,
      entityType: "component",
      reason: "Explicit pipe component is excluded before the detail queue.",
    };
  }
  return {
    publicIndexEligible: true,
    entityType: "offer",
    reason: "Current complete GQ pipes list contains an eligible pipe offer.",
  };
}

function parseCard(card, page, listPosition) {
  const sourceProductId = attribute(card, "data-entity-id") || "";
  const sourceUrl = absoluteUrl(
    firstMatch(card, /<a\b[^>]*class\s*=\s*["'][^"']*card-figure__link[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i) ||
      firstMatch(card, /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*card-figure__link/i)
  );
  const title = cleanNullableText(attribute(card, "data-name")) || htmlToText(
    firstMatch(card, /class\s*=\s*["'][^"']*card-title[^"']*["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i)
  );
  const imageUrl = absoluteUrl(
    firstMatch(card, /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
  );
  const priceRaw = priceTextFromCard(card);
  const priceGBP = parseGbpAmount(priceRaw);
  const msrpRaw = msrpTextFromCard(card);
  const msrpGBP = parseGbpAmount(msrpRaw);
  const brand = categoryBrand(card) || normalizeText(title).split(/\s+-\s+/)[0] || "";
  const publicEligibility = classifyGqPublicEligibility({ title, brand });

  return {
    source: SOURCE,
    id: `${SOURCE}-${sourceProductId}`,
    sourceProductId,
    sourceUrl,
    title: normalizeText(title),
    rawTitle: normalizeText(title),
    brand: normalizeText(brand),
    price: priceRaw,
    priceRaw,
    priceAmount: priceGBP,
    priceGBP,
    currency: SOURCE_CURRENCY,
    sourcePriceCurrency: SOURCE_CURRENCY,
    sourcePriceAmount: priceGBP,
    msrpRaw,
    msrpAmount: msrpGBP,
    imageUrl,
    mainImageUrl: imageUrl,
    inventoryStatus: "available",
    inventoryConfidence: "complete-current-list",
    listPage: page,
    listPosition,
    publicEligibility,
  };
}

export function parseGqListPage(html, { page = 1, url = "" } = {}) {
  const source = String(html ?? "");
  const gridMatch = source.match(/<ul\b[^>]*class\s*=\s*["'][^"']*productGrid[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
  const grid = gridMatch?.[1] || "";
  const categoryMarker = /data-list-name\s*=\s*["']Category:\s*Pipes["']/i.test(source);
  const noProducts = /There are no products listed under this category\./i.test(source);
  const breadcrumbPipes = /breadcrumb[^>]*is-active[\s\S]{0,500}href\s*=\s*["'][^"']*\/pipes\//i.test(source);
  const normalCategory =
    (categoryMarker && (Boolean(gridMatch) || noProducts)) ||
    (noProducts && breadcrumbPipes && /id\s*=\s*["']product-listing-container["']/i.test(source));
  const cards = normalCategory ? extractCardArticles(grid) : [];
  const products = cards.map((card, index) => parseCard(card, page, index + 1));
  const invalidProducts = products.filter(
    (product) =>
      !product.sourceProductId ||
      !/^\d+$/.test(product.sourceProductId) ||
      !product.sourceUrl ||
      !product.title ||
      product.priceGBP === null
  );

  return {
    page,
    url,
    normalCategory,
    noProducts,
    ageModalPresent: /Are You The Legal Age|your age does not permit/i.test(source),
    maxPage: extractPaginationMax(source),
    products,
    invalidProducts,
    endOfList: normalCategory && products.length === 0 && noProducts,
  };
}

function extractBcData(html) {
  const match = String(html ?? "").match(/var\s+BCData\s*=\s*({[\s\S]*?});\s*<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findDescriptionHtml(html) {
  return (
    firstMatch(html, /<div\b[^>]*id\s*=\s*["']tab-description["'][^>]*>([\s\S]*?)<\/div>\s*<div\b/i) ||
    firstMatch(html, /<div\b[^>]*id\s*=\s*["']tab-description["'][^>]*>([\s\S]*?)<\/div>/i)
  );
}

function extractDetailSpecs(descriptionHtml) {
  const aliases = new Map([
    ["pipe material", "material"],
    ["shape", "shape"],
    ["finish", "finish"],
    ["colour", "colour"],
    ["color", "colour"],
    ["mouthpiece", "mouthpiece"],
    ["filter", "filter"],
    ["pipe length", "lengthMm"],
    ["pipe height", "heightMm"],
    ["bowl height", "heightMm"],
    ["pipe width", "outsideDiameterMm"],
    ["chamber width", "chamberDiameterMm"],
    ["chamber diameter", "chamberDiameterMm"],
    ["chamber depth", "chamberDepthMm"],
    ["pipe weight", "weightGrams"],
    ["weight", "weightGrams"],
  ]);
  const specs = {};
  for (const line of htmlToLines(descriptionHtml)) {
    const match = line.match(/^([^:]{2,40})\s*:\s*(.+)$/);
    if (!match) continue;
    const key = normalizeText(match[1]).toLowerCase();
    const canonical = aliases.get(key);
    if (!canonical) continue;
    const rawValue = normalizeText(match[2]);
    if (canonical.endsWith("Mm") || canonical === "weightGrams") {
      const number = Number.parseFloat(rawValue.replace(/,/g, ".").replace(/[^\d.]/g, ""));
      specs[canonical] = Number.isFinite(number) && number > 0 ? number : null;
    } else {
      specs[canonical] = rawValue || null;
    }
  }
  return specs;
}

export function parseGqDetailPage(html, { sourceUrl = "", sourceProductId = "" } = {}) {
  const source = String(html ?? "");
  const bcData = extractBcData(source);
  const attributes = bcData?.product_attributes || {};
  const productViewTag = source.match(/<div\b[^>]*class\s*=\s*["'][^"']*productView[^"']*["'][^>]*>/i)?.[0] || "";
  const detailId = attribute(productViewTag, "data-entity-id");
  const title = htmlToText(
    firstMatch(source, /<h1\b[^>]*class\s*=\s*["'][^"']*productView-name[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
  );
  const descriptionHtml = findDescriptionHtml(source);
  const specs = extractDetailSpecs(descriptionHtml);
  const galleryImages = uniqueStrings([
    ...[...source.matchAll(/data-zoom-image\s*=\s*["']([^"']+)["']/gi)].map((match) => absoluteUrl(match[1])),
    ...[...source.matchAll(/data-image-gallery-new-image-url\s*=\s*["']([^"']+)["']/gi)].map((match) => absoluteUrl(match[1])),
  ]);
  const productCategories = attribute(productViewTag, "data-product-category") || "";
  const brand = productCategories
    .split(",")
    .map(normalizeText)
    .find((value) => /^pipes\//i.test(value))
    ?.split("/")?.[1] || "";
  const price = attributes?.price?.with_tax || {};
  const msrp = attributes?.price?.rrp_with_tax || {};
  const hasOptions = /data-product-option-change/i.test(source) && /(?:<select\b|form-field--)/i.test(source);
  const outOfStock =
    attributes?.instock === false ||
    attributes?.purchasable === false ||
    Number(attributes?.available_to_sell) === 0 ||
    /class\s*=\s*["'][^"']*productView[^"']*["'][\s\S]{0,12000}(?:Out of stock|Sold Out)/i.test(source);

  return {
    source: SOURCE,
    sourceProductId: normalizeText(sourceProductId || detailId),
    sourceUrl: absoluteUrl(sourceUrl),
    canonicalUrl: absoluteUrl(sourceUrl),
    title,
    brand: normalizeText(brand),
    description: htmlToText(descriptionHtml),
    rawDescription: htmlToText(descriptionHtml),
    images: galleryImages,
    mainImageUrl: galleryImages[0] || "",
    priceGBP: Number.isFinite(Number(price.value)) ? Number(price.value) : null,
    priceRaw: normalizeText(price.formatted),
    msrpGBP: Number.isFinite(Number(msrp.value)) ? Number(msrp.value) : null,
    msrpRaw: normalizeText(msrp.formatted),
    currency: normalizeText(price.currency) || SOURCE_CURRENCY,
    detailOutOfStock: Boolean(outOfStock),
    hasOptions,
    specs,
    detailCollectedAt: new Date().toISOString(),
  };
}

function categoryUrl(page) {
  const url = new URL(CATEGORY_PATH, SOURCE_ORIGIN);
  url.searchParams.set("page", String(page));
  url.searchParams.set("setCurrencyId", "1");
  return url.toString();
}

function sleepFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs([minimumMs, maximumMs], random = Math.random) {
  const minimum = Math.max(0, Number(minimumMs) || 0);
  const maximum = Math.max(minimum, Number(maximumMs) || minimum);
  return Math.floor(minimum + (maximum - minimum) * random());
}

function retryAfterMs(response, now = () => Date.now()) {
  const raw = normalizeText(response?.headers?.get?.("retry-after"));
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.ceil(Number(raw) * 1_000));
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - now());
}

function createHttpSession({ fetchImpl = fetch, timeoutMs = 20_000, retries = 2 } = {}) {
  const cookies = new Map();
  const persistCookies = (response) => {
    const values = response.headers.getSetCookie?.() || [];
    for (const value of values) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  };
  const cookieHeader = () => [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");

  return {
    async get(url, {
      rateLimitRetries = 0,
      rateLimitBackoffRangesMs = LIST_RATE_LIMIT_BACKOFF_RANGES_MS,
      sleep = sleepFor,
      random = Math.random,
      now = () => Date.now(),
    } = {}) {
      let retryableAttempt = 0;
      let rateLimitAttempt = 0;
      while (true) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: {
              "user-agent": "Mozilla/5.0 (compatible; YandouBuy GQ V1 collector)",
              accept: "text/html,application/xhtml+xml",
              ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
            },
          });
          persistCookies(response);
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status} for ${url}`);
            error.status = response.status;
            if (response.status === 429 && rateLimitAttempt < rateLimitRetries) {
              const retryAfter = retryAfterMs(response, now);
              const backoffRange = rateLimitBackoffRangesMs[rateLimitAttempt] || rateLimitBackoffRangesMs.at(-1);
              const delayMs = retryAfter ?? randomDelayMs(backoffRange, random);
              rateLimitAttempt += 1;
              await sleep(delayMs);
              continue;
            }
            if (response.status >= 500 && retryableAttempt < retries) {
              retryableAttempt += 1;
              await sleep(250 * retryableAttempt);
              continue;
            }
            if (response.status === 429) error.rateLimitRetries = rateLimitAttempt;
            throw error;
          }
          return {
            url: response.url,
            html: await response.text(),
            rateLimitRetries: rateLimitAttempt,
          };
        } catch (error) {
          const retryable = error?.name === "AbortError" || error?.status >= 500 || error instanceof TypeError;
          if (!retryable || retryableAttempt >= retries) throw error;
          retryableAttempt += 1;
          await sleep(250 * retryableAttempt);
        } finally {
          clearTimeout(timeout);
        }
      }
    },
  };
}

function assertParsedListPage(parsed, { expectedPage, allowEndOfList = false }) {
  if (!parsed.normalCategory) {
    throw new Error(`GQ page ${expectedPage} is not a normal Pipes category page.`);
  }
  if (parsed.products.length === 0 && !(allowEndOfList && parsed.endOfList)) {
    throw new Error(`GQ page ${expectedPage} is empty without the explicit normal end-of-list marker.`);
  }
  if (parsed.invalidProducts.length) {
    throw new Error(`GQ page ${expectedPage} contains ${parsed.invalidProducts.length} invalid product cards.`);
  }
}

export async function collectGqCurrentList({
  fetchImpl = fetch,
  maxPaginationGuard = MAX_PAGINATION_GUARD,
  sleep = sleepFor,
  random = Math.random,
  listPageDelayRangeMs = LIST_PAGE_DELAY_RANGE_MS,
} = {}) {
  const session = createHttpSession({ fetchImpl });
  const firstUrl = categoryUrl(1);
  const listFetchOptions = {
    rateLimitRetries: 3,
    rateLimitBackoffRangesMs: LIST_RATE_LIMIT_BACKOFF_RANGES_MS,
    sleep,
    random,
  };
  const firstResponse = await session.get(firstUrl, listFetchOptions);
  const first = parseGqListPage(firstResponse.html, { page: 1, url: firstResponse.url });
  assertParsedListPage(first, { expectedPage: 1 });

  const pages = [first];
  let detectedTotalPages = first.maxPage || null;
  let rateLimitRetryCount = firstResponse.rateLimitRetries || 0;
  let page = 2;
  while (page <= maxPaginationGuard) {
    await sleep(randomDelayMs(listPageDelayRangeMs, random));
    let response;
    try {
      response = await session.get(categoryUrl(page), listFetchOptions);
    } catch (error) {
      error.listProgress = {
        pagesDiscovered: Math.max(detectedTotalPages || 0, pages.length),
        pagesCompleted: pages.length,
        pagesFailed: 1,
        lastSuccessfulPage: pages.at(-1)?.page || 0,
      };
      throw error;
    }
    rateLimitRetryCount += response.rateLimitRetries || 0;
    const parsed = parseGqListPage(response.html, { page, url: response.url });
    assertParsedListPage(parsed, { expectedPage: page, allowEndOfList: true });
    if (parsed.endOfList) break;

    const priorDetectedTotal = detectedTotalPages;
    detectedTotalPages = Math.max(
      detectedTotalPages || 0,
      parsed.maxPage || 0,
      page
    );
    if (detectedTotalPages > maxPaginationGuard) {
      throw new Error(`GQ pagination reports ${detectedTotalPages} pages, over the safety guard of ${maxPaginationGuard}.`);
    }
    if (priorDetectedTotal !== null && page > priorDetectedTotal && detectedTotalPages <= priorDetectedTotal) {
      throw new Error(`GQ page ${page} contains products but its pagination did not extend the detected range.`);
    }
    pages.push(parsed);
    page += 1;
  }
  if (page > maxPaginationGuard) {
    throw new Error(`GQ pagination reached the safety guard of ${maxPaginationGuard} without an explicit end-of-list page.`);
  }

  const products = pages.flatMap((page) => page.products);
  const ids = new Set();
  const urls = new Set();
  const duplicateSourceProductIds = [];
  const duplicateSourceUrls = [];
  for (const product of products) {
    if (ids.has(product.sourceProductId)) duplicateSourceProductIds.push(product.sourceProductId);
    ids.add(product.sourceProductId);
    if (urls.has(product.sourceUrl)) duplicateSourceUrls.push(product.sourceUrl);
    urls.add(product.sourceUrl);
  }
  if (duplicateSourceProductIds.length || duplicateSourceUrls.length) {
    throw new Error("GQ current list contains duplicate source identities.");
  }

  return {
    version: "gqtobaccos-current-list-dry-run-v1",
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    scrapeType: "http-html-current-list",
    products,
    summary: {
      pagesDiscovered: pages.length,
      pagesCompleted: pages.length,
      pagesFailed: 0,
      lastSuccessfulPage: pages.at(-1)?.page || 0,
      pagesRequested: pages.length,
      pagesScanned: pages.length,
      effectiveScannedPages: pages.length,
      detectedTotalPages: detectedTotalPages || pages.length,
      expectedPages: detectedTotalPages || pages.length,
      fullExpectedRangeScanned: true,
      endOfListConfirmed: true,
      failedPages: [],
      captchaDetected: false,
      duplicateSourceProductIds: [],
      duplicateSourceUrls: [],
      duplicateStats: {
        classificationAvailable: true,
        totalDuplicateIds: 0,
        safeDuplicateCount: 0,
        suspiciousDuplicateCount: 0,
        suspiciousDuplicateIds: [],
      },
      soldByAbsenceAllowed: true,
      disappearedApplyAllowed: true,
      productsExtracted: products.length,
      rateLimitRetryCount,
    },
    pages: pages.map((page) => ({
      page: page.page,
      url: page.url,
      productCount: page.products.length,
      ageModalPresent: page.ageModalPresent,
      maxPage: page.maxPage,
    })),
  };
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.products) ? payload.products : [];
}

function productId(product) {
  return normalizeText(product?.sourceProductId || product?.id).replace(/^gqtobaccos-/i, "");
}

function detailComplete(product) {
  return Boolean(
    product?.detailComplete === true &&
      normalizeText(product?.sourceUrl) &&
      normalizeText(product?.title || product?.rawTitle) &&
      normalizeText(product?.mainImageUrl || product?.imageUrl)
  );
}

export function buildGqDetailQueue({ currentProducts, existingProducts, diff }) {
  const existingById = new Map(arrayFromPayload(existingProducts).map((product) => [productId(product), product]));
  const newOrReappeared = new Set([...(diff?.newIds || []), ...(diff?.reappearedIds || [])]);
  const items = [];
  let excluded = 0;
  let alreadyComplete = 0;
  for (const product of currentProducts || []) {
    if (product.publicEligibility?.publicIndexEligible !== true) {
      excluded += 1;
      continue;
    }
    const previous = existingById.get(product.sourceProductId);
    if (!newOrReappeared.has(product.sourceProductId) && detailComplete(previous)) {
      alreadyComplete += 1;
      continue;
    }
    items.push({
      sourceProductId: product.sourceProductId,
      sourceUrl: product.sourceUrl,
      title: product.title,
      brand: product.brand,
      priceGBP: product.priceGBP,
      status: "pending",
    });
  }
  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    items,
    summary: {
      queued: items.length,
      excludedBeforeDetail: excluded,
      alreadyComplete,
    },
  };
}

async function collectGqDetails(queue, { fetchImpl = fetch, concurrency = 2 } = {}) {
  const session = createHttpSession({ fetchImpl });
  const details = new Map();
  const errors = [];
  const pending = [...queue.items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 2)) }, async () => {
    while (pending.length) {
      const item = pending.shift();
      try {
        const response = await session.get(item.sourceUrl);
        const detail = parseGqDetailPage(response.html, item);
        if (!detail.title || !detail.mainImageUrl || detail.currency !== SOURCE_CURRENCY) {
          throw new Error("detail is missing a required title, image, or GBP currency marker");
        }
        details.set(item.sourceProductId, detail);
      } catch (error) {
        errors.push({ sourceProductId: item.sourceProductId, sourceUrl: item.sourceUrl, error: error?.message || String(error) });
      }
    }
  });
  await Promise.all(workers);
  return { details, errors };
}

function listPatch(product) {
  return {
    id: `${SOURCE}-${product.sourceProductId}`,
    source: SOURCE,
    sourceProductId: product.sourceProductId,
    sourceUrl: product.sourceUrl,
    canonicalUrl: product.sourceUrl,
    title: product.title,
    rawTitle: product.rawTitle,
    brand: product.brand,
    price: {
      current: {
        amount: product.priceGBP,
        currency: SOURCE_CURRENCY,
        rawText: product.priceRaw,
      },
      msrp: {
        amount: product.msrpAmount,
        currency: SOURCE_CURRENCY,
        rawText: product.msrpRaw || null,
      },
      internationalShippingAmount: FIXED_INTERNATIONAL_SHIPPING_GBP,
      internationalShippingCurrency: SOURCE_CURRENCY,
    },
    sourcePriceGBP: product.priceGBP,
    sourcePriceAmount: product.priceGBP,
    sourcePriceCurrency: SOURCE_CURRENCY,
    originalCurrency: SOURCE_CURRENCY,
    inventoryStatus: "available",
    inventoryConfidence: "complete-current-list",
    listImageUrl: product.imageUrl,
    mainImageUrl: product.imageUrl,
    imageUrl: product.imageUrl,
    publicEligibility: product.publicEligibility,
    listingEligible: product.publicEligibility?.publicIndexEligible === true,
    publicIndexEligible: product.publicEligibility?.publicIndexEligible === true,
    publiclySellable: product.publicEligibility?.publicIndexEligible === true,
    entityType: product.publicEligibility?.entityType || "offer",
    sourceSpecific: {
      gqtobaccos: {
        shippingGBP: FIXED_INTERNATIONAL_SHIPPING_GBP,
        listPage: product.listPage,
        listPosition: product.listPosition,
      },
    },
  };
}

function mergeDetail(product, detail) {
  if (!detail) return product;
  const specs = detail.specs || {};
  return {
    ...product,
    title: detail.title || product.title,
    rawTitle: detail.title || product.rawTitle,
    brand: detail.brand || product.brand,
    canonicalUrl: detail.canonicalUrl || product.canonicalUrl,
    description: detail.description,
    rawDescription: detail.rawDescription,
    detailImages: detail.images,
    mainImageUrl: detail.mainImageUrl || product.mainImageUrl,
    imageUrl: detail.mainImageUrl || product.imageUrl,
    hasOptions: detail.hasOptions === true,
    detailOutOfStock: detail.detailOutOfStock === true,
    detailComplete: Boolean(detail.title && detail.mainImageUrl && detail.currency === SOURCE_CURRENCY),
    detailCollectedAt: detail.detailCollectedAt,
    shape: specs.shape || null,
    finish: specs.finish || null,
    material: specs.material || null,
    mouthpiece: specs.mouthpiece || null,
    filter: specs.filter || null,
    measurements: {
      lengthMm: specs.lengthMm ?? null,
      heightMm: specs.heightMm ?? null,
      weightGrams: specs.weightGrams ?? null,
      chamberDepthMm: specs.chamberDepthMm ?? null,
      chamberDiameterMm: specs.chamberDiameterMm ?? null,
      outsideDiameterMm: specs.outsideDiameterMm ?? null,
    },
  };
}

export function mergeGqCurrentList({ currentProducts, existingProducts, detailsById, diff }) {
  const existingById = new Map(arrayFromPayload(existingProducts).map((product) => [productId(product), product]));
  const merged = [];
  for (const current of currentProducts || []) {
    const previous = existingById.get(current.sourceProductId) || {};
    const listApplied = { ...previous, ...listPatch(current) };
    const enriched = mergeDetail(listApplied, detailsById?.get(current.sourceProductId));
    // Current complete List values are authoritative even after detail enrichment.
    merged.push({ ...enriched, ...listPatch(current) });
  }
  for (const disappearedId of diff?.disappearedIds || []) {
    const previous = existingById.get(disappearedId);
    if (!previous) continue;
    merged.push({
      ...previous,
      inventoryStatus: "sold",
      inventoryConfidence: "complete-current-list-disappearance",
      publiclySellable: false,
      lastSeenInCurrentListAt: null,
    });
  }
  return merged.sort((left, right) => String(left.sourceProductId).localeCompare(String(right.sourceProductId), "en", { numeric: true }));
}

function exchangeRateFromConfig(root, currency) {
  const content = fs.readFileSync(path.join(root, "data", "exchange-rates.ts"), "utf8");
  const match = content.match(new RegExp(`\\b${currency}\\s*:\\s*([0-9.]+)`));
  const rate = Number.parseFloat(match?.[1] || "");
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function validateGqCandidate({ currentPayload, diff, products, detailErrors = [], gbpToCny }) {
  const errors = [];
  const currentProducts = arrayFromPayload(currentPayload);
  const ids = new Set();
  const urls = new Set();
  let falconPublic = 0;
  let componentPublic = 0;
  let invalidGbpPrice = 0;
  for (const product of currentProducts) {
    if (ids.has(product.sourceProductId)) errors.push(`duplicate sourceProductId: ${product.sourceProductId}`);
    ids.add(product.sourceProductId);
    if (urls.has(product.sourceUrl)) errors.push(`duplicate sourceUrl: ${product.sourceUrl}`);
    urls.add(product.sourceUrl);
    if (product.currency !== SOURCE_CURRENCY || !(Number(product.priceGBP) > 0)) invalidGbpPrice += 1;
  }
  if (invalidGbpPrice) errors.push(`invalid GBP price records: ${invalidGbpPrice}`);
  if (!(Number(gbpToCny) > 0)) errors.push("GBP customs FX is missing; a CNY reference price must not be generated.");

  const publicCurrent = currentProducts.filter((product) => product.publicEligibility?.publicIndexEligible === true);
  const missingDetail = publicCurrent.filter((product) => {
    const merged = products.find((candidate) => candidate.sourceProductId === product.sourceProductId);
    return !detailComplete(merged);
  });
  for (const product of products || []) {
    if (product.publicIndexEligible === true && /^falcon(?:\s|[-–—]|$)/i.test(normalizeText(product.brand))) falconPublic += 1;
    if (product.publicIndexEligible === true && product.entityType === "component") componentPublic += 1;
    const price = product.price?.current;
    if (price && (price.currency !== SOURCE_CURRENCY || !(Number(price.amount) > 0))) {
      errors.push(`currency mismatch or invalid price: ${product.sourceProductId}`);
    }
  }
  if (falconPublic) errors.push(`Falcon public products: ${falconPublic}`);
  if (componentPublic) errors.push(`component public products: ${componentPublic}`);
  if (missingDetail.length) errors.push(`public products missing required detail: ${missingDetail.length}`);
  if (detailErrors.length) errors.push(`detail fetch failures: ${detailErrors.length}`);
  if (currentPayload?.summary?.fullExpectedRangeScanned !== true) errors.push("unexpected list truncation");
  if (diff?.allowApply !== true) errors.push("shared inventory anomaly gate did not allow apply");

  return {
    passed: errors.length === 0,
    errors,
    counts: {
      current: currentProducts.length,
      publicEligible: publicCurrent.length,
      missingDetail: missingDetail.length,
      detailFailures: detailErrors.length,
      duplicate: errors.filter((item) => item.startsWith("duplicate ")).length,
      falconPublic,
      componentPublic,
      invalidGbpPrice,
    },
  };
}

function pricingAudit(products, gbpToCny) {
  return (products || []).map((product) => ({
    sourceProductId: product.sourceProductId,
    sourcePriceGBP: product.price?.current?.amount ?? null,
    reference: calculateReferencePrice({
      sourcePriceAmount: product.price?.current?.amount ?? null,
      sourceToCny: gbpToCny,
      internationalShippingAmount: product.price?.internationalShippingAmount ?? null,
    }),
  }));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runNode(root, script) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Production pipeline step failed: ${script}\n${result.stderr || result.stdout}`);
  }
}

export async function runGqDaily({
  root = process.cwd(),
  currentPayload = null,
  existingProducts = null,
  detailsById = null,
  fetchImpl = fetch,
  live = false,
  writeArtifacts = true,
  useLock = true,
  applyProduction = false,
  notify = false,
  notificationDryRun = false,
  notificationEnv = process.env,
  notificationFetchImpl = globalThis.fetch,
} = {}) {
  const runId = formatRunId();
  const inventoryPaths = getRunnerPaths(root);
  const artifactsRoot = path.join(root, "data", "audits", SOURCE, runId);
  const existingPath = path.join(root, "data", "products", `${SOURCE}-products.json`);
  let lock = null;
  try {
    if (useLock) lock = acquireRunLock(inventoryPaths.lock, { runId, source: SOURCE, mode: live ? "live" : "fixture" });
    const current = currentPayload || (live
      ? await collectGqCurrentList({ fetchImpl })
      : (() => { throw new Error("Offline mode requires currentPayload or a fixture passed by the caller."); })());
    const existing = existingProducts ?? readJsonIfExists(existingPath, []);
    const diff = buildInventoryDiff(current, existing, {
      source: SOURCE,
      allowedCurrencies: [SOURCE_CURRENCY],
      allowLegacyDuplicateSnapshotOverride: false,
      allowEmptyHistoricalBaseline: true,
      inputs: {
        currentList: `data/audits/${SOURCE}/${runId}/current-list.json`,
        existingProducts: `data/products/${SOURCE}-products.json`,
      },
    });
    const queue = buildGqDetailQueue({ currentProducts: current.products, existingProducts: existing, diff });
    const detailResult = detailsById
      ? { details: detailsById, errors: [] }
      : live
        ? await collectGqDetails(queue, { fetchImpl })
        : { details: new Map(), errors: queue.items.map((item) => ({ sourceProductId: item.sourceProductId, error: "offline detail fixture missing" })) };
    const products = mergeGqCurrentList({
      currentProducts: current.products,
      existingProducts: existing,
      detailsById: detailResult.details,
      diff,
    });
    const gbpToCny = exchangeRateFromConfig(root, SOURCE_CURRENCY);
    const validation = validateGqCandidate({ currentPayload: current, diff, products, detailErrors: detailResult.errors, gbpToCny });
    const allowPublish = diff.allowApply === true && validation.passed;
    const result = {
      version: "gqtobaccos-daily-v1",
      runId,
      source: SOURCE,
      mode: live ? "live" : "fixture",
      listComplete: current.summary?.fullExpectedRangeScanned === true,
      list: current.summary,
      detailQueueComplete: detailResult.errors.length === 0,
      diff,
      queue: { ...queue.summary, failures: detailResult.errors.length },
      validation,
      pricing: {
        currency: SOURCE_CURRENCY,
        customsRate: gbpToCny,
        internationalShippingGBP: FIXED_INTERNATIONAL_SHIPPING_GBP,
        samples: pricingAudit(products, gbpToCny),
      },
      allowPublish,
      productionWritten: false,
      artifactRoot: path.relative(root, artifactsRoot).replace(/\\/g, "/"),
    };
    if (writeArtifacts) {
      await writeJsonAtomic(path.join(artifactsRoot, "current-list.json"), current);
      await writeJsonAtomic(path.join(artifactsRoot, "diff.json"), diff);
      await writeJsonAtomic(path.join(artifactsRoot, "detail-queue.json"), queue);
      await writeJsonAtomic(path.join(artifactsRoot, "candidate-products.json"), products);
      await writeJsonAtomic(path.join(artifactsRoot, "report.json"), result);
    }
    if (applyProduction) {
      if (!allowPublish) throw new Error("GQ production write is blocked by the shared anomaly gate or required-detail validation.");
      await writeJsonAtomic(existingPath, products);
      runNode(root, "scripts/build-unified-products-staging-v1.mjs");
      runNode(root, "scripts/build-public-product-indexes-v1.mjs");
      result.productionWritten = true;
      if (writeArtifacts) await writeJsonAtomic(path.join(artifactsRoot, "report.json"), result);
    }
    if (notify) {
      result.notification = await sendGqDailyPushDeerNotification({
        dailyResult: result,
        dryRun: notificationDryRun,
        env: notificationEnv,
        fetchImpl: notificationFetchImpl,
      });
      if (writeArtifacts) await writeJsonAtomic(path.join(artifactsRoot, "report.json"), result);
    }
    return result;
  } catch (error) {
    let notification = null;
    if (notify) {
      notification = await sendGqDailyPushDeerNotification({
        error,
        dryRun: notificationDryRun,
        env: notificationEnv,
        fetchImpl: notificationFetchImpl,
      }).catch((notificationError) => ({
        notificationSent: false,
        notificationSkipped: false,
        notificationReason: notificationError?.message || String(notificationError),
        channel: "PushDeer",
      }));
    }
    if (writeArtifacts) {
      await writeJsonAtomic(path.join(artifactsRoot, "failure.json"), {
        version: "gqtobaccos-daily-v1-failure",
        runId,
        source: SOURCE,
        failedAt: new Date().toISOString(),
        error: error?.message || String(error),
        listProgress: error?.listProgress || null,
        allowPublish: false,
        productionWritten: false,
        notification,
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (lock) releaseRunLock(lock);
  }
}

function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.length ? rest.join("=") : true;
  }
  return options;
}

function isDirectExecution(importMetaUrl) {
  if (!process.argv[1]) return false;
  const script = path.resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase();
  const modulePath = decodeURIComponent(new URL(importMetaUrl).pathname)
    .replace(/^\/([A-Za-z]:)/, "$1")
    .replace(/\\/g, "/")
    .toLowerCase();
  return script === modulePath;
}

if (isDirectExecution(import.meta.url)) {
  const cli = parseCliOptions();
  const testNotification = cli["test-notification"] === true;
  if (testNotification && (cli.live === true || cli["apply-production"] === true || cli.fixture)) {
    throw new Error("--test-notification cannot be combined with collection, fixture, or Production flags.");
  }
  if (testNotification) {
    sendGqDailyPushDeerNotification({ testNotification: true })
      .then((notification) => {
        console.log(JSON.stringify({ version: "gqtobaccos-pushdeer-test-v1", notification }, null, 2));
        if (!notification.notificationSent) process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error?.stack || error?.message || String(error));
        process.exitCode = 1;
      });
  } else {
  const fixturePath = cli.fixture ? path.resolve(String(cli.fixture)) : null;
  const currentPayload = fixturePath ? readJsonIfExists(fixturePath, null) : null;
  runGqDaily({
    currentPayload,
    live: cli.live === true,
    applyProduction: cli["apply-production"] === true,
    notify: cli.notify === true,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    });
  }
}
