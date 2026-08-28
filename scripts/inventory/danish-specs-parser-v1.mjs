import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function makeIndex(items, canonicalKey, slugKey) {
  const index = new Map();
  for (const item of items) {
    const value = text(item[canonicalKey]);
    if (!value) continue;
    const normalized = { value, zh: text(item.zhName), slug: text(item[slugKey]) };
    for (const alias of [value, normalized.slug, ...(item.aliases || [])]) {
      const key = text(alias).toLowerCase();
      if (key) index.set(key, normalized);
    }
  }
  return index;
}

const shapes = makeIndex(readJson("data/taxonomy/pipe-shapes.json").shapes, "canonicalShape", "canonicalShapeSlug");
const finishes = makeIndex(readJson("data/taxonomy/pipe-finishes.json").finishes, "canonicalFinish", "canonicalFinishSlug");
const materials = readJson("data/taxonomy/pipe-materials.json");
const bowlMaterials = makeIndex(materials.bowlMaterials, "canonicalMaterial", "canonicalMaterialSlug");
const stemMaterials = makeIndex(materials.stemMaterials, "canonicalMaterial", "canonicalMaterialSlug");

function number(value) {
  const match = text(value).match(/(\d+(?:[,.]\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function millimeters(value) {
  const amount = number(value);
  if (amount === null) return null;
  const unit = text(value).match(/\b(mm|cm)\b/i)?.[1]?.toLowerCase();
  if (!unit) return null;
  return unit === "cm" ? Number((amount * 10).toFixed(3)) : amount;
}

function grams(value) {
  const amount = number(value);
  return amount !== null && /\b(?:g|gr|gram|grams)\b/i.test(text(value)) ? amount : null;
}

function sourceLines(product) {
  return [
    ...(Array.isArray(product?.specsText) ? product.specsText : []),
    ...(Array.isArray(product?.detailSpecsText) ? product.detailSpecsText : []),
    ...String(product?.detailBodyTextStart ?? "").split(/\r?\n/),
  ].map(text).filter(Boolean);
}

function lineValue(lines, patterns) {
  const line = lines.find((item) => patterns.some((pattern) => pattern.test(item)));
  if (!line) return "";
  const separator = line.indexOf(":");
  return separator >= 0 ? text(line.slice(separator + 1)) : line;
}

function measurement(lines, patterns, letter) {
  const labeled = lineValue(lines, patterns);
  const fromLabel = millimeters(labeled);
  if (fromLabel !== null) return fromLabel;
  const letterLine = lines.find((item) => new RegExp(`^${letter}\\s*[:：]`, "i").test(item));
  return millimeters(letterLine);
}

function termFromText(index, value) {
  const source = text(value);
  if (!source) return null;
  const entries = [...index.entries()]
    .sort(([left], [right]) => right.length - left.length);
  const match = entries.find(([alias]) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}\\b`, "i").test(source));
  return match?.[1] || null;
}

function stemFromText(value) {
  const source = text(value);
  if (!source) return null;
  if (/\b(?:ebonite|vulcanite)\b|硬橡胶/i.test(source)) return stemMaterials.get("vulcanite");
  if (/亚克力/i.test(source)) return stemMaterials.get("acrylic");
  if (/坎伯兰/i.test(source)) return stemMaterials.get("cumberland");
  return termFromText(stemMaterials, source);
}

function filterFromText(value) {
  const source = text(value);
  if (!source) return { filter: null, filterSizeMm: null, filterSpec: null };
  if (/\bno\s*filter\b|\bnone\b|无滤芯/i.test(source)) return { filter: "none", filterSizeMm: null, filterSpec: "none" };
  const size = source.match(/\b(6|9)\s*mm\b/i);
  if (size) return { filter: `${size[1]}mm`, filterSizeMm: Number(size[1]), filterSpec: `${size[1]}mm` };
  return { filter: null, filterSizeMm: null, filterSpec: null };
}

/**
 * Pure Danish V18 structured-spec parser. It only returns values supported by
 * the repository taxonomy or values explicitly present in the source fields.
 */
export function parseDanishSpecs(product) {
  const lines = sourceLines(product);
  const joined = [text(product?.name), ...lines].join("\n");
  const shapeValue = lineValue(lines, [/^(?:pipe\s+)?shape\s*[:：]|^斗型\s*[:：]/i]) || text(product?.name);
  const finishValue = lineValue(lines, [/^(?:finish|surface)\s*[:：]|^表面工艺\s*[:：]/i]) || text(product?.name);
  const bowlValue = lineValue(lines, [/^(?:bowl\s+material|material)\s*[:：]|^斗钵材质\s*[:：]/i]) || joined;
  const stemValue = lineValue(lines, [/^(?:stem\s+material|mouthpiece)\s*[:：]|^斗嘴材质\s*[:：]/i]);
  const filterValue = lineValue(lines, [/^(?:filter(?:\s+size|\s+option)?|滤芯(?:选项)?)\s*[:：]/i]);
  const shape = termFromText(shapes, shapeValue);
  const finish = termFromText(finishes, finishValue);
  const material = termFromText(bowlMaterials, bowlValue);
  const stemMaterial = stemFromText(stemValue);
  const country = lineValue(lines, [/^(?:country|origin|国家|原产地)\s*[:：]/i]);

  return {
    shape: shape?.value || "",
    shapeZh: shape?.zh || "",
    finish: finish?.value || "",
    finishZh: finish?.zh || "",
    material: material?.value || "",
    materialZh: material?.zh || "",
    stemMaterial: stemMaterial?.value || "",
    stemMaterialZh: stemMaterial?.zh || "",
    country,
    weightGrams: grams(lineValue(lines, [/^(?:weight|重量)\s*[:：]/i])) ?? grams(lines.find((item) => /(?:weight|重量)/i.test(item))),
    dimensions: {
      bowlOuterDiameterMm: measurement(lines, [/(?:bowl\s+(?:diameter|width)|outside\s+diameter|斗钵壁直径|斗钵外径)/i], "A"),
      chamberDiameterMm: measurement(lines, [/(?:chamber\s+diameter|斗钵室内径|烟室内径)/i], "B"),
      chamberDepthMm: measurement(lines, [/(?:chamber\s+depth|斗钵室深|烟室深度)/i], "C"),
      heightMm: measurement(lines, [/(?:^|\s)height|高度/i], "D"),
      lengthMm: measurement(lines, [/(?:^|\s)length|长度/i], "E"),
      buttonWidthMm: measurement(lines, [/(?:button\s+width|咬嘴宽度)/i], "F"),
      bitThicknessMm: measurement(lines, [/(?:bit\s+thickness|咬嘴厚度)/i], "G"),
    },
    ...filterFromText(filterValue),
    sourceHasSpecs: lines.length > 0,
  };
}
