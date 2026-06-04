import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parsePipeCondition } from "./collect-danish-details-v16.mjs";

const defaultStartUrl = "https://www.danishpipeshop.com/l/-zh/Pipes1";
const defaultOutputPath = path.join(process.cwd(), "data", "danish-full-v17-output.json");
const screenshotDir = path.join(process.cwd(), "data", "debug", "danish-full-v17-screenshots");

const startUrl = normalizeText(process.env.DANISH_START_URL) || defaultStartUrl;
const targetCount = readIntegerEnv("DANISH_TARGET_COUNT", 50, { min: 1 });
const maxListPages = readIntegerEnv("DANISH_MAX_LIST_PAGES", 20, { min: 1 });
const detailDelayMs = readIntegerEnv("DANISH_DETAIL_DELAY_MS", 1200, { min: 0 });
const outputPath = resolveOutputPath(process.env.DANISH_OUTPUT, defaultOutputPath);
const scraperProxy = normalizeText(process.env.SCRAPER_PROXY);

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

function normalizeProductOutput({ product, normalizedDetail, stableFieldReport, extra = {} }) {
  const galleryImages = Array.isArray(normalizedDetail.galleryImages)
    ? normalizedDetail.galleryImages
    : [];

  return {
    ...product,
    name: firstNonEmpty(normalizedDetail.title, product.name),
    brand: normalizedDetail.brand,
    productCode: normalizeText(normalizedDetail.productCode),
    price: normalizedDetail.price,
    status: normalizedDetail.status,
    href: firstNonEmpty(product.href, normalizedDetail.sourceUrl),
    imageUrl: firstNonEmpty(product.imageUrl, normalizedDetail.mainImage, galleryImages[0]),
    detailImageUrl: firstNonEmpty(normalizedDetail.mainImage, galleryImages[0]),
    galleryImages,
    galleryCount: galleryImages.length,
    specsText: normalizedDetail.specsText || [],
    conditionType: normalizedDetail.conditionType,
    smokedStatus: normalizedDetail.smokedStatus,
    conditionLabel: normalizedDetail.conditionLabel,
    conditionSource: normalizedDetail.conditionSource,
    conditionNotes: normalizedDetail.conditionNotes,
    missingFields: stableFieldReport.missingFields,
    optionalMissingFields: stableFieldReport.optionalMissingFields,
    v17: normalizedDetail,
    stableFieldReport,
    ...extra,
  };
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

  for (const url of urls) {
    if (!url || isBadImageUrl(url) || !isDanishImageUrl(url)) {
      continue;
    }

    const id = getImageId(url);

    if (!id || groups.has(id)) {
      continue;
    }

    groups.set(id, url);
  }

  return Array.from(groups.values());
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

async function getPageImageCandidates(tab) {
  return await tab.evaluate(() => {
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

    const candidates = [];
    const images = Array.from(document.querySelectorAll("img"));

    for (const img of images) {
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

      const rect = getRect(img);
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
      imageId: getImageId(candidate.url),
      ratio: getRatioFromUrl(candidate.url),
      productMatch: textMatchesProduct([candidate.url, candidate.alt].join(" "), productName),
    }))
    .filter((candidate) => candidate.imageId)
    .sort((a, b) => {
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
  return await tab.evaluate(() => {
    const text = [
      document.title || "",
      document.body?.innerText || "",
    ].join("\n").toLowerCase();

    return (
      text.includes("i am not a robot") ||
      text.includes("confirm that you are not a robot") ||
      text.includes("not a robot") ||
      text.includes("verification") ||
      text.includes("verify you are human") ||
      text.includes("checking your browser") ||
      text.includes("captcha")
    );
  });
}

async function isRobotVerificationPage(tab) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await evaluateRobotVerificationPage(tab);
    } catch (error) {
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

async function waitForManualVerification() {
  const terminal = createInterface({ input, output });

  try {
    await terminal.question("Please complete verification in the browser, then press Enter here to continue.");
  } finally {
    terminal.close();
  }
}

async function ensureManualVerificationIfNeeded(tab) {
  if (!(await isRobotVerificationPage(tab))) {
    return true;
  }

  console.log("Detected robot / verification page. This script will not bypass or auto-click verification.");
  await waitForManualVerification();
  await tab.reload({
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await tab.waitForTimeout(2200);

  if (await isRobotVerificationPage(tab)) {
    console.warn("Robot / verification page remained after manual verification.");
    return false;
  }

  return true;
}

async function discoverProductLinks(tab, listUrl, pageIndex) {
  await tab.goto(listUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await tab.waitForTimeout(1800);

  if (!(await ensureManualVerificationIfNeeded(tab))) {
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
      .filter((item) => /\/d\/-zh\/.*-i\d+\.html(?:[?#].*)?$/i.test(item.href));

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

      if (href && !/\/d\/-zh\/.*-i\d+\.html/i.test(href)) {
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
  let currentListUrl = startUrl;

  try {
    for (let pageIndex = 1; pageIndex <= maxListPages && currentListUrl; pageIndex++) {
      const normalizedListUrl = new URL(currentListUrl).href;

      if (visitedListUrls.has(normalizedListUrl)) {
        break;
      }

      visitedListUrls.add(normalizedListUrl);
      console.log(`Scanning list page ${pageIndex}/${maxListPages}: ${normalizedListUrl}`);

      const pageProducts = await discoverProductLinks(tab, normalizedListUrl, pageIndex);

      for (const item of pageProducts) {
        const normalizedProductUrl = new URL(item.href).href;

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

      console.log(`Discovered ${discovered.length}/${targetCount} product links.`);

      if (discovered.length >= targetCount) {
        break;
      }

      currentListUrl = await findNextListPageUrl(tab, normalizedListUrl, visitedListUrls);

      if (!currentListUrl) {
        console.log("No next list page found; stopping discovery.");
      }
    }
  } finally {
    await tab.close().catch(() => {});
  }

  return discovered.slice(0, targetCount);
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

    if (!(await ensureManualVerificationIfNeeded(tab))) {
      throw new Error("Robot / verification page remained during detail collection.");
    }

    const candidates = await getPageImageCandidates(tab);
    const payloads = prepareCandidatePayloads(candidates, product.name);
    const enlargeResults = [];

    for (const payload of payloads) {
      try {
        enlargeResults.push(await fetchEnlargeMedia(tab, payload));
      } catch {
        // ignore a single image payload failure
      }
    }

    const bestResult = chooseBestEnlargeResult(enlargeResults, product.name);
    let galleryImages = [];
    let galleryImageInfos = [];

    if (bestResult) {
      galleryImageInfos = bestResult.imageInfos;
      galleryImages = uniqueByImageId(
        galleryImageInfos
          .map((info) => imageInfoToUrl(info, 500))
          .filter(Boolean)
      );
    }

    if (galleryImages.length === 0) {
      const fallbackImages = candidates
        .map((candidate) => candidate.url)
        .filter(isDanishImageUrl)
        .filter((url) => !isBadImageUrl(url));

      galleryImages = uniqueByImageId(fallbackImages).slice(0, 1);
    }

    const screenshotPath = path.join(screenshotDir, `detail-${index + 1}.png`);
    await tab.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const specsText = await getSpecsText(tab);
    const detailFields = await getDetailFields(tab, product);
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
    const title = firstNonEmpty(detailFields.title, product.name);
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

    const normalizedDetail = {
      title,
      brand,
      productCode,
      price: firstNonEmpty(detailFields.price, product.price),
      status,
      mainImage: firstNonEmpty(galleryImages[0], detailFields.mainImage),
      galleryImages,
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
        version: "v17",
        candidatePayloads: payloads,
        enlargeResultCount: enlargeResults.length,
        bestCandidateImageId: bestResult?.candidateImageId || 0,
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

async function main() {
  ensureDir(path.dirname(outputPath));
  ensureDir(screenshotDir);

  console.log("Danish full collector v17 parameters:");
  console.log(`SCRAPER_PROXY=${scraperProxy ? "enabled" : "disabled"}`);
  console.log(`DANISH_START_URL=${startUrl}`);
  console.log(`DANISH_TARGET_COUNT=${targetCount}`);
  console.log(`DANISH_MAX_LIST_PAGES=${maxListPages}`);
  console.log(`DANISH_DETAIL_DELAY_MS=${detailDelayMs}`);
  console.log(`DANISH_OUTPUT=${outputPath}`);

  const executablePath = getLocalBrowserExecutablePath();
  const context = await chromium.launchPersistentContext(
    path.join(process.cwd(), "data", "debug", "danish-profile-v17"),
    {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      ...(executablePath ? { executablePath } : {}),
      ...(scraperProxy ? { proxy: { server: scraperProxy } } : {}),
    }
  );

  const products = [];
  const errors = [];
  const collectedAt = new Date().toISOString();

  try {
    const discoveredProducts = await discoverProducts(context);
    console.log(`Discovery complete: ${discoveredProducts.length} links.`);

    for (let index = 0; index < discoveredProducts.length; index++) {
      const product = discoveredProducts[index];

      try {
        const detail = await collectDetail(context, product, index);
        products.push(detail);
      } catch (error) {
        console.error(`Detail failed, continuing: ${product.href}`);
        console.error(error);

        const failedProduct = buildNormalizedFailedProduct(product, error);
        products.push(failedProduct);
        errors.push(failedProduct.error);
      }

      if (detailDelayMs > 0 && index < discoveredProducts.length - 1) {
        await sleep(detailDelayMs);
      }
    }

    const failCount = errors.length;
    const successCount = products.length - failCount;
    const payload = {
      source: "The Danish Pipe Shop",
      startUrl,
      collectedAt,
      completedAt: new Date().toISOString(),
      targetCount,
      discoveredCount: discoveredProducts.length,
      successCount,
      failCount,
      products,
      errors,
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");

    console.log(`v17 output written: ${outputPath}`);
    console.log(`successCount=${successCount}`);
    console.log(`failCount=${failCount}`);
  } finally {
    await context.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Danish full collector v17 failed:", error);
    process.exit(1);
  });
}
