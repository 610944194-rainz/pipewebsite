import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const danishProductsPath = path.join(rootDir, "data", "danish-products.ts");
const brandsPath = path.join(rootDir, "data", "brands.ts");
const brandAliasesPath = path.join(rootDir, "data", "brand-aliases.ts");
const outputPath = path.join(rootDir, "data", "brand-audit.json");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeBrandName(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBrandAliasKey(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/å/g, "a")
    .replace(/Å/g, "A")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function slugifyBrand(name) {
  const slug = normalizeBrandName(name)
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/å/g, "a")
    .replace(/Å/g, "A")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "unknown";
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

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

function parseDanishProducts() {
  const content = readFile(danishProductsPath);
  const arrayText = extractExportedArray(content, "danishProducts");

  return JSON.parse(arrayText);
}

function parseBrandAliasConfig() {
  const content = readFile(brandAliasesPath);
  const aliasObjectMatch = content.match(
    /export const brandAliases = \{([\s\S]*?)\} as const;/
  );
  const aliasesText = aliasObjectMatch?.[1] || "";
  const aliases = new Map();

  for (const match of aliasesText.matchAll(
    /(?:"([^"]+)"|([A-Za-z0-9_]+))\s*:\s*"([^"]+)"/g
  )) {
    const from = normalizeText(match[1] || match[2] || "");
    const to = normalizeText(match[3]);

    if (from && to) {
      aliases.set(normalizeBrandAliasKey(from), to);
    }
  }

  const hiddenArrayMatch = content.match(
    /export const hiddenBrandIndexNames = \[([\s\S]*?)\] as const;/
  );
  const hiddenText = hiddenArrayMatch?.[1] || "";
  const hiddenBrands = new Set(
    Array.from(hiddenText.matchAll(/"([^"]+)"/g)).map((match) =>
      normalizeBrandAliasKey(match[1])
    )
  );

  return {
    aliases,
    hiddenBrands,
  };
}

function canonicalizeBrandName(value, aliasConfig) {
  const brand = normalizeText(value);

  if (!brand) {
    return "";
  }

  return aliasConfig.aliases.get(normalizeBrandAliasKey(brand)) || brand;
}

function shouldHideBrandFromIndex(value, aliasConfig) {
  const canonicalBrand = canonicalizeBrandName(value, aliasConfig);
  return aliasConfig.hiddenBrands.has(normalizeBrandAliasKey(canonicalBrand));
}

function splitTopLevelObjects(arrayText) {
  const objects = [];
  let startIndex = -1;
  let depth = 0;
  let quote = "";
  let isEscaped = false;

  for (let index = 0; index < arrayText.length; index += 1) {
    const char = arrayText[index];

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

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0 && startIndex >= 0) {
        objects.push(arrayText.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return objects;
}

function extractStringField(objectText, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*:\\s*"([^"]*)"`);
  const match = objectText.match(regex);

  return normalizeText(match?.[1] || "");
}

function extractAliases(objectText) {
  const match = objectText.match(/aliases\s*:\s*\[([\s\S]*?)\]/);
  const aliasesText = match?.[1] || "";

  return Array.from(aliasesText.matchAll(/"([^"]+)"/g)).map((item) =>
    normalizeText(item[1])
  );
}

function parseBrandProfiles() {
  const content = readFile(brandsPath);
  const arrayText = extractExportedArray(content, "pipeBrands");

  return splitTopLevelObjects(arrayText).map((objectText) => ({
    slug: extractStringField(objectText, "slug"),
    name: extractStringField(objectText, "name"),
    aliases: extractAliases(objectText),
    country: extractStringField(objectText, "country"),
    summary: extractStringField(objectText, "summary"),
    status: extractStringField(objectText, "status"),
    nameZh:
      extractStringField(objectText, "nameZh") ||
      extractStringField(objectText, "brandZh") ||
      extractStringField(objectText, "chineseName") ||
      extractStringField(objectText, "nameChinese"),
  }));
}

function getBrandProfileLookup(brandProfiles) {
  const lookup = new Map();

  for (const profile of brandProfiles) {
    const candidates = [
      profile.slug,
      profile.name,
      ...(profile.aliases || []),
    ].filter(Boolean);

    for (const candidate of candidates) {
      lookup.set(slugifyBrand(candidate), profile);
      lookup.set(normalizeBrandName(candidate), profile);
    }
  }

  return lookup;
}

