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
const DEFAULT_OUTPUT = path.join(PUBLIC_ROOT, "featured.json");

const MAINSTREAM_BRANDS = new Set([
  "Peterson",
  "Savinelli",
  "Dunhill",
  "Nørding",
  "Rattray's",
  "Vauen",
  "Chacom",
  "Castello",
  "Former",
  "S. Bang",
  "Tsuge",
  "Barling",
  "Ser Jacopo",
  "Stanwell",
  "Ashton",
  "Comoy's",
  "Charatan's",
]);

const INVENTORY_RICH_BRANDS = new Set([
  "Peterson",
  "Savinelli",
  "Nørding",
  "Vauen",
  "Rattray's",
  "Chacom",
  "Dunhill",
  "Barling",
  "Erik Stokkebye 4th Generation",
]);

const DETAIL_MEASUREMENT_KEYS = [
  "lengthMm",
  "heightMm",
  "chamberDepthMm",
  "chamberDiameterMm",
  "outsideDiameterMm",
];

const IMAGE_PROBE_CANDIDATE_LIMIT = 120;
const IMAGE_PROBE_CONCURRENCY = 12;
const IMAGE_PROBE_TIMEOUT_MS = 4500;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const values = {};

  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    values[key] = rest.join("=");
  }

  return values;
}

function seedDateForShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function assertSeedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid seed date: ${value}`);
  }

  return value;
}

function hashUnit(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function quantile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor((sortedValues.length - 1) * ratio);
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function hasValue(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function completenessPoints(product, detail) {
  const values = [
    product.brandCountry,
    product.shape,
    product.finish,
    product.bowlMaterial,
    product.stemMaterial,
    product.filter,
    product.weightGrams,
    detail?.series,
    ...DETAIL_MEASUREMENT_KEYS.map((key) => detail?.measurements?.[key]),
  ];
  const completed = values.filter(hasValue).length;
  return {
    completed,
    total: values.length,
    points: (completed / values.length) * 20,
  };
}

function loadDetailsById() {
  const detailsDirectory = path.join(PUBLIC_ROOT, "details");
  const details = new Map();
  const files = fs
    .readdirSync(detailsDirectory)
    .filter((fileName) => /^[0-3][0-9a-f]\.json$/.test(fileName))
    .sort();

  for (const fileName of files) {
    const shard = readJson(path.join(detailsDirectory, fileName));

    for (const product of shard.products || []) {
      details.set(product.id, product);
    }
  }

  return details;
}

function imageProbeUrls(value) {
  const source = String(value || "").trim();
  if (!source) return [];

  try {
    const url = new URL(source);
    const pathname = url.pathname;

    if (
      url.hostname === "c647068.ssl.cf2.rackcdn.com" &&
      pathname.startsWith("/products/")
    ) {
      return [
        source,
        `https://assets.smokingpipes.com/images${pathname}`,
      ];
    }

    if (
      url.hostname === "assets.smokingpipes.com" &&
      pathname.startsWith("/images/products/")
    ) {
      return [
        source,
        `https://c647068.ssl.cf2.rackcdn.com${pathname.replace(
          /^\/images/,
          ""
        )}`,
      ];
    }
  } catch {
    return [source];
  }

  return [source];
}

async function probeImageUrl(value) {
  const urls = imageProbeUrls(value);
  if (urls.length === 0) return { status: "bad", url: "" };

  let completedResponses = 0;

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Range: "bytes=0-2047",
          "User-Agent": "YandouBuy featured image check",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      completedResponses += 1;
      const contentType = String(response.headers.get("content-type") || "")
        .toLowerCase();
      const isImageResponse =
        (response.ok || response.status === 206) &&
        contentType.startsWith("image/");

      await response.body?.cancel();

      if (isImageResponse) return { status: "ok", url: response.url || url };
    } catch {
      // A timeout or network error is inconclusive; try the next candidate URL.
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    status: completedResponses === urls.length ? "bad" : "unknown",
    url: "",
  };
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => runWorker()
    )
  );

  return results;
}

