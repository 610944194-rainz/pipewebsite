import fs from "node:fs";
import path from "node:path";

const inputPath = path.join(process.cwd(), "data", "brand-audit.json");
const outputPath = path.join(process.cwd(), "data", "brand-content-template.csv");

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function csvEscape(value) {
  const text = normalizeText(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function pickBrandName(item) {
  return normalizeText(
    item.brand || item.name || item.normalizedBrand || item.displayName
  );
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const brands = Array.isArray(raw) ? raw : raw.brands || raw.items || [];

const rows = brands
  .slice()
  .sort((a, b) => Number(b.productCount || 0) - Number(a.productCount || 0))
  .map((brand, index) => {
    const sampleProducts = Array.isArray(brand.sampleProducts)
      ? brand.sampleProducts.slice(0, 5).join(" | ")
      : "";

    const hidden = brand.hideFromBrandIndex ? "隐藏/不进品牌库" : "品牌库显示";

    return [
      index + 1,
      pickBrandName(brand),
      brand.slug || "",
      brand.currentNameZh || brand.nameZh || "",
      brand.currentCountryZh || brand.countryZh || "",
      brand.currentCountry || brand.country || "",
      brand.brandType || "",
      brand.productCount || 0,
      brand.priority || "",
      hidden,
      sampleProducts,
      "", // 品牌卡片短简介
      "", // 品牌详情页简介
      "", // 品牌背景/故事
      "", // 风格特点
      "", // 代表系列/代表斗型
      "", // 适合人群
      "", // 资料来源URL 1
      "", // 资料来源URL 2
      "待填写",
      "", // 备注
    ];
  });

const headers = [
  "序号",
  "英文品牌名",
  "slug",
  "中文展示名",
  "国家/地区中文",
  "国家/地区英文",
  "品牌类型",
  "库存数量",
  "优先级",
  "品牌库状态",
  "示例商品",
  "品牌卡片短简介（30-50字）",
  "品牌详情页简介（100-200字）",
  "品牌背景/故事（可选）",
  "风格特点（3-5个关键词）",
  "代表系列/代表斗型",
  "适合人群",
  "资料来源URL 1",
  "资料来源URL 2",
  "审核状态（待填写/待核验/可入库/暂不展示）",
  "备注",
];

const csv = [
  headers.map(csvEscape).join(","),
  ...rows.map((row) => row.map(csvEscape).join(",")),
].join("\n");

fs.writeFileSync(outputPath, "\uFEFF" + csv, "utf8");

console.log(`Brand content template exported: ${outputPath}`);
console.log(`Total brands: ${rows.length}`);
