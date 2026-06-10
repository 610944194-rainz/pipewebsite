import fs from "node:fs";
import path from "node:path";

const inputPath = path.join(process.cwd(), "data", "danish-products.ts");

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
  const assignmentIndex = text.indexOf("=", exportIndex);
  const startIndex = text.indexOf("[", assignmentIndex);
  const endIndex = findMatchingBracket(text, startIndex, "[", "]");

  if (exportIndex < 0 || startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not extract ${exportName}.`);
  }

  return text.slice(startIndex, endIndex + 1);
}

function isKnown(value) {
  return value !== "" && value !== "unknown" && value !== null && value !== undefined;
}

function percent(count, total) {
  return `${((count / total) * 100).toFixed(1)}%`;
}

function productText(product) {
  return [
    product.name,
    ...(product.specsText || []),
    ...(product.tags || []),
    product.detail,
    product.comment,
  ]
    .map((value) => String(value || ""))
    .join(" ");
}

function getTopUnknownShapeTerms(products) {
  const stopWords = new Set([
    "pipe",
    "pipes",
    "with",
    "and",
    "the",
    "new",
    "estate",
    "smooth",
    "rusticated",
    "rustic",
    "sandblast",
    "sandblasted",
    "matte",
    "brushed",
    "contrast",
    "natural",
    "bent",
    "straight",
    "mm",
  ]);
  const counts = new Map();

  products
    .filter((product) => product.shape === "unknown")
    .forEach((product) => {
      String(product.name || "")
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .filter((token) => !stopWords.has(token.toLowerCase()))
        .forEach((token) => {
          counts.set(token, (counts.get(token) || 0) + 1);
        });
    });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([term, count]) => ({ term, count }));
}

const text = fs.readFileSync(inputPath, "utf8");
const products = JSON.parse(extractExportedArray(text, "danishProducts"));
const total = products.length;

const summary = {
  total,
  coverage: {
    nameZh: {
      count: products.filter((product) => isKnown(product.nameZh)).length,
    },
    weightGrams: {
      count: products.filter((product) => Number.isFinite(product.weightGrams)).length,
    },
    shape: {
      count: products.filter((product) => isKnown(product.shape)).length,
    },
    finish: {
      count: products.filter((product) => isKnown(product.finish)).length,
    },
    country: {
      count: products.filter((product) => isKnown(product.brandCountry)).length,
    },
    material: {
      count: products.filter((product) => isKnown(product.material)).length,
    },
    stemMaterial: {
      count: products.filter((product) => isKnown(product.stemMaterial)).length,
    },
    engineeringFeature: {
      count: products.filter((product) => isKnown(product.engineeringFeature)).length,
    },
    grainPattern: {
      count: products.filter((product) => isKnown(product.grainPattern)).length,
    },
  },
  unknown: {
    weightGrams: products.filter((product) => !Number.isFinite(product.weightGrams)).length,
    shape: products.filter((product) => !isKnown(product.shape)).length,
    finish: products.filter((product) => !isKnown(product.finish)).length,
    country: products.filter((product) => !isKnown(product.brandCountry)).length,
    material: products.filter((product) => !isKnown(product.material)).length,
    stemMaterial: products.filter((product) => !isKnown(product.stemMaterial)).length,
    engineeringFeature: products.filter((product) => !isKnown(product.engineeringFeature)).length,
    grainPattern: products.filter((product) => !isKnown(product.grainPattern)).length,
  },
  termRecognition: {
    reverseCalabash: products.filter(
      (product) => product.engineeringFeature === "reverse-calabash"
    ).length,
    cumberland: products.filter((product) => product.stemMaterial === "cumberland").length,
    lightPolished: products.filter(
      (product) => /Light\s+Polished/i.test(String(product.name || "")) && product.finish === "polished"
    ).length,
    polished: products.filter(
      (product) => /\bPolished\b/i.test(String(product.name || "")) && product.finish === "polished"
    ).length,
    bentBilliardAbbreviation: products.filter(
      (product) =>
        /\bB\.?\s*(?:Billiard|Billard)\b/i.test(productText(product)) &&
        product.shape === "billiard" &&
        product.bendType === "bent"
    ).length,
    straightGrain: products.filter(
      (product) =>
        /\bStraight\s+Grain\b/i.test(productText(product)) &&
        product.grainPattern === "straight-grain"
    ).length,
  },
  commonUnrecognizedShapeTerms: getTopUnknownShapeTerms(products),
};

for (const value of Object.values(summary.coverage)) {
  value.percent = percent(value.count, total);
}

console.log(JSON.stringify(summary, null, 2));
