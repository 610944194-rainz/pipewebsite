import type { PublicCatalogProduct } from "./types";

type ShapeDefinition = {
  canonical: string;
  labelZh: string;
  aliases: string[];
  display: boolean;
  priority: number;
};

type ShapePresentation = {
  value: string;
  label: string;
  labelZh: string;
};

const SHAPE_DEFINITIONS: ShapeDefinition[] = [
  { canonical: "Apple", labelZh: "苹果斗", aliases: ["apple"], display: true, priority: 30 },
  { canonical: "Author", labelZh: "作家式斗", aliases: ["author"], display: true, priority: 30 },
  { canonical: "Ball", labelZh: "球形斗", aliases: ["ball"], display: true, priority: 30 },
  { canonical: "Barrel", labelZh: "酒桶斗", aliases: ["barrel"], display: true, priority: 30 },
  { canonical: "Billiard", labelZh: "撞球斗", aliases: ["billiard", "billard"], display: true, priority: 30 },
  { canonical: "Blowfish", labelZh: "河豚斗", aliases: ["blowfish"], display: true, priority: 30 },
  { canonical: "Brandy", labelZh: "白兰地斗", aliases: ["brandy"], display: true, priority: 30 },
  { canonical: "Bulldog", labelZh: "斗牛犬斗", aliases: ["bulldog"], display: true, priority: 30 },
  { canonical: "Calabash", labelZh: "葫芦斗", aliases: ["calabash"], display: true, priority: 30 },
  { canonical: "Canadian", labelZh: "加拿大斗", aliases: ["canadian"], display: true, priority: 30 },
  { canonical: "Cavalier", labelZh: "骑士斗", aliases: ["cavalier"], display: true, priority: 40 },
  { canonical: "Chimney", labelZh: "烟囱式斗", aliases: ["chimney"], display: true, priority: 30 },
  { canonical: "Churchwarden", labelZh: "长杆斗", aliases: ["churchwarden"], display: true, priority: 30 },
  { canonical: "Cutty", labelZh: "卡蒂斗", aliases: ["cutty"], display: true, priority: 30 },
  { canonical: "Diplomat", labelZh: "外交官斗", aliases: ["diplomat"], display: true, priority: 30 },
  { canonical: "Dublin", labelZh: "都柏林斗", aliases: ["dublin"], display: true, priority: 30 },
  { canonical: "Egg", labelZh: "蛋形斗", aliases: ["egg"], display: true, priority: 30 },
  { canonical: "Figural", labelZh: "造型雕刻斗", aliases: ["figural"], display: true, priority: 30 },
  { canonical: "Freehand", labelZh: "自由式斗", aliases: ["freehand"], display: true, priority: 30 },
  { canonical: "Hawkbill", labelZh: "鹰嘴斗", aliases: ["hawkbill"], display: true, priority: 30 },
  { canonical: "Horn", labelZh: "号角斗", aliases: ["horn"], display: true, priority: 30 },
  { canonical: "Liverpool", labelZh: "利物浦斗", aliases: ["liverpool"], display: true, priority: 30 },
  { canonical: "Lovat", labelZh: "罗瓦斗", aliases: ["lovat"], display: true, priority: 30 },
  { canonical: "Lumberman", labelZh: "伐木工式斗", aliases: ["lumberman"], display: true, priority: 30 },
  { canonical: "Nosewarmer", labelZh: "暖鼻斗", aliases: ["nosewarmer", "nose warmer"], display: true, priority: 30 },
  { canonical: "Oom Paul", labelZh: "匈牙利式斗", aliases: ["oom paul"], display: true, priority: 30 },
  { canonical: "Opera", labelZh: "歌剧斗", aliases: ["opera"], display: true, priority: 30 },
  { canonical: "Panel", labelZh: "面板斗", aliases: ["panel", "paneled", "panelled"], display: true, priority: 10 },
  { canonical: "Pickaxe", labelZh: "十字镐斗", aliases: ["pickaxe"], display: true, priority: 30 },
  { canonical: "Poker", labelZh: "扑克斗", aliases: ["poker"], display: true, priority: 30 },
  { canonical: "Pot", labelZh: "罐式斗", aliases: ["pot"], display: true, priority: 30 },
  { canonical: "Prince", labelZh: "王子斗", aliases: ["prince"], display: true, priority: 30 },
  { canonical: "Rhodesian", labelZh: "牛头斗", aliases: ["rhodesian"], display: true, priority: 30 },
  { canonical: "Sitter", labelZh: "坐斗", aliases: ["sitter"], display: true, priority: 20 },
  { canonical: "Shield", labelZh: "盾牌斗", aliases: ["shield"], display: true, priority: 30 },
  { canonical: "Strawberry", labelZh: "草莓斗", aliases: ["strawberry"], display: true, priority: 30 },
  { canonical: "Tomato", labelZh: "番茄斗", aliases: ["tomato"], display: true, priority: 30 },
  { canonical: "Tulip", labelZh: "郁金香斗", aliases: ["tulip"], display: true, priority: 30 },
  { canonical: "Volcano", labelZh: "火山斗", aliases: ["volcano"], display: true, priority: 30 },
  { canonical: "Zulu", labelZh: "祖鲁斗", aliases: ["zulu"], display: true, priority: 30 },
  { canonical: "Acorn", labelZh: "橡果斗", aliases: ["acorn"], display: true, priority: 30 },
  { canonical: "Pear", labelZh: "梨式斗", aliases: ["pear"], display: true, priority: 30 },
  { canonical: "Devil Anse", labelZh: "", aliases: ["devil anse", "devil's anse"], display: false, priority: 0 },
  { canonical: "Skater", labelZh: "", aliases: ["skater"], display: false, priority: 0 },
  { canonical: "Stack", labelZh: "", aliases: ["stack"], display: false, priority: 0 },
  { canonical: "Acorn/Pear", labelZh: "", aliases: ["acorn/pear", "acorn pear"], display: false, priority: 0 },
];

