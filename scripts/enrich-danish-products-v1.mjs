import fs from "node:fs";
import path from "node:path";
import { normalizeBrandForIndex } from "../data/brand-aliases.ts";
import { brandContentProfiles } from "../data/brand-content.ts";

const rootDir = process.cwd();
const inputPath = path.join(rootDir, "data", "danish-products.ts");

function findMatchingBracket(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractExportedArray(text, exportName) {
  const exportIndex = text.indexOf(`export const ${exportName}`);

  if (exportIndex < 0) {
    throw new Error(`Could not find export const ${exportName}.`);
  }

  const assignmentIndex = text.indexOf("=", exportIndex);
  const startIndex = text.indexOf("[", assignmentIndex);
  const endIndex = findMatchingBracket(text, startIndex, "[", "]");

  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not extract array for ${exportName}.`);
  }

  return text.slice(startIndex, endIndex + 1);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumber(value) {
  const match = String(value || "").match(/([0-9]+(?:[,.][0-9]+)?)/);

  if (!match) return null;

  const parsed = Number(match[1].replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function parseSpecValue(specsText, letter, labelPattern) {
  const letterPattern = new RegExp(`^\\s*${letter}\\s*[:：]`, "i");
  const labelRegex = labelPattern ? new RegExp(labelPattern, "i") : null;

  const line = (specsText || []).find((item) => {
    const text = String(item || "");
    return letterPattern.test(text) || (labelRegex ? labelRegex.test(text) : false);
  });

  return parseNumber(line);
}

function parseWeight(specsText) {
  const line = (specsText || []).find((item) =>
    /重量|weight/i.test(String(item || ""))
  );

  const match = String(line || "").match(/([0-9]+(?:[,.][0-9]+)?)\s*(?:gr|g|gram)/i);

  if (!match) return null;

  const parsed = Number(match[1].replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function getWeightRange(weightGrams) {
  if (!Number.isFinite(weightGrams)) return "unknown";
  if (weightGrams <= 35) return "light";
  if (weightGrams <= 55) return "medium";
  if (weightGrams <= 75) return "heavy";
  return "extra-heavy";
}

const shapeRules = [
  ["billiard", "撞球斗", "classic", /\b(?:Billiard|Billard)\b/i],
  ["dublin", "都柏林斗", "classic", /\bDublin\b/i],
  ["bulldog", "斗牛犬斗", "classic", /\bBulldog\b/i],
  ["rhodesian", "牛头斗", "classic", /\bRhodesian\b/i],
  ["apple", "苹果斗", "classic", /\bApple\b/i],
  ["author", "作家式斗", "classic", /\bAuthor\b/i],
  ["prince", "王子斗", "classic", /\bPrince\b/i],
  ["pot", "罐式斗", "classic", /\bPot\b/i],
  ["poker", "扑克斗", "classic", /\bPoker\b/i],
  ["canadian", "加拿大斗", "classic-long", /\bCanadian\b/i],
  ["lovat", "罗瓦斗", "classic-long", /\bLovat\b/i],
  ["liverpool", "利物浦斗", "classic-long", /\bLiverpool\b/i],
  ["churchwarden", "陶制长斗", "long", /\bChurchwarden\b/i],
  ["freehand", "自由式斗", "freehand", /\bFreehand\b/i],
  ["blowfish", "河豚斗", "freehand", /\bBlowfish\b/i],
  ["egg", "蛋形斗", "classic", /\bEgg\b/i],
  ["tomato", "番茄斗", "freehand", /\bTomato\b/i],
  ["horn", "号角斗", "freehand", /\bHorn\b/i],
  ["volcano", "火山斗", "freehand", /\bVolcano\b/i],
  ["calabash", "葫芦斗", "classic", /\bCalabash\b/i],
  ["brandy", "白兰地斗", "classic", /\bBrandy\b/i],
];

const shapeTokenPatterns = [
  /\bB\.?\s*Billiard\b/gi,
  /\bB\.?\s*Billard\b/gi,
  /\bBilliard\b/gi,
  /\bBillard\b/gi,
  /\bDublin\b/gi,
  /\bBulldog\b/gi,
  /\bRhodesian\b/gi,
  /\bApple\b/gi,
  /\bAuthor\b/gi,
  /\bPrince\b/gi,
  /\bPot\b/gi,
  /\bPoker\b/gi,
  /\bCanadian\b/gi,
  /\bLovat\b/gi,
  /\bLiverpool\b/gi,
  /\bChurchwarden\s*Pipe\b/gi,
  /\bChurchwarden\b/gi,
  /\bFreehand\b/gi,
  /\bBlowfish\b/gi,
  /\bEgg\b/gi,
  /\bTomato\b/gi,
  /\bHorn\b/gi,
  /\bVolcano\b/gi,
  /\bCalabash\b/gi,
  /\bBrandy\b/gi,
  /\bBent\b/gi,
  /\bStraight\b/gi,
];

const finishRules = [
  ["polished", "光面", /\b(?:Light\s+Polished|Polished)\b/i],
  ["smooth", "光面", /\bSmooth\b/i],
  ["sandblast", "喷砂", /\b(?:Sandblast|Sandblasted|Sabl[eé]e|Sablée|Shell Briar)\b/i],
  ["rusticated", "锈面", /\b(?:Rusticated|Rustic)\b/i],
  ["brushed", "拉丝", /\bBrushed\b/i],
  ["matte", "哑光", /\bMatte\b/i],
  ["contrast", "对比染", /\bContrast\b/i],
  ["natural", "自然色", /\bNatural\b/i],
];

const finishTokenPatterns = [
  /\bLight\s+Polished\b/gi,
  /\bPolished\b/gi,
  /\bSmooth\b/gi,
  /\bSandblast(?:ed)?\b/gi,
  /\bSabl[eé]e\b/gi,
  /\bSablée\b/gi,
  /\bShell Briar\b/gi,
  /\bRusticated\b/gi,
  /\bRustic\b/gi,
  /\bBrushed\b/gi,
  /\bMatte\b/gi,
  /\bContrast\b/gi,
  /\bNatural\b/gi,
];

const colorRules = [
  ["orange", "橙", /\bOrange\b/i],
  ["black-brown", "黑棕", /\bBlack\s+Brown\b/i],
  ["black", "黑色", /\bBlack\b/i],
  ["brown", "棕色", /\bBrown\b/i],
  ["red", "红色", /\bRed\b/i],
  ["green", "绿色", /\bGreen\b/i],
  ["blue", "蓝色", /\bBlue\b/i],
];

const materialRules = [
  ["meerschaum", "海泡石", /\bMeerschaum\b/i],
  ["corn-cob", "玉米芯", /\bCorn Cob\b/i],
  ["morta", "沼泽橡木", /\b(?:Morta|Bog Oak)\b/i],
  ["briar", "石楠根", /\b(?:Briar|Bruy[eè]re|Bruyère)\b/i],
];

const stemMaterialRules = [
  ["cumberland", "坎伯兰斗嘴", /\bCumberland\b/i],
  ["ebonite", "硫化橡胶斗嘴", /\bEbonite\b/i],
  ["vulcanite", "硫化橡胶斗嘴", /\bVulcanite\b/i],
  ["acrylic", "亚克力斗嘴", /\bAcrylic\b/i],
];

const stemMaterialTokenPatterns = [
  /\bCumberland\b/gi,
  /\bEbonite\b/gi,
  /\bVulcanite\b/gi,
  /\bAcrylic\b/gi,
];

const engineeringFeatureRules = [
  ["reverse-calabash", "空腔大气室", /\bReverse\s+Calabash\b/i],
];

const engineeringFeatureTokenPatterns = [
  /\bReverse\s+Calabash\b/gi,
];

const grainPatternRules = [
  ["straight-grain", "直纹", /\bStraight\s+Grain\b/i],
  ["cross-grain", "横纹", /\bCross\s+Grain\b/i],
  ["birdseye", "鸟眼纹", /\b(?:Birdseye|Bird[’']s\s+Eye)\b/i],
  ["flame-grain", "火焰纹", /\bFlame\s+Grain\b/i],
];

const grainPatternTokenPatterns = [
  /\bStraight\s+Grain\b/gi,
  /\bCross\s+Grain\b/gi,
  /\bBirdseye\b/gi,
  /\bBird[’']s\s+Eye\b/gi,
  /\bFlame\s+Grain\b/gi,
];

function buildProductSearchText(product) {
  return [
    product.name,
    ...(product.specsText || []),
    ...(product.tags || []),
    product.detail,
    product.comment,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function parseShape(product, engineeringFeature = "unknown") {
  const text = buildProductSearchText(product);
  const bendText = text.replace(/\bStraight\s+Grain\b/gi, " ");
  const hasBentBilliardAbbreviation = /\bB\.?\s*(?:Billiard|Billard)\b/i.test(text);
  const rule = shapeRules.find(([shape, , , regex]) => {
    if (engineeringFeature === "reverse-calabash" && shape === "calabash") {
      return false;
    }

    return regex.test(text);
  });
  const bendType = hasBentBilliardAbbreviation || /\bBent\b/i.test(bendText)
    ? "bent"
    : /\bStraight\b/i.test(bendText)
      ? "straight"
      : "unknown";

  if (!rule) {
    return {
      shape: "unknown",
      shapeZh: "",
      shapeBaseZh: "",
      shapeGroup: "unknown",
      bendType,
    };
  }

  const [shape, shapeBaseZh, shapeGroup] = rule;
  let shapeZh = shapeBaseZh;

  if (bendType === "bent" && !["freehand", "churchwarden"].includes(shape)) {
    shapeZh = `弯式${shapeBaseZh}`;
  } else if (bendType === "straight") {
    shapeZh = `直式${shapeBaseZh}`;
  }

  return {
    shape,
    shapeZh,
    shapeBaseZh,
    shapeGroup,
    bendType,
  };
}

function parseGrainPattern(product) {
  const text = buildProductSearchText(product);
  const rule = grainPatternRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        grainPattern: rule[0],
        grainPatternZh: rule[1],
      }
    : {
        grainPattern: "unknown",
        grainPatternZh: "",
      };
}

function parseFinish(name) {
  const text = normalizeText(name);
  const rule = finishRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        finish: rule[0],
        finishZh: rule[1],
      }
    : {
        finish: "unknown",
        finishZh: "",
      };
}

function parseColor(name) {
  const text = normalizeText(name);
  const rule = colorRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        color: rule[0],
        colorZh: rule[1],
      }
    : {
        color: "unknown",
        colorZh: "",
      };
}

function parseMaterial(name) {
  const text = normalizeText(name);
  const rule = materialRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        material: rule[0],
        materialZh: rule[1],
      }
    : {
        material: "unknown",
        materialZh: "",
      };
}

function parseStemMaterial(name) {
  const text = normalizeText(name);
  const rule = stemMaterialRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        stemMaterial: rule[0],
        stemMaterialZh: rule[1],
      }
    : {
        stemMaterial: "unknown",
        stemMaterialZh: "",
      };
}

function parseEngineeringFeature(name) {
  const text = normalizeText(name);
  const rule = engineeringFeatureRules.find(([, , regex]) => regex.test(text));

  return rule
    ? {
        engineeringFeature: rule[0],
        engineeringFeatureZh: rule[1],
      }
    : {
        engineeringFeature: "unknown",
        engineeringFeatureZh: "",
      };
}

function removeKnownTokens(value) {
  let text = value;

  for (const pattern of [
    ...engineeringFeatureTokenPatterns,
    ...grainPatternTokenPatterns,
    ...shapeTokenPatterns,
    ...finishTokenPatterns,
    ...stemMaterialTokenPatterns,
  ]) {
    text = text.replace(pattern, " ");
  }

  return text
    .replace(/\bPipe\b/gi, " ")
    .replace(/(^|\s)w\.\s*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:^|,\s*)[, ]+(?=,|$)/g, "")
    .replace(/^[-, ]+|[-, ]+$/g, "")
    .trim();
}

function getNameCore(productName, rawBrand, canonicalBrand) {
  const prefixes = [rawBrand, canonicalBrand].filter(Boolean);
  let text = normalizeText(productName);

  for (const prefix of prefixes) {
    const exactPrefix = `${prefix},`;
    if (text.toLowerCase().startsWith(exactPrefix.toLowerCase())) {
      text = text.slice(exactPrefix.length).trim();
      break;
    }
  }

  const parts = text
    .split(",")
    .map((part) => removeKnownTokens(part))
    .filter(Boolean);

  return parts.slice(0, 3).join(" ").trim();
}

function buildNameZh({
  product,
  brandZh,
  canonicalBrand,
  shapeZh,
  grainPatternZh,
  finishZh,
  colorZh,
  stemMaterialZh,
  engineeringFeatureZh,
  bendType,
}) {
  const core = getNameCore(product.name, product.brand, canonicalBrand);
  const isCoreOnlyColor =
    colorZh &&
    new RegExp(`^(?:${colorRules.map(([color]) => color.replace("-", "\\s+")).join("|")})$`, "i").test(core);
  const displayCore = isCoreOnlyColor ? "" : core;
  const displayFinish = finishZh && colorZh ? `${finishZh}${colorZh}` : finishZh;
  const bendOnlyZh =
    !shapeZh && bendType === "straight"
      ? "直斗"
      : !shapeZh && bendType === "bent"
        ? "弯斗"
        : "";
  const chunks = [
    brandZh || canonicalBrand,
    displayCore,
    engineeringFeatureZh,
    grainPatternZh,
    displayFinish,
    stemMaterialZh,
    shapeZh || bendOnlyZh,
  ]
    .map(normalizeText)
    .filter(Boolean);
  const baseName = chunks.join(" ").replace(/\s+/g, " ").trim();

  if (!baseName) {
    return "";
  }

  if (baseName.endsWith("斗") || baseName.endsWith("烟斗")) {
    return baseName;
  }

  return stemMaterialZh || engineeringFeatureZh
    ? `${baseName}烟斗`
    : `${baseName}斗`;
}

function getBrandLookup() {
  const lookup = new Map();

  for (const profile of brandContentProfiles) {
    const canonical = normalizeBrandForIndex(profile.name);
    const existing = lookup.get(canonical.canonicalSlug) || {};

    lookup.set(canonical.canonicalSlug, {
      ...existing,
      nameZh: existing.nameZh || profile.nameZh || "",
      country: existing.country || profile.country || "",
      countryEn: existing.countryEn || profile.countryEn || "",
    });
  }

  return lookup;
}

function unique(items) {
  return Array.from(
    new Set(items.map((item) => normalizeText(item)).filter(Boolean))
  );
}

const brandLookup = getBrandLookup();

const sourceText = fs.readFileSync(inputPath, "utf8");
const products = JSON.parse(extractExportedArray(sourceText, "danishProducts"));

const enrichedProducts = products.map((product) => {
  const canonical = normalizeBrandForIndex(product.brand);
  const brandMeta = brandLookup.get(canonical.canonicalSlug) || {};
  const engineeringInfo = parseEngineeringFeature(product.name);
  const shapeInfo = parseShape(product, engineeringInfo.engineeringFeature);
  const grainPatternInfo = parseGrainPattern(product);
  const finishInfo = parseFinish(product.name);
  const colorInfo = parseColor(product.name);
  const materialInfo = parseMaterial(product.name);
  const stemMaterialInfo = parseStemMaterial(product.name);
  const weightGrams = parseWeight(product.specsText);
  const weightRange = getWeightRange(weightGrams);
  const dimensions = {
    bowlOuterDiameterMm: parseSpecValue(product.specsText, "A", "斗钵壁直径|bowl"),
    chamberDiameterMm: parseSpecValue(product.specsText, "B", "斗钵室内径|chamber.*diameter"),
    chamberDepthMm: parseSpecValue(product.specsText, "C", "斗钵室深|chamber.*depth"),
    heightMm: parseSpecValue(product.specsText, "D", "高度|height"),
    lengthMm: parseSpecValue(product.specsText, "E", "长度|length"),
    buttonWidthMm: parseSpecValue(product.specsText, "F", "button width|咬嘴宽度"),
    bitThicknessMm: parseSpecValue(product.specsText, "G", "bit thickness|咬嘴厚度"),
  };

  const nameZh = buildNameZh({
    product,
    brandZh: brandMeta.nameZh,
    canonicalBrand: canonical.canonicalName,
    shapeZh: shapeInfo.shapeZh,
    grainPatternZh: grainPatternInfo.grainPatternZh,
    finishZh: finishInfo.finishZh,
    colorZh: colorInfo.colorZh,
    stemMaterialZh: stemMaterialInfo.stemMaterialZh,
    engineeringFeatureZh: engineeringInfo.engineeringFeatureZh,
    bendType: shapeInfo.bendType,
  });
  const parseWarnings = ["nameZh:auto-generated"];

  if (shapeInfo.shape === "unknown") parseWarnings.push("shape:unknown");
  if (finishInfo.finish === "unknown") parseWarnings.push("finish:unknown");
  if (materialInfo.material === "unknown") parseWarnings.push("material:unknown");
  if (stemMaterialInfo.stemMaterial === "unknown") parseWarnings.push("stemMaterial:unknown");
  if (engineeringInfo.engineeringFeature === "unknown") parseWarnings.push("engineeringFeature:unknown");
  if (grainPatternInfo.grainPattern === "unknown") parseWarnings.push("grainPattern:unknown");
  if (!Number.isFinite(weightGrams)) parseWarnings.push("weight:unknown");

  const parsedTags = unique([
    canonical.canonicalName,
    brandMeta.country,
    shapeInfo.shapeZh,
    grainPatternInfo.grainPatternZh,
    finishInfo.finishZh,
    materialInfo.materialZh,
    stemMaterialInfo.stemMaterialZh,
    engineeringInfo.engineeringFeatureZh,
    weightRange !== "unknown" ? weightRange : "",
    product.conditionLabel,
  ]);

  return {
    ...product,
    nameZh,
    canonicalBrand: canonical.canonicalName,
    canonicalBrandSlug: canonical.canonicalSlug,
    brandCountry: brandMeta.country || "",
    brandCountryEn: brandMeta.countryEn || "",
    shape: shapeInfo.shape,
    shapeZh: shapeInfo.shapeZh,
    shapeGroup: shapeInfo.shapeGroup,
    bendType: shapeInfo.bendType,
    finish: finishInfo.finish,
    finishZh: finishInfo.finishZh,
    material: materialInfo.material,
    materialZh: materialInfo.materialZh,
    stemMaterial: stemMaterialInfo.stemMaterial,
    stemMaterialZh: stemMaterialInfo.stemMaterialZh,
    engineeringFeature: engineeringInfo.engineeringFeature,
    engineeringFeatureZh: engineeringInfo.engineeringFeatureZh,
    grainPattern: grainPatternInfo.grainPattern,
    grainPatternZh: grainPatternInfo.grainPatternZh,
    weightGrams: Number.isFinite(weightGrams) ? weightGrams : null,
    weightRange,
    dimensions,
    parsedTags,
    parseWarnings,
  };
});

const output = `import type { PipeProduct } from "./pipes";

export type DanishPipeProduct = PipeProduct & {
  detailImageUrl: string;
  productCode: string;
  originalUrl: string;
  price: string;
  conditionType: string;
  smokedStatus: string;
  conditionLabel: string;
  conditionSource: string;
  conditionNotes: string;
  estateStatus: string | null;
  estateRatingStars: number | null;
  estateRatingLabel: string;
  estateRatingNotes: string;
  imageMatchStatus: string;
  imageMatchNotes: string;
  galleryCount: number;
  nameZh: string;
  canonicalBrand: string;
  canonicalBrandSlug: string;
  brandCountry: string;
  brandCountryEn: string;
  shape: string;
  shapeZh: string;
  shapeGroup: string;
  bendType: string;
  finish: string;
  finishZh: string;
  material: string;
  materialZh: string;
  stemMaterial: string;
  stemMaterialZh: string;
  engineeringFeature: string;
  engineeringFeatureZh: string;
  grainPattern: string;
  grainPatternZh: string;
  weightGrams: number | null;
  weightRange: string;
  dimensions: {
    bowlOuterDiameterMm: number | null;
    chamberDiameterMm: number | null;
    chamberDepthMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    buttonWidthMm: number | null;
    bitThicknessMm: number | null;
  };
  parsedTags: string[];
  parseWarnings: string[];
};

export const danishProducts: DanishPipeProduct[] = ${JSON.stringify(enrichedProducts, null, 2)};
`;

fs.writeFileSync(inputPath, output, "utf8");

function countKnown(field) {
  return enrichedProducts.filter((product) => {
    const value = product[field];
    return value !== "" && value !== "unknown" && value !== null && value !== undefined;
  }).length;
}

console.log(`Enriched Danish products: ${inputPath}`);
console.log(
  JSON.stringify(
    {
      total: enrichedProducts.length,
      nameZh: countKnown("nameZh"),
      weightGrams: enrichedProducts.filter((product) =>
        Number.isFinite(product.weightGrams)
      ).length,
      shape: countKnown("shape"),
      finish: countKnown("finish"),
      country: countKnown("brandCountry"),
      material: countKnown("material"),
      stemMaterial: countKnown("stemMaterial"),
      engineeringFeature: countKnown("engineeringFeature"),
      grainPattern: countKnown("grainPattern"),
    },
    null,
    2
  )
);
