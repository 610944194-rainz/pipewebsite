import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parsePipeCondition } from "./collect-danish-details-v16.mjs";

const defaultStartUrl = "https://www.danishpipeshop.com/l/-zh/Pipes1";
const defaultListOutputPath = path.join(process.cwd(), "data", "danish-list-full.json");
const defaultOutputPath = path.join(process.cwd(), "data", "danish-details-full.json");
const defaultErrorsOutputPath = path.join(process.cwd(), "data", "danish-details-errors.json");
const screenshotDir = path.join(process.cwd(), "data", "debug", "danish-full-v17-screenshots");

const startUrl = normalizeText(process.env.DANISH_START_URL) || defaultStartUrl;
const targetCount = readIntegerEnv("DANISH_TARGET_COUNT", 5000, { min: 1 });
const maxListPages = readIntegerEnv("DANISH_MAX_LIST_PAGES", 20, { min: 1 });
const fixedDetailDelayMs = readIntegerEnv("DANISH_DETAIL_DELAY_MS", 0, { min: 0 });
const minDetailDelayMs = fixedDetailDelayMs || readIntegerEnv("DANISH_DETAIL_MIN_DELAY_MS", 2000, { min: 0 });
const maxDetailDelayMs = fixedDetailDelayMs || readIntegerEnv("DANISH_DETAIL_MAX_DELAY_MS", 5000, { min: minDetailDelayMs });
const maxLoadMoreClicks = readIntegerEnv("DANISH_MAX_LOAD_MORE_CLICKS", 100, { min: 0 });
const loadMoreDelayMs = readIntegerEnv("DANISH_LOAD_MORE_DELAY_MS", 4000, { min: 0 });
const showMoreRetries = readIntegerEnv("DANISH_SHOW_MORE_RETRIES", 2, { min: 0 });
const pageReadyTimeoutMs = readIntegerEnv("DANISH_PAGE_READY_TIMEOUT_MS", 90000, { min: 5000 });
const languageFallbackSeconds = readIntegerEnv("DANISH_LANGUAGE_FALLBACK_SECONDS", 20, { min: 1 });
const manualVerificationTimeoutSeconds = readIntegerEnv("DANISH_MANUAL_VERIFICATION_TIMEOUT_SECONDS", 900, { min: 30 });
const manualVerificationPollMs = readIntegerEnv("DANISH_MANUAL_VERIFICATION_POLL_MS", 3000, { min: 500 });
const minimumExpectedCount = readIntegerEnv("DANISH_MIN_EXPECTED_COUNT", 1000, { min: 1 });
const outputPath = resolveOutputPath(process.env.DANISH_OUTPUT, defaultOutputPath);
const listOutputPath = resolveOutputPath(process.env.DANISH_LIST_OUTPUT, defaultListOutputPath);
const errorsOutputPath = resolveOutputPath(process.env.DANISH_ERRORS_OUTPUT, defaultErrorsOutputPath);
const detailQueuePath = resolveOutputPath(process.env.DANISH_DETAIL_QUEUE_PATH, "");
const collectorMode = normalizeText(process.env.DANISH_MODE || "full").toLowerCase();
const detailMode = normalizeText(process.env.DANISH_DETAIL_MODE || "full").toLowerCase();
const scraperProxy = normalizeText(process.env.SCRAPER_PROXY);
const saveScreenshots = readBooleanEnv("DANISH_SAVE_SCREENSHOTS", false);
const checkpointEvery = readIntegerEnv("DANISH_CHECKPOINT_EVERY", 10, { min: 0 });
const partialOutputPath = getPartialOutputPath(outputPath);
const browserProfilePath = resolveOutputPath(
  process.env.DANISH_BROWSER_PROFILE,
  path.join(process.cwd(), "data", "runtime", "danish-browser-profile")
);

let lastListIntegrityReport = {};

const browserExecutableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function compactLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || "";
}

function getBrandFromCommaName(text) {
  const value = normalizeText(text);

  if (!value.includes(",")) {
    return "";
  }

  const [brand] = value.split(",");
  return normalizeText(brand);
}

function cleanDetailFieldValue(value) {
  return normalizeText(value)
    .replace(/^[：:\s]+/, "")
    .replace(/[，,;；。.\s]+$/, "");
}

function extractDetailField(textSources, labelPattern) {
  const nextLabelPattern = [
    "品牌",
    "Brand",
    "产品编号",
    "Product\\s*(?:No\\.?|Number|Code)",
    "Item\\s*(?:No\\.?|Number)",
    "SKU",
    "价格",
    "状态",
    "滤芯",
    "滤嘴",
    "斗嘴材质",
    "材质",
    "斗型",
    "长度",
    "高度",
    "重量",
    "Filter",
    "Material",
    "Shape",
    "Length",
    "Height",
    "Weight",
  ].join("|");
  const fieldRegex = new RegExp(
    `(?:^|\\s)(?:${labelPattern})\\s*[:：]\\s*(.*?)(?=\\s+(?:${nextLabelPattern})\\s*[:：]|$)`,
    "i"
  );
  const candidates = textSources
    .flatMap((text) => splitCleanTextLines(text))
    .filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(fieldRegex);
    const value = cleanDetailFieldValue(match?.[1] || "");

    if (value) {
      return value;
    }
  }

  return "";
}

function extractBrandFromDetailText(textSources) {
  return extractDetailField(textSources, "品牌|Brand");
}

function extractProductCodeFromDetailText(textSources) {
  return extractDetailField(
    textSources,
    "产品编号|Product\\s*(?:No\\.?|Number|Code)|Item\\s*(?:No\\.?|Number)|SKU"
  );
}

function hasSoldEvidence(...values) {
  return values.some((value) => /已售|sold\s*out|\bsold\b|out\s*of\s*stock/i.test(String(value || "")));
}

function hasAvailableEvidence(...values) {
  return values.some((value) => /现在购买|add\s+to\s+(?:basket|cart)|buy\s+now|可购买|in\s+stock/i.test(String(value || "")));
}

function normalizeAvailabilityStatus({ detailStatus, listStatus, textSources = [] }) {
  const status = firstNonEmpty(detailStatus, listStatus);

  if (hasSoldEvidence(status, ...textSources)) {
    return "已售";
  }

  if (hasAvailableEvidence(status, ...textSources)) {
    return "可购买";
  }

  if (status) {
    return status;
  }

  return "可购买";
}

function buildImageQualityWarnings(imageValidation) {
  const status = imageValidation?.imageMatchStatus || "missing";

  if (status === "unverified") {
    return ["imageUnverified"];
  }

  if (status === "mismatch") {
    return ["imageMismatch"];
  }

  if (status === "missing") {
    return ["imageMissing"];
  }

  if (status === "pageScoped") {
    return ["imagePageScoped"];
  }

  return [];
}


function normalizeProductOutput({ product, normalizedDetail, stableFieldReport, extra = {} }) {
  const galleryImages = Array.isArray(normalizedDetail.galleryImages)
    ? normalizedDetail.galleryImages
    : [];
  const rawGalleryImages = Array.isArray(normalizedDetail.rawGalleryImages)
    ? normalizedDetail.rawGalleryImages
    : [];
  const outputMissingFields = normalizeOutputMissingFields(
    stableFieldReport.missingFields,
    normalizedDetail
  );

  return {
    ...product,
    name: firstNonEmpty(normalizedDetail.title, product.name),
    brand: normalizedDetail.brand,
    productCode: normalizeText(normalizedDetail.productCode),
    price: normalizedDetail.price,
    status: normalizedDetail.status,
    href: firstNonEmpty(product.href, normalizedDetail.sourceUrl),
    imageUrl: firstNonEmpty(normalizedDetail.listImageUrl, normalizedDetail.mainImage, galleryImages[0]),
    detailImageUrl: firstNonEmpty(normalizedDetail.mainImage, galleryImages[0]),
    galleryImages,
    galleryCount: galleryImages.length,
    specsText: normalizedDetail.specsText || [],
    conditionType: normalizedDetail.conditionType,
    smokedStatus: normalizedDetail.smokedStatus,
    conditionLabel: normalizedDetail.conditionLabel,
    conditionSource: normalizedDetail.conditionSource,
    conditionNotes: normalizedDetail.conditionNotes,
    imageMatchStatus: normalizedDetail.imageMatchStatus || "missing",
    imageMatchNotes: normalizedDetail.imageMatchNotes || "",
    qualityWarnings: normalizedDetail.qualityWarnings || [],
    ...(rawGalleryImages.length > 0 ? { rawGalleryImages } : {}),
    missingFields: outputMissingFields,
    optionalMissingFields: stableFieldReport.optionalMissingFields,
    v17: normalizedDetail,
    stableFieldReport,
    ...extra,
  };
}

function normalizeOutputMissingFields(missingFields, detail) {
  const galleryImages = Array.isArray(detail.galleryImages) ? detail.galleryImages : [];
  const normalizedFields = new Set(
    (missingFields || []).filter((field) => field !== "mainImage")
  );

  if (!firstNonEmpty(detail.listImageUrl, detail.mainImage, galleryImages[0])) {
    normalizedFields.add("imageUrl");
  }

  if (!firstNonEmpty(detail.mainImage, galleryImages[0])) {
    normalizedFields.add("detailImageUrl");
  }

  if (galleryImages.length === 0) {
    normalizedFields.add("galleryImages");
  }

  return Array.from(normalizedFields);
}

function readIntegerEnv(name, fallback, options = {}) {
  const rawValue = normalizeText(process.env[name]);

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue)) {
    console.warn(`${name} is invalid, using default ${fallback}.`);
    return fallback;
  }

  const min = Number.isFinite(options.min) ? options.min : 0;

  if (parsedValue < min) {
    console.warn(`${name} is below ${min}, using ${min}.`);
    return min;
  }

  return parsedValue;
}

function readBooleanEnv(name, fallback = false) {
  const rawValue = normalizeText(process.env[name]).toLowerCase();

  if (!rawValue) {
    return Boolean(fallback);
  }

  return ["1", "true", "yes", "y", "on"].includes(rawValue);
}

function getPartialOutputPath(filePath) {
  const ext = path.extname(filePath) || ".json";
  const baseName = path.basename(filePath, ext);

  return path.join(path.dirname(filePath), baseName + ".partial" + ext);
}

function getQueuedProducts(queuePayload) {
  const entries = Array.isArray(queuePayload)
    ? queuePayload
    : Array.isArray(queuePayload?.items)
      ? queuePayload.items
      : Array.isArray(queuePayload?.products)
        ? queuePayload.products
        : [];

  return entries
    .filter((entry) => !entry?.status || entry.status === "pending" || entry.status === "retry")
    .map((entry) => ({
      ...entry,
      href: firstNonEmpty(entry?.href, entry?.sourceUrl, entry?.detailUrl),
      name: firstNonEmpty(entry?.name, entry?.title),
    }))
    .filter((entry) => entry.href);
}

function resolveOutputPath(value, fallback) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return fallback;
  }

  return path.isAbsolute(normalizedValue)
    ? normalizedValue
    : path.join(process.cwd(), normalizedValue);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelayMs(minMs, maxMs) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);

  if (max === min) {
    return min;
  }

  return Math.floor(min + Math.random() * (max - min + 1));
}