const SHAPE_BY_ALIAS = new Map<string, ShapeDefinition>();
const SHAPE_BY_CANONICAL = new Map<string, ShapeDefinition>();
const SPECIAL_NON_DISPLAY = new Set(["Devil Anse", "Skater", "Stack", "Acorn/Pear"]);
const PANEL_CAN_BE_SUPPRESSED_BY = new Set([
  "Apple",
  "Ball",
  "Barrel",
  "Billiard",
  "Blowfish",
  "Brandy",
  "Bulldog",
  "Calabash",
  "Canadian",
  "Cavalier",
  "Chimney",
  "Churchwarden",
  "Cutty",
  "Diplomat",
  "Dublin",
  "Egg",
  "Freehand",
  "Hawkbill",
  "Horn",
  "Liverpool",
  "Lovat",
  "Lumberman",
  "Oom Paul",
  "Opera",
  "Pickaxe",
  "Poker",
  "Pot",
  "Prince",
  "Rhodesian",
  "Sitter",
  "Tomato",
  "Tulip",
  "Volcano",
  "Zulu",
  "Acorn",
  "Pear",
]);

function normalizeShapeKey(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

for (const definition of SHAPE_DEFINITIONS) {
  SHAPE_BY_CANONICAL.set(normalizeShapeKey(definition.canonical), definition);
  for (const alias of [definition.canonical, ...definition.aliases]) {
    SHAPE_BY_ALIAS.set(normalizeShapeKey(alias), definition);
  }
}

function stripBentPrefix(value: string) {
  return value.replace(/^bent\s+/i, "").trim();
}

function isBentShape(
  shape: string | null | undefined,
  shapeZh: string | null | undefined
) {
  return (
    /^bent(?:\s|$)/i.test(String(shape || "").trim()) ||
    /^弯式/.test(String(shapeZh || "").trim())
  );
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWord(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}


function hasHornMaterialContext(product: Partial<PublicCatalogProduct>) {
  const text = productShapeSearchText(product);
  return (
    /\bw\.?\s*\/?\s*horn\b/i.test(text) ||
    /\bw\/\s*horn\b/i.test(text) ||
    /\bwith\s+(?:ox\s+)?horn\b/i.test(text) ||
    /\bhorn\s+(?:stem|mount|accent|ferrule|application|insert|band|extension|mouthpiece|adornment)\b/i.test(text)
  );
}

const SHAPE_ZH_LOOKUP: Record<string, string> = {
  Apple: "苹果斗",
  Acorn: "橡果斗",
  Pear: "梨式斗",
  Cavalier: "骑士斗",
  Panel: "面板斗",
  Paneled: "面板斗",
  Tulip: "郁金香斗",
  Strawberry: "草莓斗",
  Tomato: "番茄斗",
  Ball: "球形斗",
  Blowfish: "河豚斗",
  Pickaxe: "十字镐斗",
  Diplomat: "外交官斗",
  Chimney: "烟囱式斗",
  Cutty: "卡蒂斗",
  Figural: "造型雕刻斗",
  Hawkbill: "鹰嘴斗",
  Lumberman: "伐木工式斗",
  "Oom Paul": "匈牙利式斗",
  Opera: "歌剧斗",
  Zulu: "祖鲁斗",
  Sitter: "坐斗",
  Horn: "号角斗",
};

const SHAPE_TEXT_INFERENCE_ORDER = [
  "Cavalier",
  "Pear",
  "Acorn",
  "Tulip",
  "Strawberry",
  "Tomato",
  "Apple",
  "Ball",
  "Blowfish",
  "Pickaxe",
  "Diplomat",
  "Chimney",
  "Cutty",
  "Figural",
  "Hawkbill",
  "Lumberman",
  "Oom Paul",
  "Opera",
  "Zulu",
  "Sitter",
  "Panel",
];

function inferShapePresentationsFromText(
  product: Partial<PublicCatalogProduct>,
  excludedCanonicals: string[] = []
): ShapePresentation[] {
  const text = productShapeSearchText(product);
  const excluded = new Set(excludedCanonicals);
  const items: Array<ShapePresentation | null> = [];

  for (const canonical of SHAPE_TEXT_INFERENCE_ORDER) {
    if (excluded.has(canonical)) continue;
    const definition = SHAPE_BY_CANONICAL.get(normalizeShapeKey(canonical));
    if (!definition || !definition.display) continue;
    const zh = SHAPE_ZH_LOOKUP[canonical];
    const aliases = [canonical, ...definition.aliases];
    const matchedByZh = zh ? text.includes(zh) : false;
    const matchedByEnglish = aliases.some((alias) => hasWord(text, normalizeShapeKey(alias)));
    if (matchedByZh || matchedByEnglish) {
      items.push(presentationFromDefinition(definition, false, zh || ""));
    }
  }

  let presentations = uniquePresentations(items);
  if (presentations.some((shape) => shape.value === "Cavalier")) {
    presentations = presentations.filter((shape) => shape.value !== "Panel");
  }
  if (presentations.some((shape) => shape.value === "Pear")) {
    presentations = presentations.filter((shape) => shape.value !== "Acorn");
  }
  if (presentations.some((shape) => shape.value === "Acorn")) {
    presentations = presentations.filter((shape) => shape.value !== "Pear");
  }
  return presentations;
}

function productShapeSearchText(
  product: Partial<PublicCatalogProduct>
) {
  return normalizeText([
    product.displayTitle,
    product.safeDisplayNameZh,
    product.displayName,
    product.displayNameEn,
    product.rawTitle,
  ].filter(Boolean).join(" "));
}


function productOriginalShapeSearchText(
  product: Partial<PublicCatalogProduct>
) {
  return normalizeText([
    product.displayName,
    product.displayNameEn,
    product.rawTitle,
  ].filter(Boolean).join(" "));
}

function resolveBaseDefinition(shape: string | null | undefined) {
  const raw = String(shape || "").trim();
  const withoutBent = stripBentPrefix(raw);
  return (
    SHAPE_BY_ALIAS.get(normalizeShapeKey(withoutBent)) ||
    SHAPE_BY_ALIAS.get(normalizeShapeKey(raw)) ||
    null
  );
}

function fallbackCanonical(shape: string | null | undefined) {
  const raw = stripBentPrefix(String(shape || "").trim());
  if (!raw) return "";

  return raw
    .split(/\s+/)
    .map((part) =>
      part
        .split("/")
        .map((segment) =>
          segment
            ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`
            : ""
        )
        .join("/")
    )
    .join(" ");
}

function presentationFromDefinition(
  definition: ShapeDefinition,
  bent: boolean,
  rawShapeZh: string
): ShapePresentation | null {
  if (!definition.display || SPECIAL_NON_DISPLAY.has(definition.canonical)) return null;

  const value = bent ? `Bent ${definition.canonical}` : definition.canonical;
  const labelZh = definition.labelZh
    ? bent && !definition.labelZh.startsWith("弯式")
      ? `弯式${definition.labelZh}`
      : definition.labelZh
    : rawShapeZh || value;

  return {
    value,
    label: value,
    labelZh,
  };
}

function uniquePresentations(items: Array<ShapePresentation | null>) {
  const map = new Map<string, ShapePresentation>();
  for (const item of items) {
    if (item?.value) map.set(item.value, item);
  }
  return [...map.values()];
}

function inferAcornPearFromProduct(
  product: Partial<PublicCatalogProduct>
): ShapePresentation[] {
  const sourceText = productOriginalShapeSearchText(product);
  const rawShapeZh = String(product.shapeZh || "").trim();
  const acorn = SHAPE_BY_CANONICAL.get("acorn");
  const pear = SHAPE_BY_CANONICAL.get("pear");
  const items: Array<ShapePresentation | null> = [];

  if (/\bacorn\s*\/\s*pear\b|\bacorn\s+pear\b/i.test(sourceText)) {
    return [];
  }

  if (pear && hasWord(sourceText, "pear")) {
    items.push(presentationFromDefinition(pear, false, rawShapeZh));
  } else if (acorn && hasWord(sourceText, "acorn")) {
    items.push(presentationFromDefinition(acorn, false, rawShapeZh));
  }

  return uniquePresentations(items);
}

export function productShapePresentations(
  product: Pick<
    PublicCatalogProduct,
    | "shape"
    | "shapeZh"
    | "displayTitle"
    | "safeDisplayNameZh"
    | "displayName"
    | "displayNameEn"
    | "rawTitle"
  >
): ShapePresentation[] {
  const rawShape = String(product.shape || "").trim();
  const rawShapeZh = String(product.shapeZh || "").trim();
  const bent = isBentShape(rawShape, rawShapeZh);
  const definition = resolveBaseDefinition(rawShape);

  if (definition?.canonical === "Acorn/Pear") {
    return inferAcornPearFromProduct(product);
  }

  if (definition?.canonical === "Horn" && hasHornMaterialContext(product)) {
    const inferred = inferShapePresentationsFromText(product, ["Horn"]);
    return inferred;
  }

  if (definition?.canonical === "Panel") {
    const inferred = inferShapePresentationsFromText(product, []);
    if (inferred.some((shape) => shape.value === "Cavalier")) {
      return inferred.filter((shape) => shape.value !== "Panel");
    }
  }

  const primary = definition
    ? presentationFromDefinition(definition, bent, rawShapeZh)
    : null;

  if (primary) return [primary];

  const baseCanonical = fallbackCanonical(rawShape);
  if (!baseCanonical) return [];
  if (SPECIAL_NON_DISPLAY.has(baseCanonical)) return [];

  return [
    {
      value: bent ? `Bent ${baseCanonical}` : baseCanonical,
      label: bent ? `Bent ${baseCanonical}` : baseCanonical,
      labelZh: rawShapeZh,
    },
  ];
}

export function productShapePresentation(
  product: Pick<
    PublicCatalogProduct,
    | "shape"
    | "shapeZh"
    | "displayTitle"
    | "safeDisplayNameZh"
    | "displayName"
    | "displayNameEn"
    | "rawTitle"
  >
): ShapePresentation {
  const presentations = productShapePresentations(product);
  return presentations[0] || { value: "", label: "", labelZh: String(product.shapeZh || "") };
}

export function productShapeValues(
  product: Pick<
    PublicCatalogProduct,
    | "shape"
    | "shapeZh"
    | "displayTitle"
    | "safeDisplayNameZh"
    | "displayName"
    | "displayNameEn"
    | "rawTitle"
  >
) {
  return productShapePresentations(product).map((item) => item.value);
}

export function productShapeValue(
  product: Pick<
    PublicCatalogProduct,
    | "shape"
    | "shapeZh"
    | "displayTitle"
    | "safeDisplayNameZh"
    | "displayName"
    | "displayNameEn"
    | "rawTitle"
  >
) {
  return productShapePresentation(product).value;
}

export function shapeDisplayLabel(
  shape: string | null | undefined,
  shapeZh: string | null | undefined
) {
  const raw = String(shape || "").trim();
  const definition = resolveBaseDefinition(raw);
  const bent = isBentShape(raw, shapeZh);
  const presentation = definition
    ? presentationFromDefinition(definition, bent, String(shapeZh || "").trim())
    : productShapePresentation({
        shape: shape ?? null,
        shapeZh: shapeZh ?? null,
        displayTitle: null,
        safeDisplayNameZh: null,
        displayName: null,
        displayNameEn: null,
        rawTitle: null,
      });
  return presentation?.labelZh || presentation?.label || "";
}

export function normalizeShapeSelection(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const bent = /^bent(?:\s|$)/i.test(raw);
  const definition = resolveBaseDefinition(raw);
  if (definition?.canonical === "Acorn/Pear") return "";
  if (definition && (!definition.display || SPECIAL_NON_DISPLAY.has(definition.canonical))) return "";

  const baseCanonical = definition?.canonical || fallbackCanonical(raw);

  if (!baseCanonical) return "";
  if (SPECIAL_NON_DISPLAY.has(baseCanonical)) return "";
  return bent ? `Bent ${baseCanonical}` : baseCanonical;
}

export function shouldSuppressPanelWhenCombined(values: string[]) {
  return values.includes("Panel") && values.some((value) => PANEL_CAN_BE_SUPPRESSED_BY.has(value));
}