async function prioritizeReachableHomepageCandidates(scored, warnings) {
  const pool = scored.slice(0, IMAGE_PROBE_CANDIDATE_LIMIT);
  const probeResults = await mapWithConcurrency(
    pool,
    IMAGE_PROBE_CONCURRENCY,
    async (candidate) => ({
      id: candidate.product.id,
      ...(await probeImageUrl(candidate.product.mainImage)),
    })
  );
  const statusById = new Map(
    probeResults.map((result) => [result.id, result.status])
  );
  const counts = {
    checked: probeResults.length,
    reachable: probeResults.filter((result) => result.status === "ok").length,
    unreachable: probeResults.filter((result) => result.status === "bad").length,
    unknown: probeResults.filter((result) => result.status === "unknown").length,
  };

  if (counts.reachable === 0) {
    warnings.push(
      `Homepage image accessibility check was inconclusive for the top ${counts.checked} candidates; original ranking was retained.`
    );
    return { scored, summary: counts };
  }

  if (counts.unreachable > 0) {
    warnings.push(
      `Homepage image accessibility check excluded ${counts.unreachable} unreachable candidates from the top ${counts.checked}.`
    );
  }
  if (counts.unknown > 0) {
    warnings.push(
      `Homepage image accessibility check was inconclusive for ${counts.unknown} candidates; they remain eligible as fallbacks.`
    );
  }

  const reachable = pool.filter(
    (candidate) => statusById.get(candidate.product.id) === "ok"
  );
  const remaining = scored.filter(
    (candidate) => statusById.get(candidate.product.id) !== "bad" &&
      statusById.get(candidate.product.id) !== "ok"
  );

  return { scored: [...reachable, ...remaining], summary: counts };
}

function priceTier(price, thresholds) {
  if (price <= thresholds.entry) return "entry";
  if (price <= thresholds.mainstream) return "mainstream";
  if (price <= thresholds.upper) return "upper";
  return "collectible";
}

function scoreCandidates(products, detailsById, seedDate) {
  const prices = products
    .map((product) => product.siteDisplayAmount)
    .sort((left, right) => left - right);
  const thresholds = {
    normalLow: quantile(prices, 0.05),
    normalHigh: quantile(prices, 0.95),
    entry: quantile(prices, 0.25),
    mainstream: quantile(prices, 0.5),
    upper: quantile(prices, 0.75),
  };

  const scored = products.map((product) => {
    const detail = detailsById.get(product.id);
    const completeness = completenessPoints(product, detail);
    const galleryPoints = product.galleryCount >= 4 ? 20 : 12;
    const mainstreamPoints = MAINSTREAM_BRANDS.has(product.brandName) ? 15 : 0;
    const inventoryRichPoints = INVENTORY_RICH_BRANDS.has(product.brandName)
      ? 10
      : 0;
    const priceNormal =
      product.siteDisplayAmount >= thresholds.normalLow &&
      product.siteDisplayAmount <= thresholds.normalHigh;
    const pricePoints = priceNormal ? 5 : 0;
    const dailyPoints = hashUnit(`${seedDate}:${product.id}`) * 18;
    const baseScore =
      30 +
      galleryPoints +
      completeness.points +
      mainstreamPoints +
      inventoryRichPoints +
      pricePoints;

    return {
      product,
      detail,
      baseScore,
      dailyPoints,
      score: baseScore + dailyPoints,
      completeness,
      priceTier: priceTier(product.siteDisplayAmount, thresholds),
    };
  });

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      right.baseScore - left.baseScore ||
      left.product.id.localeCompare(right.product.id, "en")
  );

  return { scored, thresholds };
}

