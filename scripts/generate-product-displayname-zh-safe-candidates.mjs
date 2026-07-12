import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "v8-finish-validator-hotfix-20260617";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const PATHS = {
  candidates: "data/i18n/product-displayname-zh-safe-candidates.json",
  report: "data/audits/product-displayname-zh-safe-candidates-report-20260616.json",
  samples: "data/audits/product-displayname-zh-safe-candidates-samples-20260616.md",
  brandFinal: "data/review/product-displayname-zh-brand-decisions-final-20260616.json",
  shapeFinal: "data/review/product-displayname-zh-shape-decisions-final-20260616.json",
};

function projectPath(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(projectPath(relativePath), "utf8"));
}

async function writeTextFile(relativePath, text) {
  const filePath = projectPath(relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
  await writeFile(filePath, `${normalized}\n`, "utf8");
}

async function writeJson(relativePath, value) {
  await writeTextFile(relativePath, JSON.stringify(value, null, 2));
}

async function sha256File(relativePath) {
  const data = await readFile(projectPath(relativePath));
  return createHash("sha256").update(data).digest("hex");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexiblePattern(value) {
  return escapeRegExp(cleanText(value)).replace(/\s+/g, "\\s+");
}

function makeBoundaryPattern(value, flags = "i") {
  return new RegExp(`(^|[^A-Za-z0-9])(${flexiblePattern(value)})(?=$|[^A-Za-z0-9])`, flags);
}

function replaceBoundary(value, token, replacement) {
  const pattern = makeBoundaryPattern(token, "gi");
  return cleanText(String(value || "").replace(pattern, (_m, prefix) => `${prefix}${replacement}`));
}

function startsWithToken(value, token) {
  const text = cleanText(value);
  const pattern = new RegExp(`^${flexiblePattern(token)}(?:$|[\\s,，:：|/()_-])`, "i");
  return pattern.test(text);
}

function stripLeadingToken(value, token) {
  const text = cleanText(value);
  const pattern = new RegExp(`^${flexiblePattern(token)}(?:[\\s,，:：|/()_-]+|$)`, "i");
  return cleanText(text.replace(pattern, ""));
}

function replaceLeadingToken(value, token, replacement) {
  const text = cleanText(value);
  if (!startsWithToken(text, token)) return text;
  const rest = stripLeadingToken(text, token);
  return cleanTitle(`${replacement}${rest ? ` ${rest}` : ""}`);
}

function cleanTitle(value) {
  let text = cleanText(value);
  text = text
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/，\s*，+/g, "，")
    .replace(/\s+，/g, "，")
    .replace(/[,，]\s*系列/g, " 系列")
    .replace(/\s+-\s+/g, "-")
    .replace(/\s+\/\s+/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^(,|，|\/)+\s*/, "").replace(/\s*(,|，|\/)+$/, "");
  text = text.replace(/\bAutograph\s+Autograph\b/gi, "Autograph");
  text = text.replace(/\bIkebana\s+Ikebana\b/gi, "Ikebana");
  text = text.replace(/斗\s*斗/g, "斗");
  text = text.replace(/\s+斗\s+(郁金香斗|球形斗|河豚斗|十字镐斗|外交官斗|骑士斗|自由式斗|葫芦斗|号角斗|坐斗|匈牙利式斗|番茄斗|火山斗|暖鼻斗|大气室斗|酒桶斗|盾牌斗|草莓斗)/g, " $1");
  return cleanText(text);
}

function itemSearchText(item) {
  return cleanText(`${item.originalName || ""} ${item.displayNameZhV2 || ""} ${item.safeDisplayNameZh || ""} ${item.displayTitle || ""} ${item.subtitleOriginalName || ""}`);
}

function hasToken(text, token) {
  return makeBoundaryPattern(token).test(cleanText(text));
}

function titleHasShapeZh(title, zh) {
  return Boolean(zh && String(title || "").includes(zh));
}

function hasHornMaterialContext(item) {
  const text = itemSearchText(item);
  return (
    /\bw\.?\s*\/?\s*horn\b/i.test(text) ||
    /\bw\/\s*horn\b/i.test(text) ||
    /\bwith\s+(?:ox\s+)?horn\b/i.test(text) ||
    /\bhorn\s+(?:stem|mount|accent|ferrule|application|insert|band|extension|mouthpiece|adornment)\b/i.test(text) ||
    /\b(?:stem|mount|accent|ferrule|application|insert|band|extension|mouthpiece|adornment)\s+(?:of\s+)?horn\b/i.test(text)
  );
}


function originalShapeText(item) {
  return cleanText(`${item.originalName || ""} ${item.subtitleOriginalName || ""} ${item.displayNameEn || ""} ${item.rawTitle || ""}`);
}

const EXCLUSIVE_SHAPE_GROUPS = [
  ["橡果斗", "梨式斗"],
  ["面板斗", "骑士斗"],
  ["号角斗", "梨式斗", "橡果斗", "郁金香斗", "草莓斗", "番茄斗", "苹果斗"],
];

function removeZhShape(title, zh) {
  return cleanTitle(String(title || "").replace(new RegExp(`\\s*${escapeRegExp(zh)}\\s*`, "g"), " "));
}

function hasOriginalShapeToken(item, token) {
  return hasToken(originalShapeText(item), token);
}

function hasTitleShapeZh(title, zh) {
  return String(title || "").includes(zh);
}

function resolveAcornPearTitle(item, title) {
  const original = originalShapeText(item);
  const originalHasComposite = /\bAcorn\s*\/\s*Pear\b|\bAcorn\s+Pear\b/i.test(original);
  const originalHasPear = hasToken(original, "Pear");
  const originalHasAcorn = hasToken(original, "Acorn");
  let text = cleanTitle(title);

  if (originalHasComposite) {
    // Legacy Acorn/Pear is not a real unified shape. If the original itself is only the
    // composite value, do not let either translated shape leak into the title.
    text = removeZhShape(text, "橡果斗");
    text = removeZhShape(text, "梨式斗");
  } else if (originalHasPear && !originalHasAcorn) {
    text = removeZhShape(text, "橡果斗");
    if (!hasTitleShapeZh(text, "梨式斗")) text = cleanTitle(`${text} 梨式斗`);
  } else if (originalHasAcorn && !originalHasPear) {
    text = removeZhShape(text, "梨式斗");
    if (!hasTitleShapeZh(text, "橡果斗")) text = cleanTitle(`${text} 橡果斗`);
  } else if (!originalHasPear && !originalHasAcorn) {
    // If neither source title nor English subtitle says Acorn/Pear, any legacy Acorn/Pear
    // Chinese label came from an ambiguous old bucket and should be suppressed.
    text = removeZhShape(text, "橡果斗");
    text = removeZhShape(text, "梨式斗");
  } else if (hasTitleShapeZh(text, "橡果斗") && hasTitleShapeZh(text, "梨式斗")) {
    if (/\bPear\b/i.test(original)) text = removeZhShape(text, "橡果斗");
    else text = removeZhShape(text, "梨式斗");
  }

  return cleanTitle(text);
}

function suppressPanelWhenSpecificShapePresent(title) {
  let text = cleanTitle(title);
  if (/骑士斗/.test(text)) text = removeZhShape(text, "面板斗");
  return cleanTitle(text);
}

function suppressHornWhenMaterial(item, title) {
  let text = cleanTitle(title);
  if (hasHornMaterialContext(item)) {
    text = removeZhShape(text, "号角斗");
  }
  return cleanTitle(text);
}

function suppressDoNotDisplayShapeTokens(title) {
  let text = cleanTitle(title);
  text = text.replace(/\b(?:Devil\s+Anse|Stack|Skater)\s*斗\b/gi, " ");
  text = text.replace(/\b(?:Devil\s+Anse|Stack|Skater)\b/gi, " ");
  // Removing Stack/Skater can leave an orphan generic "斗" token, e.g. "喷砂 斗".
  // A standalone "斗" is not a valid shape and should not be displayed.
  text = text.replace(/(^|[\s，,])斗(?=$|[\s，,])/g, " ");
  return cleanTitle(text);
}



function translateFinishTerms(title) {
  let text = cleanTitle(title);
  const replacements = [
    [/\bPartially\s+Sandblasted\b/gi, "局部喷砂"],
    [/\bPartial\s+Sandblasted\b/gi, "局部喷砂"],
    [/\bPartially\s+Rusticated\b/gi, "局部锈蚀"],
    [/\bPartial\s+Rusticated\b/gi, "局部锈蚀"],
    [/\bLight\s+Polished\b/gi, "浅色抛光"],
    [/\bMatte\b/gi, "哑光"],
    [/\bMatt\b/gi, "哑光"],
    [/\bMat\b/gi, "哑光"],
    [/\bSandblasted\b/gi, "喷砂"],
    [/\bSandblast\b/gi, "喷砂"],
    [/\bRusticated\b/gi, "锈蚀"],
    [/\bRustication\b/gi, "锈蚀"],
    [/\bRustic\b/gi, "锈蚀"],
    [/\bSmooth\b/gi, "光面"],
    [/\bSablee\b/gi, "喷砂"],
    [/\bSablée\b/gi, "喷砂"],
    [/\bSand\b/gi, "喷砂"],
    [/\bNatural\b/gi, "自然色"],
    [/\bPolished\b/gi, "抛光"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/喷砂\s+喷砂/g, "喷砂")
    .replace(/锈蚀\s+锈蚀/g, "锈蚀")
    .replace(/光面\s+光面/g, "光面")
    .replace(/局部\s+喷砂/g, "局部喷砂")
    .replace(/局部\s+锈蚀/g, "局部锈蚀");

  return cleanTitle(text);
}

function ensureFinalShapeConsistency(item, title) {
  let text = cleanTitle(title);
  text = suppressDoNotDisplayShapeTokens(text);
  text = suppressHornWhenMaterial(item, text);
  text = resolveAcornPearTitle(item, text);
  text = suppressPanelWhenSpecificShapePresent(text);
  text = text.replace(/\s+斗\s+/g, " ");
  text = text.replace(/\bPear\s*Fishtail\b/gi, "Fishtail");
  return cleanTitle(text);
}

function stripShapeTokensFromSeries(title, shapeKey) {
  let text = cleanText(title);
  const parts = cleanText(shapeKey).split(/\s+/).filter(Boolean);
  const variants = new Set([shapeKey]);
  if (parts.length > 1) {
    variants.add(parts[parts.length - 1]);
  }
  for (const variant of variants) {
    const pattern = new RegExp(`(?:^|[\\s,，])(?:Bent|Straight|Canted|Stubby)?\\s*${flexiblePattern(variant)}(?=\\s*系列|[\\s,，]|$)`, "gi");
    text = text.replace(pattern, " ");
  }
  return cleanTitle(text);
}

function removeWarning(warnings, warning) {
  return warnings.filter((item) => item !== warning);
}

function addWarning(warnings, warning) {
  return warnings.includes(warning) ? warnings : [...warnings, warning];
}

function buildFinalBrandRules(brandFinal) {
  const decisions = [];
  for (const [brand, decision] of Object.entries(brandFinal.brandDecisions || {})) {
    decisions.push({
      brand,
      normalizedBrand: normalizeKey(brand),
      action: decision.action,
      zh: cleanText(decision.zh),
      decision,
    });
  }
  decisions.sort((a, b) => b.brand.length - a.brand.length);

  const aliases = [];
  for (const [alias, correction] of Object.entries(brandFinal.brandAliasCorrections || {})) {
    aliases.push({
      alias,
      normalizedAlias: normalizeKey(alias),
      action: correction.action,
      canonicalBrand: cleanText(correction.canonicalBrand),
      brandZh: cleanText(correction.brandZh),
      series: cleanText(correction.series),
      descriptor: cleanText(correction.descriptor),
      correction,
    });
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length);

  return { decisions, aliases };
}

function buildFinalShapeRules(shapeFinal) {
  const decisions = [];
  const doNotDisplay = new Set(shapeFinal.doNotDisplayShapeKeywords || []);
  for (const [shape, decision] of Object.entries(shapeFinal.shapeDecisions || {})) {
    decisions.push({
      shape,
      normalizedShape: normalizeKey(shape),
      action: decision.action,
      zh: cleanText(decision.zh),
      display: decision.display !== false,
      isShape: decision.isShape !== false,
      decision,
    });
  }

  const extraShapeDecisions = {
    Acorn: { action: "translate", zh: "橡果斗", display: true, isShape: true },
    Pear: { action: "translate", zh: "梨式斗", display: true, isShape: true },
    Panel: { action: "translate", zh: "面板斗", display: true, isShape: true },
    Paneled: { action: "translate", zh: "面板斗", display: true, isShape: true },
    Chimney: { action: "translate", zh: "烟囱式斗", display: true, isShape: true },
    Cutty: { action: "translate", zh: "卡蒂斗", display: true, isShape: true },
    Figural: { action: "translate", zh: "造型雕刻斗", display: true, isShape: true },
    Hawkbill: { action: "translate", zh: "鹰嘴斗", display: true, isShape: true },
    Lumberman: { action: "translate", zh: "伐木工式斗", display: true, isShape: true },
    "Oom Paul": { action: "translate", zh: "匈牙利式斗", display: true, isShape: true },
    Opera: { action: "translate", zh: "歌剧斗", display: true, isShape: true },
    Zulu: { action: "translate", zh: "祖鲁斗", display: true, isShape: true },
    Stack: { action: "do-not-display", zh: "", display: false, isShape: false },
    Skater: { action: "do-not-display", zh: "", display: false, isShape: false },
  };

  const existing = new Set(decisions.map((decision) => normalizeKey(decision.shape)));
  for (const [shape, decision] of Object.entries(extraShapeDecisions)) {
    if (existing.has(normalizeKey(shape))) continue;
    decisions.push({
      shape,
      normalizedShape: normalizeKey(shape),
      action: decision.action,
      zh: cleanText(decision.zh),
      display: decision.display !== false,
      isShape: decision.isShape !== false,
      decision,
    });
  }

  decisions.sort((a, b) => b.shape.length - a.shape.length);
  return { decisions, doNotDisplay };
}

function applyAliasCorrections(item, title, aliases) {
  let currentTitle = cleanTitle(title);
  let applied = null;
  const searchText = itemSearchText(item);

  for (const rule of aliases) {
    const matchesAlias = hasToken(searchText, rule.alias) || normalizeKey(searchText).includes(rule.normalizedAlias);
    if (!matchesAlias) continue;

    const brandLabel = rule.brandZh || rule.canonicalBrand || rule.alias;
    const seriesOrDescriptor = rule.series || rule.descriptor || "";

    if (startsWithToken(currentTitle, rule.alias)) {
      currentTitle = replaceLeadingToken(currentTitle, rule.alias, brandLabel);
    } else if (startsWithToken(currentTitle, `${rule.canonicalBrand} ${seriesOrDescriptor}`)) {
      currentTitle = replaceLeadingToken(currentTitle, `${rule.canonicalBrand} ${seriesOrDescriptor}`, `${brandLabel}${seriesOrDescriptor ? ` ${seriesOrDescriptor}` : ""}`);
    } else if (rule.alias === "Savinelli Autograph" && /^Savinelli\s+Autograph\b/i.test(currentTitle)) {
      currentTitle = currentTitle.replace(/^Savinelli\s+Autograph\b/i, "沙芬 Autograph");
    } else if (rule.alias === "Tsuge Ikebana" && /^Tsuge\s+Ikebana\b/i.test(currentTitle)) {
      currentTitle = currentTitle.replace(/^Tsuge\s+Ikebana\b/i, "拓植 Ikebana");
    } else if (startsWithToken(currentTitle, rule.canonicalBrand)) {
      currentTitle = replaceLeadingToken(currentTitle, rule.canonicalBrand, brandLabel);
      if (seriesOrDescriptor && !hasToken(currentTitle, seriesOrDescriptor)) {
        const rest = stripLeadingToken(currentTitle, brandLabel);
        currentTitle = cleanTitle(`${brandLabel} ${seriesOrDescriptor}${rest ? ` ${rest}` : ""}`);
      }
    } else if (rule.alias === "SON (Nording)" && /SON\s*\(Nording\)/i.test(searchText)) {
      currentTitle = replaceLeadingToken(currentTitle, "SON", `${brandLabel} SON`);
    }

    if (rule.series) {
      currentTitle = cleanTitle(currentTitle.replace(new RegExp(`\\b${flexiblePattern(rule.series)}\\s+${flexiblePattern(rule.series)}\\b`, "gi"), rule.series));
    }

    applied = rule;
    break;
  }

  return { title: cleanTitle(currentTitle), applied };
}

function detectBrandDecision(item, title, decisions) {
  const original = cleanText(item.originalName || item.subtitleOriginalName || "");

  // Highest confidence: the current generated title starts with the brand token.
  // This is critical for Smokingpipes items whose original title may contain maker names
  // in parentheses, e.g. GH Zhang item titles containing Dirk Heinemann.
  for (const rule of decisions) {
    if (startsWithToken(title, rule.brand)) return rule;
  }

  // Next: source original title starts with brand, optionally prefixed by Estate.
  const originalWithoutEstate = cleanText(original.replace(/^Estate\s+/i, ""));
  for (const rule of decisions) {
    if (startsWithToken(originalWithoutEstate, rule.brand)) return rule;
  }

  // Last resort: title contains the brand token somewhere.
  for (const rule of decisions) {
    if (hasToken(title, rule.brand)) return rule;
  }

  return null;
}

function applyBrandDecision(item, title, rule) {
  if (!rule) return { title, applied: null };
  let currentTitle = cleanTitle(title);
  if (rule.action === "translate" && rule.zh) {
    if (startsWithToken(currentTitle, rule.brand)) {
      currentTitle = replaceLeadingToken(currentTitle, rule.brand, rule.zh);
    } else if (hasToken(currentTitle, rule.brand)) {
      currentTitle = replaceBoundary(currentTitle, rule.brand, rule.zh);
    } else {
      const normalizedTitle = normalizeKey(currentTitle);
      if (!normalizedTitle.startsWith(normalizeKey(rule.zh))) {
        currentTitle = cleanTitle(`${rule.zh} ${currentTitle}`);
      }
    }
  }
  return { title: cleanTitle(currentTitle), applied: rule };
}

function applyShapeDecision(item, title, rule) {
  let currentTitle = cleanTitle(title);
  const searchText = itemSearchText(item);

  if (!hasToken(searchText, rule.shape) && !hasToken(currentTitle, rule.shape)) {
    return { title: currentTitle, applied: false, suppressed: false, hornMaterial: false };
  }

  if (rule.shape === "Horn" && hasHornMaterialContext(item)) {
    currentTitle = currentTitle.replace(/\s*号角斗\s*/g, " ");
    currentTitle = cleanTitle(currentTitle);
    return { title: currentTitle, applied: false, suppressed: false, hornMaterial: true };
  }

  if (rule.display === false || rule.action === "do-not-display") {
    const tokenDou = new RegExp(`\\b${flexiblePattern(rule.shape)}\\s*斗\\b`, "gi");
    const tokenSeries = new RegExp(`(?:^|[\\s,，])${flexiblePattern(rule.shape)}\\s*系列(?=\\s|$)`, "gi");
    const tokenPlain = new RegExp(`\\b${flexiblePattern(rule.shape)}\\b`, "gi");
    currentTitle = currentTitle
      .replace(tokenDou, " ")
      .replace(tokenSeries, " ")
      .replace(tokenPlain, " ");
    return { title: cleanTitle(currentTitle), applied: false, suppressed: true, hornMaterial: false };
  }

  if (!rule.zh) return { title: currentTitle, applied: false, suppressed: false, hornMaterial: false };

  const englishDouTestPattern = new RegExp(`\\b${flexiblePattern(rule.shape)}\\s*斗\\b`, "i");
  const englishDouPattern = new RegExp(`\\b${flexiblePattern(rule.shape)}\\s*斗\\b`, "gi");
  const hadEnglishDou = englishDouTestPattern.test(currentTitle);
  currentTitle = currentTitle.replace(englishDouPattern, rule.zh);

  const oldZhByShape = {
    Freehand: "自由手工斗",
  };
  if (oldZhByShape[rule.shape]) {
    currentTitle = currentTitle.replace(new RegExp(escapeRegExp(oldZhByShape[rule.shape]), "g"), rule.zh);
  }

  const alreadyHasZh = titleHasShapeZh(currentTitle, rule.zh);
  const shouldAppend = !alreadyHasZh && (hadEnglishDou || hasToken(searchText, rule.shape));
  if (shouldAppend) {
    currentTitle = stripShapeTokensFromSeries(currentTitle, rule.shape);
    currentTitle = cleanTitle(`${currentTitle} ${rule.zh}`);
  }

  currentTitle = stripShapeTokensFromSeries(currentTitle, rule.shape);
  if (!titleHasShapeZh(currentTitle, rule.zh) && shouldAppend) {
    currentTitle = cleanTitle(`${currentTitle} ${rule.zh}`);
  }

  return { title: cleanTitle(currentTitle), applied: titleHasShapeZh(currentTitle, rule.zh), suppressed: false, hornMaterial: false };
}

function finalCleanTitle(item, title) {
  let text = cleanTitle(title);
  text = text.replace(/\bSavinelli\s+Autograph\s+Autograph\b/gi, "沙芬 Autograph");
  text = text.replace(/\bTsuge\s+Ikebana\s+Ikebana\b/gi, "拓植 Ikebana");
  text = text.replace(/\bTulip\s*斗\b/gi, "郁金香斗");
  text = text.replace(/\bBall\s*斗\b/gi, "球形斗");
  text = text.replace(/\bBlowfish\s*斗\b/gi, "河豚斗");
  text = text.replace(/\bPickaxe\s*斗\b/gi, "十字镐斗");
  text = text.replace(/\bDiplomat\s*斗\b/gi, "外交官斗");
  text = text.replace(/\bCavalier\s*斗\b/gi, "骑士斗");
  text = text.replace(/\bPear\s*斗\b/gi, "梨式斗");
  text = text.replace(/\bPanel(?:ed)?\s*斗\b/gi, "面板斗");
  text = text.replace(/\bChimney\s*斗\b/gi, "烟囱式斗");
  text = text.replace(/\bCutty\s*斗\b/gi, "卡蒂斗");
  text = text.replace(/\bFigural\s*斗\b/gi, "造型雕刻斗");
  text = text.replace(/\bHawkbill\s*斗\b/gi, "鹰嘴斗");
  text = text.replace(/\bLumberman\s*斗\b/gi, "伐木工式斗");
  text = text.replace(/\bOom\s+Paul\s*斗\b/gi, "匈牙利式斗");
  text = text.replace(/\bOpera\s*斗\b/gi, "歌剧斗");
  text = text.replace(/\bZulu\s*斗\b/gi, "祖鲁斗");
  text = text.replace(/面板斗\s+骑士斗/g, "骑士斗");
  text = text.replace(/骑士斗\s+面板斗/g, "骑士斗");
  text = text.replace(/\bStack\s*斗\b/gi, "");
  text = text.replace(/\bSkater\s*斗\b/gi, "");
  text = text.replace(/\bStack\b/gi, "");
  text = text.replace(/\bSkater\b/gi, "");
  if (hasHornMaterialContext(item)) {
    text = text.replace(/\s*号角斗\s*/g, " ");
  }
  text = ensureFinalShapeConsistency(item, text);
  text = translateFinishTerms(text);
  return cleanTitle(text);
}

function updateItem(item, brandRules, shapeRules) {
  const beforeTitle = cleanTitle(item.displayTitle || item.safeDisplayNameZh || item.displayNameZhV2 || item.originalName);
  let title = beforeTitle;
  const warnings = Array.isArray(item.warnings) ? [...item.warnings] : [];
  const stats = {
    changed: false,
    brandFinalApplied: 0,
    shapeFinalApplied: 0,
    aliasCorrectionApplied: 0,
    doNotDisplayShapeSuppressed: 0,
    hornMaterialContext: 0,
    hornAsShape: 0,
  };

  const aliasResult = applyAliasCorrections(item, title, brandRules.aliases);
  title = aliasResult.title;
  if (aliasResult.applied) {
    stats.aliasCorrectionApplied = 1;
  }

  const brandRule = detectBrandDecision(item, title, brandRules.decisions);
  const brandResult = applyBrandDecision(item, title, brandRule);
  title = brandResult.title;
  if (brandResult.applied) {
    stats.brandFinalApplied = 1;
  }

  let finalWarnings = warnings;
  if (aliasResult.applied || brandResult.applied) {
    finalWarnings = removeWarning(finalWarnings, "brandUnconfirmed");
  }

  for (const rule of shapeRules.decisions) {
    const shapeResult = applyShapeDecision(item, title, rule);
    if (shapeResult.title !== title) {
      title = shapeResult.title;
    }
    if (shapeResult.applied) {
      stats.shapeFinalApplied += 1;
      finalWarnings = removeWarning(finalWarnings, "unconfirmedShapeKeyword");
      if (rule.shape === "Horn") stats.hornAsShape = 1;
    }
    if (shapeResult.suppressed) {
      stats.doNotDisplayShapeSuppressed += 1;
      finalWarnings = removeWarning(finalWarnings, "unconfirmedShapeKeyword");
    }
    if (shapeResult.hornMaterial) {
      stats.hornMaterialContext = 1;
      finalWarnings = addWarning(finalWarnings, "hornMaterialContext");
    }
  }

  title = finalCleanTitle(item, title);
  stats.changed = title !== beforeTitle;

  const nextItem = {
    ...item,
    safeDisplayNameZh: title,
    displayTitle: title,
    warnings: finalWarnings,
  };

  if (aliasResult.applied) {
    nextItem.brandZhSource = "final-human-alias-correction";
  } else if (brandResult.applied) {
    nextItem.brandZhSource = brandResult.applied.action === "translate" ? "final-human-translate" : "final-human-keep-original";
  }

  return { item: nextItem, beforeTitle, afterTitle: title, stats };
}

function countByQuality(items) {
  const counts = { ready: 0, candidate: 0, "fallback-original": 0 };
  for (const item of items) {
    counts[item.quality] = (counts[item.quality] || 0) + 1;
  }
  return counts;
}

function countBySource(items) {
  const counts = {};
  for (const item of items) counts[item.source] = (counts[item.source] || 0) + 1;
  return counts;
}

function countWarnings(items) {
  const map = new Map();
  for (const item of items) {
    for (const warning of item.warnings || []) {
      map.set(warning, (map.get(warning) || 0) + 1);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([warning, count]) => ({ warning, count }));
}

function makeSample(changes, matcher, limit = 8) {
  return changes.filter(matcher).slice(0, limit).map((change) => ({
    id: change.item.id,
    source: change.item.source,
    originalName: change.item.originalName,
    beforeDisplayTitle: change.beforeTitle,
    afterDisplayTitle: change.afterTitle,
    quality: change.item.quality,
    warnings: change.item.warnings,
  }));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# 商品中文展示名 Safe Candidates Final Apply Report 20260616");
  lines.push("");
  lines.push(`生成脚本版本：${report.generatorVersion}`);
  lines.push("");
  lines.push("## 核心统计");
  lines.push("");
  lines.push(`- total: ${report.summary.total}`);
  lines.push(`- ready: ${report.summary.ready}`);
  lines.push(`- candidate: ${report.summary.candidate}`);
  lines.push(`- fallback-original: ${report.summary["fallback-original"]}`);
  lines.push(`- brandFinalAppliedCount: ${report.finalApplyStats.brandFinalAppliedCount}`);
  lines.push(`- shapeFinalAppliedCount: ${report.finalApplyStats.shapeFinalAppliedCount}`);
  lines.push(`- aliasCorrectionAppliedCount: ${report.finalApplyStats.aliasCorrectionAppliedCount}`);
  lines.push(`- doNotDisplayShapeSuppressedCount: ${report.finalApplyStats.doNotDisplayShapeSuppressedCount}`);
  lines.push(`- hornMaterialContextCount: ${report.finalApplyStats.hornMaterialContextCount}`);
  lines.push(`- hornAsShapeCount: ${report.finalApplyStats.hornAsShapeCount}`);
  lines.push(`- titlesWithStackDouCount: ${report.finalValidation.titlesWithStackDouCount}`);
  lines.push(`- titlesWithSkaterDouCount: ${report.finalValidation.titlesWithSkaterDouCount}`);
  lines.push("");
  lines.push("## 关键样本");
  lines.push("");
  for (const [section, samples] of Object.entries(report.samples)) {
    lines.push(`### ${section}`);
    lines.push("");
    if (!samples.length) {
      lines.push("无样本。");
      lines.push("");
      continue;
    }
    lines.push("| id | 原名 | 修改前 | 修改后 | warnings |");
    lines.push("|---|---|---|---|---|");
    for (const sample of samples) {
      lines.push(`| ${sample.id} | ${sample.originalName} | ${sample.beforeDisplayTitle} | ${sample.afterDisplayTitle} | ${(sample.warnings || []).join(", ")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function ensureInputFiles() {
  const required = [PATHS.candidates, PATHS.brandFinal, PATHS.shapeFinal];
  const missing = required.filter((relativePath) => !existsSync(projectPath(relativePath)));
  if (missing.length) {
    throw new Error(`Missing required input files: ${missing.join(", ")}`);
  }
}

async function main() {
  ensureInputFiles();

  const candidates = await readJson(PATHS.candidates);
  const brandFinal = await readJson(PATHS.brandFinal);
  const shapeFinal = await readJson(PATHS.shapeFinal);
  const items = Array.isArray(candidates.items) ? candidates.items : [];

  if (items.length !== 7301) {
    throw new Error(`Expected 7301 candidate items, got ${items.length}`);
  }

  const brandRules = buildFinalBrandRules(brandFinal);
  const shapeRules = buildFinalShapeRules(shapeFinal);

  const changes = [];
  const nextItems = [];
  const totals = {
    brandFinalAppliedCount: 0,
    shapeFinalAppliedCount: 0,
    aliasCorrectionAppliedCount: 0,
    doNotDisplayShapeSuppressedCount: 0,
    hornMaterialContextCount: 0,
    hornAsShapeCount: 0,
    changedTitleCount: 0,
  };

  for (const item of items) {
    const result = updateItem(item, brandRules, shapeRules);
    nextItems.push(result.item);
    changes.push(result);
    totals.brandFinalAppliedCount += result.stats.brandFinalApplied;
    totals.shapeFinalAppliedCount += result.stats.shapeFinalApplied;
    totals.aliasCorrectionAppliedCount += result.stats.aliasCorrectionApplied;
    totals.doNotDisplayShapeSuppressedCount += result.stats.doNotDisplayShapeSuppressed;
    totals.hornMaterialContextCount += result.stats.hornMaterialContext;
    totals.hornAsShapeCount += result.stats.hornAsShape;
    totals.changedTitleCount += result.stats.changed ? 1 : 0;
  }

  const summaryByQuality = countByQuality(nextItems);
  const nextCandidates = {
    ...candidates,
    schemaVersion: `${candidates.schemaVersion || "product-displayname-zh-safe-candidates"}+${SCRIPT_VERSION}`,
    generatedFrom: {
      ...(candidates.generatedFrom || {}),
      finalApplyScript: SCRIPT_VERSION,
      brandFinal: PATHS.brandFinal,
      shapeFinal: PATHS.shapeFinal,
    },
    summary: {
      ...(candidates.summary || {}),
      total: nextItems.length,
      ready: summaryByQuality.ready || 0,
      candidate: summaryByQuality.candidate || 0,
      "fallback-original": summaryByQuality["fallback-original"] || 0,
      bySource: countBySource(nextItems),
    },
    items: nextItems,
  };

  await writeJson(PATHS.candidates, nextCandidates);

  const finalValidation = {
    titlesWithStackDouCount: nextItems.filter((item) => /Stack\s*斗/i.test(item.displayTitle)).length,
    titlesWithSkaterDouCount: nextItems.filter((item) => /Skater\s*斗/i.test(item.displayTitle)).length,
    titlesWithDoNotDisplayTokenCount: nextItems.filter((item) => /\b(?:Stack|Skater)\b/i.test(item.displayTitle)).length,
    titlesWithAcornPearCount: nextItems.filter((item) => /Acorn\s*\/\s*Pear|Acorn\s+Pear/i.test(item.displayTitle)).length,
    titlesWithBothAcornAndPearZhCount: nextItems.filter((item) => /橡果斗/.test(item.displayTitle || "") && /梨式斗/.test(item.displayTitle || "")).length,
    titlesWithHornMaterialAndHornZhCount: nextItems.filter((item) => hasHornMaterialContext(item) && /号角斗/.test(item.displayTitle || "")).length,
    titlesWithPanelAndCavalierZhCount: nextItems.filter((item) => /面板斗/.test(item.displayTitle || "") && /骑士斗/.test(item.displayTitle || "")).length,
    titlesWithTulipDouCount: nextItems.filter((item) => /Tulip\s*斗/i.test(item.displayTitle)).length,
    titlesWithBallDouCount: nextItems.filter((item) => /Ball\s*斗/i.test(item.displayTitle)).length,
    titlesWithBlowfishDouCount: nextItems.filter((item) => /Blowfish\s*斗/i.test(item.displayTitle)).length,
    titlesWithSavinelliAutographAsBrandCount: nextItems.filter((item) => /^Savinelli\s+Autograph\b/i.test(item.displayTitle)).length,
    titlesWithTsugeIkebanaAsBrandCount: nextItems.filter((item) => /^Tsuge\s+Ikebana\b/i.test(item.displayTitle)).length,
    emptyTitleCount: nextItems.filter((item) => !cleanText(item.displayTitle)).length,
  };

  const report = {
    status: "completed",
    generatorVersion: SCRIPT_VERSION,
    outputFiles: {
      candidates: PATHS.candidates,
      report: PATHS.report,
      samples: PATHS.samples,
    },
    summary: nextCandidates.summary,
    finalApplyStats: totals,
    finalValidation,
    warningsTop20: countWarnings(nextItems),
    samples: {
      brandFinal: makeSample(changes, (change) => change.stats.brandFinalApplied > 0),
      aliasCorrections: makeSample(changes, (change) => change.stats.aliasCorrectionApplied > 0),
      shapeFinal: makeSample(changes, (change) => change.stats.shapeFinalApplied > 0),
      doNotDisplaySuppressed: makeSample(changes, (change) => change.stats.doNotDisplayShapeSuppressed > 0),
      hornMaterialContext: makeSample(changes, (change) => change.stats.hornMaterialContext > 0),
      keyRegressionChecks: makeSample(
        changes,
        (change) => /S\. Bang|Tulip|Ball|Blowfish|Pickaxe|Diplomat|Savinelli Autograph|Tsuge Ikebana|Ser Jacopo/i.test(`${change.beforeTitle} ${change.afterTitle} ${change.item.originalName}`),
        20
      ),
    },
    sourceFileHashes: {
      candidates: await sha256File(PATHS.candidates),
      brandFinal: await sha256File(PATHS.brandFinal),
      shapeFinal: await sha256File(PATHS.shapeFinal),
    },
  };

  await writeJson(PATHS.report, report);
  await writeTextFile(PATHS.samples, buildMarkdown(report));

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", generatorVersion: SCRIPT_VERSION, error: error.message }, null, 2));
  process.exitCode = 1;
});