function getLocalBrowserExecutablePath() {
  return browserExecutableCandidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function isBadImageUrl(url) {
  const lowered = String(url || "").toLowerCase();

  return (
    !url ||
    lowered.includes("logo") ||
    lowered.includes("globe") ||
    lowered.includes("icon") ||
    lowered.includes("sprite") ||
    lowered.includes("facebook") ||
    lowered.includes("instagram") ||
    lowered.includes("favorite") ||
    lowered.includes("compare") ||
    lowered.includes("badge") ||
    lowered.includes("blank") ||
    lowered.includes("transparent") ||
    lowered.includes("ninks") ||
    lowered.includes("new-price") ||
    lowered.includes("corner")
  );
}

function isDanishImageUrl(url) {
  const lowered = String(url || "").toLowerCase();

  return (
    lowered.includes("danishpipeshop.com/img/") &&
    lowered.includes("img-") &&
    (
      lowered.includes(".jpg") ||
      lowered.includes(".jpeg") ||
      lowered.includes(".png") ||
      lowered.includes(".webp")
    )
  );
}

function getImageId(url) {
  const match = String(url || "").match(/img-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function getWidthFromUrl(url) {
  const match = String(url || "").match(/-w(\d+)-/i);
  return match ? Number(match[1]) : 0;
}

function getHeightFromUrl(url) {
  const match = String(url || "").match(/-h(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function getRatioFromUrl(url) {
  const width = getWidthFromUrl(url);
  const height = getHeightFromUrl(url);

  if (!width || !height) {
    return 1;
  }

  return width / height;
}

function normalizeSlug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductIdFromUrl(url) {
  const match = String(url || "").match(/-i(\d+)\.html/i);
  return match ? match[1] : "";
}

function getProductSlugFromUrl(url) {
  const match = String(url || "").match(/\/d\/(?:-zh\/)?(.+?)-i\d+\.html/i);
  return match ? normalizeSlug(decodeURIComponent(match[1])) : "";
}

function getImageSlugFromUrl(url) {
  const match = String(url || "").match(/\/img\/(.+?)-img-\d+/i);
  const rawSlug = match ? match[1] : "";

  return rawSlug && rawSlug !== "-" ? normalizeSlug(decodeURIComponent(rawSlug)) : "";
}

function getSlugTokens(slug) {
  const stopWords = new Set(["the", "pipe", "pipes", "with", "and", "for", "smooth", "bent", "classic"]);

  return String(slug || "")
    .split("-")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !stopWords.has(token));
}

function slugMatchesProduct(imageSlug, productSlug) {
  if (!imageSlug || !productSlug) {
    return false;
  }

  if (imageSlug.includes(productSlug) || productSlug.includes(imageSlug)) {
    return true;
  }

  const tokens = getSlugTokens(productSlug);

  if (tokens.length === 0) {
    return false;
  }

  const matchedCount = tokens.filter((token) => imageSlug.includes(token)).length;
  return tokens.length <= 2 ? matchedCount >= 1 : matchedCount >= 2;
}

function validateProductPageUrl(actualUrl, expectedUrl) {
  const expectedId = getProductIdFromUrl(expectedUrl);
  const actualId = getProductIdFromUrl(actualUrl);

  return {
    expectedId,
    actualId,
    matches: Boolean(expectedId && actualId && expectedId === actualId),
  };
}

function getProductTokens(productName) {
  const stopWords = new Set([
    "the",
    "danish",
    "pipe",
    "pipes",
    "shop",
    "with",
    "and",
    "for",
    "classic",
    "smooth",
    "bent",
    "unica",
  ]);

  return String(productName || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
    .filter((word) => !stopWords.has(word));
}

function textMatchesProduct(text, productName) {
  const lowered = String(text || "").toLowerCase();
  const productSlug = normalizeSlug(productName);
  const tokens = getProductTokens(productName);

  if (productSlug && lowered.includes(productSlug)) {
    return true;
  }

  if (tokens.length === 0) {
    return false;
  }

  const matchedCount = tokens.filter((token) => lowered.includes(token)).length;

  if (tokens.length <= 2) {
    return matchedCount >= 1;
  }

  return matchedCount >= 2;
}

function imageInfoToUrl(info, targetWidth = 500) {
  const id = String(info.id || "").trim();
  const name = String(info.name || "").trim();
  const ext = String(info.ext || ".jpg").trim() || ".jpg";
  const originalW = Number(info.w);
  const originalH = Number(info.h);

  if (!id || !name || !originalW || !originalH) {
    return "";
  }

  const targetHeight = Math.floor((originalH / originalW) * targetWidth);
  return `https://www.danishpipeshop.com/img/${name}-img-${id}-w${targetWidth}-h${targetHeight}${ext}`;
}

function parseImageInfosFromEnlargeResponse(responseText) {
  const value = String(responseText || "");
  const infos = [];
  const regex = /data-nn5-imageinfo='([^']+)'/gi;
  let match;

  while ((match = regex.exec(value)) !== null) {
    const raw = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'");

    try {
      const info = JSON.parse(raw);

      if (info && info.id && info.name && info.w && info.h) {
        infos.push(info);
      }
    } catch {
      // ignore single malformed imageinfo
    }
  }

  return infos;
}

function scoreEnlargeResult(result, productName) {
  if (!result || !Array.isArray(result.imageInfos)) {
    return -9999;
  }

  let score = result.imageInfos.length * 10;

  if (result.imageInfos.length >= 2) {
    score += 30;
  }

  for (const info of result.imageInfos) {
    const text = [info.name, info.title, info.alt, info.id].join(" ");

    if (textMatchesProduct(text, productName)) {
      score += 80;
    }
  }

  if (result.candidateImageId) {
    const containsCandidate = result.imageInfos.some(
      (info) => Number(info.id) === Number(result.candidateImageId)
    );

    if (containsCandidate) {
      score += 20;
    }
  }

  return score;
}

function chooseBestEnlargeResult(results, productName) {
  const validResults = results.filter(
    (result) => result && result.imageInfos && result.imageInfos.length > 0
  );

  if (validResults.length === 0) {
    return null;
  }

  return validResults.sort((a, b) => {
    return scoreEnlargeResult(b, productName) - scoreEnlargeResult(a, productName);
  })[0];
}

function uniqueByImageId(urls) {
  const groups = new Map();
  const seenUrls = new Set();

  for (const url of urls) {
    if (!url || isBadImageUrl(url) || !isDanishImageUrl(url)) {
      continue;
    }

    const normalizedUrl = String(url).trim();

    if (seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);

    const id = getImageId(normalizedUrl);

    if (!id || groups.has(id)) {
      continue;
    }

    groups.set(id, normalizedUrl);
  }

  return Array.from(groups.values());
}

function strictSlugMatchesProduct(imageSlug, productSlug) {
  return Boolean(imageSlug && productSlug && imageSlug.includes(productSlug));
}

function looselyRelatedSlug(imageSlug, productSlug) {
  if (!imageSlug || !productSlug) {
    return false;
  }

  const tokens = getSlugTokens(productSlug);

  if (tokens.length === 0) {
    return false;
  }

  const matchedCount = tokens.filter((token) => imageSlug.includes(token)).length;
  const brandMatches = tokens[0] && imageSlug.includes(tokens[0]);

  return Boolean(brandMatches && matchedCount >= 2);
}

function validateProductImages({ productHref, detailImageUrl, galleryImages, listImageUrl }) {
  const productSlug = getProductSlugFromUrl(productHref);
  const allDetailImages = [detailImageUrl, ...galleryImages].filter(Boolean);
  const mismatchedImages = [];
  const matchedImages = [];
  const unknownImages = [];

  for (const imageUrl of allDetailImages) {
    const imageSlug = getImageSlugFromUrl(imageUrl);

    if (!imageSlug) {
      unknownImages.push(imageUrl);
      continue;
    }

    if (slugMatchesProduct(imageSlug, productSlug)) {
      matchedImages.push(imageUrl);
      continue;
    }

    mismatchedImages.push(imageUrl);
  }

  if (mismatchedImages.length > 0) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "mismatch",
      imageMatchNotes:
        `图片 slug 与当前商品不匹配，已清空图片字段。productSlug=${productSlug}; mismatched=${mismatchedImages.join(", ")}`,
    };
  }

  if (matchedImages.length > 0) {
    const safeGalleryImages = galleryImages.filter((imageUrl) => {
      const imageSlug = getImageSlugFromUrl(imageUrl);
      return imageSlug && slugMatchesProduct(imageSlug, productSlug);
    });
    const listImageSlug = getImageSlugFromUrl(listImageUrl);

    return {
      safeDetailImageUrl: matchedImages[0],
      safeGalleryImages,
      safeListImageUrl: listImageSlug && slugMatchesProduct(listImageSlug, productSlug) ? listImageUrl : "",
      imageMatchStatus: "matched",
      imageMatchNotes: "详情页图片 slug 与当前商品匹配。",
    };
  }

  if (allDetailImages.length > 0) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "unknown",
      imageMatchNotes:
        `图片 URL 缺少可校验商品 slug，未输出详情图片，避免跨商品串档。productSlug=${productSlug}`,
    };
  }

  const listImageSlug = getImageSlugFromUrl(listImageUrl);

  if (listImageSlug && !slugMatchesProduct(listImageSlug, productSlug)) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "mismatch",
      imageMatchNotes:
        `列表缩略图 slug 与当前商品不匹配，已清空图片字段。productSlug=${productSlug}; listImage=${listImageUrl}`,
    };
  }

  return {
    safeDetailImageUrl: "",
    safeGalleryImages: [],
    safeListImageUrl: listImageSlug ? listImageUrl : "",
    imageMatchStatus: listImageSlug ? "fallback" : "unknown",
    imageMatchNotes: listImageSlug
      ? "仅保留与当前商品匹配的列表缩略图。"
      : "当前商品未提取到可校验图片。",
  };
}

function validateProductImagesV2({
  productHref,
  detailImageUrl,
  galleryImages,
  listImageUrl,
  galleryScoped = false,
}) {
  const productSlug = getProductSlugFromUrl(productHref);
  const rawGalleryImages = uniqueByImageId(
    [detailImageUrl, ...(Array.isArray(galleryImages) ? galleryImages : [])].filter(Boolean)
  );
  const cleanListImageUrl =
    listImageUrl && isDanishImageUrl(listImageUrl) && !isBadImageUrl(listImageUrl)
      ? String(listImageUrl).trim()
      : "";
  const rawImageCandidates = uniqueByImageId(
    [...rawGalleryImages, cleanListImageUrl].filter(Boolean)
  );

  if (galleryScoped && rawGalleryImages.length > 0) {
    return {
      safeDetailImageUrl: rawGalleryImages[0] || "",
      safeGalleryImages: rawGalleryImages,
      safeListImageUrl: "",
      imageMatchStatus: "galleryScoped",
      imageMatchNotes:
        "\u56fe\u7247\u6765\u81ea Danish \u5546\u54c1\u8be6\u60c5\u4e3b\u56fe/\u7f29\u7565\u56fe\u533a\u57df\uff0c\u5e76\u901a\u8fc7 enlargemedia \u89e3\u6790\u3002",
      rawGalleryImages: rawImageCandidates,
    };
  }

  const imageRecords = rawGalleryImages.map((imageUrl) => {
    const imageSlug = getImageSlugFromUrl(imageUrl);

    return {
      imageUrl,
      imageSlug,
      strict: strictSlugMatchesProduct(imageSlug, productSlug),
      loose: looselyRelatedSlug(imageSlug, productSlug),
      hasSlug: Boolean(imageSlug),
    };
  });

  const listImageSlug = getImageSlugFromUrl(cleanListImageUrl);
  const listStrict = strictSlugMatchesProduct(listImageSlug, productSlug);
  const listLoose = looselyRelatedSlug(listImageSlug, productSlug);

  const strictImages = imageRecords
    .filter((record) => record.strict)
    .map((record) => record.imageUrl);

  const looseImages = imageRecords
    .filter((record) => !record.strict && record.loose)
    .map((record) => record.imageUrl);

  const sluglessImages = imageRecords
    .filter((record) => !record.imageSlug)
    .map((record) => record.imageUrl);

  const mismatchImages = imageRecords
    .filter((record) => record.imageSlug && !record.strict && !record.loose)
    .map((record) => record.imageUrl);

  if (strictImages.length > 0 || listStrict) {
    return {
      safeDetailImageUrl: strictImages[0] || (listStrict ? cleanListImageUrl : ""),
      safeGalleryImages: strictImages,
      safeListImageUrl: listStrict ? cleanListImageUrl : "",
      imageMatchStatus: "matched",
      imageMatchNotes: `图片 URL 严格包含当前商品 slug。productSlug=${productSlug}`,
      rawGalleryImages: rawImageCandidates,
    };
  }

  if (sluglessImages.length > 0) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "pageScoped",
      imageMatchNotes:
        `图片 URL 无商品 slug，但来自商品详情主图区域，且已排除相似产品/最近浏览区域。productSlug=${productSlug}`,
      rawGalleryImages: rawImageCandidates,
    };
  }

  if (looseImages.length > 0 || listLoose) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "unverified",
      imageMatchNotes:
        `图片 URL 未严格匹配当前商品 slug，疑似同品牌/同系列图，未进入正式图片字段，需人工确认。productSlug=${productSlug}`,
      rawGalleryImages: rawImageCandidates,
    };
  }

  if (mismatchImages.length > 0 || (listImageSlug && !listStrict && !listLoose)) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "mismatch",
      imageMatchNotes:
        `图片 URL 与当前商品 slug 明显不匹配，已清空正式图片字段。productSlug=${productSlug}; mismatched=${[...mismatchImages, cleanListImageUrl].filter(Boolean).join(", ")}`,
      rawGalleryImages: rawImageCandidates,
    };
  }

  if (cleanListImageUrl && !listImageSlug) {
    return {
      safeDetailImageUrl: "",
      safeGalleryImages: [],
      safeListImageUrl: "",
      imageMatchStatus: "pageScoped",
      imageMatchNotes:
        `列表图片 URL 无商品 slug，但没有发现冲突证据，作为保守兜底图使用。productSlug=${productSlug}`,
      rawGalleryImages: rawImageCandidates,
    };
  }

  return {
    safeDetailImageUrl: "",
    safeGalleryImages: [],
    safeListImageUrl: "",
    imageMatchStatus: "missing",
    imageMatchNotes: rawImageCandidates.length > 0
      ? `图片 URL 缺少可校验的商品 slug，且未通过主图区域可信规则。productSlug=${productSlug}`
      : `当前商品未提取到可用图片。productSlug=${productSlug}`,
    rawGalleryImages: rawImageCandidates,
  };
}


const pageJunkPatterns = [
  /cookie information/i,
  /google analytics/i,
  /youtube/i,
  /privacy policy/i,
  /asp\.?net_sessionid/i,
  /dpscurrentlanguage/i,
  /nn5shopportalcookie/i,
  /internet explorer/i,
  /microsoft edge/i,
  /mozilla firefox/i,
  /google chrome/i,
  /\bopera\b/i,
  /\bsafari\b/i,
  /登录/,
  /联系我们/,
  /语言/,
  /\bZH\s+USD\b/i,
];

const productSpecPatterns = [
  /\bshape\b/i,
  /\bmodel\b/i,
  /\bmaterial\b/i,
  /\bfilter\b/i,
  /\bstem\b/i,
  /\bmouthpiece\b/i,
  /\bfinish\b/i,
  /\blength\b/i,
  /\bheight\b/i,
  /\bweight\b/i,
  /\bchamber\b/i,
  /\bbowl\b/i,
  /\bdiameter\b/i,
  /\bdepth\b/i,
  /\bwidth\b/i,
  /\bcountry\b/i,
  /\borigin\b/i,
  /\bmade in\b/i,
  /\bgrade\b/i,
  /\bcondition\b/i,
  /\bestate\b/i,
  /\bunsmoked\b/i,
  /\bpre[-\s]?smoked\b/i,
  /\bsmoked\b/i,
  /\brestored\b/i,
  /\brefurbished\b/i,
  /产地/,
  /长度/,
  /高度/,
  /重量/,
  /滤嘴/,
  /材质/,
  /斗型/,
  /钵径/,
  /烟钵/,
  /斗钵/,
  /深度/,
  /口径/,
  /成色/,
  /状态/,
  /品牌/,
  /编号/,
];

