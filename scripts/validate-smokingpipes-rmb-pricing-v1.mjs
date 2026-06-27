import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DANISH_PIPE_SHOP_PRICING_CONFIG,
  REFERENCE_PRICE_COMMON_CONFIG,
  calculateDanishPipeShopReferencePrice,
  calculateSmokingpipesReferencePrice,
  getSmokingpipesShippingUsd,
} from "../lib/pricing/reference-price.mjs";

const ROOT = process.cwd();
const GENERATED_ROOT = path.join(ROOT, "data", "generated", "public-products");
const REVIEW_ROOT = path.join(ROOT, "data", "review");
const INPUTS = {
  exchangeRates: path.join(ROOT, "data", "exchange-rates.ts"),
  smokingpipesPricing: path.join(
    ROOT,
    "data",
    "pricing",
    "smokingpipes-pricing.json"
  ),
  smokingpipesProducts: path.join(
    ROOT,
    "data",
    "products",
    "smokingpipes-products.json"
  ),
  danishProducts: path.join(ROOT, "data", "products", "danish-products.json"),
  catalog: path.join(GENERATED_ROOT, "catalog.json"),
  recentNew: path.join(GENERATED_ROOT, "recent-new.json"),
  manifest: path.join(GENERATED_ROOT, "manifest.json"),
  site: path.join(ROOT, "data", "site.ts"),
  appPrice: path.join(ROOT, "app", "utils", "price.ts"),
  presentation: path.join(
    ROOT,
    "lib",
    "public-products",
    "presentation.ts"
  ),
};
const OUTPUTS = {
  json: path.join(REVIEW_ROOT, "pricing-impact-audit-report.json"),
  markdown: path.join(REVIEW_ROOT, "pricing-impact-audit-report.md"),
};
const FLOAT_TOLERANCE = 1e-7;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function approxEqual(left, right, tolerance = FLOAT_TOLERANCE) {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= tolerance
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fsSync.readFileSync(filePath))
    .digest("hex")
    .toUpperCase();
}

async function readExchangeRates(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const usdToCny = Number.parseFloat(
    source.match(/USD:\s*([0-9.]+)/)?.[1] || ""
  );
  return {
    effectiveMonth:
      source.match(/effectiveMonth:\s*"([^"]+)"/)?.[1] || null,
    basisDate: source.match(/basisDate:\s*"([^"]+)"/)?.[1] || null,
    USD: Number.isFinite(usdToCny) ? usdToCny : null,
  };
}

