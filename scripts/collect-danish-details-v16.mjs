import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const inputPath = path.join(process.cwd(), "data", "danish-sample.json");
const outputPath = path.join(process.cwd(), "data", "danish-details-v16-sample.json");
const screenshotDir = path.join(process.cwd(), "data", "debug", "danish-detail-v16-screenshots");

// v16 只做 5 条详情页字段测试，不覆盖正式详情样本。
const DETAIL_LIMIT = 5;
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

export function parsePipeCondition(textSources) {
  const sources = (Array.isArray(textSources) ? textSources : [textSources])
    .map((source) => {
      if (typeof source === "string") {
        return {
          source: "text",
          text: source,
        };
      }

      return {
        source: normalizeText(source?.source || "text"),
        text: normalizeText(source?.text || ""),
      };
    })
    .filter((source) => source.text);

  const keywordMatchers = [
    {
      key: "brandNewEstatePipe",
      label: "brand new estate pipes",
      regex: /\bbrand\s+new\s+estate\s+pipes?\b/i,
    },
    { key: "brandNewPipe", label: "brand new pipe", regex: /\bbrand\s+new\s+pipes?\b/i },
    { key: "estatePipe", label: "estate pipe", regex: /\bestate\s+pipe\b/i },
    { key: "estate", label: "Estate", regex: /\bestate\b/i },
    { key: "presmoked", label: "Presmoked", regex: /\bpresmoked\b/i },
    { key: "preSmoked", label: "pre-smoked", regex: /\bpre[-\s]smoked\b/i },
    { key: "unsmoked", label: "unsmoked", regex: /\bunsmoked\b/i },
    { key: "newPipe", label: "new pipe", regex: /\bnew\s+pipes?\b/i },
    { key: "newInnerCoating", label: "new inner coating", regex: /\bnew\s+inner\s+coating\b/i },
    { key: "newHome", label: "new home", regex: /\bnew\s+home\b/i },
    { key: "asNew", label: "as new", regex: /\bas\s+new\b/i },
    { key: "veryGoodCondition", label: "very good condition", regex: /\bvery\s+good\s+condition\b/i },
    { key: "goodCondition", label: "good condition", regex: /\bgood\s+condition\b/i },
    { key: "normalCondition", label: "normal condition", regex: /\bnormal\s+condition\b/i },
    { key: "acceptableCondition", label: "acceptable condition", regex: /\bacceptable\s+condition\b/i },
    { key: "condition", label: "condition", regex: /\bcondition\b/i },
    { key: "restored", label: "restored", regex: /\brestored\b/i },
    { key: "refurbished", label: "refurbished", regex: /\brefurbished\b/i },
    { key: "excellent", label: "excellent", regex: /\bexcellent\b/i },
    { key: "smoked", label: "smoked", regex: /\bsmoked\b/i },
  ];

  const matches = [];

  for (const matcher of keywordMatchers) {
    for (const source of sources) {
      if (matcher.regex.test(source.text)) {
        matches.push({
          key: matcher.key,
          label: matcher.label,
          source: source.source,
        });
        break;
      }
    }
  }

  const hasKeyword = (key) => matches.some((match) => match.key === key);
  const matchedLabels = Array.from(new Set(matches.map((match) => match.label)));

  const ratingLabels = {
    1: "1 星可接受成色",
    2: "2 星普通成色",
    3: "3 星良好成色",
    4: "4 星非常好成色",
    5: "5 星近似全新",
  };

  function findEstateRating() {
    const ratingMatches = [];

    function addRating(stars, rawText) {
      if (!stars || stars < 1 || stars > 5) {
        return;
      }

      ratingMatches.push({
        stars,
        rawText,
      });
    }

    for (const source of sources) {
      const text = source.text;
      const trimmed = text.trim();

      if (/\bas\s+new\b/i.test(text)) {
        addRating(5, "as new");
      }

      if (/\bvery\s+good\s+condition\b/i.test(text)) {
        addRating(4, "very good condition");
      } else if (/\bgood\s+condition\b/i.test(text)) {
        addRating(3, "good condition");
      }

      if (/\bnormal\s+condition\b/i.test(text)) {
        addRating(2, "normal condition");
      }

      if (/\bacceptable\s+condition\b/i.test(text)) {
        addRating(1, "acceptable condition");
      }

      const digitStarMatch =
        text.match(/\b([1-5])\s*(?:stars?|star\s+rating|rating)\b/i) ||
        text.match(/\brating\s*[:：]?\s*([1-5])\b/i);

      if (digitStarMatch) {
        addRating(Number(digitStarMatch[1]), digitStarMatch[0]);
      }

      const exactDigitMatch = trimmed.match(/^[1-5]$/);

      if (exactDigitMatch) {
        addRating(Number(exactDigitMatch[0]), exactDigitMatch[0]);
      }

      const starTextMatch =
        trimmed.match(/^\*{1,5}$/) ||
        text.match(/(?:rating|condition)\s*[:：]?\s*(\*{1,5})(?=\s|$)/i);

      if (starTextMatch) {
        const rawStars = starTextMatch[1] || starTextMatch[0];
        addRating(rawStars.length, rawStars);
      }
    }

    if (ratingMatches.length === 0) {
      return {
        estateRatingStars: null,
        estateRatingLabel: "",
        estateRatingNotes: "未识别 Danish Estate 星级成色。",
        estateRatingRawText: "",
      };
    }

    const bestRating = ratingMatches.sort((a, b) => b.stars - a.stars)[0];

    return {
      estateRatingStars: bestRating.stars,
      estateRatingLabel: ratingLabels[bestRating.stars],
      estateRatingNotes: `命中 Danish Estate rating：${bestRating.rawText}，按 ${ratingLabels[bestRating.stars]} 记录。`,
      estateRatingRawText: bestRating.rawText,
    };
  }

  function buildResult({
    conditionType,
    smokedStatus,
    conditionLabel,
    conditionNotes,
    estateStatus,
    conditionSource,
  }) {
    const rating = findEstateRating();
    const { estateRatingRawText, ...ratingFields } = rating;
    const conditionRawText = Array.from(
      new Set([...matchedLabels, estateRatingRawText].filter(Boolean))
    );

    return {
      conditionType,
      smokedStatus,
      conditionLabel,
      conditionRawText,
      conditionNotes,
      estateStatus,
      conditionSource,
      ...ratingFields,
    };
  }

  const hasFocusedKeyword = (key) => {
    return matches.some((match) => {
      if (match.key !== key) {
        return false;
      }

      const loweredSource = String(match.source || "").toLowerCase();
      return !loweredSource.includes("rawtext") && !loweredSource.includes("visible");
    });
  };

  const hasBrandNewEstatePipe = hasKeyword("brandNewEstatePipe");
  const hasEstate = hasKeyword("estate") || hasKeyword("estatePipe") || hasBrandNewEstatePipe;
  const hasPresmoked = hasKeyword("presmoked") || hasKeyword("preSmoked");
  const hasUnsmoked = hasKeyword("unsmoked");
  const hasSmoked = hasKeyword("smoked") && !hasPresmoked && !hasUnsmoked;
  const hasExplicitNewPipe =
    (hasFocusedKeyword("newPipe") || hasFocusedKeyword("brandNewPipe")) &&
    !hasKeyword("newInnerCoating") &&
    !hasKeyword("newHome") &&
    !hasBrandNewEstatePipe;
  const hasEstateUnsmoked = hasUnsmoked || hasBrandNewEstatePipe;
  const estateRating = findEstateRating();
  const hasEstateRating = estateRating.estateRatingStars !== null;
  const hasNormalPipesCategory = sources.some((source) => {
    const text = source.text.replace(/\\/g, "/");
    return /\/l\/[^/\s]+\/pipes1(?:[/?#\s]|$)/i.test(text);
  });
  const hasConditionEvidence =
    hasEstate ||
    hasPresmoked ||
    hasUnsmoked ||
    hasSmoked ||
    hasEstateRating ||
    hasKeyword("asNew") ||
    hasKeyword("restored") ||
    hasKeyword("refurbished") ||
    hasKeyword("excellent") ||
    hasKeyword("veryGoodCondition") ||
    hasKeyword("goodCondition") ||
    hasKeyword("normalCondition") ||
    hasKeyword("acceptableCondition");

  if (hasEstate && hasEstateUnsmoked) {
    return buildResult({
      conditionType: "estate",
      smokedStatus: "unsmoked",
      conditionLabel: "Estate 未使用",
      conditionNotes: "命中 Estate 与 Unsmoked，按规则判断为 Estate 未使用；仍建议人工核对原站状态。",
      estateStatus: "unsmoked",
      conditionSource: "explicit",
    });
  }

  if (hasEstate && (hasPresmoked || hasSmoked)) {
    return buildResult({
      conditionType: "estate",
      smokedStatus: "preSmoked",
      conditionLabel: "Estate 已使用",
      conditionNotes: "命中 Estate 与 Presmoked / Smoked，按 Danish 说明判断为 Estate 已使用。",
      estateStatus: "presmoked",
      conditionSource: "explicit",
    });
  }

  if (hasEstate) {
    return buildResult({
      conditionType: "estate",
      smokedStatus: "unknown",
      conditionLabel: "Estate 二手斗",
      conditionNotes:
        "命中 Estate，但未稳定命中 Presmoked 或 Unsmoked；保留为 Estate 二手斗，使用状态待人工确认。",
      estateStatus: "unknown",
      conditionSource: "explicit",
    });
  }

  if (hasExplicitNewPipe) {
    return buildResult({
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionNotes: "明确命中 New pipe / Brand new pipe 且未命中 Estate，按普通新斗记录。",
      estateStatus: null,
      conditionSource: "explicit",
    });
  }

  if (hasUnsmoked) {
    return buildResult({
      conditionType: "unknown",
      smokedStatus: "unsmoked",
      conditionLabel: "未使用，来源待确认",
      conditionNotes: "命中 Unsmoked，但无法确认是否 Estate；保留来源待确认。",
      estateStatus: null,
      conditionSource: "explicit",
    });
  }

  if (hasPresmoked || hasSmoked) {
    return buildResult({
      conditionType: "unknown",
      smokedStatus: "preSmoked",
      conditionLabel: "已使用，来源待确认",
      conditionNotes: "命中 Presmoked / Smoked，但无法确认是否 Estate；保留来源待确认。",
      estateStatus: null,
      conditionSource: "explicit",
    });
  }

  if (hasConditionEvidence) {
    return buildResult({
      conditionType: "unknown",
      smokedStatus: "unknown",
      conditionLabel: "状态待确认",
      conditionNotes:
        "命中星级、成色描述或修复整理词，但证据不足以判断普通新斗、Estate 或是否抽过，保留为待确认。",
      estateStatus: null,
      conditionSource: "explicit",
    });
  }

  if (hasNormalPipesCategory) {
    return buildResult({
      conditionType: "new",
      smokedStatus: "unsmoked",
      conditionLabel: "新斗",
      conditionNotes:
        "按 Danish 普通 Pipes 栏目判断，详情页未见 Estate / Presmoked / Unsmoked / 星级成色标记，购买前仍建议人工确认。",
      estateStatus: null,
      conditionSource: "category",
    });
  }

  return buildResult({
    conditionType: "unknown",
    smokedStatus: "unknown",
    conditionLabel: "状态待确认",
    conditionNotes: matchedLabels.length
      ? "仅命中星级、成色描述或泛化状态词，证据不足以判断普通新斗、Estate 或是否抽过，保留为待确认。"
      : "未命中可稳定判断烟斗成色 / 使用状态的关键词，保留为待确认。",
    estateStatus: null,
    conditionSource: "unknown",
  });
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
    .replace(/['’]/g, "")
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

  // Danish 前端用 floor，不是 round。
  // 例如 638 / 1800 * 500 = 177.2 => h177
  // 1501 / 1800 * 500 = 416.9 => h416
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
      // ignore parse error
    }
  }

  return infos;
}

function scoreEnlargeResult(result, productName) {
  if (!result || !Array.isArray(result.imageInfos)) {
    return -9999;
  }

  let score = 0;

  score += result.imageInfos.length * 10;

  if (result.imageInfos.length >= 2) {
    score += 30;
  }

  for (const info of result.imageInfos) {
    const text = [
      info.name,
      info.title,
      info.alt,
      info.id,
    ].join(" ");

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

    if (!id) {
      continue;
    }

    if (!groups.has(id)) {
      groups.set(id, url);
    }
  }

  return Array.from(groups.values());
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

      const attrs = [
        "src",
        "data-src",
        "data-original",
        "data-lazy",
        "data-full",
        "data-large",
      ];

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

function getCandidateImageId(candidate) {
  return getImageId(candidate.url);
}

function prepareCandidatePayloads(candidates, productName) {
  const usable = candidates
    .filter((candidate) => candidate.url)
    .filter((candidate) => isDanishImageUrl(candidate.url))
    .filter((candidate) => !isBadImageUrl(candidate.url))
    .map((candidate) => ({
      ...candidate,
      imageId: getCandidateImageId(candidate),
      ratio: getRatioFromUrl(candidate.url),
      productMatch: textMatchesProduct(
        [candidate.url, candidate.alt].join(" "),
        productName
      ),
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

    const safeRatio =
      Number.isFinite(item.ratio) && item.ratio > 0
        ? item.ratio
        : 1;

    payloads.push({
      imageId: item.imageId,
      ratio: safeRatio,
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
    // keep raw text
  }

  const imageInfos = parseImageInfosFromEnlargeResponse(responseText);

  return {
    candidateImageId: payload.imageId,
    candidateSourceUrl: payload.sourceUrl,
    querystring,
    ok: result.ok,
    status: result.status,
    imageInfos,
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
        texts.push(
          ...Array.from(element.querySelectorAll("tr"))
            .map(getText)
            .filter(Boolean)
        );
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

      texts.push(
        ...Array.from(element.querySelectorAll("li"))
          .map(getText)
          .filter(Boolean)
      );

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

    const categoryText = firstText([
      ".category",
      ".product-category",
      "[class*='category']",
    ]);

    const titleText = firstText([
      "h1",
      ".product-title",
      ".productname",
      ".product-name",
      "[itemprop='name']",
    ]);

    const descriptionCandidates = [
      ...metaContents([
        "meta[name='description']",
        "meta[property='og:description']",
      ]),
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

    const description = descriptionCandidates[0] || "";

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

    const ogImage = metaContent([
      "meta[property='og:image']",
      "meta[name='twitter:image']",
    ]);

    return {
      title: titleText,
      brand: product.imageAlt ? String(product.imageAlt).split(",")[0] : "",
      price: normalize(priceText),
      status: statusText,
      mainImage: absoluteUrl(ogImage),
      rawText,
      description,
      descriptionCandidates,
      productDetailTextCandidates,
      breadcrumbText,
      categoryText,
      sourceUrl: location.href,
      pageTitle: document.title,
    };
  }, listProduct);
}

function buildStableFieldReport(detail) {
  const requiredFields = [
    "title",
    "brand",
    "price",
    "status",
    "mainImage",
    "galleryImages",
    "specsText",
    "sourceUrl",
    "rawText",
    "description",
    "conditionType",
    "smokedStatus",
    "conditionLabel",
    "conditionNotes",
    "conditionSource",
    "estateStatus",
    "estateRatingNotes",
  ];

  const missingFields = requiredFields.filter((field) => {
    const value = detail[field];

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return !normalizeText(value);
  });

  return {
    status: missingFields.length === 0 ? "complete" : "partial",
    missingFields,
  };
}

async function isRobotVerificationPage(tab) {
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

async function waitForManualVerification() {
  const terminal = createInterface({ input, output });

  try {
    await terminal.question("请在弹出的浏览器中手动完成验证，完成后回到终端按 Enter 继续。");
  } finally {
    terminal.close();
  }
}

async function recordVerificationFailure(enrichedProducts, product, tab) {
  const detailPageTitle = await tab.title().catch(() => "");
  const stableFieldReport = {
    status: "partial",
    missingFields: ["robotVerification"],
  };

  const normalizedDetail = {
    title: firstNonEmpty(product.name),
    brand: firstNonEmpty(product.imageAlt?.split(",")?.[0]),
    price: firstNonEmpty(product.price),
    status: firstNonEmpty(product.status),
    mainImage: firstNonEmpty(product.imageUrl),
    galleryImages: [],
    specsText: [],
    sourceUrl: firstNonEmpty(product.href),
    rawText: "",
    description: firstNonEmpty(product.rawText),
    conditionType: "unknown",
    smokedStatus: "unknown",
    conditionLabel: "状态待确认",
    conditionRawText: [],
    conditionNotes:
      "Robot / verification page remained after manual verification; stopped without bypassing verification.",
    conditionSource: "unknown",
    estateStatus: null,
    estateRatingStars: null,
    estateRatingLabel: "",
    estateRatingNotes: "未识别 Danish Estate 星级成色。",
  };

  enrichedProducts.push({
    ...product,
    v16: normalizedDetail,
    stableFieldReport,
    detailPageTitle,
    detailImageUrl: normalizedDetail.mainImage,
    detailGalleryImages: [],
    detailSpecsText: [],
    detailBodyTextStart: "",
    detailPageUrl: product.href,
    detailImageDebug: {
      version: "v16",
      error: "robotVerification",
    },
  });
}

async function main() {
  ensureDir(screenshotDir);

  if (!fs.existsSync(inputPath)) {
    console.error(`找不到文件：${inputPath}`);
    console.error("请先运行 Danish 列表页采集脚本，生成 data/danish-sample.json");
    process.exit(1);
  }

  const sourceData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const products = sourceData.products.slice(0, DETAIL_LIMIT);

  const userDataDir = path.join(process.cwd(), "data", "debug", "danish-profile-v16");
  const executablePath = getLocalBrowserExecutablePath();
  const scraperProxy = normalizeText(process.env.SCRAPER_PROXY);

  const launchOptions = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    ...(executablePath ? { executablePath } : {}),
    ...(scraperProxy ? { proxy: { server: scraperProxy } } : {}),
  };

  if (scraperProxy) {
    console.log(`Using scraper proxy: ${scraperProxy}`);
  } else {
    console.log("No scraper proxy configured");
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  const bootstrapTab = context.pages()[0] ?? (await context.newPage());

  console.log("");
  console.log("准备打开 Danish 详情页采集 v16。");
  console.log("这版继续请求 enlargemedia，并解析 data-nn5-imageinfo；只测试前 5 条。");
  console.log("");

  await bootstrapTab.goto("https://www.danishpipeshop.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("v16 测试脚本如遇 Cookie / 年龄 / robot / verification 页面，会等待人工处理后继续。");

  const enrichedProducts = [];

  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    const tab = await context.newPage();

    console.log("");
    console.log(`正在抓取 ${index + 1}/${products.length}: ${product.name}`);
    console.log(product.href);

    await tab.goto(product.href, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await tab.waitForTimeout(2200);

    const robotDetected = await isRobotVerificationPage(tab);

    if (robotDetected) {
      console.log("检测到 robot / verification 页面。脚本不会绕过验证，也不会自动点击验证按钮。");
      await waitForManualVerification();
      await tab.reload({
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await tab.waitForTimeout(2200);

      if (await isRobotVerificationPage(tab)) {
        console.error("人工验证后仍检测到 robot / verification 页面，记录错误并停止采集。");
        await recordVerificationFailure(enrichedProducts, product, tab);
        await tab.close();
        break;
      }
    }

    const candidates = await getPageImageCandidates(tab);
    const payloads = prepareCandidatePayloads(candidates, product.name);

    console.log(`候选 imageid 数量：${payloads.length}`);
    console.log("候选 imageid：");
    console.log(payloads.map((item) => item.imageId));

    const enlargeResults = [];

    for (const payload of payloads) {
      try {
        const result = await fetchEnlargeMedia(tab, payload);
        enlargeResults.push(result);
      } catch {
        // ignore single payload error
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

    // 兜底：如果接口没有拿到图，就用页面候选图里最像当前商品的第一张
    if (galleryImages.length === 0) {
      const fallbackImages = candidates
        .map((candidate) => candidate.url)
        .filter(isDanishImageUrl)
        .filter((url) => !isBadImageUrl(url));

      galleryImages = uniqueByImageId(fallbackImages).slice(0, 1);
    }

    const mainImage = galleryImages[0] || "";

    const screenshotPath = path.join(screenshotDir, `detail-${index + 1}.png`);

    await tab.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    const specsText = await getSpecsText(tab);
    const detailFields = await getDetailFields(tab, product);

    const detailBodyTextStart = await tab.evaluate(() => {
      return document.body.innerText.slice(0, 2500);
    });

    const detailPageTitle = await tab.title();
    const description = cleanDescriptionText([
      ...(detailFields.descriptionCandidates || []),
      detailFields.description,
      product.rawText,
    ]);
    const productDetailText = cleanProductDetailText([
      ...(detailFields.productDetailTextCandidates || []),
      description,
      specsText.join("\n"),
    ]);

    const normalizedDetail = {
      title: firstNonEmpty(detailFields.title, product.name),
      brand: firstNonEmpty(detailFields.brand, product.imageAlt?.split(",")?.[0]),
      price: firstNonEmpty(detailFields.price, product.price),
      status: firstNonEmpty(detailFields.status, product.status),
      mainImage: firstNonEmpty(mainImage, detailFields.mainImage, product.imageUrl),
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
        { source: "listPageUrl", text: sourceData.pageUrl },
        { source: "productListPageUrl", text: product.pageUrl || product.listPageUrl || "" },
        { source: "sourceUrl", text: normalizedDetail.sourceUrl },
        { source: "specsText", text: specsText.join("\n") },
        { source: "description", text: normalizedDetail.description },
        { source: "productDetailText", text: normalizedDetail.productDetailText },
      ])
    );

    const stableFieldReport = buildStableFieldReport(normalizedDetail);

    enrichedProducts.push({
      ...product,
      v16: normalizedDetail,
      stableFieldReport,
      detailPageTitle,
      detailImageUrl: normalizedDetail.mainImage,
      detailGalleryImages: galleryImages,
      detailSpecsText: specsText,
      detailBodyTextStart,
      detailPageUrl: product.href,
      detailImageDebug: {
        version: "v16",
        candidatePayloads: payloads,
        enlargeResultCount: enlargeResults.length,
        bestCandidateImageId: bestResult?.candidateImageId || 0,
        bestQuerystring: bestResult?.querystring || "",
        imageInfoCount: galleryImageInfos.length,
        galleryIds: galleryImages.map(getImageId),
        galleryImages,
        imageInfos: galleryImageInfos,
      },
    });

    console.log(`最佳 imageid：${bestResult?.candidateImageId || "未找到"}`);
    console.log(`图库数量：${galleryImages.length}`);
    console.log(`字段状态：${stableFieldReport.status}`);
    console.log(`缺失字段：${stableFieldReport.missingFields.join(", ") || "无"}`);
    console.log(`成色判断：${normalizedDetail.conditionLabel}`);
    console.log(`成色来源：${normalizedDetail.conditionSource}`);
    console.log("成色命中词：");
    console.log(normalizedDetail.conditionRawText);
    console.log("图库编号：");
    console.log(galleryImages.map(getImageId));
    console.log("图库预览：");
    console.log(galleryImages);

    await tab.close();
  }

  await bootstrapTab.close().catch(() => {});

  const payload = {
    source: "The Danish Pipe Shop",
    baseCollectedAt: sourceData.baseCollectedAt || sourceData.collectedAt,
    detailCollectedAt: new Date().toISOString(),
    count: enrichedProducts.length,
    products: enrichedProducts,
    fieldSummary: enrichedProducts.map((item) => ({
      name: item.name,
      sourceUrl: item.href,
      status: item.stableFieldReport.status,
      missingFields: item.stableFieldReport.missingFields,
      conditionType: item.v16?.conditionType || "unknown",
      smokedStatus: item.v16?.smokedStatus || "unknown",
      conditionLabel: item.v16?.conditionLabel || "状态待确认",
      conditionRawText: item.v16?.conditionRawText || [],
      conditionSource: item.v16?.conditionSource || "unknown",
      estateStatus: item.v16?.estateStatus ?? null,
      estateRatingStars: item.v16?.estateRatingStars ?? null,
      estateRatingLabel: item.v16?.estateRatingLabel || "",
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log("");
  console.log(`详情页增强采集完成：${outputPath}`);
  console.log(`采集数量：${enrichedProducts.length}`);
  console.log("");

  if (enrichedProducts.length > 0) {
    console.log("前 5 条预览：");
    console.log(
      enrichedProducts.slice(0, 5).map((item) => ({
        name: item.name,
        price: item.price,
        status: item.status,
        detailImageUrl: item.detailImageUrl,
        galleryCount: item.detailGalleryImages.length,
        galleryIds: item.detailGalleryImages.map(getImageId),
        galleryImages: item.detailGalleryImages,
        conditionType: item.v16.conditionType,
        smokedStatus: item.v16.smokedStatus,
        conditionLabel: item.v16.conditionLabel,
        conditionRawText: item.v16.conditionRawText,
        conditionSource: item.v16.conditionSource,
        estateStatus: item.v16.estateStatus,
        estateRatingStars: item.v16.estateRatingStars,
        estateRatingLabel: item.v16.estateRatingLabel,
        href: item.href,
        missingFields: item.stableFieldReport.missingFields,
      }))
    );
  }

  await context.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
  const failurePayload = {
    source: "The Danish Pipe Shop",
    detailCollectedAt: new Date().toISOString(),
    version: "v16",
    count: 0,
    products: [],
    fieldSummary: [],
    error: {
      message: error?.message || String(error),
      name: error?.name || "Error",
    },
    note:
      "v16 测试脚本已创建，但本次运行未能访问 Danish Pipe Shop；未生成正式商品数据。",
  };

  try {
    fs.writeFileSync(outputPath, JSON.stringify(failurePayload, null, 2), "utf8");
    console.error(`已写入失败样本：${outputPath}`);
  } catch (writeError) {
    console.error("失败样本写入失败：", writeError);
  }

  console.error("详情页采集失败：", error);
    process.exit(1);
  });
}
