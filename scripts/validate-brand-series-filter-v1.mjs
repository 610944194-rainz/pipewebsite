import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_ROOT = path.join(ROOT, "data", "generated", "public-products");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function main() {
  const errors = [];
  const warnings = [];
  const seriesFile = readJson(path.join(PUBLIC_ROOT, "series.json"));
  const audit = readJson(
    path.join(ROOT, "data", "review", "product-series-candidates-v1.json")
  );
  const brandsFile = readJson(path.join(PUBLIC_ROOT, "brands.json"));
  const catalogFile = readJson(path.join(PUBLIC_ROOT, "catalog.json"));
  const brandPage = readText("app/brands/[slug]/page.tsx");
  const seriesDrawer = readText(
    "components/brands/BrandSeriesFilterDrawer.tsx"
  );
  const productsPage = [
    readText("app/products/page.tsx"),
    readText("components/products/ProductsPageClient.tsx"),
  ].join("\n");
  const productCard = readText("components/products/ProductCard.tsx");
  const productGrid = readText("components/products/ProductGrid.tsx");
  const productScroll = readText("lib/public-products/scroll.ts");
  const productDetailClient = readText(
    "app/products/[id]/ProductGallery.tsx"
  );
  const productDetailPage = readText("app/products/[id]/page.tsx");
  const brandBySlug = new Map(
    brandsFile.brands.map((brand) => [brand.brandSlug, brand])
  );
  const productById = new Map(
    catalogFile.products.map((product) => [product.id, product])
  );

  if (seriesFile.frontendThresholdExclusive !== 100) {
    errors.push("Frontend brand threshold must be productCount > 100.");
  }

  const productsPageHasSeriesFilter =
    /name=["']series["']|getPublicBrandSeriesOptions|seriesOptions/.test(
      productsPage
    );
  if (productsPageHasSeriesFilter) {
    errors.push("/products contains a series filter entry or series data import.");
  }

  if (!brandPage.includes("getPublicBrandSeriesOptions")) {
    errors.push("Brand detail page does not read the public series index.");
  }
  if (!brandPage.includes("brand.productCount > 100")) {
    errors.push("Brand detail page is missing the productCount > 100 gate.");
  }
  if (!brandPage.includes("seriesOptions.length > 0")) {
    errors.push("Brand detail page is missing the non-empty series options gate.");
  }
  if (!brandPage.includes("series?: string")) {
    errors.push("Brand detail page does not accept the series query parameter.");
  }
  if (!brandPage.includes('id="brand-stock"')) {
    errors.push("Brand detail stock area is missing the brand-stock anchor.");
  }
  if (!brandPage.includes("BrandSeriesFilterDrawer")) {
    errors.push("Brand detail page does not use the series filter drawer.");
  }
  if (!seriesDrawer.includes('role="dialog"')) {
    errors.push("Series filter drawer is missing dialog semantics.");
  }
  if (!seriesDrawer.includes('placeholder="搜索系列"')) {
    errors.push("Series filter drawer is missing the series search input.");
  }
  if (
    !seriesDrawer.includes("清除") ||
    !seriesDrawer.includes("确认") ||
    !seriesDrawer.includes("#brand-stock")
  ) {
    errors.push(
      "Series filter drawer is missing clear/confirm actions or stock anchor navigation."
    );
  }
  if (
    !productCard.includes("productAnchorId(product.id)") ||
    !productCard.includes('params.set("anchor"')
  ) {
    errors.push("Product cards are missing stable product anchors.");
  }
  if (
    !productCard.includes("productReturnScrollKey(returnTo)") ||
    !productCard.includes("scrollY: window.scrollY") ||
    !productCard.includes("productReturnNavigationKey(productId)") ||
    !productCard.includes("onNavigate")
  ) {
    errors.push(
      "Product cards do not persist trusted source navigation and list position."
    );
  }
  if (
    !productGrid.includes("parseProductReturnPosition") ||
    !productGrid.includes("scrollIntoView") ||
    !productGrid.includes('block: "center"')
  ) {
    errors.push(
      "Product grid does not restore the product anchor with scroll fallback."
    );
  }
  if (
    !productScroll.includes("ProductReturnPosition") ||
    !productScroll.includes("productAnchorId") ||
    !productScroll.includes("ProductReturnNavigation")
  ) {
    errors.push("Product scroll memory helpers are incomplete.");
  }
  if (
    !productDetailClient.includes("sanitizeProductAnchor") ||
    !productDetailClient.includes("appendProductAnchor") ||
    !productDetailClient.includes("returnTo") ||
    !productDetailClient.includes("scroll: false") ||
    !productDetailClient.includes("router.back()") ||
    !productDetailClient.includes("router.replace(")
  ) {
    errors.push(
      "Product detail back logic does not use history-back with replace fallback."
    );
  }
  if (productDetailClient.includes("router.push(")) {
    errors.push("Product detail back logic must not use router.push().");
  }
  if (
    !productDetailPage.includes('"返回品牌页"') ||
    !productDetailPage.includes('"返回海外库存"') ||
    !productDetailPage.includes("backLabel")
  ) {
    errors.push("Product detail page does not provide source-aware back labels.");
  }
  if (
    !brandPage.includes('href="/brands"') ||
    brandPage.includes("<BackButton")
  ) {
    errors.push("Brand detail back control must be a direct link to /brands.");
  }

  const forbiddenTerms = [
    "billiard",
    "billard",
    "dublin",
    "apple",
    "bulldog",
    "rhodesian",
    "tomato",
    "egg",
    "pear",
    "acorn",
    "brandy",
    "calabash",
    "canadian",
    "churchwarden",
    "cutty",
    "freehand",
    "lovat",
    "panel",
    "paneled",
    "poker",
    "pot",
    "prince",
    "tulip",
    "volcano",
    "zulu",
    "smooth",
    "sandblast",
    "sandblasted",
    "rusticated",
    "natural",
    "polished",
    "briar",
    "meerschaum",
    "morta",
    "horn",
    "acrylic",
    "cumberland",
    "bamboo",
    "large",
    "small",
    "mini",
    "chubby",
    "bent",
    "straight",
  ];
  const allowedMaterialSeries = new Set([
    "dunhill:shell briar",
    "dunhill:root briar",
    "dunhill:cumberland",
    "missouri meerschaum:corn cob",
  ]);

  function validateOption(brandEntry, option) {
    const normalizedSeries = normalize(option.series);
    const exceptionKey = `${normalize(brandEntry.brand)}:${normalizedSeries}`;
    if (/\b(?:19|20)\d{2}\b|\b\d+\b/.test(normalizedSeries)) {
      errors.push(
        `${brandEntry.brand} series contains a year or standalone number: ${option.series}`
      );
    }
    const forbidden = forbiddenTerms.find((term) =>
      new RegExp(`\\b${term}\\b`, "i").test(normalizedSeries)
    );
    if (forbidden && !allowedMaterialSeries.has(exceptionKey)) {
      errors.push(
        `${brandEntry.brand} series contains forbidden taxonomy term ${forbidden}: ${option.series}`
      );
    }
  }

  for (const auditBrand of audit.brands || []) {
    for (const option of auditBrand.seriesCandidates || []) {
      validateOption(auditBrand, option);
    }
  }

  for (const brandEntry of seriesFile.brands || []) {
    const publicBrand = brandBySlug.get(brandEntry.brandSlug);
    if (!publicBrand) {
      errors.push(`Series brand is missing from brands.json: ${brandEntry.brand}`);
      continue;
    }
    if (publicBrand.productCount <= 100 || brandEntry.productCount <= 100) {
      errors.push(
        `Brand at or below threshold entered frontend series index: ${brandEntry.brand}`
      );
    }
    if (!brandEntry.seriesOptions?.length) {
      errors.push(`Frontend series brand has no options: ${brandEntry.brand}`);
    }

    for (const option of brandEntry.seriesOptions || []) {
      if (option.count !== option.productIds.length) {
        errors.push(
          `${brandEntry.brand} ${option.series} count does not match productIds.`
        );
      }
      if (new Set(option.productIds).size !== option.productIds.length) {
        errors.push(
          `${brandEntry.brand} ${option.series} has duplicate product IDs.`
        );
      }

      for (const productId of option.productIds) {
        const product = productById.get(productId);
        if (!product) {
          errors.push(
            `${brandEntry.brand} ${option.series} references missing product ${productId}.`
          );
        } else if (product.brandSlug !== brandEntry.brandSlug) {
          errors.push(
            `${brandEntry.brand} ${option.series} references another brand product ${productId}.`
          );
        }
      }
    }
  }

  const indexedSlugs = new Set(
    (seriesFile.brands || []).map((brand) => brand.brandSlug)
  );
  for (const brand of brandsFile.brands) {
    if (brand.productCount <= 100 && indexedSlugs.has(brand.brandSlug)) {
      errors.push(
        `Low-inventory brand has frontend series options: ${brand.brandName}`
      );
    }
  }

  const savinelli = (seriesFile.brands || []).find(
    (brand) => brand.brand === "Savinelli"
  );
  const savinelliAutograph = savinelli?.seriesOptions?.find(
    (option) => option.series === "Autograph"
  );
  if (!savinelliAutograph?.count) {
    errors.push("Savinelli Autograph is not represented as a Savinelli series.");
  }
  if (
    brandsFile.brands.some(
      (brand) => normalize(brand.brandName) === "savinelli autograph"
    )
  ) {
    errors.push("Savinelli Autograph remains as an independent public brand.");
  }

  const tsugeAudit = (audit.brands || []).find(
    (brand) => brand.brand === "Tsuge"
  );
  const tsugeIkebana = tsugeAudit?.seriesCandidates?.find(
    (option) => option.series === "Ikebana"
  );
  if (!tsugeIkebana?.count) {
    errors.push("Tsuge Ikebana is not represented as a Tsuge audit candidate.");
  }
  if (indexedSlugs.has("tsuge")) {
    errors.push("Tsuge must remain audit-only while productCount <= 100.");
  }
  if (
    brandsFile.brands.some(
      (brand) => normalize(brand.brandName) === "tsuge ikebana"
    )
  ) {
    errors.push("Tsuge Ikebana remains as an independent public brand.");
  }

  if (audit.status !== "passed") {
    errors.push(`Audit status is not passed: ${audit.status}`);
  }
  if (audit.summary.publicProductCount !== catalogFile.products.length) {
    errors.push("Audit public product count does not match catalog.json.");
  }
  if (audit.summary.publicBrandCount !== brandsFile.brands.length) {
    errors.push("Audit public brand count does not match brands.json.");
  }

  const result = {
    status: errors.length === 0 ? "passed" : "failed",
    checks: {
      productsPageHasNoSeriesFilter: !productsPageHasSeriesFilter,
      brandSeriesDrawerPresent: brandPage.includes("BrandSeriesFilterDrawer"),
      brandStockAnchorPresent: brandPage.includes('id="brand-stock"'),
      productAnchorPresent: productCard.includes("productAnchorId(product.id)"),
      productReturnMemoryPresent:
        productGrid.includes("parseProductReturnPosition") &&
        productDetailClient.includes("appendProductAnchor"),
      productDetailUsesHistoryBack:
        productDetailClient.includes("router.back()") &&
        productDetailClient.includes("router.replace(") &&
        !productDetailClient.includes("router.push("),
      productDetailHasSourceAwareLabel:
        productDetailPage.includes('"返回品牌页"') &&
        productDetailPage.includes('"返回海外库存"'),
      brandBackLinksToLibrary:
        brandPage.includes('href="/brands"') &&
        !brandPage.includes("<BackButton"),
      frontendBrandCount: (seriesFile.brands || []).length,
      frontendSeriesOptionCount: (seriesFile.brands || []).reduce(
        (total, brand) => total + brand.seriesOptions.length,
        0
      ),
      savinelliAutographCount: savinelliAutograph?.count || 0,
      tsugeIkebanaAuditCount: tsugeIkebana?.count || 0,
      lowInventoryBrandsInFrontendIndex: brandsFile.brands.filter(
        (brand) =>
          brand.productCount <= 100 && indexedSlugs.has(brand.brandSlug)
      ).length,
    },
    errors,
    warnings,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
