import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const startUrl = "https://www.danishpipeshop.com/";

const outputDir = path.join(process.cwd(), "data");
const outputJson = path.join(outputDir, "danish-sample.json");
const outputScreenshot = path.join(outputDir, "danish-screenshot.png");
const outputHtml = path.join(outputDir, "danish-page.html");
const outputDebug = path.join(outputDir, "danish-debug.json");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });

  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

async function main() {
  ensureDir(outputDir);

  const userDataDir = path.join(process.cwd(), ".browser", "danish-profile");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(startUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("");
  console.log("浏览器已经打开 Danish Pipe Shop。");
  console.log("请你手动完成 Cookie / 年龄 / 语言 / robot 确认。");
  console.log("然后进入烟斗列表页，并确认能看到具体商品卡片。");
  console.log("建议手动向下滚动一段，再回到终端按 Enter。");
  console.log("");

  const rl = readline.createInterface({ input, output });
  await rl.question("准备好后按 Enter 开始 Danish 专用提取：");
  rl.close();

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  await scrollPage(page);

  const currentUrl = page.url();
  const title = await page.title();
  const html = await page.content();

  fs.writeFileSync(outputHtml, html, "utf8");

  const robotDetected = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();

    return (
      text.includes("i am not a robot") ||
      text.includes("confirm that you are not a robot") ||
      text.includes("not a robot")
    );
  });

  if (robotDetected) {
    console.log("");
    console.log("检测到当前页面仍然是 robot 验证页。");
    console.log("脚本不会绕过验证，请你手动通过后再运行测试。");
    await page.screenshot({ path: outputScreenshot, fullPage: true });
    await context.close();
    return;
  }

  const result = await page.evaluate(() => {
    function normalize(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    function absoluteUrl(url) {
      if (!url) return "";

      try {
        return new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }

    function getUrlFromSrcset(srcset) {
      if (!srcset) return "";

      const first = srcset.split(",")[0]?.trim();
      if (!first) return "";

      return first.split(/\s+/)[0] || "";
    }

    function getBackgroundUrl(value) {
      if (!value || value === "none") return "";

      const match = value.match(/url\(["']?(.*?)["']?\)/i);
      return match ? match[1] : "";
    }

    function findPrice(text) {
      const patterns = [
        /\$\s?\d[\d.,]*(?:,-)?/i,
        /€\s?\d[\d.,]*(?:,-)?/i,
        /£\s?\d[\d.,]*(?:,-)?/i,
        /DKK\s?\d[\d.,]*(?:,-)?/i,
        /USD\s?\d[\d.,]*(?:,-)?/i,
        /EUR\s?\d[\d.,]*(?:,-)?/i,
        /\d[\d.,]*(?:,-)?\s?(?:\$|€|£|DKK|USD|EUR)/i,
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[0];
      }

      return "";
    }

    function isProductHref(href) {
      return /\/d\/.*i\d+\.html/i.test(href);
    }

    function hrefToName(href) {
      try {
        const file = decodeURIComponent(href.split("/").pop() || "");

        return file
          .replace(/\.html$/i, "")
          .replace(/-i\d+$/i, "")
          .replace(/-/g, " ")
          .trim();
      } catch {
        return "";
      }
    }

    function cleanNameFromText(rawText, href, price) {
      let text = normalize(rawText);

      text = text
        .replace(/^更多信息\s*/i, "")
        .replace(/更多信息/gi, "")
        .replace(/^现在购买\s*/i, "")
        .replace(/现在购买/gi, "")
        .replace(/免欧盟增值税/gi, "")
        .replace(/已售/gi, "")
        .trim();

      if (price && text.includes(price)) {
        text = text.split(price)[0].trim();
      }

      text = text
        .replace(/\s+/g, " ")
        .replace(/^[-–—:：]+/, "")
        .replace(/[-–—:：]+$/, "")
        .trim();

      if (!text || text.length < 3 || text.length > 120) {
        return hrefToName(href);
      }

      return text;
    }

    function findStatus(rawText) {
      if (rawText.includes("已售")) {
        return "已售";
      }

      if (rawText.includes("现在购买")) {
        return "可购买";
      }

      return "需人工确认";
    }

    function isBadText(text) {
      const lowered = text.toLowerCase();

      return (
        lowered.includes("cookie") ||
        lowered.includes("robot") ||
        lowered.includes("facebook") ||
        lowered.includes("instagram") ||
        lowered.includes("语言货币") ||
        lowered.includes("联系我们 登录") ||
        lowered.includes("welcome to") ||
        lowered.includes("please confirm") ||
        lowered.includes("the danish pipe shop since")
      );
    }

    function getRect(element) {
      const rect = element.getBoundingClientRect();

      return {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        centerX: rect.left + window.scrollX + rect.width / 2,
        centerY: rect.top + window.scrollY + rect.height / 2,
      };
    }

    function getContainerCandidates(link) {
      const candidates = [];
      let node = link;

      for (let i = 0; i < 8; i++) {
        node = node.parentElement;
        if (!node) break;

        const text = normalize(node.innerText);
        if (!text) continue;

        const price = findPrice(text);
        const linkCount = node.querySelectorAll("a[href]").length;
        const imageCount = node.querySelectorAll("img").length;

        let score = 0;

        if (text.includes("更多信息")) score += 2;
        if (text.includes("现在购买")) score += 3;
        if (text.includes("已售")) score += 3;
        if (price) score += 4;
        if (imageCount > 0) score += 2;
        if (linkCount <= 8) score += 1;
        if (text.length > 20 && text.length < 500) score += 3;
        if (text.length > 800) score -= 5;
        if (isBadText(text)) score -= 10;

        candidates.push({
          node,
          text,
          price,
          score,
          rect: getRect(node),
        });
      }

      candidates.sort((a, b) => b.score - a.score);

      return candidates[0] || null;
    }

    function getImageUrlFromElement(element) {
      if (!element) return "";

      const tagName = element.tagName?.toLowerCase();

      if (tagName === "img") {
        const src =
          element.getAttribute("src") ||
          element.getAttribute("data-src") ||
          element.getAttribute("data-original") ||
          element.getAttribute("data-lazy") ||
          getUrlFromSrcset(element.getAttribute("srcset")) ||
          getUrlFromSrcset(element.getAttribute("data-srcset"));

        return absoluteUrl(src);
      }

      const style = getComputedStyle(element);
      const bg = getBackgroundUrl(style.backgroundImage);

      return absoluteUrl(bg);
    }

    function collectVisualImages() {
      const elements = Array.from(
        document.querySelectorAll("img, [style], div, a")
      );

      const images = [];

      for (const element of elements) {
        const url = getImageUrlFromElement(element);
        if (!url) continue;

        const lowered = url.toLowerCase();

        if (lowered.includes("logo")) continue;
        if (lowered.includes("globe")) continue;
        if (lowered.includes("icon")) continue;
        if (lowered.includes("sprite")) continue;
        if (lowered.includes("facebook")) continue;
        if (lowered.includes("instagram")) continue;

        const rect = getRect(element);

        images.push({
          src: url,
          alt: normalize(element.getAttribute("alt") || ""),
          rect,
          width: rect.width,
          height: rect.height,
          tagName: element.tagName,
          className: element.className?.toString?.() || "",
        });
      }

      return images.filter((image) => {
        const lowered = image.src.toLowerCase();

        if (!image.src) return false;

        if (
          lowered.includes(".png") ||
          lowered.includes(".jpg") ||
          lowered.includes(".jpeg") ||
          lowered.includes(".webp")
        ) {
          return true;
        }

        return image.width > 30 && image.height > 30;
      });
    }

    function matchImageByPosition(productRect, images, href) {
      const productIdMatch = href.match(/i(\d+)\.html/i);
      const productId = productIdMatch ? productIdMatch[1] : "";

      if (productId) {
        const idImage = images.find((image) => image.src.includes(productId));

        if (idImage) {
          return {
            src: idImage.src,
            alt: idImage.alt,
          };
        }
      }

      let bestImage = null;
      let bestScore = Infinity;

      for (const image of images) {
        const dx = Math.abs(image.rect.centerX - productRect.centerX);
        const imageIsAbove = image.rect.centerY < productRect.centerY;
        const verticalDistance = Math.abs(productRect.top - image.rect.bottom);

        let score = dx + verticalDistance * 0.8;

        if (imageIsAbove) {
          score -= 80;
        } else {
          score += 200;
        }

        if (dx > 260) {
          score += 500;
        }

        if (verticalDistance > 700) {
          score += 500;
        }

        if (score < bestScore) {
          bestScore = score;
          bestImage = image;
        }
      }

      if (!bestImage || bestScore > 900) {
        return {
          src: "",
          alt: "",
        };
      }

      return {
        src: bestImage.src,
        alt: bestImage.alt,
      };
    }

    const allLinks = Array.from(document.querySelectorAll("a[href]"));
    const productLinks = allLinks.filter((link) => isProductHref(link.href));
    const allImages = collectVisualImages();

    const groupedLinks = new Map();

    for (const link of productLinks) {
      const href = link.href;

      if (!groupedLinks.has(href)) {
        groupedLinks.set(href, []);
      }

      groupedLinks.get(href).push(link);
    }

    const products = [];

    for (const [href, sameLinks] of groupedLinks.entries()) {
      let bestCandidate = null;

      for (const link of sameLinks) {
        const candidate = getContainerCandidates(link);

        if (!candidate) continue;

        if (!bestCandidate || candidate.score > bestCandidate.score) {
          bestCandidate = candidate;
        }
      }

      const rawText =
        bestCandidate?.text ||
        normalize(sameLinks.map((link) => link.innerText).join(" "));

      const price = findPrice(rawText);
      const status = findStatus(rawText);
      const name = cleanNameFromText(rawText, href, price);
      const rect = bestCandidate?.rect || getRect(sameLinks[0]);
      const image = matchImageByPosition(rect, allImages, href);

      if (!name || isBadText(rawText)) {
        continue;
      }

      products.push({
        name,
        price,
        status,
        href,
        imageUrl: image.src,
        imageAlt: image.alt,
        rawText: rawText.slice(0, 500),
      });
    }

    const debug = {
      pageTitle: document.title,
      pageUrl: location.href,
      bodyTextStart: normalize(document.body.innerText).slice(0, 1500),
      allLinkCount: allLinks.length,
      productLinkCount: productLinks.length,
      uniqueProductLinkCount: groupedLinks.size,
      imageCount: document.querySelectorAll("img").length,
      candidateImageCount: allImages.length,
      sampleImages: allImages.slice(0, 80),
      productLinks: Array.from(groupedLinks.keys()).slice(0, 80),
    };

    return {
      debug,
      products: products.slice(0, 100),
    };
  });

  await page.screenshot({ path: outputScreenshot, fullPage: true });

  fs.writeFileSync(outputDebug, JSON.stringify(result.debug, null, 2), "utf8");

  const payload = {
    source: "The Danish Pipe Shop",
    collectedAt: new Date().toISOString(),
    pageTitle: title,
    pageUrl: currentUrl,
    count: result.products.length,
    products: result.products,
  };

  fs.writeFileSync(outputJson, JSON.stringify(payload, null, 2), "utf8");

  console.log("");
  console.log(`当前页面：${currentUrl}`);
  console.log(`页面标题：${title}`);
  console.log(`商品详情链接数量：${result.debug.productLinkCount}`);
  console.log(`去重后商品数量：${result.debug.uniqueProductLinkCount}`);
  console.log(`候选图片数量：${result.debug.candidateImageCount}`);
  console.log(`提取到商品数量：${result.products.length}`);
  console.log(`已保存 JSON：${outputJson}`);
  console.log(`已保存截图：${outputScreenshot}`);
  console.log(`已保存 HTML：${outputHtml}`);
  console.log(`已保存调试数据：${outputDebug}`);
  console.log("");

  if (result.products.length > 0) {
    console.log("前 10 条结果预览：");
    console.log(result.products.slice(0, 10));
  } else {
    console.log("没有提取到商品，但如果商品详情链接数量 > 0，说明还需要继续适配容器结构。");
  }

  await context.close();
}

main().catch((error) => {
  console.error("测试失败：", error);
  process.exit(1);
});