const productDetailPatterns = [
  ...productSpecPatterns,
  /\bpipe\b/i,
  /\bbriar\b/i,
  /\bsandblast(?:ed)?\b/i,
  /\bsmooth\b/i,
  /\brusticat(?:ed|ion)?\b/i,
  /\bacrylic\b/i,
  /\bebonite\b/i,
  /\bvulcanite\b/i,
  /\bbilliard\b/i,
  /\bbent\b/i,
  /\bstraight\b/i,
  /烟斗/,
  /石楠/,
  /斗柄/,
  /斗嘴/,
  /喷砂/,
  /光面/,
];

function hasPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isPageJunkText(text) {
  return hasPattern(String(text || ""), pageJunkPatterns);
}

function splitCleanTextLines(text) {
  return compactLines(text)
    .map((line) => line.replace(/\s*[:：]\s*/g, ": "))
    .map(normalizeText)
    .filter(Boolean);
}

function hasMeasurementHint(text) {
  return /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|g|gr|gram|grams|inch|inches|")\b/i.test(text);
}

function isLikelySpecLine(text) {
  const line = normalizeText(text);

  if (!line || line.length < 3 || line.length > 220 || isPageJunkText(line)) {
    return false;
  }

  return hasPattern(line, productSpecPatterns) || hasMeasurementHint(line);
}

function isLikelyProductDetailLine(text) {
  const line = normalizeText(text);

  if (!line || line.length < 12 || line.length > 650 || isPageJunkText(line)) {
    return false;
  }

  return hasPattern(line, productDetailPatterns) || hasMeasurementHint(line);
}

function dedupePreserveOrder(values) {
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

function cleanSpecsText(candidates) {
  const lines = candidates.flatMap(splitCleanTextLines).filter(isLikelySpecLine);
  return dedupePreserveOrder(lines).slice(0, 18);
}

function cleanProductDetailText(candidates, maxLength = 1800) {
  const lines = candidates.flatMap(splitCleanTextLines).filter(isLikelyProductDetailLine);
  return dedupePreserveOrder(lines).join(" ").slice(0, maxLength).trim();
}

function cleanDescriptionText(candidates) {
  return cleanProductDetailText(candidates, 900);
}

async function getPageImageCandidatesLegacy(tab) {
  return await tab.evaluate(() => {
    const excludedSectionPatterns = [
      /similar\s+products?/i,
      /recently\s+viewed/i,
      /related\s+products?/i,
      /相似产品/,
      /最近浏览过/,
      /相关商品/,
      /推荐商品/,
      /品牌更多产品/,
      /\bfooter\b/i,
    ];
    const preferredContainerPatterns = [
      /product/i,
      /gallery/i,
      /image/i,
      /media/i,
      /photo/i,
      /thumb/i,
      /enlarge/i,
    ];

    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    function getRect(element) {
      const rect = element.getBoundingClientRect();

      return {
        width: rect.width,
        height: rect.height,
        area: rect.width * rect.height,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      };
    }

    function getElementMeta(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      return normalize([
        element.tagName,
        typeof element.className === "string" ? element.className : "",
        element.id || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("role") || "",
        element.getAttribute("data-name") || "",
        element.getAttribute("data-title") || "",
      ].join(" "));
    }

    function hasExcludedText(text) {
      return excludedSectionPatterns.some((pattern) => pattern.test(text));
    }

    function hasPreferredText(text) {
      return preferredContainerPatterns.some((pattern) => pattern.test(text));
    }

    function getShortElementText(element, maxLength = 1600) {
      const text = normalize(element?.innerText || element?.textContent || "");
      return text.length <= maxLength ? text : "";
    }

    function isInsideExcludedSection(element) {
      if (element.closest?.("footer")) {
        return true;
      }

      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const meta = getElementMeta(current);

        if (hasExcludedText(meta)) {
          return true;
        }

        const text = getShortElementText(current);

        if (text && hasExcludedText(text)) {
          return true;
        }

        current = current.parentElement;
      }

      return false;
    }

    function getFirstExcludedHeadingTop() {
      const headingSelectors = [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "[class*='title']",
        "[class*='heading']",
        "[class*='headline']",
      ].join(",");
      const tops = Array.from(document.querySelectorAll(headingSelectors))
        .map((element) => {
          const text = getShortElementText(element, 140);

          if (!text || !hasExcludedText(text)) {
            return null;
          }

          const rect = getRect(element);
          return rect.top;
        })
        .filter((value) => Number.isFinite(value));

      return tops.length > 0 ? Math.min(...tops) : Number.POSITIVE_INFINITY;
    }

    function getProductImageScope(img, rect, excludedStartTop) {
      if (isInsideExcludedSection(img)) {
        return null;
      }

      if (Number.isFinite(excludedStartTop) && rect.top >= excludedStartTop - 8) {
        return null;
      }

      let current = img;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const meta = getElementMeta(current);

        if (hasPreferredText(meta)) {
          return { name: "product-media-container", priority: 100 };
        }

        current = current.parentElement;
      }

      const topMainLimit = Math.max(window.innerHeight * 1.5, 1100);

      if (rect.top <= topMainLimit && rect.area >= 1800) {
        return { name: "top-main-area", priority: 60 };
      }

      return null;
    }

    function getUrlsFromSrcset(srcset) {
      if (!srcset) return [];

      return srcset
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+/)[0])
        .filter(Boolean);
    }

    const candidates = [];
    const excludedStartTop = getFirstExcludedHeadingTop();
    const images = [];

    for (const img of images) {
      const rect = getRect(img);
      const scope = getProductImageScope(img, rect, excludedStartTop);

      if (!scope) {
        continue;
      }

      const urls = [];
      const attrs = ["src", "data-src", "data-original", "data-lazy", "data-full", "data-large"];

      for (const attr of attrs) {
        const value = img.getAttribute(attr);

        if (value) {
          urls.push(value);
        }
      }

      urls.push(...getUrlsFromSrcset(img.getAttribute("srcset")));
      urls.push(...getUrlsFromSrcset(img.getAttribute("data-srcset")));

      const alt =
        img.getAttribute("alt") ||
        img.getAttribute("title") ||
        img.getAttribute("aria-label") ||
        "";

      for (const rawUrl of urls) {
        const url = absoluteUrl(rawUrl);

        if (!url) continue;

        candidates.push({
          url,
          alt,
          area: rect.area,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          scope: scope.name,
          scopePriority: scope.priority,
        });
      }
    }

    return candidates;
  });
}

async function getPageImageCandidates(tab) {
  return await tab.evaluate(() => {
    const excludedSectionPatterns = [
      /similar\s+products?/i,
      /recently\s+viewed/i,
      /related\s+products?/i,
      /\u76f8\u4f3c\u4ea7\u54c1/,
      /\u6700\u8fd1\u6d4f\u89c8\u8fc7/,
      /\u76f8\u5173\u5546\u54c1/,
      /\u63a8\u8350\u5546\u54c1/,
      /\u54c1\u724c\u66f4\u591a\u4ea7\u54c1/,
      /\bfooter\b/i,
    ];
    const productImageSelectors = [
      "a.nn5-srcset-image img",
      ".nn5-flexlist img",
      "a[href*='enlargemedia'] img",
      ".product-gallery img",
      ".product-image img",
      ".product-images img",
      ".gallery img",
      ".image-gallery img",
      ".thumb img",
      ".thumbnail img",
      "[class*='gallery'] img",
      "[class*='thumb'] img",
      "[class*='image'] img",
      "[class*='media'] img",
    ];

    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    function getRect(element) {
      const rect = element.getBoundingClientRect();

      return {
        width: rect.width,
        height: rect.height,
        area: rect.width * rect.height,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      };
    }

    function getUrlsFromSrcset(srcset) {
      if (!srcset) return [];

      return srcset
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+/)[0])
        .filter(Boolean);
    }

    function getShortElementText(element, maxLength = 1600) {
      const text = normalize(element?.innerText || element?.textContent || "");
      return text.length <= maxLength ? text : "";
    }

    function hasExcludedText(text) {
      return excludedSectionPatterns.some((pattern) => pattern.test(text));
    }

    function getElementMeta(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      return normalize([
        element.tagName,
        typeof element.className === "string" ? element.className : "",
        element.id || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("role") || "",
        element.getAttribute("data-name") || "",
        element.getAttribute("data-title") || "",
      ].join(" "));
    }

    function isInsideExcludedSection(element) {
      if (element.closest?.("footer")) {
        return true;
      }

      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        if (hasExcludedText(getElementMeta(current))) {
          return true;
        }

        const text = getShortElementText(current);

        if (text && hasExcludedText(text)) {
          return true;
        }

        current = current.parentElement;
      }

      return false;
    }

    function getFirstExcludedHeadingTop() {
      const headingSelectors = [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "[class*='title']",
        "[class*='heading']",
        "[class*='headline']",
      ].join(",");
      const tops = Array.from(document.querySelectorAll(headingSelectors))
        .map((element) => {
          const text = getShortElementText(element, 140);

          if (!text || !hasExcludedText(text)) {
            return null;
          }

          return getRect(element).top;
        })
        .filter((value) => Number.isFinite(value));

      return tops.length > 0 ? Math.min(...tops) : Number.POSITIVE_INFINITY;
    }

    function getProductRoot() {
      const primaryRoot = document.querySelector(".detail-container .row .col-xs-12.col-md-7");

      if (primaryRoot) {
        return { element: primaryRoot, scope: "detail-main-column", priority: 120 };
      }

      const detailRoot = document.querySelector(".detail-container");

      if (detailRoot) {
        return { element: detailRoot, scope: "detail-container", priority: 90 };
      }

      return { element: document.body, scope: "document-body-fallback", priority: 20 };
    }

    function getScopedImages(rootInfo) {
      const seen = new Set();
      const images = [];

      for (const selector of productImageSelectors) {
        for (const img of Array.from(rootInfo.element.querySelectorAll(selector))) {
          if (!seen.has(img)) {
            seen.add(img);
            images.push(img);
          }
        }
      }

      if (rootInfo.scope === "detail-main-column") {
        for (const img of Array.from(rootInfo.element.querySelectorAll("img"))) {
          if (!seen.has(img)) {
            seen.add(img);
            images.push(img);
          }
        }
      }

      return images;
    }

    function getImageScope(img, rect, rootInfo, excludedStartTop) {
      // The Danish product gallery is explicitly scoped by:
      // .detail-container .row .col-xs-12.col-md-7
      // Do not run broad ancestor-text exclusion here, because large parent
      // containers can include "similar products" / "recently viewed" text and
      // incorrectly exclude the real product gallery.
      if (rootInfo.scope === "detail-main-column") {
        return { name: "detail-main-column", priority: rootInfo.priority };
      }

      if (isInsideExcludedSection(img)) {
        return null;
      }

      if (Number.isFinite(excludedStartTop) && rect.top >= excludedStartTop - 8) {
        return null;
      }

      if (img.closest?.("a.nn5-srcset-image, a[href*='enlargemedia']")) {
        return { name: `${rootInfo.scope}:enlargemedia-link`, priority: rootInfo.priority + 20 };
      }

      if (img.closest?.(".nn5-flexlist")) {
        return { name: `${rootInfo.scope}:thumb-list`, priority: rootInfo.priority + 10 };
      }

      let current = img;

      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        if (/(gallery|image|media|photo|thumb|enlarge|product)/i.test(getElementMeta(current))) {
          return { name: `${rootInfo.scope}:media-container`, priority: rootInfo.priority };
        }

        current = current.parentElement;
      }

      return null;
    }

    function extractImageIdFromText(text) {
      const value = String(text || "");
      const match = value.match(/[?&]imageid=(\d+)/i) || value.match(/\bimageid\s*=\s*(\d+)/i);

      return match ? match[1] : "";
    }

    function getImageIdFromElement(img) {
      const anchor = img.closest("a");
      const values = [
        anchor?.getAttribute("href"),
        anchor?.getAttribute("onclick"),
        img.getAttribute("data-nn5-imageid"),
        img.getAttribute("data-imageid"),
      ];

      for (const value of values) {
        const imageId = extractImageIdFromText(value);

        if (imageId) {
          return imageId;
        }
      }

      return "";
    }

    const candidates = [];
    const rootInfo = getProductRoot();
    const excludedStartTop = getFirstExcludedHeadingTop();

    for (const img of getScopedImages(rootInfo)) {
      const rect = getRect(img);
      const scope = getImageScope(img, rect, rootInfo, excludedStartTop);

      if (!scope) {
        continue;
      }

      const urls = [];
      const attrs = ["src", "data-src", "data-original", "data-lazy", "data-full", "data-large"];

      for (const attr of attrs) {
        const value = img.getAttribute(attr);

        if (value) {
          urls.push(value);
        }
      }

      urls.push(...getUrlsFromSrcset(img.getAttribute("srcset")));
      urls.push(...getUrlsFromSrcset(img.getAttribute("data-srcset")));

      const alt =
        img.getAttribute("alt") ||
        img.getAttribute("title") ||
        img.getAttribute("aria-label") ||
        "";
      const imageId = getImageIdFromElement(img);

      for (const rawUrl of urls) {
        const url = absoluteUrl(rawUrl);

        if (!url) {
          continue;
        }

        candidates.push({
          url,
          imageId,
          alt,
          area: rect.area,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          scope: scope.name,
          scopePriority: scope.priority,
          rootScope: rootInfo.scope,
          galleryScoped: rootInfo.scope !== "document-body-fallback",
        });
      }
    }

    return candidates;
  });
}

