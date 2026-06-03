import fs from "node:fs";
import path from "node:path";

const detailInputPath = path.join(process.cwd(), "data", "danish-detail-sample.json");
const listInputPath = path.join(process.cwd(), "data", "danish-sample.json");
const outputPath = path.join(process.cwd(), "data", "danish-products.ts");

const USD_TO_CNY = 7.3;

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseUsdPrice(priceText) {
  if (!priceText) return 0;

  let cleaned = priceText
    .replace("$", "")
    .replace("USD", "")
    .replace(",-", "")
    .replace(/\s+/g, "")
    .trim();

  if (cleaned.endsWith(",")) {
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }

  const value = Number(cleaned);

  return Number.isFinite(value) ? value : 0;
}

function formatCny(value) {
  return `约 ¥${Math.round(value).toLocaleString("zh-CN")} 起`;
}

function getWidthFromUrl(url) {
  const match = String(url || "").match(/-w(\d+)-/i);
  return match ? Number(match[1]) : 0;
}

function getImageId(url) {
  const match = String(url || "").match(/img-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function isLowQualityImage(url) {
  const width = getWidthFromUrl(url);

  if (!width) return false;

  return width < 400;
}

function isUsableImage(url) {
  const text = String(url || "").toLowerCase();

  if (!text) return false;

  if (!text.includes("danishpipeshop.com/img/")) return false;
  if (!text.includes("img-")) return false;

  if (
    text.includes("logo") ||
    text.includes("globe") ||
    text.includes("icon") ||
    text.includes("sprite") ||
    text.includes("facebook") ||
    text.includes("instagram") ||
    text.includes("favorite") ||
    text.includes("compare") ||
    text.includes("badge") ||
    text.includes("blank") ||
    text.includes("transparent") ||
    text.includes("ninks") ||
    text.includes("new-price") ||
    text.includes("corner")
  ) {
    return false;
  }

  return (
    text.includes(".jpg") ||
    text.includes(".jpeg") ||
    text.includes(".png") ||
    text.includes(".webp")
  );
}

function imageQualityScore(url) {
  const text = String(url || "");
  const width = getWidthFromUrl(text);

  let score = 0;

  score += width * 10;

  if (text.includes("x2")) score += 2500;
  if (text.includes("w1300")) score += 6500;
  if (text.includes("w1100")) score += 6000;
  if (text.includes("w1000")) score += 5200;
  if (text.includes("w900")) score += 4500;
  if (text.includes("w760")) score += 3500;
  if (text.includes("w710")) score += 2800;
  if (text.includes("w500")) score += 1800;
  if (text.includes("w400")) score += 1000;
  if (text.includes("w340")) score += 600;
  if (text.includes("w300")) score += 300;
  if (text.includes("w200")) score -= 1500;
  if (text.includes("w100")) score -= 3000;

  return score;
}

function uniqueImagesByImageId(images) {
  const groups = new Map();

  for (const image of images) {
    if (!isUsableImage(image)) continue;

    const imageId = getImageId(image);

    if (!imageId) continue;

    const existing = groups.get(imageId);

    if (!existing) {
      groups.set(imageId, image);
      continue;
    }

    if (imageQualityScore(image) > imageQualityScore(existing)) {
      groups.set(imageId, image);
    }
  }

  return Array.from(groups.values());
}

function cleanGalleryImages(product) {
  const rawImages = [
    product.detailImageUrl,
    ...(product.detailGalleryImages || []),
    product.imageUrl,
  ].filter(Boolean);

  const uniqueImages = uniqueImagesByImageId(rawImages);

  const highQualityImages = uniqueImages.filter((image) => !isLowQualityImage(image));

  // 如果有高清图，就丢掉 w100 / w200 / w300 缩略图
  // 如果全是低清图，先保留，避免没有图
  const cleanedImages =
    highQualityImages.length > 0 ? highQualityImages : uniqueImages;

  // 排序逻辑：
  // 1. 如果 detailImageUrl 不是低清图，优先放第一
  // 2. 否则按图片质量排序
  const detailImage = product.detailImageUrl;

  const sorted = [...cleanedImages].sort((a, b) => {
    const aIsDetail = a === detailImage && !isLowQualityImage(a);
    const bIsDetail = b === detailImage && !isLowQualityImage(b);

    if (aIsDetail && !bIsDetail) return -1;
    if (!aIsDetail && bIsDetail) return 1;

    return imageQualityScore(b) - imageQualityScore(a);
  });

  return sorted.slice(0, 12);
}

function chooseMainImage(product, galleryImages) {
  const detailImage = product.detailImageUrl;

  if (detailImage && isUsableImage(detailImage) && !isLowQualityImage(detailImage)) {
    return detailImage;
  }

  const bestGalleryImage = galleryImages.find((image) => !isLowQualityImage(image));

  if (bestGalleryImage) {
    return bestGalleryImage;
  }

  if (galleryImages[0]) {
    return galleryImages[0];
  }

  if (product.imageUrl && isUsableImage(product.imageUrl)) {
    return product.imageUrl;
  }

  return "/images/pipes/placeholder-pipe.svg";
}

function inferImageQualityLabel(galleryImages) {
  if (!galleryImages || galleryImages.length === 0) {
    return "图片待补";
  }

  const highQualityCount = galleryImages.filter((image) => !isLowQualityImage(image)).length;

  if (galleryImages.length >= 3 && highQualityCount >= 2) {
    return "多图完整";
  }

  if (highQualityCount >= 1) {
    return "图片可用";
  }

  return "低清待复核";
}

function inferBrand(name) {
  const knownBrands = [
    "Anne Julie",
    "Berggreen Pipes",
    "Castello",
    "BPK",
    "Dunhill",
    "Stanwell",
    "Tom Eltang",
    "Peter Heding",
    "Neerup",
    "Poul Winsløw",
    "Winsløw",
    "Former",
    "Savinelli",
    "Peterson",
    "Chacom",
    "Ascorti",
    "Talamona",
    "Ser Jacopo",
  ];

  const matchedBrand = knownBrands.find((brand) =>
    name.toLowerCase().startsWith(brand.toLowerCase())
  );

  if (matchedBrand) {
    return matchedBrand;
  }

  return name.split(" ")[0] || "Danish";
}

function getTags(product, estimatedCnyValue, galleryImages) {
  const tags = ["Danish Pipe Shop", "需人工确认"];

  if (product.status === "已售") {
    tags.push("已售参考");
  }

  if (estimatedCnyValue > 0 && estimatedCnyValue <= 3000) {
    tags.push("预算友好");
  } else if (estimatedCnyValue >= 5000 && estimatedCnyValue < 999999) {
    tags.push("高端收藏");
  } else if (estimatedCnyValue > 3000 && estimatedCnyValue < 999999) {
    tags.push("进阶选择");
  } else {
    tags.push("价格需确认");
  }

  tags.push(inferImageQualityLabel(galleryImages));

  return tags;
}

function findSpec(text, regex, label) {
  const match = text.match(regex);

  if (!match || !match[1]) {
    return "";
  }

  return `${label}：${normalizeText(match[1])}`;
}

function extractSpecs(product) {
  const sourceText = normalizeText(
    [
      product.detailSpecsText?.join(" "),
      product.detailBodyTextStart,
      product.rawText,
    ]
      .filter(Boolean)
      .join(" ")
  );

  const specs = [
    findSpec(sourceText, /A:\s*斗钵壁直径:\s*([^A-Z]+?mm)/i, "斗钵壁直径"),
    findSpec(sourceText, /B:\s*斗钵室内径:\s*([^A-Z]+?mm)/i, "斗钵室内径"),
    findSpec(sourceText, /C:\s*斗钵室深:\s*([^A-Z]+?mm)/i, "斗钵室深"),
    findSpec(sourceText, /D:\s*高度:\s*([^A-Z]+?mm)/i, "高度"),
    findSpec(sourceText, /E:\s*长度:\s*([^A-Z]+?mm)/i, "长度"),
    findSpec(sourceText, /F:\s*Button width:\s*([^A-Z]+?mm)/i, "Button width"),
    findSpec(sourceText, /G:\s*Bit thickness:\s*([^A-Z]+?mm)/i, "Bit thickness"),
    findSpec(sourceText, /重量:\s*([^m]+?gr)/i, "重量"),
    findSpec(sourceText, /滤芯:\s*([^斗品]+?)(?=斗嘴材质:|品牌:|产品编号:|$)/i, "滤芯"),
    findSpec(sourceText, /斗嘴材质:\s*(.*?)(?=品牌:|产品编号:|From|$)/i, "斗嘴材质"),
    findSpec(sourceText, /产品编号:\s*([A-Za-z0-9-]+)/i, "产品编号"),
  ].filter(Boolean);

  return Array.from(new Set(specs));
}

function buildDetail(product, isSold) {
  if (isSold) {
    return "该烟斗在 Danish Pipe Shop 页面采集时显示已售。此类商品仍可作为品牌、斗型和价格区间参考。若喜欢类似款式，可以提交找斗需求，由人工协助寻找相近库存。";
  }

  return "该烟斗来自 The Danish Pipe Shop 公开页面。页面价格、图片和库存状态为采集时信息，仅供参考。实际购买前需要人工重新确认库存、最终价格、国际运费、预计税费和代购服务费。";
}

function main() {
  let inputPath = "";

  if (fs.existsSync(detailInputPath)) {
    inputPath = detailInputPath;
  } else if (fs.existsSync(listInputPath)) {
    inputPath = listInputPath;
  } else {
    console.error("找不到 Danish 采集数据。请先运行列表页或详情页采集脚本。");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const rawProducts = raw.products || [];

  const collectedAt =
    raw.detailCollectedAt ||
    raw.collectedAt ||
    raw.baseCollectedAt ||
    new Date().toISOString();

  const products = rawProducts.map((product, index) => {
    const originalPriceValue = parseUsdPrice(product.price);

    const estimatedCnyValue = originalPriceValue
      ? Math.round(originalPriceValue * USD_TO_CNY)
      : 999999;

    const brand = inferBrand(product.name);
    const isSold = product.status === "已售";

    const status = isSold ? "可能已售" : "需人工确认";

    const galleryImages = cleanGalleryImages(product);
    const imageUrl = chooseMainImage(product, galleryImages);

    const updatedAt = new Date(collectedAt)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");

    return {
      id: 10000 + index + 1,
      brand,
      name: product.name,
      originalPrice: product.price || "价格需确认",
      originalCurrency: "USD",
      originalPriceValue,
      estimatedCny: originalPriceValue
        ? formatCny(estimatedCnyValue)
        : "价格需确认",
      estimatedCnyValue,
      source: "The Danish Pipe Shop",
      sourceUrl: product.href,
      imageUrl,
      galleryImages,
      specsText: extractSpecs(product),
      condition: "新斗",
      status,
      updatedAt,
      audience:
        estimatedCnyValue >= 5000 && estimatedCnyValue < 999999
          ? "进阶玩家 / 高端收藏向"
          : "新手进阶 / 海外烟斗关注者",
      comment: isSold
        ? "该商品在采集时显示已售，可作为同类烟斗价格与款式参考。"
        : "来自 The Danish Pipe Shop 的公开库存信息，适合进一步人工确认库存、价格和品相。",
      detail: buildDetail(product, isSold),
      tags: getTags(product, estimatedCnyValue, galleryImages),
    };
  });

  const fileContent = `import type { PipeProduct } from "./pipes";

export const danishProducts: PipeProduct[] = ${JSON.stringify(
    products,
    null,
    2
  )};
`;

  fs.writeFileSync(outputPath, fileContent, "utf8");

  console.log(`读取来源：${inputPath}`);
  console.log(`已生成：${outputPath}`);
  console.log(`商品数量：${products.length}`);
  console.log("");
  console.log("前 5 条预览：");
  console.log(
    products.slice(0, 5).map((item) => ({
      id: item.id,
      brand: item.brand,
      name: item.name,
      originalPrice: item.originalPrice,
      estimatedCny: item.estimatedCny,
      imageUrl: item.imageUrl,
      galleryCount: item.galleryImages.length,
      tags: item.tags,
      sourceUrl: item.sourceUrl,
    }))
  );
}

main();