function selectFeatured(scored, homepage, warnings) {
  const selected = [...homepage];
  const brandCounts = new Map();
  const shapeCounts = new Map();

  for (const candidate of selected) {
    const brand = candidate.product.brandName;
    const shape = candidate.product.shape;
    brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
    shapeCounts.set(shape, (shapeCounts.get(shape) || 0) + 1);
  }

  function trySelect(shapeLimit) {
    for (const candidate of scored) {
      if (selected.length >= FEATURED_PRODUCT_RULES.featuredSize) break;
      if (selected.some((entry) => entry.product.id === candidate.product.id)) {
        continue;
      }

      const brand = candidate.product.brandName;
      const shape = candidate.product.shape;
      if ((brandCounts.get(brand) || 0) >= FEATURED_PRODUCT_RULES.maxPerBrand) {
        continue;
      }
      if (shapeLimit && (shapeCounts.get(shape) || 0) >= shapeLimit) continue;

      selected.push(candidate);
      brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
      shapeCounts.set(shape, (shapeCounts.get(shape) || 0) + 1);
    }
  }

  trySelect(4);

  if (selected.length < FEATURED_PRODUCT_RULES.featuredSize) {
    warnings.push(
      `Shape diversity relaxed after selecting ${selected.length} products.`
    );
    trySelect(null);
  }

  if (selected.length < FEATURED_PRODUCT_RULES.featuredSize) {
    warnings.push(
      `Only ${selected.length} eligible products satisfied the brand cap.`
    );
  }

  return selected;
}

function selectHomepage(scored, warnings) {
  const selected = [];
  const brands = new Set();
  const shapes = new Set();

  function take(candidate) {
    selected.push(candidate);
    brands.add(candidate.product.brandName);
    shapes.add(candidate.product.shape);
  }

  const entryFriendlyCandidate = scored.find(
    (entry) =>
      entry.product.siteDisplayAmount >=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMinCny &&
      entry.product.siteDisplayAmount <=
        HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny
  );
  const entryFallbackCandidate =
    entryFriendlyCandidate ||
    scored.find(
      (entry) =>
        entry.product.siteDisplayAmount >
          HOMEPAGE_ENTRY_PRICE_RULES.preferredMaxCny &&
        entry.product.siteDisplayAmount <=
          HOMEPAGE_ENTRY_PRICE_RULES.fallbackMaxCny
    );

  if (entryFallbackCandidate) {
    take(entryFallbackCandidate);
  }

  if (!entryFriendlyCandidate && entryFallbackCandidate) {
    warnings.push(HOMEPAGE_ENTRY_PRICE_RULES.fallbackWarning);
  }

  if (!entryFallbackCandidate) {
    warnings.push(
      `Homepage could not include an entry-friendly product within CNY ${HOMEPAGE_ENTRY_PRICE_RULES.preferredMinCny}-${HOMEPAGE_ENTRY_PRICE_RULES.fallbackMaxCny}.`
    );
  }

  const desiredTiers = ["entry", "mainstream", "upper", "collectible"].filter(
    (tier) => !selected.some((entry) => entry.priceTier === tier)
  );

  for (const tier of desiredTiers) {
    const candidate = scored.find(
      (entry) =>
        entry.priceTier === tier &&
        !selected.includes(entry) &&
        !brands.has(entry.product.brandName) &&
        !shapes.has(entry.product.shape)
    );

    if (candidate) take(candidate);
  }

  for (const candidate of scored) {
    if (selected.length >= FEATURED_PRODUCT_RULES.homepageSize) break;
    if (selected.includes(candidate)) continue;
    if (brands.has(candidate.product.brandName)) continue;
    if (shapes.has(candidate.product.shape)) continue;
    take(candidate);
  }

  for (const candidate of scored) {
    if (selected.length >= FEATURED_PRODUCT_RULES.homepageSize) break;
    if (selected.includes(candidate)) continue;
    if (brands.has(candidate.product.brandName)) continue;
    take(candidate);
  }

  for (const candidate of scored) {
    if (selected.length >= FEATURED_PRODUCT_RULES.homepageSize) break;
    if (selected.includes(candidate)) continue;
    take(candidate);
  }

  if (brands.size < selected.length) {
    warnings.push("Homepage brand diversity was relaxed.");
  }
  if (new Set(selected.map((entry) => entry.priceTier)).size < 4) {
    warnings.push(
      "Homepage could not cover entry, mainstream, upper, and collectible price tiers."
    );
  }

  return selected;
}