function prepareCandidatePayloads(candidates, productName) {
  const usable = candidates
    .filter((candidate) => candidate.url)
    .filter((candidate) => isDanishImageUrl(candidate.url))
    .filter((candidate) => !isBadImageUrl(candidate.url))
    .map((candidate) => ({
      ...candidate,
      imageId: candidate.imageId || getImageId(candidate.url),
      ratio: getRatioFromUrl(candidate.url),
      productMatch: textMatchesProduct([candidate.url, candidate.alt].join(" "), productName),
    }))
    .filter((candidate) => candidate.imageId)
    .sort((a, b) => {
      const aPriority = Number(a.scopePriority || 0);
      const bPriority = Number(b.scopePriority || 0);

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      if (a.productMatch !== b.productMatch) {
        return Number(b.productMatch) - Number(a.productMatch);
      }

      if (a.top !== b.top) {
        return a.top - b.top;
      }

      return b.area - a.area;
    });

  const seen = new Set();
  const payloads = [];

  for (const item of usable) {
    if (seen.has(item.imageId)) {
      continue;
    }

    seen.add(item.imageId);

    payloads.push({
      imageId: item.imageId,
      ratio: Number.isFinite(item.ratio) && item.ratio > 0 ? item.ratio : 1,
      sourceUrl: item.url,
      productMatch: item.productMatch,
      area: item.area,
      scope: item.scope || "",
      scopePriority: Number(item.scopePriority || 0),
      rootScope: item.rootScope || "",
      galleryScoped: Boolean(item.galleryScoped),
    });
  }

  return payloads.slice(0, 10);
}

async function fetchEnlargeMedia(tab, payload) {
  const ratio = Number(payload.ratio || 1).toFixed(4);
  const querystring = [
    `imageid=${payload.imageId}`,
    `ratio=${ratio}`,
    "lan=2",
    "excludeFLV=1",
    "hidesubtexts=1",
    "useimagetitles=1",
    "excludetypes=1",
    "enlargew=1024",
  ].join("&");

  const result = await tab.evaluate(async (querystringValue) => {
    const response = await fetch("/webservice.asmx/enlargemedia", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        querystring: querystringValue,
      }),
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  }, querystring);

  let responseText = result.text;

  try {
    const json = JSON.parse(result.text);

    if (json && typeof json.d === "string") {
      responseText = json.d;
    }
  } catch {
    // keep raw response text
  }

  return {
    candidateImageId: payload.imageId,
    candidateSourceUrl: payload.sourceUrl,
    candidateScope: payload.scope || "",
    candidateRootScope: payload.rootScope || "",
    galleryScoped: Boolean(payload.galleryScoped),
    querystring,
    ok: result.ok,
    status: result.status,
    imageInfos: parseImageInfosFromEnlargeResponse(responseText),
  };
}

async function getSpecsText(tab) {
  const candidates = await tab.evaluate(() => {
    function normalize(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    function getText(element) {
      return normalize(element?.innerText || element?.textContent || "");
    }

    function getScopedRoots() {
      const selectors = [
        "[itemtype*='Product']",
        "[itemscope][itemtype*='Product']",
        ".product",
        ".product-detail",
        ".productdetails",
        ".product-detail-page",
        ".product-info",
        ".product-data",
        ".product-description",
        "#product",
        "main",
      ];

      const roots = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      return roots.length > 0 ? roots : [document.body].filter(Boolean);
    }

    const specSelectors = [
      "table",
      "dl",
      ".specs",
      ".product-info",
      ".product-data",
      ".product-attributes",
      ".attributes",
      ".product-specifications",
      ".properties",
      ".details",
      ".facts",
    ];

    const elements = new Set();

    for (const root of getScopedRoots()) {
      for (const selector of specSelectors) {
        for (const element of root.querySelectorAll(selector)) {
          elements.add(element);
        }
      }
    }

    if (elements.size === 0) {
      for (const selector of ["table", "dl", ".specs", ".product-data", ".product-specifications"]) {
        for (const element of document.querySelectorAll(selector)) {
          elements.add(element);
        }
      }
    }

    const texts = [];

    for (const element of elements) {
      const tagName = element.tagName.toLowerCase();

      if (tagName === "table") {
        texts.push(...Array.from(element.querySelectorAll("tr")).map(getText).filter(Boolean));
        continue;
      }

      if (tagName === "dl") {
        const children = Array.from(element.children);

        for (let index = 0; index < children.length; index++) {
          if (children[index].tagName.toLowerCase() !== "dt") {
            continue;
          }

          const label = getText(children[index]);
          const value = getText(children[index + 1]);
          texts.push([label, value].filter(Boolean).join(": "));
        }
        continue;
      }

      texts.push(...Array.from(element.querySelectorAll("li")).map(getText).filter(Boolean));
      texts.push(getText(element));
    }

    return texts.filter(Boolean);
  });

  return cleanSpecsText(candidates);
}

async function getDetailFields(tab, listProduct) {
  return await tab.evaluate((product) => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function firstText(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = normalize(element?.textContent || "");

        if (text) {
          return text;
        }
      }

      return "";
    }

    function allTexts(selectors) {
      return selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((element) => normalize(element?.innerText || element?.textContent || ""))
        .filter(Boolean);
    }

    function uniqueTexts(values) {
      const seen = new Set();
      const result = [];

      for (const value of values.map(normalize).filter(Boolean)) {
        const key = value.toLowerCase();

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        result.push(value);
      }

      return result;
    }

    function getDetailFieldTextCandidates() {
      const labelPattern = /品牌|产品编号|Product\s*(?:No\.?|Number|Code)|Item\s*(?:No\.?|Number)|SKU|Brand/i;
      const texts = [];

      for (const row of Array.from(document.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("th, td"))
          .map((cell) => normalize(cell.innerText || cell.textContent || ""))
          .filter(Boolean);

        if (cells.length >= 2) {
          texts.push(`${cells[0]}: ${cells.slice(1).join(" ")}`);
        } else if (cells.length === 1) {
          texts.push(cells[0]);
        }
      }

      for (const dl of Array.from(document.querySelectorAll("dl"))) {
        const children = Array.from(dl.children);

        for (let index = 0; index < children.length; index++) {
          if (children[index].tagName.toLowerCase() !== "dt") {
            continue;
          }

          const label = normalize(children[index].innerText || children[index].textContent || "");
          const value = normalize(children[index + 1]?.innerText || children[index + 1]?.textContent || "");
          texts.push([label, value].filter(Boolean).join(": "));
        }
      }

      texts.push(
        ...Array.from(document.querySelectorAll("li, p, div, span"))
          .map((element) => normalize(element.innerText || element.textContent || ""))
          .filter((text) => text.length <= 260)
      );

      return uniqueTexts(texts)
        .filter((text) => labelPattern.test(text))
        .slice(0, 80);
    }

    function metaContent(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const content = normalize(element?.getAttribute("content") || "");

        if (content) {
          return content;
        }
      }

      return "";
    }

    function metaContents(selectors) {
      return selectors
        .map((selector) => document.querySelector(selector))
        .map((element) => normalize(element?.getAttribute("content") || ""))
        .filter(Boolean);
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    const rawText = normalize(document.body?.innerText || "");
    const breadcrumbText = firstText([
      ".breadcrumb",
      ".breadcrumbs",
      "[class*='breadcrumb']",
      "nav[aria-label='breadcrumb']",
      "nav[aria-label='Breadcrumb']",
      ".crumbs",
      ".path",
    ]);

    const categoryText = firstText([".category", ".product-category", "[class*='category']"]);

    const titleText = firstText([
      "h1",
      ".product-title",
      ".productname",
      ".product-name",
      "[itemprop='name']",
    ]);

    const descriptionCandidates = [
      ...metaContents(["meta[name='description']", "meta[property='og:description']"]),
      ...allTexts([
        "[itemprop='description']",
        ".product-description",
        ".producttext",
        ".product-description-text",
        ".product-detail-description",
        "#description",
      ]),
    ];

    const productDetailTextCandidates = allTexts([
      "[itemtype*='Product']",
      "[itemscope][itemtype*='Product']",
      ".product-description",
      ".producttext",
      ".product-detail-description",
      ".product-detail",
      ".productdetails",
      ".product-info",
      ".product-data",
      ".product-tabs",
      ".tab-content",
      "#description",
      "#product",
    ]);
    const detailFieldTextCandidates = getDetailFieldTextCandidates();

    const priceText =
      firstText([
        "[itemprop='price']",
        ".price",
        ".product-price",
        ".pricefield",
        ".sales-price",
      ]) ||
      (rawText.match(/[$€£]\s?[\d.,-]+/) || [""])[0];

    const statusText = /已售|sold/i.test(rawText)
      ? "已售"
      : /现在购买|add to basket|buy now|可购买/i.test(rawText)
        ? "可购买"
        : "";

    const ogImage = metaContent(["meta[property='og:image']", "meta[name='twitter:image']"]);

    return {
      title: titleText,
      brand: product.imageAlt ? String(product.imageAlt).split(",")[0] : "",
      price: normalize(priceText),
      status: statusText,
      mainImage: absoluteUrl(ogImage),
      rawText,
      description: descriptionCandidates[0] || "",
      descriptionCandidates,
      productDetailTextCandidates,
      detailFieldTextCandidates,
      breadcrumbText,
      categoryText,
      sourceUrl: location.href,
      pageTitle: document.title,
    };
  }, listProduct);
}

function buildStableFieldReport(detail) {
  const criticalFields = [
    "title",
    "brand",
    "price",
    "status",
    "mainImage",
    "galleryImages",
    "specsText",
    "conditionType",
    "smokedStatus",
    "conditionLabel",
    "conditionSource",
  ];

  function isMissingField(field) {
    const value = detail[field];

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return !normalizeText(value);
  }

  const missingFields = criticalFields.filter(isMissingField);

  if (detail.conditionType === "estate" && isMissingField("estateStatus")) {
    missingFields.push("estateStatus");
  }

  const optionalMissingFields = ["description"].filter(isMissingField);

  return {
    status: missingFields.length === 0 ? "complete" : "partial",
    missingFields,
    optionalMissingFields,
  };
}

function isRobotCheckNavigationError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("execution context was destroyed") ||
    message.includes("cannot find context") ||
    message.includes("target closed") ||
    message.includes("frame was detached")
  );
}

async function evaluateRobotVerificationPage(tab) {
  const state = await inspectVerificationPage(tab);
  return state.challenge;
}

function collectorLog(stage, value = null) {
  console.log(
    `[${stage}]` + (value ? " " + JSON.stringify(value) : "")
  );
}

async function inspectVerificationPage(tab) {
  if (tab.isClosed?.()) {
    throw new Error("manual-verification-page-closed");
  }
  try {
    const state = await tab.evaluate(() => {
    const text = [
      document.title || "",
      document.body?.innerText || "",
    ].join("\n").toLowerCase();
    const title = String(document.title || "").trim();
    const challenge = (
      text.includes("i am not a robot") ||
      text.includes("confirm that you are not a robot") ||
      text.includes("not a robot") ||
      text.includes("verification") ||
      text.includes("verify you are human") ||
      text.includes("checking your browser") ||
      text.includes("captcha")
    );
    return {
      title,
      challenge,
      hasListContainer: Boolean(document.querySelector("#list-container-inner")),
      listItemCount: document.querySelectorAll("#list-container-inner .list-item").length,
    };
  });
    const url = tab.url();
    let danishHost = false;
    try { danishHost = new URL(url).hostname.toLowerCase().endsWith("danishpipeshop.com"); } catch {}
    return { ...state, url, danishHost };
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (tab.isClosed?.() || message.includes("target closed")) {
      throw new Error("manual-verification-page-closed");
    }
    if (isRobotCheckNavigationError(error)) {
      return { title: "", challenge: true, hasListContainer: false, listItemCount: 0, url: tab.url(), danishHost: true, navigating: true };
    }
    throw error;
  }
}

async function isRobotVerificationPage(tab) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await evaluateRobotVerificationPage(tab);
    } catch (error) {
      if (String(error?.message || error).includes("manual-verification-page-closed")) {
        throw error;
      }
      const shouldRetry = attempt === 0 && isRobotCheckNavigationError(error);

      if (shouldRetry) {
        await tab.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        await tab.waitForTimeout(800).catch(() => {});
        continue;
      }

      console.warn("Robot check skipped because page was navigating.");
      return false;
    }
  }

  console.warn("Robot check skipped because page was navigating.");
  return false;
}

export async function waitForManualVerificationRecovery(tab, options = {}) {
  const targetUrl = options.targetUrl || tab.url();
  const requireList = Boolean(options.requireList);
  const timeoutMs = Number(options.timeoutMs ?? manualVerificationTimeoutSeconds * 1000);
  const pollMs = Number(options.pollMs ?? manualVerificationPollMs);
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((milliseconds) => tab.waitForTimeout(milliseconds));
  const log = options.log || collectorLog;
  const deadline = now() + timeoutMs;
  let refreshedTarget = false;

  log("manual-verification-required", { targetUrl, timeoutSeconds: Math.round(timeoutMs / 1000), pollMs });
  while (now() <= deadline) {
    const state = await inspectVerificationPage(tab);
    const normalPage = !state.challenge && state.danishHost && !/just a moment|verification|captcha/i.test(state.title);
    const listReady = !requireList || (state.hasListContainer && state.listItemCount > 0);
    if (normalPage && listReady) {
      log("manual-verification-completed", { url: state.url, title: state.title, listItemCount: state.listItemCount });
      if (requireList) log("normal-list-page-ready", { url: state.url, listItemCount: state.listItemCount });
      return state;
    }
    if (normalPage && !refreshedTarget) {
      refreshedTarget = true;
      log("manual-verification-reload-target", { targetUrl, currentUrl: state.url });
      await tab.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(60000, Math.max(1000, deadline - now())),
      });
      continue;
    }
    await sleep(Math.min(pollMs, Math.max(100, deadline - now())));
  }
  throw new Error(`manual-verification-timeout after ${Math.round(timeoutMs / 1000)} seconds`);
}

