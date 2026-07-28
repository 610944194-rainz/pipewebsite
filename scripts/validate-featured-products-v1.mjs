import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEATURED_PRODUCT_RULES,
  FEATURED_PRODUCTS_VERSION,
  HOMEPAGE_ENTRY_PRICE_RULES,
  getFeaturedProductExclusionReasons,
} from "../lib/public-products/featured-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_ROOT = path.join(
  ROOT,
  "data",
  "generated",
  "public-products"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function countByBrand(products) {
  const counts = new Map();

  for (const product of products) {
    const brand = product.brandName || "(missing)";
    counts.set(brand, (counts.get(brand) || 0) + 1);
  }

  return Object.fromEntries(
    [...counts].sort(
      ([leftBrand, leftCount], [rightBrand, rightCount]) =>
        rightCount - leftCount ||
        leftBrand.localeCompare(rightBrand, "en")
    )
  );
}

function quantile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor((sortedValues.length - 1) * ratio);
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function homepagePriceTier(price, thresholds) {
  if (price <= thresholds.entry) return "entry";
  if (price <= thresholds.mainstream) return "mainstream";
  if (price <= thresholds.upper) return "upper";
  return "collectible";
}

const errors = [];
const warnings = [];
const featuredPath = path.join(PUBLIC_ROOT, "featured.json");

addError(errors, fs.existsSync(featuredPath), "featured.json does not exist.");