function readHeadJson(relativeFile) {
  try {
    const text = execFileSync(
      "git",
      ["show", `HEAD:${relativeFile.replace(/\\/g, "/")}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function addCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), ...details });
}

function calculatePreviousSmokingpipesFormula({
  sourcePriceAmount,
  brandName,
  usdToCny,
  pricingConfig,
}) {
  const reference = calculateSmokingpipesReferencePrice({
    sourcePriceAmount,
    brandName,
    usdToCny,
    pricingConfig: {
      ...pricingConfig,
      importCostFactor: 1,
      taxFactor: 1,
    },
  });
  return reference.siteDisplayAmount;
}

function smokingpipesSample(product, usdToCny, pricingConfig) {
  const sourcePriceAmount = product?.price?.current?.amount ?? null;
  const brandName = product?.canonicalBrand || product?.brand || null;
  const reference = calculateSmokingpipesReferencePrice({
    sourcePriceAmount,
    brandName,
    usdToCny,
    pricingConfig,
  });
  return {
    sourceProductId: cleanText(product?.sourceProductId),
    title: cleanText(product?.rawTitle || product?.fullTitle),
    brandName,
    sourceListedPriceUsd: sourcePriceAmount,
    sourceMsrpUsd: product?.price?.msrp?.amount ?? null,
    brandDiscountRate: reference.brandDiscountRate,
    purchasePriceUsd: reference.purchasePriceUsd,
    shippingUsd: reference.shippingUsd,
    importCostFactor: reference.importCostFactor,
    taxableProductCostCny: reference.taxableProductCostCny,
    shippingCny: reference.shippingCny,
    baseCostCny: reference.baseCostCny,
    serviceFeeCny: reference.serviceFeeCny,
    domesticShippingCny: reference.domesticShippingCny,
    previousFormulaAmount:
      sourcePriceAmount === null
        ? null
        : calculatePreviousSmokingpipesFormula({
            sourcePriceAmount,
            brandName,
            usdToCny,
            pricingConfig,
          }),
    correctedSiteDisplayAmount: reference.siteDisplayAmount,
    displayCeil:
      reference.siteDisplayAmount === null
        ? null
        : Math.ceil(reference.siteDisplayAmount),
  };
}

function danishSample(product, usdToCny) {
  const sourcePriceAmount = Number(product?.originalPriceValue);
  const config = DANISH_PIPE_SHOP_PRICING_CONFIG;
  const netExportPriceUsd = isPositiveNumber(sourcePriceAmount)
    ? sourcePriceAmount / (1 + config.danishVatRate)
    : null;
  const shippingUsd =
    netExportPriceUsd === null
      ? null
      : netExportPriceUsd > config.freeShippingThresholdUsd
        ? 0
        : config.shippingUsd;
  const taxableProductCostCny =
    netExportPriceUsd === null
      ? null
      : netExportPriceUsd * usdToCny * config.taxFactor;
  const shippingCny =
    shippingUsd === null ? null : shippingUsd * usdToCny;
  const baseCostCny =
    taxableProductCostCny === null ? null : taxableProductCostCny + shippingCny;
  const serviceFeeCny =
    baseCostCny === null
      ? null
      : Math.max(
          baseCostCny * config.serviceFeeRate,
          config.minServiceFeeCny
        );
  const siteDisplayAmount = calculateDanishPipeShopReferencePrice({
    sourcePriceAmount,
    usdToCny,
    pricingConfig: config,
  });

  return {
    sourceProductId: cleanText(product?.id),
    title: cleanText(product?.name),
    brandName: cleanText(product?.canonicalBrand || product?.brand),
    sourcePriceUsd: sourcePriceAmount,
    netExportPriceUsd,
    shippingUsd,
    taxFactor: config.taxFactor,
    taxableProductCostCny,
    shippingCny,
    baseCostCny,
    serviceFeeCny,
    domesticShippingCny: REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
    siteDisplayAmount,
    displayCeil:
      siteDisplayAmount === null ? null : Math.ceil(siteDisplayAmount),
  };
}

function pricingMatches(product, expected) {
  return (
    product.siteDisplayReady === expected.siteDisplayReady &&
    product.siteDisplayCurrency === expected.siteDisplayCurrency &&
    (expected.siteDisplayAmount === null
      ? product.siteDisplayAmount === null
      : approxEqual(product.siteDisplayAmount, expected.siteDisplayAmount)) &&
    (expected.siteDisplayAmount === null
      ? product.sortKeys?.price === null
      : approxEqual(product.sortKeys?.price, expected.siteDisplayAmount))
  );
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${columns
        .map((column) => cleanText(column.value(row)).replace(/\|/g, "\\|"))
        .join(" | ")} |`
  );
  return [header, separator, ...body].join("\n");
}

function buildMarkdown(report) {
  const spColumns = [
    { label: "ID", value: (row) => row.sourceProductId },
    { label: "品牌", value: (row) => row.brandName },
    { label: "原站价 USD", value: (row) => row.sourceListedPriceUsd },
    { label: "实际购买价 USD", value: (row) => row.purchasePriceUsd },
    { label: "运费 USD", value: (row) => row.shippingUsd },
    { label: "进口系数", value: (row) => row.importCostFactor },
    { label: "旧公式 CNY", value: (row) => row.previousFormulaAmount?.toFixed(2) },
    {
      label: "修复后 CNY",
      value: (row) => row.correctedSiteDisplayAmount?.toFixed(2),
    },
  ];
  const danishColumns = [
    { label: "ID", value: (row) => row.sourceProductId },
    { label: "品牌", value: (row) => row.brandName },
    { label: "原站价 USD", value: (row) => row.sourcePriceUsd },
    { label: "净出口价 USD", value: (row) => row.netExportPriceUsd?.toFixed(2) },
    { label: "运费 USD", value: (row) => row.shippingUsd },
    { label: "税费系数", value: (row) => row.taxFactor },
    { label: "展示价 CNY", value: (row) => row.siteDisplayAmount?.toFixed(2) },
  ];

  return `# Pricing Impact Audit Report

- 状态：${report.status.toUpperCase()}
- 生成时间：${report.generatedAt}
- 项目 USD/CNY 汇率：${report.exchangeRates.USD}

## 结论

- Danish 调用 \`reference-price.mjs\`：${report.danishImpact.callsReferencePriceModule}
- Danish 使用独立 \`calculateDanishPipeShopReferencePrice\`：${report.danishImpact.usesIndependentCalculator}
- Danish 保留 \`taxFactor=1.2\`：${report.danishImpact.taxFactorPreserved}
- Danish 受本次 SP 公式修复影响：${report.danishImpact.affectedBySmokingpipesFix}
- Danish 需要因本次修复重算 public catalog：${report.danishImpact.publicCatalogRecalculationRequired}
- Smokingpipes 问题：${report.smokingpipesImpact.rootCause}
- Smokingpipes public catalog 公式不一致：${report.catalog.smokingpipesFormulaMismatchCount}
- Danish public catalog 相对 hotfix 基线变化：${report.catalog.danishChangedFromHeadCount}

## Peterson 716017

- 原站列表价：$${report.peterson716017.sourceListedPriceUsd}
- Peterson 折扣后实际购买价：$${report.peterson716017.purchasePriceUsd}
- 国际运费：$${report.peterson716017.shippingUsd}
- import/tax factor：${report.peterson716017.importCostFactor}
- 服务费：¥${report.peterson716017.serviceFeeCny?.toFixed(2)}
- 国内邮费：¥${report.peterson716017.domesticShippingCny}
- 当前项目汇率结果：¥${report.peterson716017.correctedSiteDisplayAmount?.toFixed(2)}
- 页面向上取整显示：约 ¥${report.peterson716017.displayCeil}
- 汇率 7.2 校验：约 ¥${report.peterson716017.atUsdToCny72.displayCeil}

## Smokingpipes 抽样 10 条

${markdownTable(report.samples.smokingpipes, spColumns)}

## Danish 抽样 10 条

${markdownTable(report.samples.danish, danishColumns)}

## 校验

${report.checks
  .map((check) => `- ${check.passed ? "PASS" : "FAIL"}：${check.name}`)
  .join("\n")}

## Errors

${report.errors.length ? report.errors.map((error) => `- ${error}`).join("\n") : "- 无"}
`;
}

async function main() {
  const [
    exchangeRates,
    pricingConfig,
    smokingpipesPayload,
    danishProducts,
    catalogPayload,
    recentNewPayload,
    manifest,
    siteSource,
    appPriceSource,
    presentationSource,
  ] = await Promise.all([
    readExchangeRates(INPUTS.exchangeRates),
    readJson(INPUTS.smokingpipesPricing),
    readJson(INPUTS.smokingpipesProducts),
    readJson(INPUTS.danishProducts),
    readJson(INPUTS.catalog),
    readJson(INPUTS.recentNew),
    readJson(INPUTS.manifest),
    fs.readFile(INPUTS.site, "utf8"),
    fs.readFile(INPUTS.appPrice, "utf8"),
    fs.readFile(INPUTS.presentation, "utf8"),
  ]);

  const smokingpipesProducts = Array.isArray(smokingpipesPayload)
    ? smokingpipesPayload
    : smokingpipesPayload.products || [];
  const catalog = catalogPayload.products || [];
  const recentNew = recentNewPayload.products || [];
  const checks = [];
  const errors = [];
  const add = (name, passed, details = {}) =>
    addCheck(checks, name, passed, details);
  const usdToCny = exchangeRates.USD;

  add("项目 USD 汇率有效", isPositiveNumber(usdToCny), { actual: usdToCny });
  add("SP 配置 taxFactor 为 1.2", pricingConfig.taxFactor === 1.2, {
    actual: pricingConfig.taxFactor,
  });
  add(
    "Danish 配置 taxFactor 保持 1.2",
    DANISH_PIPE_SHOP_PRICING_CONFIG.taxFactor === 1.2,
    { actual: DANISH_PIPE_SHOP_PRICING_CONFIG.taxFactor }
  );

  for (const boundary of [
    [89.3, 6],
    [149.99, 6],
    [150, 19],
    [399.99, 19],
    [400, 60],
  ]) {
    add(
      `SP 运费边界 $${boundary[0]} => $${boundary[1]}`,
      getSmokingpipesShippingUsd(boundary[0], pricingConfig) === boundary[1]
    );
  }

  const peterson = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: 94,
    brandName: "Peterson",
    usdToCny,
    pricingConfig,
  });
  const petersonAt72 = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: 94,
    brandName: "Peterson",
    usdToCny: 7.2,
    pricingConfig,
  });
  const petersonExpectedBase = (89.3 * 1.2 + 6) * usdToCny;
  const petersonExpectedTotal =
    petersonExpectedBase + Math.max(petersonExpectedBase * 0.15, 200) + 30;
  add("Peterson 716017 使用折后实际购买价 $89.30", approxEqual(peterson.purchasePriceUsd, 89.3));
  add("Peterson 716017 使用 $6 运费", peterson.shippingUsd === 6);
  add("Peterson 716017 恢复 1.2 import/tax factor", peterson.importCostFactor === 1.2);
  add("Peterson 716017 当前汇率公式正确", approxEqual(peterson.siteDisplayAmount, petersonExpectedTotal));
  add("Peterson 716017 在汇率 7.2 时约 ¥1045", Math.ceil(petersonAt72.siteDisplayAmount) === 1045);
  add("低金额服务费使用最低 ¥200", peterson.serviceFeeCny === 200);
  add("国内邮费固定 ¥30", peterson.domesticShippingCny === 30);

  const highPrice = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: 400,
    brandName: "Other",
    usdToCny: 7.2,
    pricingConfig,
  });
  add(
    "高金额服务费使用 baseCost 的 15%",
    approxEqual(highPrice.serviceFeeCny, highPrice.baseCostCny * 0.15) &&
      highPrice.serviceFeeCny > 200
  );

  const missingPrice = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: null,
    brandName: "Peterson",
    usdToCny,
    pricingConfig,
  });
  add(
    "缺价不输出 ¥0",
    missingPrice.siteDisplayReady === false &&
      missingPrice.siteDisplayAmount === null
  );

  const importFactorOverride = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: 100,
    brandName: "Other",
    usdToCny: 7.2,
    pricingConfig: {
      ...pricingConfig,
      importCostFactor: 1.25,
      taxFactor: 1.2,
    },
  });
  add(
    "importCostFactor 优先于兼容 taxFactor",
    importFactorOverride.importCostFactor === 1.25 &&
      approxEqual(importFactorOverride.taxableProductCostCny, 100 * 1.25 * 7.2)
  );

  const danishControl = danishSample(danishProducts[0], usdToCny);
  add(
    "Danish 使用独立 VAT/运费/税费公式",
    approxEqual(
      danishControl.siteDisplayAmount,
      danishControl.baseCostCny +
        danishControl.serviceFeeCny +
        danishControl.domesticShippingCny
    )
  );
  add(
    "Danish 不套用 SP 运费档",
    danishControl.shippingUsd === 0 ||
      danishControl.shippingUsd === DANISH_PIPE_SHOP_PRICING_CONFIG.shippingUsd
  );

  add(
    "服务费文案为 15%、最低 200、国内邮费 30",
    siteSource.includes("服务费按落地成本的 15% 收取，最低 200 元；另加国内邮费 30 元。") &&
      !siteSource.includes("最低 300 元")
  );
  add(
    "Danish 前端调用独立价格函数",
    appPriceSource.includes("calculateDanishPipeShopReferencePrice") &&
      appPriceSource.includes("calculateDanishPipeShopRmb")
  );
  add(
    "前端缺价显示价格待确认且不回退美元价",
    presentationSource.includes("价格待确认") &&
      presentationSource.includes("约 ¥") &&
      !/formatSitePrice[\s\S]*?formatSourcePrice\(/.test(presentationSource)
  );

  const ids = catalog.map((product) => cleanText(product.id));
  add(
    "public catalog 结构有效且 ID 唯一",
    catalogPayload.schemaVersion === 1 &&
      catalog.length > 0 &&
      ids.every(Boolean) &&
      new Set(ids).size === ids.length
  );
  add(
    "manifest catalog/detail 数量与 public catalog 一致",
    manifest.publicProductCount === catalog.length &&
      manifest.detailRecordCount === catalog.length
  );

  const smokingpipesCatalog = catalog.filter(
    (product) => product.source === "smokingpipes"
  );
  const danishCatalog = catalog.filter((product) => product.source === "danish");
  const smokingpipesFormulaMismatches = smokingpipesCatalog.filter((product) => {
    const expected = calculateSmokingpipesReferencePrice({
      sourcePriceAmount: product.sourcePriceAmount,
      brandName: product.brandName,
      usdToCny,
      pricingConfig,
    });
    return !pricingMatches(product, expected);
  });
  add(
    "全部 SP public catalog 价格符合修复公式",
    smokingpipesFormulaMismatches.length === 0,
    { mismatchCount: smokingpipesFormulaMismatches.length }
  );
  add(
    "SP public catalog 无 0 元可售价格",
    smokingpipesCatalog.every(
      (product) =>
        !product.siteDisplayReady || isPositiveNumber(product.siteDisplayAmount)
    )
  );

  const headCatalog = readHeadJson(
    "data/generated/public-products/catalog.json"
  )?.products;
  const headDanishById = new Map(
    (headCatalog || [])
      .filter((product) => product.source === "danish")
      .map((product) => [product.id, product])
  );
  const danishChangedFromHead = headCatalog
    ? danishCatalog.filter(
        (product) =>
          JSON.stringify(product) !==
          JSON.stringify(headDanishById.get(product.id))
      )
    : [];
  add(
    "Danish public catalog 未被 SP hotfix 改动",
    headCatalog !== null && danishChangedFromHead.length === 0,
    { changedCount: danishChangedFromHead.length }
  );

  const detailProducts = [];
  for (const relativeFile of manifest.detailFiles || []) {
    const payload = await readJson(path.join(ROOT, relativeFile));
    detailProducts.push(...(payload.products || []));
  }
  const smokingpipesDetailMismatches = detailProducts
    .filter((product) => product.source === "smokingpipes")
    .filter((product) => {
      const expected = calculateSmokingpipesReferencePrice({
        sourcePriceAmount: product.sourcePriceAmount,
        brandName: product.brandName,
        usdToCny,
        pricingConfig,
      });
      return !pricingMatches(product, expected);
    });
  add(
    "全部 SP detail shard 价格符合修复公式",
    smokingpipesDetailMismatches.length === 0,
    { mismatchCount: smokingpipesDetailMismatches.length }
  );
  add(
    "detail shard 记录数与 manifest 一致",
    detailProducts.length === manifest.detailRecordCount
  );

  const recentNewMismatches = recentNew
    .filter((product) => product.source === "smokingpipes")
    .filter((product) => {
      const expected = calculateSmokingpipesReferencePrice({
        sourcePriceAmount: product.sourcePriceAmount,
        brandName: product.brandName,
        usdToCny,
        pricingConfig,
      });
      return !pricingMatches(product, expected);
    });
  add(
    "recent-new 中 SP 价格符合修复公式",
    recentNewMismatches.length === 0,
    { mismatchCount: recentNewMismatches.length }
  );

  const manifestHashMismatches = Object.entries(
    manifest.fileHashes || {}
  ).filter(([relativeFile, expectedHash]) => {
    const absoluteFile = path.join(ROOT, relativeFile);
    return !fsSync.existsSync(absoluteFile) || hashFile(absoluteFile) !== expectedHash;
  });
  add(
    "manifest 文件哈希全部匹配",
    manifestHashMismatches.length === 0,
    { mismatchCount: manifestHashMismatches.length }
  );

  for (const check of checks) {
    if (!check.passed) errors.push(check.name);
  }

  const smokingpipesById = new Map(
    smokingpipesProducts.map((product) => [
      cleanText(product.sourceProductId),
      product,
    ])
  );
  const petersonProduct = smokingpipesById.get("716017");
  const sampleIds = [
    "716017",
    ...smokingpipesCatalog
      .map((product) => cleanText(product.sourceProductId))
      .filter((id) => id && id !== "716017"),
  ].slice(0, 10);
  const smokingpipesSamples = sampleIds
    .map((id) => smokingpipesById.get(id))
    .filter(Boolean)
    .map((product) => smokingpipesSample(product, usdToCny, pricingConfig));
  const danishSamples = danishProducts
    .filter((product) => isPositiveNumber(Number(product.originalPriceValue)))
    .slice(0, 10)
    .map((product) => danishSample(product, usdToCny));
  const petersonAudit = smokingpipesSample(
    petersonProduct,
    usdToCny,
    pricingConfig
  );
  petersonAudit.atUsdToCny72 = smokingpipesSample(
    petersonProduct,
    7.2,
    pricingConfig
  );

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    exchangeRates,
    formula: {
      overseasBaseCost:
        "(purchasePriceUsd * importCostFactor + shippingUsd) * usdToCny",
      serviceFee:
        "max(baseCostCny * serviceFeeRate, minServiceFeeCny)",
      siteDisplay:
        "baseCostCny + serviceFeeCny + domesticShippingCny",
    },
    smokingpipesImpact: {
      rootCause:
        "The previous hotfix omitted the configured 1.2 import/tax cost factor from Smokingpipes taxable product cost.",
      usesActualPurchasePriceAfterBrandDiscount: true,
      usesMsrpAsPurchasePrice: false,
      configuredTaxFactor: pricingConfig.taxFactor,
    },
    danishImpact: {
      callsReferencePriceModule: appPriceSource.includes(
        "../../lib/pricing/reference-price.mjs"
      ),
      usesIndependentCalculator: appPriceSource.includes(
        "calculateDanishPipeShopReferencePrice"
      ),
      taxFactor: DANISH_PIPE_SHOP_PRICING_CONFIG.taxFactor,
      taxFactorPreserved:
        DANISH_PIPE_SHOP_PRICING_CONFIG.taxFactor === 1.2,
      affectedBySmokingpipesFix: false,
      publicCatalogRecalculationRequired: false,
      reason:
        "Danish uses calculateDanishPipeShopReferencePrice and its own VAT, shipping, and tax-factor configuration; the SP-only reprice path preserves Danish records byte-for-byte.",
    },
    peterson716017: petersonAudit,
    catalog: {
      total: catalog.length,
      smokingpipes: smokingpipesCatalog.length,
      danish: danishCatalog.length,
      smokingpipesFormulaMismatchCount:
        smokingpipesFormulaMismatches.length,
      smokingpipesDetailMismatchCount:
        smokingpipesDetailMismatches.length,
      recentNewMismatchCount: recentNewMismatches.length,
      danishChangedFromHeadCount: danishChangedFromHead.length,
      duplicateIdCount: ids.length - new Set(ids).size,
      manifestHashMismatchCount: manifestHashMismatches.length,
    },
    samples: {
      smokingpipes: smokingpipesSamples,
      danish: danishSamples,
    },
    checks,
    errors,
  };

  await fs.mkdir(REVIEW_ROOT, { recursive: true });
  await fs.writeFile(OUTPUTS.json, stableJson(report), "utf8");
  await fs.writeFile(
    OUTPUTS.markdown,
    `\ufeff${buildMarkdown(report)}`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status: report.status,
        peterson716017: {
          projectRate: usdToCny,
          purchasePriceUsd: petersonAudit.purchasePriceUsd,
          shippingUsd: petersonAudit.shippingUsd,
          importCostFactor: petersonAudit.importCostFactor,
          siteDisplayAmount: petersonAudit.correctedSiteDisplayAmount,
          displayCeil: petersonAudit.displayCeil,
        },
        catalog: report.catalog,
        reports: {
          json: path.relative(ROOT, OUTPUTS.json),
          markdown: path.relative(ROOT, OUTPUTS.markdown),
        },
        errors,
      },
      null,
      2
    )
  );

  if (errors.length) process.exitCode = 1;
}

await main();
