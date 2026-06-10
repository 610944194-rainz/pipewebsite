import fs from "node:fs";
import path from "node:path";

const inputPath = path.join(process.cwd(), "data", "brand-content-optimized-v3.csv");
const outputPath = path.join(process.cwd(), "data", "brand-content.ts");

function normalizeText(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && nextChar === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }

      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some((cell) => normalizeText(cell)));
}

function getCell(row, headers, ...names) {
  for (const name of names) {
    const index = headers.indexOf(name);

    if (index >= 0) {
      return normalizeText(row[index]);
    }
  }

  return "";
}

function splitList(value) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/(?:\s*[；;｜|、]\s*|\n+)/)
        .map(normalizeText)
        .filter(Boolean)
    )
  );
}

function splitUrls(...values) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => normalizeText(value).split(/\s*[；;｜|\n]\s*/))
        .map(normalizeText)
        .filter((value) => /^https?:\/\//i.test(value))
    )
  );
}

function toTsString(value) {
  return JSON.stringify(value, null, 2);
}

const rawCsv = fs.readFileSync(inputPath, "utf8");
const [headerRow, ...dataRows] = parseCsv(rawCsv);

if (!headerRow) {
  throw new Error(`No CSV header found in ${inputPath}.`);
}

const headers = headerRow.map(normalizeText);

const profiles = dataRows.map((row) => {
  const sourceUrl1 = getCell(row, headers, "资料来源URL 1", "资料来源 URL 1");
  const sourceUrl2 = getCell(row, headers, "资料来源URL 2", "资料来源 URL 2");

  return {
    slug: getCell(row, headers, "slug"),
    name: getCell(row, headers, "英文品牌名", "brand", "name"),
    nameZh: getCell(row, headers, "中文展示名", "中文名", "nameZh"),
    country: getCell(row, headers, "国家/地区中文", "国家", "countryZh"),
    countryEn: getCell(row, headers, "国家/地区英文", "country", "countryEn"),
    brandType: getCell(row, headers, "品牌类型", "brandType"),
    priority: getCell(row, headers, "优先级", "priority"),
    brandIndexStatus: getCell(row, headers, "品牌库状态"),
    summary: getCell(row, headers, "品牌卡片短简介（30-50字）", "品牌卡片短简介"),
    detailIntro: getCell(row, headers, "品牌详情页简介（100-200字）", "品牌详情页简介"),
    story: getCell(row, headers, "品牌背景/故事（可选）", "品牌背景/故事"),
    features: splitList(getCell(row, headers, "风格特点（3-5个关键词）", "风格特点")),
    representativeStyles: splitList(
      getCell(row, headers, "代表系列/代表斗型", "代表系列", "代表斗型")
    ),
    suitableFor: getCell(row, headers, "适合人群"),
    sourceUrls: splitUrls(sourceUrl1, sourceUrl2),
    reviewStatus: getCell(
      row,
      headers,
      "审核状态（待填写/待核验/可入库/暂不展示）",
      "审核状态"
    ),
    noteZh: getCell(row, headers, "备注"),
  };
});

const output = `export type BrandContentProfile = {
  slug: string;
  name: string;
  nameZh: string;
  country: string;
  countryEn: string;
  brandType: string;
  priority: string;
  brandIndexStatus: string;
  summary: string;
  detailIntro: string;
  story: string;
  features: string[];
  representativeStyles: string[];
  suitableFor: string;
  sourceUrls: string[];
  reviewStatus: string;
  noteZh: string;
};

export const brandContentProfiles: BrandContentProfile[] = ${toTsString(profiles)};
`;

fs.writeFileSync(outputPath, output, "utf8");

const statusCounts = profiles.reduce((counts, profile) => {
  const key = profile.brandIndexStatus || "(empty)";
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

console.log(`Brand content imported: ${outputPath}`);
console.log(`Total profiles: ${profiles.length}`);
console.log(JSON.stringify(statusCounts, null, 2));
