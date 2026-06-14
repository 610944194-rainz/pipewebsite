import type { PublicCatalogProduct } from "./types";

type ShapeDefinition = {
  canonical: string;
  labelZh: string;
  aliases: string[];
};

type ShapePresentation = {
  value: string;
  label: string;
  labelZh: string;
};

const SHAPE_DEFINITIONS: ShapeDefinition[] = [
  { canonical: "Acorn/Pear", labelZh: "", aliases: ["acorn/pear", "acorn pear", "pear", "acorn"] },
  { canonical: "Apple", labelZh: "苹果斗", aliases: ["apple"] },
  { canonical: "Author", labelZh: "作家式斗", aliases: ["author"] },
  { canonical: "Ball", labelZh: "球形斗", aliases: ["ball"] },
  { canonical: "Billiard", labelZh: "撞球斗", aliases: ["billiard", "billard"] },
  { canonical: "Blowfish", labelZh: "河豚斗", aliases: ["blowfish"] },
  { canonical: "Brandy", labelZh: "白兰地斗", aliases: ["brandy"] },
  { canonical: "Bulldog", labelZh: "斗牛犬斗", aliases: ["bulldog"] },
  { canonical: "Calabash", labelZh: "葫芦斗", aliases: ["calabash"] },
  { canonical: "Canadian", labelZh: "加拿大斗", aliases: ["canadian"] },
  { canonical: "Cavalier", labelZh: "", aliases: ["cavalier"] },
  { canonical: "Chimney", labelZh: "", aliases: ["chimney", "stack"] },
  { canonical: "Churchwarden", labelZh: "长杆斗", aliases: ["churchwarden"] },
  { canonical: "Cutty", labelZh: "", aliases: ["cutty"] },
  { canonical: "Devil Anse", labelZh: "", aliases: ["devil anse", "devil's anse"] },
  { canonical: "Dublin", labelZh: "都柏林斗", aliases: ["dublin"] },
  { canonical: "Egg", labelZh: "蛋形斗", aliases: ["egg"] },
  { canonical: "Figural", labelZh: "", aliases: ["figural"] },
  { canonical: "Freehand", labelZh: "自由式斗", aliases: ["freehand"] },
  { canonical: "Hawkbill", labelZh: "", aliases: ["hawkbill"] },
  { canonical: "Horn", labelZh: "号角斗", aliases: ["horn"] },
  { canonical: "Liverpool", labelZh: "利物浦斗", aliases: ["liverpool"] },
  { canonical: "Lovat", labelZh: "罗瓦斗", aliases: ["lovat"] },
  { canonical: "Lumberman", labelZh: "", aliases: ["lumberman"] },
  { canonical: "Oom Paul", labelZh: "", aliases: ["oom paul"] },
  { canonical: "Opera", labelZh: "", aliases: ["opera"] },
  { canonical: "Panel", labelZh: "", aliases: ["panel"] },
  { canonical: "Poker", labelZh: "扑克斗", aliases: ["poker"] },
  { canonical: "Pot", labelZh: "罐式斗", aliases: ["pot"] },
  { canonical: "Prince", labelZh: "王子斗", aliases: ["prince"] },
  { canonical: "Rhodesian", labelZh: "牛头斗", aliases: ["rhodesian"] },
  { canonical: "Skater", labelZh: "", aliases: ["skater"] },
  { canonical: "Tomato", labelZh: "番茄斗", aliases: ["tomato"] },
  { canonical: "Volcano", labelZh: "火山斗", aliases: ["volcano"] },
  { canonical: "Zulu", labelZh: "", aliases: ["zulu"] },
];

const SHAPE_BY_ALIAS = new Map<string, ShapeDefinition>();

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

export function productShapePresentation(
  product: Pick<PublicCatalogProduct, "shape" | "shapeZh">
): ShapePresentation {
  const rawShape = String(product.shape || "").trim();
  const rawShapeZh = String(product.shapeZh || "").trim();
  const bent = isBentShape(rawShape, rawShapeZh);
  const definition = resolveBaseDefinition(rawShape);
  const baseCanonical = definition?.canonical || fallbackCanonical(rawShape);

  if (!baseCanonical) {
    return {
      value: "",
      label: "",
      labelZh: rawShapeZh,
    };
  }

  const value = bent ? `Bent ${baseCanonical}` : baseCanonical;
  const baseZh = definition?.labelZh || "";
  const labelZh = baseZh
    ? bent
      ? `弯式${baseZh}`
      : baseZh
    : rawShapeZh || value;

  return {
    value,
    label: value,
    labelZh,
  };
}

export function productShapeValue(
  product: Pick<PublicCatalogProduct, "shape" | "shapeZh">
) {
  return productShapePresentation(product).value;
}

export function shapeDisplayLabel(
  shape: string | null | undefined,
  shapeZh: string | null | undefined
) {
  const presentation = productShapePresentation({
    shape: shape ?? null,
    shapeZh: shapeZh ?? null,
  });
  return presentation.labelZh || presentation.label;
}

export function normalizeShapeSelection(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const bent = /^bent(?:\s|$)/i.test(raw);
  const definition = resolveBaseDefinition(raw);
  const baseCanonical = definition?.canonical || fallbackCanonical(raw);

  if (!baseCanonical) return "";
  return bent ? `Bent ${baseCanonical}` : baseCanonical;
}
