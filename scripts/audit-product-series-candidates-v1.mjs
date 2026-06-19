import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_ROOT = path.join(ROOT, "data", "generated", "public-products");
const REVIEW_ROOT = path.join(ROOT, "data", "review");
const SAFE_CANDIDATES_PATH = path.join(
  ROOT,
  "data",
  "i18n",
  "product-displayname-zh-safe-candidates.json"
);
const SERIES_INDEX_PATH = path.join(PUBLIC_ROOT, "series.json");
const AUDIT_JSON_PATH = path.join(
  REVIEW_ROOT,
  "product-series-candidates-v1.json"
);
const AUDIT_MD_PATH = path.join(
  REVIEW_ROOT,
  "product-series-candidates-v1.md"
);

const FRONTEND_THRESHOLD_EXCLUSIVE = 100;
const MIN_FRONTEND_SERIES_COUNT = 2;

function rule(series, aliases = [series], confidence = "high") {
  return { series, aliases, confidence };
}

const SERIES_RULES = {
  Peterson: [
    rule("Donegal Rocky"),
    rule("Sherlock Holmes"),
    rule("St. Patrick's Day", ["St Patrick's Day", "St. Patrick's Day"]),
    rule("Irish Harp"),
    rule("Barley Spigot"),
    rule("Rua Spigot"),
    rule("Red Spigot"),
    rule("Terracotta Spigot"),
    rule("Newgrange Spigot"),
    rule("System", ["System", "Sys", "Sys Standard", "De Luxe System"]),
    rule("Premier"),
    rule("Aran"),
    rule("Killarney"),
    rule("Dracula"),
    rule("Donegal"),
    rule("Christmas"),
    rule("Junior"),
    rule("Arklow"),
    rule("Kildare"),
    rule("Derry"),
    rule("Emerald"),
    rule("Tyrone"),
    rule("Cobble"),
    rule("Pub Pipe", ["Pub Pipe", "PUB"]),
    rule("House Pipe"),
    rule("Tavern", ["Tavern", "Tavern Pipe"]),
    rule("Spigot"),
  ],
  Savinelli: [
    rule("Giubileo d'Oro", ["Giubileo d Oro", "Giubileo d'Oro"]),
    rule("Punto Oro"),
    rule("Saint Nicholas"),
    rule("Ginger's Favorite", ["Gingers Favourite", "Ginger's Favorite"]),
    rule("Roma", ["Roma", "Roma Lucite"]),
    rule("Autograph"),
    rule("Oscar"),
    rule("Miele"),
    rule("One", ["One", "One Starter Kit"]),
    rule("Trevi"),
    rule("Dolomiti"),
    rule("Tortuga"),
    rule("Unica"),
    rule("Oceano"),
    rule("Bosco"),
    rule("Lunaria"),
    rule("Siena"),
    rule("Tre"),
    rule("Petite"),
    rule("Sasso"),
    rule("Minuto"),
    rule("Marte"),
    rule("Porto Cervo"),
    rule("Tundra"),
    rule("Eleganza"),
    rule("Marron Glace"),
  ],
  "Missouri Meerschaum": [
    rule("Missouri Pride"),
    rule("Country Gentleman"),
    rule("Mark Twain"),
    rule("Washington"),
    rule("Morgan"),
    rule("Legend", ["Missouri Legend", "Legend"]),
    rule("Corn Cob"),
  ],
  Tsuge: [
    rule("Ikebana", ["Ikebana", "Fukuda", "Kikuchi"]),
    rule("The Tasting"),
    rule("Tasting"),
    rule("Kaga"),
    rule("Tokyo"),
    rule("Capito"),
    rule("Tevina"),
  ],
  Dunhill: [
    rule("Shell Briar", ["Shell Briar", "Shell"]),
    rule("Ruby Bark"),
    rule("Root Briar"),
    rule("Bruyere"),
    rule("Dress"),
    rule("Chestnut"),
    rule("Cumberland"),
    rule("County"),
  ],
  "Ser Jacopo": [
    rule("Delecta"),
    rule("Picta"),
    rule("Maxima"),
    rule("La Fuma"),
    rule("Historica"),
    rule("Rowlette"),
    rule("Spongia"),
    rule("Domina"),
  ],
  Chacom: [
    rule("New Gentleman"),
    rule("Tom Eltang"),
    rule("Maigret"),
    rule("Anton"),
    rule("Berlingot"),
    rule("Comfort"),
    rule("Spigot"),
    rule("Mojito"),
    rule("Lizon"),
    rule("Alpina"),
    rule("Ideal"),
    rule("Baccara"),
    rule("Skipper"),
    rule("Montmartre"),
    rule("Champs Elysees"),
    rule("Churchill"),
    rule("Chambord"),
  ],
  Ropp: [rule("Vintage"), rule("Heritage"), rule("Etudiant"), rule("Stout")],
  "Nørding": [
    rule("Double Silver"),
    rule("Silver Classic"),
    rule("Point Clear"),
    rule("Hunting Pipe"),
    rule("Eriksen Keystone", ["Eriksen Keystone", "Keystone"]),
    rule("Compass"),
    rule("Extra", ["Freehand Extra", "Extra"]),
    rule("Signature"),
  ],
  Stanwell: [
    rule("Royal Guard"),
    rule("Silke Brun"),
    rule("Vario"),
    rule("De Luxe"),
  ],
  Vauen: [
    rule("Auenland"),
    rule("Olaf"),
    rule("Lime"),
    rule("Troja"),
    rule("Timber"),
    rule("Mokka"),
    rule("Mamba"),
    rule("Sola"),
    rule("Chianti"),
    rule("Oregon"),
    rule("Ambrosi"),
    rule("Hippo"),
    rule("Mito"),
    rule("Ray"),
    rule("Lindis"),
    rule("Dante"),
    rule("Lessing"),
    rule("Minni"),
    rule("Leopold"),
    rule("Paris"),
    rule("Zeppelin"),
  ],
  "Comoy's": [rule("Tradition"), rule("Blue Riband")],
  "Charatan's": [rule("Make"), rule("Belvedere")],
  Ashton: [rule("Sovereign"), rule("Pebble Grain"), rule("Old Church")],
  Former: [],
  "Rattray's": [
    rule("British Collection"),
    rule("Blowers Daughter"),
    rule("Brave Heart"),
    rule("The Witch"),
    rule("Distillery"),
    rule("Dark Ale"),
    rule("Lowland"),
    rule("Monarch"),
    rule("Newcastle"),
    rule("Rannoch"),
    rule("The Bull"),
    rule("Majesty"),
    rule("Sanctuary"),
    rule("Goblin"),
    rule("Ahoy"),
    rule("Slainte"),
    rule("Lil Pipe"),
  ],
  Barling: [
    rule("Marylebone"),
    rule("Trafalgar"),
    rule("Benjamin"),
    rule("Montague"),
    rule("Nelson"),
  ],
  Molina: [
    rule("Hobby Block"),
    rule("Barasso"),
    rule("Peppino"),
    rule("Zebrano"),
    rule("Azzurro"),
    rule("Tramonto"),
    rule("Shorty"),
    rule("Americano"),
  ],
  "Erik Stokkebye 4th Generation": [
    rule("Spring Collection"),
    rule("Summer Collection"),
    rule("Autumn Collection"),
    rule("Winter Collection"),
    rule("Forza"),
    rule("Klassisk"),
    rule("Frihand"),
  ],
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAlias(text, alias) {
  const normalizedAlias = normalizeText(alias);
  return Boolean(
    normalizedAlias && ` ${text} `.includes(` ${normalizedAlias} `)
  );
}

function readDetails() {
  const detailsDir = path.join(PUBLIC_ROOT, "details");
  const files = fs
    .readdirSync(detailsDir)
    .filter((fileName) => /^[0-3][0-9a-f]\.json$/.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en"));
  const products = files.flatMap(
    (fileName) => readJson(path.join(detailsDir, fileName)).products || []
  );

  return { files, products };
}

function buildSearchText(product, detail, safeCandidate) {
  return normalizeText(
    [
      product.rawTitle,
      product.displayNameEn,
      product.displayName,
      detail?.rawTitle,
      detail?.displayNameEn,
      detail?.displayName,
      detail?.displayNameZh,
      detail?.series,
      detail?.sourceOriginalText,
      safeCandidate?.originalName,
      safeCandidate?.displayNameZhV2,
      safeCandidate?.safeDisplayNameZh,
      safeCandidate?.displayTitle,
      safeCandidate?.subtitleOriginalName,
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function ruleSpecificity(entry) {
  return Math.max(...entry.aliases.map((alias) => normalizeText(alias).length));
}

function matchSeries(product, rules, detail, safeCandidate) {
  const searchText = buildSearchText(product, detail, safeCandidate);
  const sortedRules = [...rules].sort(
    (left, right) => ruleSpecificity(right) - ruleSpecificity(left)
  );

  return (
    sortedRules.find((entry) =>
      entry.aliases.some((alias) => containsAlias(searchText, alias))
    ) || null
  );
}

function countSources(products) {
  const counts = {};
  for (const product of products) {
    counts[product.source] = (counts[product.source] || 0) + 1;
  }
  return counts;
}

function buildMarkdown(audit) {
  const lines = [
    "# Product Series Candidates V1",
    "",
    "## Summary",
    "",
    `- Public products: ${audit.summary.publicProductCount}`,
    `- Public brands: ${audit.summary.publicBrandCount}`,
    `- Detail shards: ${audit.summary.detailShardCount}`,
    `- Detail records: ${audit.summary.detailRecordCount}`,
    `- Frontend threshold: brand product count > ${audit.summary.frontendThresholdExclusive}`,
    `- Frontend-enabled brands: ${audit.summary.frontendEnabledBrandCount}`,
    `- Frontend series options: ${audit.summary.frontendSeriesOptionCount}`,
    `- Audit-only brands with candidates: ${audit.summary.auditOnlyBrandCount}`,
    "",
    "## Frontend-enabled brands",
    "",
    "| Brand | Products | Series |",
    "| --- | ---: | ---: |",
  ];

  for (const brand of audit.brands.filter((entry) => entry.frontendEnabled)) {
    lines.push(
      `| ${brand.brand} | ${brand.productCount} | ${brand.frontendSeriesOptions.length} |`
    );
  }

  lines.push("", "## Candidate details", "");

  for (const brand of audit.brands) {
    lines.push(
      `### ${brand.brand} (${brand.productCount})`,
      "",
      `- Frontend eligible: ${brand.frontendEligible ? "yes" : "no"}`,
      `- Frontend enabled: ${brand.frontendEnabled ? "yes" : "no"}`,
      `- Reason: ${brand.frontendReason}`,
      "",
      "| Series | Count | Confidence | Frontend | Sample |",
      "| --- | ---: | --- | --- | --- |"
    );

    for (const option of brand.seriesCandidates) {
      lines.push(
        `| ${option.series} | ${option.count} | ${option.confidence} | ${
          option.frontendIncluded ? "yes" : "no"
        } | ${(option.sampleTitles[0] || "").replace(/\|/g, "\\|")} |`
      );
    }

    if (brand.seriesCandidates.length === 0) {
      lines.push("| _No controlled candidate matched_ | 0 | - | no | - |");
    }
    lines.push("");
  }

  lines.push(
    "## Guardrails",
    "",
    "- Series are selected from brand-scoped controlled rules and must match current public product text.",
    "- A product is assigned to at most one primary series, preferring the most specific match.",
    "- Shapes, finishes, materials, dimensions, standalone years, and model numbers are not generated as series.",
    "- Savinelli Autograph is grouped under Savinelli.",
    "- Tsuge Ikebana is grouped under Tsuge and remains audit-only because Tsuge has 100 or fewer public products.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function main() {
  const catalogFile = readJson(path.join(PUBLIC_ROOT, "catalog.json"));
  const brandsFile = readJson(path.join(PUBLIC_ROOT, "brands.json"));
  const filtersFile = readJson(path.join(PUBLIC_ROOT, "filters.json"));
  const safeCandidatesFile = readJson(SAFE_CANDIDATES_PATH);
  const { files: detailFiles, products: detailProducts } = readDetails();
  const catalog = catalogFile.products || [];
  const brands = brandsFile.brands || [];
  const detailsById = new Map(
    detailProducts.map((product) => [product.id, product])
  );
  const safeById = new Map(
    (safeCandidatesFile.items || []).map((item) => [item.id, item])
  );
  const catalogByBrand = new Map();

  for (const product of catalog) {
    const key = product.brandName || "";
    if (!catalogByBrand.has(key)) catalogByBrand.set(key, []);
    catalogByBrand.get(key).push(product);
  }

  const auditBrands = [];
  const frontendBrands = [];
  const allBrandNames = new Set([
    ...brands.map((brand) => brand.brandName),
    ...Object.keys(SERIES_RULES),
  ]);

  for (const brandName of allBrandNames) {
    const brandIndex = brands.find((brand) => brand.brandName === brandName);
    const products = catalogByBrand.get(brandName) || [];
    const productCount = brandIndex?.productCount ?? products.length;
    const rules = SERIES_RULES[brandName] || [];
    const candidateGroups = new Map(
      rules.map((entry) => [
        entry.series,
        { ...entry, products: [], sampleTitles: [] },
      ])
    );

    for (const product of products) {
      const matched = matchSeries(
        product,
        rules,
        detailsById.get(product.id),
        safeById.get(product.id)
      );
      if (!matched) continue;

      const group = candidateGroups.get(matched.series);
      group.products.push(product);
      const title =
        product.displayNameEn || product.rawTitle || product.displayName || "";
      if (title && group.sampleTitles.length < 5) {
        group.sampleTitles.push(title);
      }
    }

    const seriesCandidates = Array.from(candidateGroups.values())
      .map((entry) => ({
        brand: brandName,
        brandZh: brandIndex?.brandNameZh || null,
        canonicalBrand: brandName,
        series: entry.series,
        seriesZh: null,
        count: entry.products.length,
        productIds: entry.products.map((product) => product.id).sort(),
        sourceCounts: countSources(entry.products),
        confidence: entry.confidence,
        sampleTitles: entry.sampleTitles,
        frontendIncluded:
          productCount > FRONTEND_THRESHOLD_EXCLUSIVE &&
          entry.products.length >= MIN_FRONTEND_SERIES_COUNT,
      }))
      .filter((entry) => entry.count > 0)
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.series.localeCompare(right.series, "en")
      );

    const frontendSeriesOptions = seriesCandidates
      .filter((entry) => entry.frontendIncluded)
      .map(
        ({
          sampleTitles: _sampleTitles,
          frontendIncluded: _frontendIncluded,
          sourceCounts: _sourceCounts,
          ...entry
        }) => entry
      );
    const frontendEligible = productCount > FRONTEND_THRESHOLD_EXCLUSIVE;
    const frontendEnabled =
      frontendEligible && frontendSeriesOptions.length > 0;
    const frontendReason = frontendEnabled
      ? "brandProductCount > 100 and controlled series candidates matched"
      : frontendEligible
        ? "brandProductCount > 100 but no controlled series candidate reached the minimum count"
        : "brandProductCount <= 100; audit-only by product rule";

    const auditEntry = {
      brand: brandName,
      brandZh: brandIndex?.brandNameZh || null,
      brandSlug: brandIndex?.brandSlug || null,
      productCount,
      frontendEligible,
      frontendEnabled,
      frontendReason,
      seriesCandidates,
      frontendSeriesOptions,
    };
    auditBrands.push(auditEntry);

    if (frontendEnabled && brandIndex?.brandSlug) {
      frontendBrands.push({
        brand: brandName,
        brandZh: brandIndex.brandNameZh || null,
        canonicalBrand: brandName,
        brandSlug: brandIndex.brandSlug,
        productCount,
        seriesOptions: frontendSeriesOptions,
      });
    }
  }

  auditBrands.sort(
    (left, right) =>
      right.productCount - left.productCount ||
      left.brand.localeCompare(right.brand, "en")
  );
  frontendBrands.sort(
    (left, right) =>
      right.productCount - left.productCount ||
      left.brand.localeCompare(right.brand, "en")
  );

  const seriesIndex = {
    schemaVersion: 1,
    frontendThresholdExclusive: FRONTEND_THRESHOLD_EXCLUSIVE,
    minimumSeriesProductCount: MIN_FRONTEND_SERIES_COUNT,
    brands: frontendBrands,
  };
  const audit = {
    schemaVersion: 1,
    status: "passed",
    summary: {
      publicProductCount: catalog.length,
      publicBrandCount: brands.length,
      detailShardCount: detailFiles.length,
      detailRecordCount: detailProducts.length,
      filterGroupCount: Object.keys(filtersFile.options || {}).length,
      safeCandidateCount: (safeCandidatesFile.items || []).length,
      frontendThresholdExclusive: FRONTEND_THRESHOLD_EXCLUSIVE,
      minimumFrontendSeriesProductCount: MIN_FRONTEND_SERIES_COUNT,
      frontendEligibleBrandCount: auditBrands.filter(
        (brand) => brand.frontendEligible
      ).length,
      frontendEnabledBrandCount: frontendBrands.length,
      frontendSeriesOptionCount: frontendBrands.reduce(
        (total, brand) => total + brand.seriesOptions.length,
        0
      ),
      auditOnlyBrandCount: auditBrands.filter(
        (brand) =>
          !brand.frontendEligible && brand.seriesCandidates.length > 0
      ).length,
    },
    rules: {
      seriesFilterScope: "brand-detail-only",
      showSeriesFilter: "brandProductCount > 100 && seriesOptions.length > 0",
      productAssignment: "single-primary-series-most-specific-match",
      frontendThresholdExclusive: FRONTEND_THRESHOLD_EXCLUSIVE,
      minimumSeriesProductCount: MIN_FRONTEND_SERIES_COUNT,
    },
    brands: auditBrands,
  };

  fs.mkdirSync(REVIEW_ROOT, { recursive: true });
  fs.writeFileSync(SERIES_INDEX_PATH, `${JSON.stringify(seriesIndex, null, 2)}\n`);
  fs.writeFileSync(AUDIT_JSON_PATH, `${JSON.stringify(audit, null, 2)}\n`);
  fs.writeFileSync(AUDIT_MD_PATH, buildMarkdown(audit));

  console.log(
    JSON.stringify(
      {
        status: audit.status,
        summary: audit.summary,
        outputs: [
          path.relative(ROOT, SERIES_INDEX_PATH),
          path.relative(ROOT, AUDIT_JSON_PATH),
          path.relative(ROOT, AUDIT_MD_PATH),
        ],
      },
      null,
      2
    )
  );
}

main();
