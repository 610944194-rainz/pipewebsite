import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const inputPath = path.join(process.cwd(), "data", "danish-sample.json");
const outputPath = path.join(process.cwd(), "data", "danish-detail-sample.json");
const screenshotDir = path.join(process.cwd(), "data", "danish-detail-screenshots");

// 先测前 5 条；确认稳定后再改成 48
const DETAIL_LIMIT = 48;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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

async function getSpecsText(tab) {
  return await tab.evaluate(() => {
    function normalize(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    return Array.from(
      document.querySelectorAll("table, dl, ul, .specs, .product-info, .product-data")
    )
      .map((element) => normalize(element.innerText))
      .filter((text) => text.length > 10)
      .slice(0, 10);
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

  const userDataDir = path.join(process.cwd(), ".browser", "danish-profile");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  const bootstrapTab = context.pages()[0] ?? (await context.newPage());

  console.log("");
  console.log("准备打开 Danish 详情页采集 v15。");
  console.log("这版直接请求 enlargemedia，并解析 data-nn5-imageinfo。");
  console.log("");

  await bootstrapTab.goto("https://www.danishpipeshop.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const rl = readline.createInterface({ input, output });
  await rl.question("如果已完成 Cookie / 年龄 / robot 确认，请按 Enter 开始：");
  rl.close();

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

    const robotDetected = await tab.evaluate(() => {
      const text = document.body.innerText.toLowerCase();

      return (
        text.includes("i am not a robot") ||
        text.includes("confirm that you are not a robot") ||
        text.includes("not a robot")
      );
    });

    if (robotDetected) {
      console.log("检测到 robot 验证页。脚本不会绕过验证。请你手动通过后重新运行。");
      await tab.close();
      break;
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

    const detailBodyTextStart = await tab.evaluate(() => {
      return document.body.innerText.slice(0, 2500);
    });

    const detailPageTitle = await tab.title();

    enrichedProducts.push({
      ...product,
      detailPageTitle,
      detailImageUrl: mainImage,
      detailGalleryImages: galleryImages,
      detailSpecsText: specsText,
      detailBodyTextStart,
      detailPageUrl: product.href,
      detailImageDebug: {
        version: "v15",
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
        href: item.href,
      }))
    );
  }

  await context.close();
}

main().catch((error) => {
  console.error("详情页采集失败：", error);
  process.exit(1);
});