export async function ensureManualVerificationIfNeeded(tab, options = {}) {
  if (!(await isRobotVerificationPage(tab))) {
    return true;
  }
  await waitForManualVerificationRecovery(tab, options);
  return true;
}

async function inspectAgeLanguageGate(tab) {
  return await tab.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function isVisible(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function findExactVisibleText(text) {
      const expected = normalize(text).toLowerCase();

      return Array.from(document.querySelectorAll("body *")).find((element) => {
        if (!isVisible(element)) {
          return false;
        }

        return normalize(element.textContent).toLowerCase() === expected;
      }) || null;
    }

    const titleElement = findExactVisibleText(
      "Welcome to The Danish Pipe Shop"
    );
    const chineseElement = findExactVisibleText(
      "请点击这里选择中文"
    );
    const englishElement = findExactVisibleText(
      "CLICK HERE TO CHOOSE ENGLISH"
    );

    const listContainer = document.querySelector("#list-container-inner");
    const listItems = Array.from(
      document.querySelectorAll("#list-container-inner .list-item")
    );
    const visibleListItems = listItems.filter(isVisible);

    return {
      gatePresent: Boolean(
        titleElement ||
        chineseElement ||
        englishElement
      ),
      titlePresent: Boolean(titleElement),
      chinesePresent: Boolean(chineseElement),
      englishPresent: Boolean(englishElement),
      listContainerVisible: isVisible(listContainer),
      listItemCount: listItems.length,
      visibleListItemCount: visibleListItems.length,
      url: location.href,
      pageTitle: document.title,
    };
  });
}

async function clickExactAgeLanguageOption(tab, text) {
  const exactLocator = tab.getByText(text, { exact: true }).first();
  const locatorCount = await exactLocator.count().catch(() => 0);

  if (locatorCount > 0) {
    const visible = await exactLocator.isVisible().catch(() => false);

    if (visible) {
      try {
        await exactLocator.click({
          timeout: 5000,
        });

        return {
          clicked: true,
          method: "playwright-exact-text",
          selectedText: text,
        };
      } catch {
        // Continue with the scoped DOM fallback.
      }
    }
  }

  return await tab.evaluate((targetText) => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function isVisible(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function isClickable(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const tagName = element.tagName.toLowerCase();
      const role = normalize(element.getAttribute("role")).toLowerCase();

      return (
        tagName === "button" ||
        tagName === "a" ||
        tagName === "input" ||
        tagName === "label" ||
        role === "button" ||
        role === "link" ||
        element.hasAttribute("onclick") ||
        element.hasAttribute("tabindex")
      );
    }

    const expected = normalize(targetText).toLowerCase();
    const textElement = Array.from(
      document.querySelectorAll("body *")
    ).find((element) => {
      return (
        isVisible(element) &&
        normalize(element.textContent).toLowerCase() === expected
      );
    });

    if (!textElement) {
      return {
        clicked: false,
        method: "dom",
        selectedText: targetText,
        reason: "exact text not found",
      };
    }

    let clickable = textElement;
    let level = 0;

    while (
      clickable &&
      clickable !== document.body &&
      level <= 6 &&
      !isClickable(clickable)
    ) {
      clickable = clickable.parentElement;
      level += 1;
    }

    if (
      !clickable ||
      clickable === document.body ||
      !isVisible(clickable)
    ) {
      return {
        clicked: false,
        method: "dom",
        selectedText: targetText,
        reason: "clickable ancestor not found",
      };
    }

    const rect = clickable.getBoundingClientRect();

    clickable.click();

    return {
      clicked: true,
      method: "dom-clickable-ancestor",
      selectedText: targetText,
      tagName: clickable.tagName,
      role: clickable.getAttribute("role") || "",
      href: clickable.getAttribute("href") || "",
      width: rect.width,
      height: rect.height,
    };
  }, text);
}

async function waitForAgeLanguageGateDismissal(
  tab,
  {
    requireList = true,
    timeoutMs = pageReadyTimeoutMs,
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveReadyChecks = 0;
  let lastState = null;

  while (Date.now() < deadline) {
    lastState = await inspectAgeLanguageGate(tab);

    const listReady =
      !requireList ||
      (
        lastState.listContainerVisible &&
        lastState.listItemCount > 0
      );

    if (!lastState.gatePresent && listReady) {
      consecutiveReadyChecks += 1;

      if (consecutiveReadyChecks >= 2) {
        return {
          ready: true,
          state: lastState,
        };
      }
    } else {
      consecutiveReadyChecks = 0;
    }

    await tab.waitForTimeout(500);
  }

  return {
    ready: false,
    state: lastState,
  };
}

async function waitForManualAgeLanguageSelection(tab, { requireList }) {
  collectorLog("manual-age-language-required", { timeoutSeconds: manualVerificationTimeoutSeconds });
  return await waitForAgeLanguageGateDismissal(tab, {
    requireList,
    timeoutMs: manualVerificationTimeoutSeconds * 1000,
  });
}

async function ensureAgeLanguageGateHandled(
  tab,
  {
    requireList = true,
  } = {}
) {
  let state = await inspectAgeLanguageGate(tab);

  if (!state.gatePresent) {
    const readyResult = await waitForAgeLanguageGateDismissal(tab, {
      requireList,
      timeoutMs: pageReadyTimeoutMs,
    });

    if (!readyResult.ready) {
      throw new Error(
        requireList
          ? "Danish page did not become ready after verification."
          : "Danish detail page remained blocked after verification."
      );
    }

    return {
      detected: false,
      selectedText: "",
      automatic: false,
    };
  }

  console.log("[INFO] Danish age/language gate detected");

  /*
   * Prefer Chinese because the proven V17 collector and default URL
   * were built around /-zh/ routes. English remains a safe fallback
   * because V18 accepts both URL forms.
   */
  const choices = [
    "请点击这里选择中文",
    "CLICK HERE TO CHOOSE ENGLISH",
  ];

  for (const choice of choices) {
    state = await inspectAgeLanguageGate(tab);

    const choiceAvailable =
      choice === "请点击这里选择中文"
        ? state.chinesePresent
        : state.englishPresent;

    if (!choiceAvailable) {
      continue;
    }

    console.log("[INFO] automatically selecting: " + choice);

    const clickResult = await clickExactAgeLanguageOption(tab, choice);

    if (!clickResult.clicked) {
      console.warn(
        "[WARN] age/language click failed: " +
        choice +
        "; " +
        (clickResult.reason || "unknown reason")
      );
      continue;
    }

    const readyResult = await waitForAgeLanguageGateDismissal(tab, {
      requireList,
      timeoutMs: Math.min(pageReadyTimeoutMs, 15000),
    });

    if (readyResult.ready) {
      console.log("[PASS] Danish age/language gate completed");

      return {
        detected: true,
        selectedText: choice,
        automatic: true,
        clickMethod: clickResult.method || "",
      };
    }

    console.warn(
      "[WARN] age/language modal remained after clicking: " +
      choice
    );
  }

  console.log(
    "[WAIT] automatic age/language selection failed"
  );
  console.log(
    "browser remains open for " +
    languageFallbackSeconds +
    " seconds before manual confirmation"
  );

  /*
   * Give the browser a short period before prompting, so a delayed
   * website transition can complete without unnecessary interaction.
   */
  await tab.waitForTimeout(languageFallbackSeconds * 1000);

  state = await inspectAgeLanguageGate(tab);

  if (!state.gatePresent) {
    const delayedReadyResult = await waitForAgeLanguageGateDismissal(tab, {
      requireList,
      timeoutMs: pageReadyTimeoutMs,
    });

    if (delayedReadyResult.ready) {
      console.log(
        "[PASS] Danish age/language gate completed after delayed transition"
      );

      return {
        detected: true,
        selectedText: "",
        automatic: true,
        clickMethod: "delayed-transition",
      };
    }
  }

  const manualReadyResult = await waitForManualAgeLanguageSelection(tab, { requireList });

  if (!manualReadyResult.ready) {
    throw new Error(
      "Danish age/language gate was not dismissed after automatic and manual attempts."
    );
  }

  console.log(
    "[PASS] Danish age/language gate completed manually"
  );

  return {
    detected: true,
    selectedText: "",
    automatic: false,
    clickMethod: "manual",
  };
}

async function getListProgress(tab) {
  return await tab.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function parseInteger(text) {
      const digits = String(text || "").replace(/[^\d]/g, "");

      if (!digits) {
        return 0;
      }

      const value = Number.parseInt(digits, 10);
      return Number.isFinite(value) ? value : 0;
    }

    function isVisible(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const itemCount = document.querySelectorAll(
      "#list-container-inner .list-item"
    ).length;

    const showMoreButton = document.querySelector(
      "#show-more-button"
    );

    const localTexts = [];
    let current = showMoreButton;

    for (let level = 0; current && level < 5; level += 1) {
      const text = normalize(
        current.innerText ||
        current.textContent ||
        ""
      );

      if (text) {
        localTexts.push(text);
      }

      current = current.parentElement;
    }

    const bodyText = normalize(document.body?.innerText || "");

    const contextualPatterns = [
      /showing\s+([\d.,]+)\s+(?:of|\/)\s+([\d.,]+)/i,
      /([\d.,]+)\s+of\s+([\d.,]+)\s+(?:products?|items?)/i,
      /(?:显示|已显示)\s*([\d.,]+)\s*(?:个|件)?\s*(?:\/|共|of)\s*([\d.,]+)/i,
      /(?:共)\s*([\d.,]+)\s*(?:个|件|项|款)/i,
    ];

    let shownCount = 0;
    let totalCount = 0;
    let matchedText = "";

    const textsToInspect = [
      ...localTexts,
      bodyText,
    ];

    for (const text of textsToInspect) {
      for (const pattern of contextualPatterns) {
        const match = text.match(pattern);

        if (!match) {
          continue;
        }

        if (match.length >= 3) {
          shownCount = parseInteger(match[1]);
          totalCount = parseInteger(match[2]);
        } else if (match.length === 2) {
          totalCount = parseInteger(match[1]);
        }

        matchedText = match[0] || "";

        if (totalCount > 0) {
          break;
        }
      }

      if (totalCount > 0) {
        break;
      }
    }

    const totalAttributeCandidates = [
      showMoreButton?.getAttribute("data-total"),
      showMoreButton?.getAttribute("data-totalcount"),
      showMoreButton?.getAttribute("data-total-count"),
      document
        .querySelector("#list-container-inner")
        ?.getAttribute("data-total"),
      document
        .querySelector("#list-container")
        ?.getAttribute("data-total"),
    ];

    if (!totalCount) {
      for (const candidate of totalAttributeCandidates) {
        const parsed = parseInteger(candidate);

        if (parsed > 0) {
          totalCount = parsed;
          matchedText = "data-total";
          break;
        }
      }
    }

    shownCount = Math.max(shownCount, itemCount);

    return {
      itemCount,
      shownCount,
      totalCount,
      matchedText,
      showMorePresent: Boolean(showMoreButton),
      showMoreVisible: isVisible(showMoreButton),
      url: location.href,
    };
  });
}

async function waitForStableListCount(tab, checks = 2, delayMs = 1200) {
  let previousCount = await getCurrentListItemCount(tab);
  let stableChecks = 0;

  for (let index = 0; index < checks + 2; index += 1) {
    await tab.waitForTimeout(delayMs);
    const currentCount = await getCurrentListItemCount(tab);

    if (currentCount === previousCount) {
      stableChecks += 1;

      if (stableChecks >= checks) {
        return {
          stable: true,
          count: currentCount,
        };
      }
    } else {
      stableChecks = 0;
      previousCount = currentCount;
    }
  }

  return {
    stable: false,
    count: previousCount,
  };
}

async function waitForExpectedProductPage(tab, expectedHref) {
  await tab.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await tab.waitForTimeout(500).catch(() => {});

  let validation = validateProductPageUrl(tab.url(), expectedHref);

  for (let attempt = 0; attempt < 4 && !validation.matches; attempt++) {
    await tab.waitForTimeout(500).catch(() => {});
    validation = validateProductPageUrl(tab.url(), expectedHref);
  }

  return {
    ...validation,
    actualUrl: tab.url(),
    expectedUrl: expectedHref,
  };
}

