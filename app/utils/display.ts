export type ParsedBrandSummary = {
  zh: string;
  en: string;
};

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseBrandSummary(summary?: string): ParsedBrandSummary {
  const text = normalizeText(summary);

  if (!text) {
    return { zh: "", en: "" };
  }

  const parts = text.split(/[｜|]\s*(?:EN|English)[:：]/i);

  if (parts.length > 1) {
    return {
      zh: normalizeText(parts[0]),
      en: normalizeText(parts.slice(1).join(" ")),
    };
  }

  const englishOnly = /^[\x00-\x7F\s.,;:'"!?()&/+-]+$/.test(text);

  return englishOnly ? { zh: "", en: text } : { zh: text, en: "" };
}

export function getConditionDisplayLabel(product: {
  conditionType?: string;
  smokedStatus?: string;
  conditionLabel?: string;
  condition?: string;
}) {
  const conditionType = normalizeText(product.conditionType).toLowerCase();
  const smokedStatus = normalizeText(product.smokedStatus).toLowerCase();
  const conditionLabel = normalizeText(product.conditionLabel);
  const combined = `${conditionType} ${smokedStatus} ${conditionLabel} ${normalizeText(
    product.condition
  )}`.toLowerCase();

  if (conditionType === "estate") {
    if (smokedStatus === "unsmoked" || conditionLabel.includes("未使用")) {
      return "回流未用";
    }

    if (
      ["presmoked", "presmoked", "pre-smoked", "pre smoked", "smoked", "used"].some(
        (value) => smokedStatus.includes(value)
      ) ||
      conditionLabel.includes("已使用")
    ) {
      return "回流已用";
    }

    return "回流";
  }

  if (
    conditionType === "new" ||
    conditionLabel.includes("新斗") ||
    /\bnew(?:\s+pipe)?\b/i.test(combined)
  ) {
    return "新斗";
  }

  if (combined.includes("estate")) {
    return "回流";
  }

  return conditionLabel || normalizeText(product.condition);
}

function stripConditionWords(value: string) {
  return normalizeText(value)
    .replace(/\b(?:Estate|Presmoked|Pre[-\s]?smoked|Unsmoked)\b/gi, " ")
    .replace(/\bNew\s+Pipe\b/gi, " ")
    .replace(/Estate\s*(?:已使用|未使用)?/gi, " ")
    .replace(/回流(?:已用|未用)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getProductEnglishTitle(product: {
  name?: string;
  brand?: string;
  canonicalBrand?: string;
}) {
  let title = stripConditionWords(product.name || "");
  const brandNames = [product.canonicalBrand, product.brand]
    .map(normalizeText)
    .filter(Boolean);

  for (const brand of brandNames) {
    const lowerTitle = title.toLowerCase();
    const lowerBrand = brand.toLowerCase();

    if (lowerTitle.startsWith(`${lowerBrand},`)) {
      title = title.slice(brand.length + 1).trim();
      break;
    }

    if (lowerTitle.startsWith(`${lowerBrand} `)) {
      title = title.slice(brand.length).trim();
      break;
    }
  }

  title = title
    .split(",")
    .map((part) => stripConditionWords(part))
    .filter(Boolean)
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();

  return title || normalizeText(product.name);
}

export function getProductChineseTitle(product: {
  name?: string;
  nameZh?: string;
  titleZh?: string;
  translatedName?: string;
  chineseName?: string;
  brand?: string;
  canonicalBrand?: string;
  brandZh?: string;
  brandChinese?: string;
}) {
  let title = normalizeText(
    product.nameZh ||
      product.titleZh ||
      product.translatedName ||
      product.chineseName
  );

  if (!title) {
    return "";
  }

  title = stripConditionWords(title);

  const brandNames = [
    product.brandZh,
    product.brandChinese,
    product.canonicalBrand,
    product.brand,
  ]
    .map(normalizeText)
    .filter(Boolean);

  for (const brand of brandNames) {
    const pattern = new RegExp(`(${escapeRegExp(brand)})(?:\\s+\\1)+`, "gi");
    title = title.replace(pattern, "$1");

    const firstIndex = title.toLowerCase().indexOf(brand.toLowerCase());

    if (firstIndex >= 0) {
      const before = title.slice(0, firstIndex + brand.length);
      const after = title
        .slice(firstIndex + brand.length)
        .replace(new RegExp(escapeRegExp(brand), "gi"), " ");
      title = `${before} ${after}`;
    }
  }

  return title.replace(/\s+/g, " ").trim();
}
