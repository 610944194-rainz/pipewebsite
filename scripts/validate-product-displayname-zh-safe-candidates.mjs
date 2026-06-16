import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALIDATOR_VERSION = "v3-final-postprocess-20260616";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const PATHS = {
  candidates: "data/i18n/product-displayname-zh-safe-candidates.json",
  report: "data/audits/product-displayname-zh-safe-candidates-report-20260616.json",
  brandFinal: "data/review/product-displayname-zh-brand-decisions-final-20260616.json",
  shapeFinal: "data/review/product-displayname-zh-shape-decisions-final-20260616.json",
};

function projectPath(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(projectPath(relativePath), "utf8"));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textOf(item) {
  return `${item.originalName || ""} ${item.displayTitle || ""} ${item.safeDisplayNameZh || ""} ${item.subtitleOriginalName || ""}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexiblePattern(value) {
  return escapeRegExp(cleanText(value)).replace(/\s+/g, "\\s+");
}

function boundaryPattern(value) {
  return new RegExp(`(^|[^A-Za-z0-9])${flexiblePattern(value)}(?=$|[^A-Za-z0-9])`, "i");
}

function matchingItems(items, pattern) {
  return items.filter((item) => pattern.test(textOf(item)));
}

function titleMatchingItems(items, pattern) {
  return items.filter((item) => pattern.test(item.displayTitle || ""));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function sampleTitles(items, limit = 5) {
  return items.slice(0, limit).map((item) => `${item.id}: ${item.displayTitle}`).join(" | ");
}

async function main() {
  const errors = [];
  for (const relativePath of Object.values(PATHS)) {
    assert(existsSync(projectPath(relativePath)), `Missing file: ${relativePath}`, errors);
  }
  if (errors.length) throw new Error(errors.join("\n"));

  const candidates = await readJson(PATHS.candidates);
  const report = await readJson(PATHS.report);
  const brandFinal = await readJson(PATHS.brandFinal);
  const shapeFinal = await readJson(PATHS.shapeFinal);
  const items = Array.isArray(candidates.items) ? candidates.items : [];

  assert(items.length === 7301, `Expected 7301 items, got ${items.length}`, errors);
  assert(brandFinal?.brandDecisions && brandFinal?.brandAliasCorrections, "Brand final file is missing decisions/corrections", errors);
  assert(shapeFinal?.shapeDecisions, "Shape final file is missing shapeDecisions", errors);

  const emptyTitles = items.filter((item) => !cleanText(item.displayTitle));
  assert(emptyTitles.length === 0, `Empty displayTitle count: ${emptyTitles.length}`, errors);

  const bannedText = items.filter((item) => /undefined|\bnull\b|\bNaN\b|斗斗/i.test(item.displayTitle || ""));
  assert(bannedText.length === 0, `Banned text in displayTitle: ${sampleTitles(bannedText)}`, errors);

  const forbiddenShapeTitles = titleMatchingItems(items, /\b(?:Stack|Skater)\s*斗\b/i);
  assert(forbiddenShapeTitles.length === 0, `Forbidden Stack/Skater 斗 remains: ${sampleTitles(forbiddenShapeTitles)}`, errors);

  const forbiddenEnglishShapeTitles = titleMatchingItems(items, /\b(?:Tulip|Ball|Blowfish|Pickaxe|Diplomat|Cavalier)\s*斗\b/i);
  assert(forbiddenEnglishShapeTitles.length === 0, `English shape + 斗 remains: ${sampleTitles(forbiddenEnglishShapeTitles)}`, errors);

  const savinelliAliasBad = titleMatchingItems(items, /^Savinelli\s+Autograph\b/i);
  assert(savinelliAliasBad.length === 0, `Savinelli Autograph remains as title brand: ${sampleTitles(savinelliAliasBad)}`, errors);

  const tsugeAliasBad = titleMatchingItems(items, /^Tsuge\s+Ikebana\b/i);
  assert(tsugeAliasBad.length === 0, `Tsuge Ikebana remains as title brand: ${sampleTitles(tsugeAliasBad)}`, errors);

  const duplicateAutograph = titleMatchingItems(items, /\bAutograph\s+Autograph\b/i);
  assert(duplicateAutograph.length === 0, `Duplicate Autograph remains: ${sampleTitles(duplicateAutograph)}`, errors);

  const keyBrandRules = [
    { pattern: /S\.\s*Bang/i, zh: "斯邦", label: "S. Bang" },
    { pattern: /Former/i, zh: "佛么", label: "Former" },
    { pattern: /Charatan'?s/i, zh: "查拉坦", label: "Charatan's" },
    { pattern: /Comoy'?s/i, zh: "科莫伊", label: "Comoy's" },
    { pattern: /Bjarne/i, zh: "比耶恩", label: "Bjarne" },
    { pattern: /Butz-Choquin/i, zh: "BC", label: "Butz-Choquin" },
    { pattern: /Ser\s+Jacopo/i, zh: "雅克博", label: "Ser Jacopo" },
    { pattern: /Cavicchi/i, zh: "卡维奇", label: "Cavicchi" },
    { pattern: /GH\s+Zhang/i, zh: "张国辉", label: "GH Zhang" },
  ];

  for (const rule of keyBrandRules) {
    const matches = matchingItems(items, rule.pattern);
    if (matches.length) {
      const bad = matches.filter((item) => !(item.displayTitle || "").includes(rule.zh));
      assert(bad.length === 0, `${rule.label} exists but title does not use ${rule.zh}: ${sampleTitles(bad)}`, errors);
    }
  }

  const keyShapeRules = [
    { token: "Tulip", zh: "郁金香斗", label: "Tulip" },
    { token: "Ball", zh: "球形斗", label: "Ball" },
    { token: "Blowfish", zh: "河豚斗", label: "Blowfish" },
    { token: "Pickaxe", zh: "十字镐斗", label: "Pickaxe" },
    { token: "Diplomat", zh: "外交官斗", label: "Diplomat" },
  ];

  for (const rule of keyShapeRules) {
    const matches = matchingItems(items, boundaryPattern(rule.token));
    if (matches.length) {
      const bad = matches.filter((item) => !(item.displayTitle || "").includes(rule.zh));
      assert(bad.length === 0, `${rule.label} exists but title does not use ${rule.zh}: ${sampleTitles(bad)}`, errors);
    }
  }

  const hornMaterialBad = items.filter((item) => {
    const source = textOf(item);
    const material = /\bw\.?\s*\/?\s*horn\b|\bwith\s+(?:ox\s+)?horn\b|\bhorn\s+(?:stem|mount|accent|ferrule|application|insert|band|extension|mouthpiece|adornment)\b/i.test(source);
    return material && /号角斗/.test(item.displayTitle || "");
  });
  assert(hornMaterialBad.length === 0, `Horn material context still displays 号角斗: ${sampleTitles(hornMaterialBad)}`, errors);

  assert(report.generatorVersion === VALIDATOR_VERSION, `Report generatorVersion is not ${VALIDATOR_VERSION}; actual: ${report.generatorVersion}`, errors);
  assert(report.finalApplyStats?.brandFinalAppliedCount > 0, "brandFinalAppliedCount must be > 0", errors);
  assert(report.finalApplyStats?.shapeFinalAppliedCount > 0, "shapeFinalAppliedCount must be > 0", errors);

  const output = {
    status: errors.length ? "failed" : "passed",
    validatorVersion: VALIDATOR_VERSION,
    counts: {
      total: items.length,
      emptyTitles: emptyTitles.length,
      forbiddenEnglishShapeTitles: forbiddenEnglishShapeTitles.length,
      forbiddenShapeTitles: forbiddenShapeTitles.length,
      savinelliAliasBad: savinelliAliasBad.length,
      tsugeAliasBad: tsugeAliasBad.length,
      hornMaterialBad: hornMaterialBad.length,
      brandFinalAppliedCount: report.finalApplyStats?.brandFinalAppliedCount || 0,
      shapeFinalAppliedCount: report.finalApplyStats?.shapeFinalAppliedCount || 0,
      aliasCorrectionAppliedCount: report.finalApplyStats?.aliasCorrectionAppliedCount || 0,
    },
    errors,
  };

  console.log(JSON.stringify(output, null, 2));

  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", validatorVersion: VALIDATOR_VERSION, error: error.message }, null, 2));
  process.exitCode = 1;
});