function countBy(values, getter) {
  const counts = new Map();

  for (const value of values) {
    const key = getter(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Object.fromEntries(
    [...counts].sort(
      ([leftKey, leftCount], [rightKey, rightCount]) =>
        rightCount - leftCount || leftKey.localeCompare(rightKey, "en")
    )
  );
}

export async function generateFeaturedProducts({
  seedDate,
  outputPath = DEFAULT_OUTPUT,
} = {}) {
  const resolvedSeedDate = assertSeedDate(
    seedDate || process.env.FEATURED_SEED_DATE || seedDateForShanghai()
  );
  const catalogFile = readJson(path.join(PUBLIC_ROOT, "catalog.json"));
  const products = catalogFile.products || [];
  const detailsById = loadDetailsById();
  const exclusionCounts = new Map();
  const eligible = [];

  for (const product of products) {
    const reasons = getFeaturedProductExclusionReasons(product);

    if (reasons.length === 0) {
      eligible.push(product);
      continue;
    }

    for (const reason of reasons) {
      exclusionCounts.set(reason, (exclusionCounts.get(reason) || 0) + 1);
    }
  }

  if (eligible.length < FEATURED_PRODUCT_RULES.featuredSize) {
    throw new Error(
      `Only ${eligible.length} eligible products; ${FEATURED_PRODUCT_RULES.featuredSize} required.`
    );
  }

  const warnings = [];
  const { scored, thresholds } = scoreCandidates(
    eligible,
    detailsById,
    resolvedSeedDate
  );
  const imageProbe = await prioritizeReachableHomepageCandidates(
    scored,
    warnings
  );
  const homepageSelection = selectHomepage(imageProbe.scored, warnings);
  const featuredSelection = selectFeatured(scored, homepageSelection, warnings);

  if (
    featuredSelection.length !== FEATURED_PRODUCT_RULES.featuredSize ||
    homepageSelection.length !== FEATURED_PRODUCT_RULES.homepageSize
  ) {
    throw new Error("Unable to produce the required featured product counts.");
  }

  const output = {
    version: FEATURED_PRODUCTS_VERSION,
    generatedAt: `${resolvedSeedDate}T00:00:00.000Z`,
    seedDate: resolvedSeedDate,
    homepage: homepageSelection.map((entry) => entry.product.id),
    featured: featuredSelection.map((entry) => entry.product.id),
    rules: {
      homepageSize: FEATURED_PRODUCT_RULES.homepageSize,
      featuredSize: FEATURED_PRODUCT_RULES.featuredSize,
      maxPerBrand: FEATURED_PRODUCT_RULES.maxPerBrand,
      homepageMaxPerBrand: FEATURED_PRODUCT_RULES.homepageMaxPerBrand,
    },
    warnings,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const summary = {
    seedDate: resolvedSeedDate,
    catalogTotal: products.length,
    eligibleTotal: eligible.length,
    excludedRecordTotal: products.length - eligible.length,
    exclusionReasonCounts: Object.fromEntries(
      [...exclusionCounts].sort(([left], [right]) =>
        left.localeCompare(right, "en")
      )
    ),
    imageProbe: imageProbe.summary,
    priceThresholdsCny: thresholds,
    featured: featuredSelection.map((entry) => ({
      id: entry.product.id,
      brand: entry.product.brandName,
      priceCny: entry.product.siteDisplayAmount,
      galleryCount: entry.product.galleryCount,
      shape: entry.product.shape,
      score: Number(entry.score.toFixed(6)),
    })),
    homepage: homepageSelection.map((entry) => ({
      id: entry.product.id,
      brand: entry.product.brandName,
      priceCny: entry.product.siteDisplayAmount,
      galleryCount: entry.product.galleryCount,
      shape: entry.product.shape,
      priceTier: entry.priceTier,
    })),
    brandDistribution: countBy(
      featuredSelection,
      (entry) => entry.product.brandName
    ),
    warnings,
    outputPath: path.relative(ROOT, outputPath).replaceAll("\\", "/"),
  };

  console.log(JSON.stringify(summary, null, 2));
  return { output, summary };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output
    ? path.resolve(ROOT, args.output)
    : process.env.FEATURED_OUTPUT_PATH
      ? path.resolve(ROOT, process.env.FEATURED_OUTPUT_PATH)
      : DEFAULT_OUTPUT;

  await generateFeaturedProducts({
    seedDate: args.date || process.env.FEATURED_SEED_DATE,
    outputPath,
  });
}