async function discoverProductLinksLegacy(tab, listUrl, pageIndex) {
  await tab.goto(listUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await tab.waitForTimeout(1800);

  if (!(await ensureManualVerificationIfNeeded(tab, { targetUrl: listUrl, requireList: true }))) {
    throw new Error("Robot / verification page remained during list discovery.");
  }

  const links = await tab.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    function getImageUrl(anchor) {
      const img = anchor.querySelector("img");

      if (!img) return "";

      const attrs = ["src", "data-src", "data-original", "data-lazy"];

      for (const attr of attrs) {
        const value = img.getAttribute(attr);

        if (value) {
          return absoluteUrl(value);
        }
      }

      const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
      const firstSrcsetUrl = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).find(Boolean);
      return absoluteUrl(firstSrcsetUrl);
    }

    function getCardText(anchor) {
      const card =
        anchor.closest("article, li, tr, .product, .product-item, .productbox, .product-list-item, .item, .col") ||
        anchor.parentElement;

      return normalize(card?.innerText || card?.textContent || anchor.textContent || "");
    }

    function getStatus(text) {
      if (/已售|sold\s*out|\bsold\b|out\s*of\s*stock/i.test(text)) {
        return "已售";
      }

      if (/现在购买|add\s+to\s+(?:basket|cart)|buy\s+now|可购买|in\s+stock/i.test(text)) {
        return "可购买";
      }

      return "";
    }

    function getPrice(text) {
      return (text.match(/[$€£]\s?[\d.,-]+/) || [""])[0];
    }

    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const href = absoluteUrl(anchor.getAttribute("href"));
        const imageAlt = normalize(anchor.querySelector("img")?.getAttribute("alt") || "");
        const text = normalize(anchor.textContent || "");
        const title = normalize(anchor.getAttribute("title") || "");
        const cardText = getCardText(anchor);

        return {
          href,
          name: firstNonEmptyInPage(text, title, imageAlt),
          imageAlt,
          imageUrl: getImageUrl(anchor),
          price: getPrice(cardText),
          status: getStatus(cardText),
          rawText: cardText,
        };
      })
      .filter((item) => /\/d\/(?:-zh\/)?.*-i\d+\.html(?:[?#].*)?$/i.test(item.href));

    function firstNonEmptyInPage(...values) {
      return values.map(normalize).find(Boolean) || "";
    }
  });

  return links.map((item, index) => ({
    ...item,
    listPageUrl: listUrl,
    listPageIndex: pageIndex,
    listPosition: index + 1,
  }));
}

async function collectProductLinksFromCurrentListPage(tab, listUrl, pageIndex) {
  const links = await tab.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    function firstNonEmptyInPage(...values) {
      return values.map(normalize).find(Boolean) || "";
    }

    function getImageUrl(card) {
      const img = card.querySelector("img");

      if (!img) return "";

      const attrs = ["src", "data-src", "data-original", "data-lazy"];

      for (const attr of attrs) {
        const value = img.getAttribute(attr);

        if (value) {
          return absoluteUrl(value);
        }
      }

      const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
      const firstSrcsetUrl = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .find(Boolean);

      return absoluteUrl(firstSrcsetUrl);
    }

    function getStatus(text) {
      if (/\u5df2\u552e|sold\s*out|\bsold\b|out\s*of\s*stock/i.test(text)) {
        return "\u5df2\u552e";
      }

      if (/\u73b0\u5728\u8d2d\u4e70|add\s+to\s+(?:basket|cart)|buy\s+now|\u53ef\u8d2d\u4e70|in\s+stock/i.test(text)) {
        return "\u53ef\u8d2d\u4e70";
      }

      return "";
    }

    function getPrice(text) {
      return (text.match(/[$€£¥]\s?[\d.,-]+/) || [""])[0];
    }

    return Array.from(document.querySelectorAll("#list-container-inner .list-item"))
      .map((card) => {
        const anchors = Array.from(card.querySelectorAll("a[href]"));
        const anchor = anchors.find((item) => {
          const href = absoluteUrl(item.getAttribute("href"));
          return /\/d\/(?:-zh\/)?.*-i\d+\.html(?:[?#].*)?$/i.test(href);
        });

        if (!anchor) {
          return null;
        }

        const href = absoluteUrl(anchor.getAttribute("href"));
        const img = card.querySelector("img") || anchor.querySelector("img");
        const imageAlt = normalize(img?.getAttribute("alt") || "");
        const anchorText = normalize(anchor.textContent || "");
        const title = normalize(anchor.getAttribute("title") || img?.getAttribute("title") || "");
        const cardText = normalize(card.innerText || card.textContent || "");

        return {
          href,
          name: firstNonEmptyInPage(imageAlt, title, anchorText, cardText),
          imageAlt,
          imageUrl: getImageUrl(card),
          price: getPrice(cardText),
          status: getStatus(cardText),
          rawText: cardText,
        };
      })
      .filter(Boolean);
  });

  return links.map((item, index) => ({
    ...item,
    listPageUrl: listUrl,
    listPageIndex: pageIndex,
    listPosition: index + 1,
  }));
}

async function discoverProductLinks(tab, listUrl, pageIndex) {
  await tab.goto(listUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await tab.waitForTimeout(1800);

  if (!(await ensureManualVerificationIfNeeded(tab, { targetUrl: listUrl, requireList: true }))) {
    throw new Error("Robot / verification page remained during list discovery.");
  }

  await ensureAgeLanguageGateHandled(tab, {
    requireList: true,
  });

  return await collectProductLinksFromCurrentListPage(tab, listUrl, pageIndex);
}

async function getCurrentListItemCount(tab) {
  return await tab.locator("#list-container-inner .list-item").count().catch(() => 0);
}

async function hasLoadMoreButton(tab) {
  return await tab.evaluate(() => {
    const button = document.querySelector("#show-more-button");

    if (!button) {
      return false;
    }

    const style = window.getComputedStyle(button);
    const rect = button.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }).catch(() => false);
}

async function clickLoadMoreAndWait(tab, beforeCount) {
  const button = tab.locator("#show-more-button").first();
  const buttonCount = await button.count().catch(() => 0);

  if (buttonCount === 0 || !(await hasLoadMoreButton(tab))) {
    return { clicked: false, beforeCount, afterCount: beforeCount, reason: "missing" };
  }

  await button.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

  try {
    await button.click({ timeout: 10000 });
  } catch (error) {
    return {
      clicked: false,
      beforeCount,
      afterCount: beforeCount,
      reason: error?.message || String(error),
    };
  }

  if (loadMoreDelayMs > 0) {
    await tab.waitForFunction(
      (count) => document.querySelectorAll("#list-container-inner .list-item").length > count,
      beforeCount,
      { timeout: loadMoreDelayMs }
    ).catch(() => {});
  }

  const afterCount = await getCurrentListItemCount(tab);

  return { clicked: true, beforeCount, afterCount, reason: "" };
}

async function findNextListPageUrl(tab, currentUrl, visitedListUrls) {
  const nextUrl = await tab.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.href).href;
      } catch {
        return "";
      }
    }

    const relNext = document.querySelector("a[rel='next'], link[rel='next']");
    const relNextUrl = absoluteUrl(relNext?.getAttribute("href") || "");

    if (relNextUrl) {
      return relNextUrl;
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const nextTextPatterns = [
      /\bnext\b/i,
      /\bnæste\b/i,
      /\bnaeste\b/i,
      /下一页/,
      /下一个/,
      /^>$/,
      /^»$/,
    ];

    for (const anchor of anchors) {
      const text = normalize(anchor.textContent || anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "");

      if (!nextTextPatterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      const href = absoluteUrl(anchor.getAttribute("href"));

      if (href && !/\/d\/(?:-zh\/)?.*-i\d+\.html/i.test(href)) {
        return href;
      }
    }

    return "";
  });

  if (!nextUrl) {
    return "";
  }

  const normalizedNext = new URL(nextUrl).href;
  const normalizedCurrent = new URL(currentUrl).href;

  if (normalizedNext === normalizedCurrent || visitedListUrls.has(normalizedNext)) {
    return "";
  }

  return normalizedNext;
}