function findBrandProfile(brandName, lookup) {
  return (
    lookup.get(slugifyBrand(brandName)) ||
    lookup.get(normalizeBrandName(brandName)) ||
    null
  );
}

function getPriority(productCount) {
  if (productCount >= 10) {
    return "high";
  }

  if (productCount >= 3) {
    return "medium";
  }

  return "low";
}

function isMissingText(value) {
  const text = normalizeText(value);

  return !text || /待补充|后续补充|模板资料|资料待完善/.test(text);
}

function buildRawBrandCount(products) {
  return new Set(
    products
      .map((product) => normalizeBrandName(product.brand))
      .filter(Boolean)
  ).size;
}

function buildBrandGroups(products, aliasConfig) {
  const groups = new Map();

  for (const product of products) {
    const rawBrand = normalizeText(product.brand);
    const brand = canonicalizeBrandName(rawBrand, aliasConfig);

    if (!brand) {
      continue;
    }

    const key = normalizeBrandName(brand);
    const hideFromBrandIndex = shouldHideBrandFromIndex(rawBrand, aliasConfig);
    const existing = groups.get(key);

    if (existing) {
      existing.products.push(product);
      existing.hideFromBrandIndex =
        existing.hideFromBrandIndex || hideFromBrandIndex;
    } else {
      groups.set(key, {
        brand,
        slug: slugifyBrand(brand),
        products: [product],
        hideFromBrandIndex,
      });
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    const countDiff = right.products.length - left.products.length;

    if (countDiff !== 0) {
      return countDiff;
    }

    return left.brand.localeCompare(right.brand, "en");
  });
}

function buildAudit() {
  const products = parseDanishProducts();
  const brandProfiles = parseBrandProfiles();
  const aliasConfig = parseBrandAliasConfig();
  const profileLookup = getBrandProfileLookup(brandProfiles);
  const rawBrandCount = buildRawBrandCount(products);
  const brandGroups = buildBrandGroups(products, aliasConfig);

  const audit = brandGroups.map((group) => {
    const profile = findBrandProfile(group.brand, profileLookup);
    const productCount = group.products.length;
    const hideFromBrandIndex = Boolean(group.hideFromBrandIndex);
    const currentCountry =
      profile && !isMissingText(profile.country) ? profile.country : "";
    const currentSummary = profile?.summary || "";
    const currentNameZh = profile?.nameZh || "";
    const needsChineseName = !hideFromBrandIndex && !currentNameZh;
    const needsCountry = !hideFromBrandIndex && !currentCountry;
    const needsProfile = hideFromBrandIndex
      ? false
      : !profile ||
        profile.status !== "verified" ||
        isMissingText(currentSummary);

    return {
      brand: group.brand,
      slug: group.slug,
      productCount,
      hideFromBrandIndex,
      sampleProducts: Array.from(
        new Set(
          group.products
            .map((product) => normalizeText(product.name))
            .filter(Boolean)
        )
      ).slice(0, 5),
      hasBrandProfile: Boolean(profile),
      currentNameZh,
      currentCountry,
      currentSummary,
      needsChineseName,
      needsCountry,
      needsProfile,
      priority: getPriority(productCount),
    };
  });

  return {
    rawBrandCount,
    audit,
  };
}

function summarize(rawBrandCount, audit) {
  const nording = audit.find((item) => item.brand === "Nørding");

  return {
    rawBrandCount,
    brandCount: audit.length,
    visibleBrandCount: audit.filter((item) => !item.hideFromBrandIndex).length,
    hiddenBrandCount: audit.filter((item) => item.hideFromBrandIndex).length,
    highPriorityCount: audit.filter((item) => item.priority === "high").length,
    missingChineseNameCount: audit.filter((item) => item.needsChineseName)
      .length,
    missingCountryCount: audit.filter((item) => item.needsCountry).length,
    missingProfileCount: audit.filter((item) => item.needsProfile).length,
    nordingProductCount: nording?.productCount || 0,
  };
}

const { rawBrandCount, audit } = buildAudit();
fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

const summary = summarize(rawBrandCount, audit);
console.log(JSON.stringify(summary, null, 2));
console.log(`Brand audit written: ${outputPath}`);
