import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const inputPath = path.join(process.cwd(), "data", "danish-sample.json");
const outputPath = path.join(process.cwd(), "data", "danish-detail-sample.json");
const screenshotDir = path.join(process.cwd(), "data", "danish-detail-screenshots");

// 先测试前 5 条；确认图库干净后，再改成 48
const DETAIL_LIMIT = 5;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const page = context.pages()[0] ?? (awaitDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });

  const page = context.pages()[0] ?? (await context.newPage());

  console.log("");
  console.log("准备打开 Danish 详情页采集。");
  console.log("如果浏览器里再次出现 Cookie / 年龄 / robot，请你手动处理。");
  console.log("处理完成后回到终端按 Enter。");
  console.log("");

  await page.goto("https://www.danishpipeshop.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const rl = readline.createInterface({ input, output });
  await rl.question("准备好后按 Enter 开始抓取详情页：");
  rl.close();

  const enrichedProducts = [];

  for (let index = 0; index < products.length; index++) {
    const product = products[index];

    console.log("");
    console.log(`正在抓取 ${index + 1}/${products.length}: ${product.name}`);
    console.log(product.href);

    await page.goto(product.href, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(2500);

    const robotDetected = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();

      return (
        text.includes("i am not a robot") ||
        text.includes("confirm that you are not a robot") ||
        text.includes("not a robot")
      );
    });

    if (robotDetected) {
      console.log("检测到 robot 验证页。脚本不会绕过验证。请你手动通过后重新运行。");
      break;
    }

    const detail = await page.evaluate(() => {
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

        const candidates = srcset
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [url, size] = part.split(/\s+/);
            const width = size && size.endsWith("w") ? Number(size.replace("w", "")) : 0;

            return {
              url,
              width,
            };
          });

        candidates.sort((a, b) => b.width - a.width);

        return candidates[0]?.url || "";
      }

      function getBackgroundUrl(value) {
        if (!value || value === "none") return "";

        const match = value.match(/url\(["']?(.*?)["']?\)/i);
        return match ? match[1] : "";
      }

      function getRect(element) {
        const rect = element.getBoundingClientRect();

        return {
          width: rect.width,
          height: rect.height,
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
          right: rect.right + window.scrollX,
          centerX: rect.left + window.scrollX + rect.width / 2,
          centerY: rect.top + window.scrollY + rect.height / 2,
          area: rect.width * rect.height,
        };
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

      function isBadImageUrl(url) {
        const lowered = url.toLowerCase();

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
          lowered.includes("new-price")
        );
      }

      function isLikelyProductImage(url) {
        const lowered = url.toLowerCase();

        return (
          lowered.includes("/img/-img-") &&
          (lowered.endsWith(".jpg") ||
            lowered.endsWith(".jpeg") ||
            lowered.endsWith(".png") ||
            lowered.endsWith(".webp"))
        );
      }

      function collectProductImages() {
        const elements = Array.from(document.querySelectorAll("img, [style], a, div"));
        const images = [];

        for (const element of elements) {
          const url = getImageUrlFromElement(element);

          if (!url) continue;
          if (isBadImageUrl(url)) continue;
          if (!isLikelyProductImage(url)) continue;

          const rect = getRect(element);

          if (rect.width < 30 || rect.height < 30) continue;

          images.push({
            url,
            alt: normalize(element.getAttribute("alt") || ""),
            tagName: element.tagName,
            className: element.className?.toString?.() || "",
            rect,
          });
        }

        const uniqueMap = new Map();

        for (const image of images) {
          if (!uniqueMap.has(image.url)) {
            uniqueMap.set(image.url, image);
          }
        }

        return Array.from(uniqueMap.values()).sort((a, b) => b.rect.area - a.rect.area);
      }

      function findMainImage(images) {
        return images.find((image) => image.rect.area > 20000) || images[0] || null;
      }

      function findGalleryImages(images, mainImage, pageTitle) {
        if (!mainImage) return [];

        const mainRect = mainImage.rect;

        const titleWords = normalize(pageTitle)
          .toLowerCase()
          .replace(/[,，]/g, " ")
          .split(" ")
          .filter((word) => word.length >= 3);

        const gallery = images.filter((image) => {
          const rect = image.rect;
          const alt = normalize(image.alt).toLowerCase();
          const url = image.url.toLowerCase();

          if (!url.includes("/img/-img-")) {
            return false;
          }

          if (rect.width < 35 || rect.height < 35) {
            return false;
          }

          const matchesTitle =
            titleWords.length > 0 &&
            titleWords.some((word) => alt.includes(word));

          const nearMainColumn =
            Math.abs(rect.centerX - mainRect.centerX) < 600;

          const nearMainVertical =
            rect.top >= mainRect.top - 140 && rect.top <= mainRect.bottom + 520;

          const reasonableArea = rect.area > 1200;

          return reasonableArea && (matchesTitle || (nearMainColumn && nearMainVertical));
        });

        const uniqueUrls = Array.from(new Set(gallery.map((image) => image.url)));

        return uniqueUrls.slice(0, 12);
      }

      const pageTitle = normalize(document.querySelector("h1")?.textContent || document.title);
      const bodyText = normalize(document.body.innerText);

      const productImages = collectProductImages();
      const mainImageCandidate = findMainImage(productImages);

      const mainImage = mainImageCandidate?.url || "";
      const galleryImages = findGalleryImages(
        productImages,
        mainImageCandidate,
        pageTitle
      );

      const specsTextCandidates = Array.from(
        document.querySelectorAll("table, dl, ul, .specs, .product-info, .product-data")
      )
        .map((element) => normalize(element.innerText))
        .filter((text) => text.length > 10)
        .slice(0, 10);

      return {
        pageTitle,
        pageUrl: location.href,
        mainImage,
        galleryImages,
        productImagesDebug: productImages.slice(0, 30),
        specsText: specsTextCandidates,
        bodyTextStart: bodyText.slice(0, 2500),
      };
    });

    const screenshotPath = path.join(screenshotDir, `detail-${index + 1}.png`);

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    enrichedProducts.push({
      ...product,
      detailPageTitle: detail.pageTitle,
      detailImageUrl: detail.mainImage,
      detailGalleryImages: detail.galleryImages,
      detailSpecsText: detail.specsText,
      detailBodyTextStart: detail.bodyTextStart,
      detailPageUrl: detail.pageUrl,
      detailImageDebug: detail.productImagesDebug,
    });

    console.log(`主图：${detail.mainImage || "未找到"}`);
    console.log(`图库数量：${detail.galleryImages.length}`);
    console.log("图库预览：");
    console.log(detail.galleryImages);

    await sleep(1500);
  }

  const payload = {
    source: "The Danish Pipe Shop",
    baseCollectedAt: sourceData.collectedAt,
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
    console.log("前 3 条预览：");
    console.log(
      enrichedProducts.slice(0, 3).map((item) => ({
        name: item.name,
        price: item.price,
        status: item.status,
        detailImageUrl: item.detailImageUrl,
        galleryCount: item.detailGalleryImages.length,
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