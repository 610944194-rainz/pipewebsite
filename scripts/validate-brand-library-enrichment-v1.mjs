import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const brands = read("data/brands.ts");
const publicBrands = read("lib/public-products/brands.ts");
const listPage = read("app/brands/page.tsx");
const detailPage = read("app/brands/[slug]/page.tsx");
const brandAliases = read("data/taxonomy/brand-aliases.json");
const safeCandidates = read("data/i18n/product-displayname-zh-safe-candidates.json");

const requiredTranslations = {
  "S. Bang": "斯邦",
  Former: "佛么",
  "Charatan's": "查拉坦",
  "Comoy's": "科莫伊",
  Barling: "巴林",
  Cavicchi: "卡维奇",
  "GH Zhang": "张国辉",
  Brigham: "布里格姆",
  "Ser Jacopo": "雅克博",
  Rossi: "罗西",
  Ashton: "阿什顿",
  Radice: "雷迪斯",
  Ropp: "罗普",
  Tsuge: "拓植",
  Caminetto: "白胡子",
  Jacono: "杰克诺",
  Rinaldo: "里纳尔多",
  Ardor: "阿道尔",
  "Butz-Choquin": "BC",
};

const forbiddenIndependentBrands = [
  "Savinelli Autograph",
  "Tsuge Ikebana",
  "Eriksen Keystone filter pipe",
  "Ashton for Paul Olsen",
  "SON (Nording)",
  "Pipe Key Ring",
  "Pipepack",
];

const errors = [];

for (const [brand, zh] of Object.entries(requiredTranslations)) {
  if (!brands.includes(JSON.stringify(brand)) || !brands.includes(JSON.stringify(zh))) {
    errors.push(`Missing required brand translation: ${brand} -> ${zh}`);
  }
}

for (const brand of forbiddenIndependentBrands) {
  const key = brand.toLowerCase().replace(/[()]/g, " ").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!brands.toLowerCase().includes(key) && !brands.includes(brand)) {
    errors.push(`Missing non-independent brand rule: ${brand}`);
  }
}

if (!brands.includes("normalizeBrandForBrandIndex")) {
  errors.push("data/brands.ts must export normalizeBrandForBrandIndex");
}

if (!publicBrands.includes("getMergedPublicBrandEntries")) {
  errors.push("lib/public-products/brands.ts must merge canonical brand entries");
}

if (!listPage.includes("brandShortName") || !detailPage.includes("brandShortName")) {
  errors.push("brand pages must support monogram fallback");
}

if (!listPage.includes("brandDisplayName") || !detailPage.includes("brandDisplayName")) {
  errors.push("brand pages must format English brand names for display");
}

if (!brands.includes("formatBrandDisplayName")) {
  errors.push("data/brands.ts must expose normalized display capitalization");
}

if (brandAliases.includes("南娜·伊瓦松") || safeCandidates.includes("南娜·伊瓦松")) {
  errors.push("Nanna Ivarsson Chinese name must be 娜娜·伊瓦松, not 南娜·伊瓦松");
}

if (!brandAliases.includes("娜娜·伊瓦松") || !safeCandidates.includes("娜娜·伊瓦松")) {
  errors.push("Nanna Ivarsson correction not found in alias / display-name data");
}

if (/https?:\/\//.test(listPage) || /https?:\/\//.test(detailPage)) {
  errors.push("brand pages should not hard-code external logo hotlinks");
}

if (detailPage.includes("资料来源") || detailPage.includes("SourceSection")) {
  errors.push("brand detail page should not render source URL cards");
}

if (detailPage.includes('label: "Danish"') || detailPage.includes('label: "Smokingpipes"')) {
  errors.push("brand detail facts should not display product source rows");
}

console.log(JSON.stringify({
  status: errors.length ? "failed" : "passed",
  validatorVersion: "brand-library-enrichment-v4-release-polish-20260618",
  counts: {
    requiredTranslations: Object.keys(requiredTranslations).length,
    forbiddenIndependentBrands: forbiddenIndependentBrands.length,
    nannaIvarssonCorrection: safeCandidates.match(/娜娜·伊瓦松/g)?.length || 0,
  },
  errors,
}, null, 2));

if (errors.length) process.exit(1);