async function discoverProducts(context) {
  const tab = await context.newPage();
  const discovered = [];
  const seenProductUrls = new Set();
  const visitedListUrls = new Set();
  const loadMoreProgress = [];

  let initialShownCount = 0;
  let detectedTotalCount = 0;
  let showMoreClickCount = 0;
  let completionReason = "";
  let integrityFailureReason = "";
  let fallbackPagesVisited = 0;
  let fallbackExhausted = false;

  function addDiscoveredProducts(pageProducts) {
    for (const item of pageProducts) {
      let normalizedProductUrl = "";

      try {
        normalizedProductUrl = new URL(item.href).href;
      } catch {
        continue;
      }

      if (seenProductUrls.has(normalizedProductUrl)) {
        continue;
      }

      seenProductUrls.add(normalizedProductUrl);
      discovered.push({
        ...item,
        href: normalizedProductUrl,
      });

      if (discovered.length >= targetCount) {
        break;
      }
    }
  }

  try {
    const normalizedStartUrl = new URL(startUrl).href;
    visitedListUrls.add(normalizedStartUrl);

    console.log(
      "Scanning Danish list: " + normalizedStartUrl
    );
    collectorLog("initial-navigation-start", { url: normalizedStartUrl });

    await tab.goto(normalizedStartUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    collectorLog("initial-navigation-complete", { url: tab.url() });

    await tab.waitForTimeout(1800);

    if (!(await ensureManualVerificationIfNeeded(tab, { targetUrl: normalizedStartUrl, requireList: true }))) {
      throw new Error(
        "Robot / verification page remained during list discovery."
      );
    }

    await ensureAgeLanguageGateHandled(tab, {
      requireList: true,
    });
    collectorLog("normal-list-page-ready", { url: tab.url(), listItemCount: await getCurrentListItemCount(tab) });
    collectorLog("list-collection-start", { url: normalizedStartUrl });

    addDiscoveredProducts(
      await collectProductLinksFromCurrentListPage(
        tab,
        normalizedStartUrl,
        1
      )
    );

    let progress = await getListProgress(tab);

    initialShownCount = progress.shownCount || progress.itemCount;
    detectedTotalCount = Math.max(
      detectedTotalCount,
      progress.totalCount || 0
    );

    console.log(
      "Initial Danish list: DOM=" +
      progress.itemCount +
      ", unique=" +
      discovered.length +
      ", detectedTotal=" +
      (detectedTotalCount || "unknown")
    );
    collectorLog("list-page-progress", { page: 1, domCount: progress.itemCount, uniqueCount: discovered.length, detectedTotalCount });

    for (
      let clickIndex = 1;
      clickIndex <= maxLoadMoreClicks;
      clickIndex += 1
    ) {
      const gateState = await inspectAgeLanguageGate(tab);

      if (gateState.gatePresent) {
        console.warn(
          "[WARN] Danish age/language gate reappeared during list loading."
        );

        await ensureAgeLanguageGateHandled(tab, {
          requireList: true,
        });
      }

      if (await isRobotVerificationPage(tab)) {
        console.warn(
          "[WARN] Danish verification reappeared during list loading."
        );

        if (!(await ensureManualVerificationIfNeeded(tab, { targetUrl: normalizedStartUrl, requireList: true }))) {
          integrityFailureReason =
            "robot-verification-remained-during-show-more";
          break;
        }

        await ensureAgeLanguageGateHandled(tab, {
          requireList: true,
        });
      }

      progress = await getListProgress(tab);

      detectedTotalCount = Math.max(
        detectedTotalCount,
        progress.totalCount || 0
      );

      if (
        detectedTotalCount > 0 &&
        discovered.length >= detectedTotalCount
      ) {
        completionReason = "detected-total-reached";
        break;
      }

      if (discovered.length >= targetCount) {
        if (
          detectedTotalCount > 0 &&
          targetCount < detectedTotalCount
        ) {
          integrityFailureReason =
            "target-count-lower-than-detected-total";
        } else {
          completionReason = "target-count-reached";
        }

        break;
      }

      if (
        !progress.showMorePresent ||
        !progress.showMoreVisible
      ) {
        completionReason =
          detectedTotalCount > 0
            ? "show-more-missing-before-total"
            : "show-more-exhausted";
        break;
      }

      const beforeCount = progress.itemCount;
      let loadMoreResult = null;
      let successfulGrowth = false;

      for (
        let attempt = 0;
        attempt <= showMoreRetries;
        attempt += 1
      ) {
        loadMoreResult = await clickLoadMoreAndWait(
          tab,
          beforeCount
        );

        if (
          loadMoreResult.clicked &&
          loadMoreResult.afterCount > beforeCount
        ) {
          successfulGrowth = true;
          break;
        }

        if (attempt < showMoreRetries) {
          console.warn(
            "[WARN] Show-more produced no growth; retrying " +
            (attempt + 1) +
            "/" +
            showMoreRetries
          );

          await tab.waitForTimeout(1500);
        }
      }

      const afterProgress = await getListProgress(tab);

      if (!successfulGrowth) {
        integrityFailureReason = loadMoreResult?.clicked
          ? "show-more-no-progress"
          : "show-more-click-failed";

        loadMoreProgress.push({
          batchIndex: clickIndex,
          beforeCount,
          afterCount: afterProgress.itemCount,
          uniqueCount: discovered.length,
          detectedTotalCount,
          clicked: Boolean(loadMoreResult?.clicked),
          reason:
            loadMoreResult?.reason ||
            integrityFailureReason,
          url: tab.url(),
        });

        break;
      }

      showMoreClickCount += 1;

      addDiscoveredProducts(
        await collectProductLinksFromCurrentListPage(
          tab,
          normalizedStartUrl,
          1
        )
      );

      detectedTotalCount = Math.max(
        detectedTotalCount,
        afterProgress.totalCount || 0
      );

      loadMoreProgress.push({
        batchIndex: clickIndex,
        beforeCount,
        afterCount: afterProgress.itemCount,
        uniqueCount: discovered.length,
        detectedShownCount: afterProgress.shownCount,
        detectedTotalCount,
        clicked: true,
        reason: "",
        url: tab.url(),
      });

      console.log(
        "Show more " +
        clickIndex +
        "/" +
        maxLoadMoreClicks +
        ": before=" +
        beforeCount +
        ", after=" +
        afterProgress.itemCount +
        ", unique=" +
        discovered.length +
        ", total=" +
        (detectedTotalCount || "unknown")
      );
      collectorLog("list-page-progress", { page: 1, batch: clickIndex, domCount: afterProgress.itemCount, uniqueCount: discovered.length, detectedTotalCount });
    }

    /*
     * Preserve the proven V17 fallback-page behavior. It is only used
     * after the primary Show-more route has stopped.
     */
    if (
      !integrityFailureReason &&
      discovered.length < targetCount &&
      !(
        detectedTotalCount > 0 &&
        discovered.length >= detectedTotalCount
      )
    ) {
      let currentListUrl = await findNextListPageUrl(
        tab,
        normalizedStartUrl,
        visitedListUrls
      );

      if (!currentListUrl) {
        fallbackExhausted = true;
      }

      for (
        let pageIndex = 2;
        pageIndex <= maxListPages && currentListUrl;
        pageIndex += 1
      ) {
        const normalizedListUrl = new URL(
          currentListUrl
        ).href;

        if (visitedListUrls.has(normalizedListUrl)) {
          fallbackExhausted = true;
          break;
        }

        visitedListUrls.add(normalizedListUrl);
        fallbackPagesVisited += 1;

        console.log(
          "Scanning Danish fallback list page " +
          pageIndex +
          "/" +
          maxListPages +
          ": " +
          normalizedListUrl
        );

        addDiscoveredProducts(
          await discoverProductLinks(
            tab,
            normalizedListUrl,
            pageIndex
          )
        );

        if (
          detectedTotalCount > 0 &&
          discovered.length >= detectedTotalCount
        ) {
          completionReason = "detected-total-reached";
          fallbackExhausted = true;
          break;
        }

        if (discovered.length >= targetCount) {
          completionReason = "target-count-reached";
          break;
        }

        currentListUrl = await findNextListPageUrl(
          tab,
          normalizedListUrl,
          visitedListUrls
        );

        if (!currentListUrl) {
          fallbackExhausted = true;
        }
      }
    }

    const finalProgress = await getListProgress(tab);
    const finalGateState = await inspectAgeLanguageGate(tab);
    const finalRobotCheck = await isRobotVerificationPage(tab);
    const stableResult = await waitForStableListCount(
      tab,
      2,
      1200
    );

    detectedTotalCount = Math.max(
      detectedTotalCount,
      finalProgress.totalCount || 0
    );

    const minimumCountPassed =
      discovered.length >= minimumExpectedCount;

    const listTotalMatched =
      detectedTotalCount > 0
        ? discovered.length >= detectedTotalCount
        : (
          !finalProgress.showMoreVisible &&
          stableResult.stable &&
          fallbackExhausted
        );

    if (
      !integrityFailureReason &&
      detectedTotalCount > 0 &&
      discovered.length < detectedTotalCount
    ) {
      integrityFailureReason =
        "final-unique-count-below-detected-total";
    }

    if (
      !integrityFailureReason &&
      detectedTotalCount === 0 &&
      finalProgress.showMoreVisible
    ) {
      integrityFailureReason =
        "show-more-still-visible-without-detected-total";
    }

    if (
      !integrityFailureReason &&
      !minimumCountPassed
    ) {
      integrityFailureReason =
        "final-count-below-minimum-expected-count";
    }

    if (
      !integrityFailureReason &&
      finalGateState.gatePresent
    ) {
      integrityFailureReason =
        "age-language-gate-still-present";
    }

    if (
      !integrityFailureReason &&
      finalRobotCheck
    ) {
      integrityFailureReason =
        "robot-verification-still-present";
    }

    if (!completionReason) {
      if (
        detectedTotalCount > 0 &&
        discovered.length >= detectedTotalCount
      ) {
        completionReason = "detected-total-reached";
      } else if (
        detectedTotalCount === 0 &&
        !finalProgress.showMoreVisible &&
        stableResult.stable &&
        fallbackExhausted
      ) {
        completionReason =
          fallbackPagesVisited > 0
            ? "fallback-pages-exhausted-stable"
            : "show-more-exhausted-stable";
      } else {
        completionReason = "incomplete";
      }
    }

    const integrityGate = Boolean(
      !integrityFailureReason &&
      discovered.length > 0 &&
      minimumCountPassed &&
      listTotalMatched &&
      !finalGateState.gatePresent &&
      !finalRobotCheck
    );

    lastListIntegrityReport = {
      collectorVersion: "v18",
      integrityGate,
      integrityFailureReason,
      initialShownCount,
      detectedTotalCount,
      showMoreClickCount,
      maxLoadMoreClicks,
      showMoreRetries,
      finalShownCount: finalProgress.shownCount,
      finalDomCount: finalProgress.itemCount,
      finalUniqueCount: discovered.length,
      listTotalMatched,
      minimumExpectedCount,
      minimumCountPassed,
      completionReason,
      finalShowMoreVisible: finalProgress.showMoreVisible,
      finalListCountStable: stableResult.stable,
      fallbackPagesVisited,
      fallbackExhausted,
      loadMoreProgress,
    };

    console.log("Danish V18 list integrity:");
    console.log(
      JSON.stringify(lastListIntegrityReport, null, 2)
    );
    collectorLog("list-collection-complete", { uniqueCount: discovered.length, integrityGate, completionReason, integrityFailureReason });

    return discovered.slice(0, targetCount);
  } finally {
    await tab.close().catch(() => {});
  }
}

async function collectDetail(context, product, index) {
  const tab = await context.newPage();

  try {
    console.log(`Collecting detail ${index + 1}: ${product.name || product.href}`);
    await tab.goto(product.href, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await tab.waitForTimeout(2200);

    if (!(await ensureManualVerificationIfNeeded(tab, { targetUrl: product.href, requireList: false }))) {
      throw new Error("Robot / verification page remained during detail collection.");
    }

    await ensureAgeLanguageGateHandled(tab, {
      requireList: false,
    });

    const pageValidation = await waitForExpectedProductPage(tab, product.href);

    if (!pageValidation.matches) {
      throw new Error(
        `Product page id mismatch: expected i${pageValidation.expectedId}, got i${pageValidation.actualId || "unknown"} at ${pageValidation.actualUrl}`
      );
    }

    const detailFields = await getDetailFields(tab, product);
    const title = firstNonEmpty(detailFields.title, product.name, product.imageAlt);
    const productNameForImage = firstNonEmpty(title, product.name, product.imageAlt, product.href);

    const candidates = await getPageImageCandidates(tab);
    const payloads = prepareCandidatePayloads(candidates, productNameForImage);
    const enlargeResults = [];

    for (const payload of payloads) {
      try {
        enlargeResults.push(await fetchEnlargeMedia(tab, payload));
      } catch {
        // ignore a single image payload failure
      }
    }

    const bestResult = chooseBestEnlargeResult(enlargeResults, productNameForImage);
    let galleryImages = [];
    let galleryImageInfos = [];
    let galleryScoped = false;

    if (bestResult) {
      galleryImageInfos = bestResult.imageInfos;
      galleryImages = uniqueByImageId(
        galleryImageInfos
          .map((info) => imageInfoToUrl(info, 500))
          .filter(Boolean)
      );
      galleryScoped = Boolean(bestResult.galleryScoped && galleryImages.length > 0);
    }

    if (galleryImages.length === 0) {
      const fallbackImages = candidates
        .map((candidate) => candidate.url)
        .filter(isDanishImageUrl)
        .filter((url) => !isBadImageUrl(url));

      galleryImages = uniqueByImageId(fallbackImages).slice(0, 1);
    }

    if (saveScreenshots) {
      const screenshotPath = path.join(screenshotDir, `detail-${index + 1}.png`);
      await tab.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }

    const specsText = await getSpecsText(tab);
    const detailBodyTextStart = await tab.evaluate(() => document.body.innerText.slice(0, 2500));
    const detailPageTitle = await tab.title();

    const description = cleanDescriptionText([
      ...(detailFields.descriptionCandidates || []),
      detailFields.description,
    ]);
    const productDetailText = cleanProductDetailText([
      ...(detailFields.productDetailTextCandidates || []),
      description,
      specsText.join("\n"),
    ]);
    const detailTextSources = [
      ...(detailFields.detailFieldTextCandidates || []),
      ...(detailFields.productDetailTextCandidates || []),
      specsText.join("\n"),
      productDetailText,
      description,
    ];
    const productCode = extractProductCodeFromDetailText(detailTextSources);
    const brand = firstNonEmpty(
      extractBrandFromDetailText(detailTextSources),
      getBrandFromCommaName(title),
      getBrandFromCommaName(product.name),
      getBrandFromCommaName(product.imageAlt),
      detailFields.brand,
      product.brand
    );
    const status = normalizeAvailabilityStatus({
      detailStatus: detailFields.status,
      listStatus: product.status,
      textSources: [
        detailFields.rawText,
        product.rawText,
        title,
        product.name,
      ],
    });
    const rawDetailImageUrl = firstNonEmpty(galleryImages[0], detailFields.mainImage);
    const imageValidation = validateProductImagesV2({
      productHref: product.href,
      detailImageUrl: rawDetailImageUrl,
      galleryImages,
      listImageUrl: product.imageUrl,
      galleryScoped,
    });
    galleryImages = imageValidation.safeGalleryImages;

    const normalizedDetail = {
      title,
      brand,
      productCode,
      price: firstNonEmpty(detailFields.price, product.price),
      status,
      mainImage: imageValidation.safeDetailImageUrl,
      listImageUrl: imageValidation.safeListImageUrl,
      galleryImages,
      rawGalleryImages: imageValidation.rawGalleryImages,
      imageMatchStatus: imageValidation.imageMatchStatus,
      imageMatchNotes: imageValidation.imageMatchNotes,
      qualityWarnings: buildImageQualityWarnings(imageValidation),
      specsText,
      sourceUrl: firstNonEmpty(detailFields.sourceUrl, product.href),
      rawText: productDetailText,
      description,
      productDetailText,
    };

    Object.assign(
      normalizedDetail,
      parsePipeCondition([
        { source: "title", text: normalizedDetail.title },
        { source: "productName", text: product.name },
        {
          source: "breadcrumb/category",
          text: [detailFields.breadcrumbText, detailFields.categoryText]
            .filter(Boolean)
            .join(" "),
        },
        { source: "listPageUrl", text: product.listPageUrl || startUrl },
        { source: "sourceUrl", text: normalizedDetail.sourceUrl },
        { source: "specsText", text: specsText.join("\n") },
        { source: "description", text: normalizedDetail.description },
        { source: "productDetailText", text: normalizedDetail.productDetailText },
      ])
    );

    const stableFieldReport = buildStableFieldReport(normalizedDetail);

    return normalizeProductOutput({
      product,
      normalizedDetail,
      stableFieldReport,
      extra: {
        detailPageTitle,
        detailGalleryImages: galleryImages,
        detailSpecsText: specsText,
        detailBodyTextStart,
        detailPageUrl: product.href,
        detailImageDebug: {
        version: "v18",
        pageValidation,
        productNameForImage,
        imageMatchStatus: imageValidation.imageMatchStatus,
        imageMatchNotes: imageValidation.imageMatchNotes,
        rawGalleryImages: imageValidation.rawGalleryImages,
        galleryScoped,
        candidatePayloads: payloads,
        enlargeResultCount: enlargeResults.length,
        bestCandidateImageId: bestResult?.candidateImageId || 0,
        bestCandidateScope: bestResult?.candidateScope || "",
        bestCandidateRootScope: bestResult?.candidateRootScope || "",
        bestQuerystring: bestResult?.querystring || "",
        imageInfoCount: galleryImageInfos.length,
        galleryIds: galleryImages.map(getImageId),
        galleryImages,
        imageInfos: galleryImageInfos,
      },
      },
    });
  } finally {
    await tab.close().catch(() => {});
  }
}

function buildFailedProduct(product, error) {
  const errorInfo = {
    href: product.href,
    name: product.name || "",
    message: error?.message || String(error),
    nameOfError: error?.name || "Error",
  };

  return {
    ...product,
    error: errorInfo,
    v17: {
      title: firstNonEmpty(product.name),
      brand: firstNonEmpty(product.imageAlt),
      price: "",
      status: "",
      mainImage: "",
      galleryImages: [],
      specsText: [],
      sourceUrl: firstNonEmpty(product.href),
      rawText: "",
      description: "",
      productDetailText: "",
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      conditionRawText: [],
      conditionNotes: "单条商品详情采集失败，未获得足够文本证据判断成色。",
      conditionSource: "unknown",
      estateStatus: null,
      estateRatingStars: null,
      estateRatingLabel: "",
      estateRatingNotes: "未识别 Danish Estate 星级成色。",
    },
    stableFieldReport: {
      status: "partial",
      missingFields: ["productDetailError"],
      optionalMissingFields: [],
    },
  };
}

function buildNormalizedFailedProduct(product, error) {
  const errorInfo = {
    href: product.href,
    name: product.name || "",
    message: error?.message || String(error),
    nameOfError: error?.name || "Error",
  };
  const title = firstNonEmpty(product.name);
  const normalizedDetail = {
    title,
    brand: firstNonEmpty(
      getBrandFromCommaName(title),
      getBrandFromCommaName(product.imageAlt),
      product.imageAlt
    ),
    productCode: "",
    price: firstNonEmpty(product.price),
    status: normalizeAvailabilityStatus({
      listStatus: product.status,
      textSources: [product.rawText, title],
    }),
    mainImage: "",
    listImageUrl: "",
    galleryImages: [],
    imageMatchStatus: "missing",
    imageMatchNotes: "详情采集失败，未进行图片匹配校验。",
    qualityWarnings: ["imageMissing"],
    specsText: [],
    sourceUrl: firstNonEmpty(product.href),
    rawText: "",
    description: "",
    productDetailText: "",
    conditionType: "unknown",
    smokedStatus: "unknown",
    conditionLabel: "状态待确认",
    conditionRawText: [],
    conditionNotes: "单条商品详情采集失败，未获得足够文本证据判断成色。",
    conditionSource: "unknown",
    estateStatus: null,
    estateRatingStars: null,
    estateRatingLabel: "",
    estateRatingNotes: "未识别 Danish Estate 星级成色。",
  };
  const stableFieldReport = {
    status: "partial",
    missingFields: ["productDetailError"],
    optionalMissingFields: [],
  };

  return normalizeProductOutput({
    product,
    normalizedDetail,
    stableFieldReport,
    extra: {
      error: errorInfo,
    },
  });
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read JSON file ${filePath}: ${error?.message || error}`);
    return fallback;
  }
}

function getPayloadProducts(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload?.products) ? payload.products : [];
}

function getProductHref(product) {
  return firstNonEmpty(
    product?.href,
    product?.sourceUrl,
    product?.originalUrl,
    product?.error?.href
  );
}

function normalizeHrefForSet(href) {
  const value = normalizeText(href);

  if (!value) {
    return "";
  }

  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

function getProductErrors(products) {
  return products
    .map((product) => product?.error)
    .filter(Boolean);
}

function summarizeErrorReasons(errors) {
  return errors.reduce((acc, error) => {
    const key = normalizeText(error?.nameOfError || error?.message || "Unknown error");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}


function buildListOutputPayload({
  products,
  collectedAt,
  completedAt = "",
}) {
  const invalidLinkCount = products.filter(
    (product) =>
      !/\/d\/(?:-zh\/)?.*-i\d+\.html(?:[?#].*)?$/i.test(
        product.href || ""
      )
  ).length;

  const dedupedCount = new Set(
    products.map((product) => product.href)
  ).size;

  const report = {
    ...lastListIntegrityReport,
  };

  let integrityFailureReason =
    normalizeText(report.integrityFailureReason);

  if (!integrityFailureReason && invalidLinkCount > 0) {
    integrityFailureReason = "invalid-product-links";
  }

  if (
    !integrityFailureReason &&
    dedupedCount !== products.length
  ) {
    integrityFailureReason = "duplicate-product-links";
  }

  const integrityGate = Boolean(
    report.integrityGate &&
    invalidLinkCount === 0 &&
    dedupedCount === products.length &&
    products.length > 0
  );

  return {
    source: "The Danish Pipe Shop",
    collectorVersion: "v18",
    startUrl,
    collectedAt,
    completedAt,
    targetCount,
    totalCount: products.length,
    dedupedCount,
    invalidLinkCount,
    ...report,
    integrityGate,
    integrityFailureReason,
    products,
  };
}

function buildErrorsPayload({ errors, collectedAt, completedAt = "" }) {
  return {
    source: "The Danish Pipe Shop",
    startUrl,
    collectedAt,
    completedAt,
    failCount: errors.length,
    errorSummary: summarizeErrorReasons(errors),
    errors,
  };
}

function buildOutputPayload({ discoveredProducts, products, errors, collectedAt, completedAt = "" }) {
  const failCount = errors.length;
  const successCount = products.length - failCount;

  return {
    source: "The Danish Pipe Shop",
    startUrl,
    collectedAt,
    completedAt,
    targetCount,
    discoveredCount: discoveredProducts.length,
    successCount,
    failCount,
    products,
    errors,
  };
}

function writeCollectorOutput(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}


function writeListOutput({ products, collectedAt }) {
  const payload = buildListOutputPayload({
    products,
    collectedAt,
    completedAt: new Date().toISOString(),
  });

  writeCollectorOutput(listOutputPath, payload);

  console.log(
    "List output written: " + listOutputPath
  );

  console.log(
    "list total=" +
    payload.totalCount +
    ", deduped=" +
    payload.dedupedCount +
    ", invalid=" +
    payload.invalidLinkCount +
    ", detectedTotal=" +
    (payload.detectedTotalCount || "unknown") +
    ", integrityGate=" +
    payload.integrityGate
  );

  if (!payload.integrityGate) {
    const error = new Error(
      "Danish V18 list integrity gate failed: " +
      (
        payload.integrityFailureReason ||
        "unknown integrity failure"
      )
    );

    error.exitCode = 2;
    throw error;
  }
}

function writeErrorOutput({ errors, collectedAt }) {
  const payload = buildErrorsPayload({
    errors,
    collectedAt,
    completedAt: new Date().toISOString(),
  });

  writeCollectorOutput(errorsOutputPath, payload);
  console.log(`Errors output written: ${errorsOutputPath}`);
}

function writeDetailsOutput({ discoveredProducts, products, errors, collectedAt, checkpoint = false }) {
  const payload = buildOutputPayload({
    discoveredProducts,
    products,
    errors,
    collectedAt,
    completedAt: new Date().toISOString(),
  });

  if (checkpoint) {
    payload.checkpoint = true;
    payload.checkpointAt = new Date().toISOString();
  }

  writeCollectorOutput(outputPath, payload);
  writeErrorOutput({ errors, collectedAt });
  return payload;
}

function writeCheckpoint({ discoveredProducts, products, errors, collectedAt }) {
  const payload = buildOutputPayload({
    discoveredProducts,
    products,
    errors,
    collectedAt,
    completedAt: new Date().toISOString(),
  });

  payload.checkpoint = true;
  payload.checkpointAt = new Date().toISOString();
  writeCollectorOutput(partialOutputPath, payload);
  console.log("Checkpoint written: " + partialOutputPath);
  collectorLog("checkpoint-written", { path: partialOutputPath, successCount: payload.successCount, failCount: payload.failCount });
}

async function main() {
  ensureDir(path.dirname(outputPath));
  ensureDir(path.dirname(listOutputPath));
  ensureDir(path.dirname(errorsOutputPath));
  ensureDir(screenshotDir);
  ensureDir(browserProfilePath);

  if (!["full", "list", "details"].includes(collectorMode)) {
    throw new Error(`Unsupported DANISH_MODE: ${collectorMode}. Use full, list, or details.`);
  }
  if (!["full", "incremental"].includes(detailMode)) {
    throw new Error(`Unsupported DANISH_DETAIL_MODE: ${detailMode}. Use full or incremental.`);
  }
  if (collectorMode === "details" && detailMode === "incremental" && !detailQueuePath) {
    throw new Error("DANISH_DETAIL_MODE=incremental requires DANISH_DETAIL_QUEUE_PATH; refusing full-detail fallback.");
  }

  console.log("Danish full collector v18 parameters:");
  console.log(`DANISH_MODE=${collectorMode}`);
  console.log(`DANISH_DETAIL_MODE=${detailMode}`);
  console.log(`SCRAPER_PROXY=${scraperProxy ? "enabled" : "disabled"}`);
  console.log(`DANISH_START_URL=${startUrl}`);
  console.log(`DANISH_TARGET_COUNT=${targetCount}`);
  console.log(`DANISH_MAX_LIST_PAGES=${maxListPages}`);
  console.log(`DANISH_MAX_LOAD_MORE_CLICKS=${maxLoadMoreClicks}`);
  console.log(`DANISH_LOAD_MORE_DELAY_MS=${loadMoreDelayMs}`);
  console.log(`DANISH_SHOW_MORE_RETRIES=${showMoreRetries}`);
  console.log(`DANISH_PAGE_READY_TIMEOUT_MS=${pageReadyTimeoutMs}`);
  console.log(`DANISH_LANGUAGE_FALLBACK_SECONDS=${languageFallbackSeconds}`);
  console.log(`DANISH_MANUAL_VERIFICATION_TIMEOUT_SECONDS=${manualVerificationTimeoutSeconds}`);
  console.log(`DANISH_MANUAL_VERIFICATION_POLL_MS=${manualVerificationPollMs}`);
  console.log(`DANISH_MIN_EXPECTED_COUNT=${minimumExpectedCount}`);
  console.log(`DANISH_DETAIL_DELAY_MS=${fixedDetailDelayMs || "random"}`);
  console.log(`DANISH_DETAIL_MIN_DELAY_MS=${minDetailDelayMs}`);
  console.log(`DANISH_DETAIL_MAX_DELAY_MS=${maxDetailDelayMs}`);
  console.log(`DANISH_LIST_OUTPUT=${listOutputPath}`);
  console.log(`DANISH_OUTPUT=${outputPath}`);
  console.log(`DANISH_ERRORS_OUTPUT=${errorsOutputPath}`);
  console.log(`DANISH_DETAIL_QUEUE_PATH=${detailQueuePath || "none"}`);
  console.log(`DANISH_SAVE_SCREENSHOTS=${saveScreenshots ? "1" : "0"}`);
  console.log(`DANISH_CHECKPOINT_EVERY=${checkpointEvery}`);
  console.log(`DANISH_PARTIAL_OUTPUT=${partialOutputPath}`);
  console.log(`DANISH_BROWSER_PROFILE=${browserProfilePath}`);

  const executablePath = getLocalBrowserExecutablePath();
  collectorLog("browser-launch-start", { browserProfilePath, executablePath: executablePath || "playwright-default" });
  const context = await chromium.launchPersistentContext(
    browserProfilePath,
    {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      ...(executablePath ? { executablePath } : {}),
      ...(scraperProxy ? { proxy: { server: scraperProxy } } : {}),
    }
  );
  collectorLog("browser-launch-complete", { browserProfilePath });

  const collectedAt = new Date().toISOString();

  try {
    let discoveredProducts = [];

    if (collectorMode === "details") {
      if (detailQueuePath) {
        const queuePayload = readJsonIfExists(detailQueuePath);
        discoveredProducts = getQueuedProducts(queuePayload).slice(0, targetCount);
        console.log(`Loaded ${discoveredProducts.length} queued detail links from: ${detailQueuePath}`);
      } else {
        const listPayload = readJsonIfExists(listOutputPath);
        discoveredProducts = getPayloadProducts(listPayload).slice(0, targetCount);
        console.log(`Loaded ${discoveredProducts.length} product links from: ${listOutputPath}`);
      }

      if (discoveredProducts.length === 0) {
        throw new Error("No product links found in DANISH_LIST_OUTPUT.");
      }
    } else {
      discoveredProducts = await discoverProducts(context);
      console.log(`Discovery complete: ${discoveredProducts.length} links.`);
      writeListOutput({ products: discoveredProducts, collectedAt });

      if (collectorMode === "list") {
        collectorLog("collector-complete", { mode: collectorMode, listCount: discoveredProducts.length });
        return;
      }
    }

    const previousPayload = readJsonIfExists(outputPath);
    const products = getPayloadProducts(previousPayload);
    const processedHrefs = new Set(
      products
        .map(getProductHref)
        .map(normalizeHrefForSet)
        .filter(Boolean)
    );
    const errors = getProductErrors(products);
    let processedThisRun = 0;

    collectorLog("details-resume-state", { existingDetails: products.length, discoveredProducts: discoveredProducts.length });
    collectorLog("details-collection-start", { pendingDetails: discoveredProducts.filter((product) => !processedHrefs.has(normalizeHrefForSet(product.href))).length });
    if (products.length > 0) {
      console.log(`Resume enabled: ${products.length} existing detail records loaded.`);
    }

    for (let index = 0; index < discoveredProducts.length; index++) {
      const product = discoveredProducts[index];
      const normalizedHref = normalizeHrefForSet(product.href);

      if (processedHrefs.has(normalizedHref)) {
        console.log(`Skipping already collected detail ${index + 1}: ${product.name || product.href}`);
        continue;
      }

      try {
        const detail = await collectDetail(context, product, index);
        products.push(detail);
        processedHrefs.add(normalizedHref);
      } catch (error) {
        console.error(`Detail failed, continuing: ${product.href}`);
        console.error(error);

        const failedProduct = buildNormalizedFailedProduct(product, error);
        products.push(failedProduct);
        processedHrefs.add(normalizedHref);
        errors.push(failedProduct.error);
      }

      processedThisRun++;

      if (checkpointEvery > 0 && processedThisRun % checkpointEvery === 0) {
        const checkpointPayload = writeDetailsOutput({
          discoveredProducts,
          products,
          errors,
          collectedAt,
          checkpoint: true,
        });
        writeCheckpoint({ discoveredProducts, products, errors, collectedAt });
        console.log(
          `Checkpoint saved after ${processedThisRun} new records: successCount=${checkpointPayload.successCount}, failCount=${checkpointPayload.failCount}`
        );
      }

      const hasMorePending = discoveredProducts
        .slice(index + 1)
        .some((nextProduct) => !processedHrefs.has(normalizeHrefForSet(nextProduct.href)));

      if (hasMorePending) {
        const delayMs = getRandomDelayMs(minDetailDelayMs, maxDetailDelayMs);

        if (delayMs > 0) {
          console.log(`Waiting ${delayMs}ms before next detail.`);
          await sleep(delayMs);
        }
      }
    }

    const payload = writeDetailsOutput({
      discoveredProducts,
      products,
      errors,
      collectedAt,
    });

    console.log(`v18 output written: ${outputPath}`);
    console.log(`successCount=${payload.successCount}`);
    console.log(`failCount=${payload.failCount}`);
    collectorLog("collector-complete", { mode: collectorMode, successCount: payload.successCount, failCount: payload.failCount, outputPath });
  } finally {
    await context.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Danish full collector v18 failed:", error);
    process.exit(
      Number.isFinite(Number(error?.exitCode))
        ? Number(error.exitCode)
        : 1
    );
  });
}