if (errors.length === 0) {
  const catalog = readJson(path.join(PUBLIC_ROOT, "catalog.json")).products || [];
  const catalogMap = new Map(catalog.map((product) => [product.id, product]));
  const featuredFile = readJson(featuredPath);
  const homepageIds = Array.isArray(featuredFile.homepage)
    ? featuredFile.homepage
    : [];
  const featuredIds = Array.isArray(featuredFile.featured)
    ? featuredFile.featured
    : [];

  addError(
    errors,
    featuredFile.version === FEATURED_PRODUCTS_VERSION,
    `Unexpected featured version: ${featuredFile.version}`
  );
  addError(
    errors,
    homepageIds.length === FEATURED_PRODUCT_RULES.homepageSize,
    `Homepage must contain ${FEATURED_PRODUCT_RULES.homepageSize} IDs.`
  );
  addError(
    errors,
    featuredIds.length === FEATURED_PRODUCT_RULES.featuredSize,
    `Featured list must contain ${FEATURED_PRODUCT_RULES.featuredSize} IDs.`
  );
  addError(
    errors,
    new Set(homepageIds).size === homepageIds.length,
    "Homepage IDs contain duplicates."
  );
  addError(
    errors,
    new Set(featuredIds).size === featuredIds.length,
    "Featured IDs contain duplicates."
  );

  const featuredSet = new Set(featuredIds);
  for (const id of homepageIds) {
    addError(
      errors,
      featuredSet.has(id),
      `Homepage ID is not included in featured: ${id}`
    );
  }

  const selectedProducts = [];
  for (const id of featuredIds) {
    const product = catalogMap.get(id);
    addError(errors, Boolean(product), `Featured ID is missing from catalog: ${id}`);
    if (!product) continue;

    selectedProducts.push(product);
    const reasons = getFeaturedProductExclusionReasons(product);
    addError(
      errors,
      reasons.length === 0,
      `${id} violates eligibility rules: ${reasons.join(", ")}`
    );
  }

  const brandDistribution = countByBrand(selectedProducts);
  for (const [brand, count] of Object.entries(brandDistribution)) {
    addError(
      errors,
      count <= FEATURED_PRODUCT_RULES.maxPerBrand,
      `${brand} exceeds the featured brand cap: ${count}`
    );
  }

  const homepageProducts = homepageIds
    .map((id) => catalogMap.get(id))
    .filter(Boolean);
  const homepageBrandCount = new Set(
    homepageProducts.map((product) => product.brandName)
  ).size;

  if (homepageBrandCount < homepageProducts.length) {
    warnings.push(
      `Homepage contains ${homepageBrandCount} brands across ${homepageProducts.length} products.`
    );
  }

  const eligiblePrices = catalog
    .filter(
      (product) => getFeaturedProductExclusionReasons(product).length === 0
    )
    .map((product) => product.siteDisplayAmount)
    .sort((left, right) => left - right);
  const priceTierThresholds = {
    entry: quantile(eligiblePrices, 0.25),
    mainstream: quantile(eligiblePrices, 0.5),
    upper: quantile(eligiblePrices, 0.75),
  };
  const homepagePriceTiers = homepageProducts.map((product) =>
    homepagePriceTier(product.siteDisplayAmount, priceTierThresholds)
  );
  const eligiblePriceTiers = new Set(
    catalog
      .filter(
        (product) => getFeaturedProductExclusionReasons(product).length === 0
      )
      .map((product) => homepagePriceTier(product.siteDisplayAmount, priceTierThresholds))
  );
  const eligibleEntryFriendlyProducts = catalog.filter(
    (product) =>
      getFeaturedProductExclusionReasons(product).length === 0 &&
      product.siteDisplayAmount >=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMinCny &&
      product.siteDisplayAmount <=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny
  );
  const eligibleEntryFallbackProducts = catalog.filter(
    (product) =>
      getFeaturedProductExclusionReasons(product).length === 0 &&
      product.siteDisplayAmount >
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny &&
      product.siteDisplayAmount <=
        HOMEPAGE_ENTRY_PRICE_RULES.fallbackMaxCny
  );
  const homepageEntryFriendlyProducts = homepageProducts.filter(
    (product) =>
      product.siteDisplayAmount >=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMinCny &&
      product.siteDisplayAmount <=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny
  );
  const homepageEntryFallbackProducts = homepageProducts.filter(
    (product) =>
      product.siteDisplayAmount >
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny &&
      product.siteDisplayAmount <=
        HOMEPAGE_ENTRY_PRICE_RULES.fallbackMaxCny
  );

  if (eligibleEntryFriendlyProducts.length > 0) {
    addError(
      errors,
      homepageEntryFriendlyProducts.length > 0,
      `Homepage must include an eligible CNY ${HOMEPAGE_ENTRY_PRICE_RULES.preferredMinCny}-${HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny} entry-friendly product.`
    );
  } else if (eligibleEntryFallbackProducts.length > 0) {
    addError(
      errors,
      homepageEntryFallbackProducts.length > 0,
      `Homepage must fall back to an eligible CNY ${HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny}-${HOMEPAGE_ENTRY_PRICE_RULES.fallbackMaxCny} product.`
    );
    addError(
      errors,
      Array.isArray(featuredFile.warnings) &&
        featuredFile.warnings.includes(
          HOMEPAGE_ENTRY_PRICE_RULES.fallbackWarning
        ),
      "Homepage entry-friendly fallback must emit the expected warning."
    );
  }

  const missingHomepagePriceTiers = ["entry", "mainstream", "upper", "collectible"].filter(
    (tier) => !homepagePriceTiers.includes(tier)
  );
  const allHomepagePriceTiersAreEligible =
    eligiblePriceTiers.size === FEATURED_PRODUCT_RULES.homepageSize;
  if (allHomepagePriceTiersAreEligible) {
    addError(
      errors,
      missingHomepagePriceTiers.length === 0,
      `Homepage must cover entry, mainstream, upper, and collectible price tiers; got ${homepagePriceTiers.join(", ")}.`
    );
  } else if (missingHomepagePriceTiers.length > 0) {
    warnings.push(
      `Homepage price-tier diversity is limited by eligible inventory; missing ${missingHomepagePriceTiers.join(", ")}.`
    );
  }

  const homePagePath = path.join(ROOT, "app", "page.tsx");
  const featuredPagePath = path.join(ROOT, "app", "featured", "page.tsx");

  addError(
    errors,
    fs.existsSync(homePagePath),
    "app/page.tsx does not exist."
  );

  const homePageSource = fs.existsSync(homePagePath)
    ? fs.readFileSync(homePagePath, "utf8")
    : "";

  addError(
    errors,
    homePageSource.includes("getHomepageFeaturedProducts"),
    "Homepage does not read generated homepage featured products."
  );
  const homeEditorialSectionsPath = path.join(
    ROOT,
    "app",
    "components",
    "home",
    "HomeEditorialSections.tsx"
  );
  const homeEditorialSectionsSource = fs.existsSync(homeEditorialSectionsPath)
    ? fs.readFileSync(homeEditorialSectionsPath, "utf8")
    : "";
  addError(
    errors,
    homePageSource.includes("<HomeEditorialSections") &&
      homeEditorialSectionsSource.includes('href="/featured"'),
    "Homepage featured link does not point to /featured."
  );
  addError(
    errors,
    fs.existsSync(featuredPagePath),
    "app/featured/page.tsx does not exist."
  );

  if (fs.existsSync(featuredPagePath)) {
    const featuredPageSource = fs.readFileSync(featuredPagePath, "utf8");
    addError(
      errors,
      featuredPageSource.includes("getFeaturedProducts"),
      "/featured does not read the generated 20-product selection."
    );
    addError(
      errors,
      featuredPageSource.includes("<ProductGrid"),
      "/featured does not reuse the public ProductGrid."
    );
  }

  console.log(
    JSON.stringify(
      {
        status: errors.length === 0 ? "passed" : "failed",
        seedDate: featuredFile.seedDate,
        homepageCount: homepageIds.length,
        featuredCount: featuredIds.length,
        homepageBrandCount,
        homepagePriceTiers,
        priceTierThresholds,
        eligibleEntryFriendlyCount: eligibleEntryFriendlyProducts.length,
        homepageEntryFriendlyCount: homepageEntryFriendlyProducts.length,
        brandDistribution,
        errors,
        warnings,
      },
      null,
      2
    )
  );
}

if (errors.length > 0) {
  process.exitCode = 1;
}
