export const DANISH_PIPE_SHOP_PRICING_CONFIG = Object.freeze({
  danishVatRate: 0.25,
  taxFactor: 1.2,
  shippingUsd: 21,
  freeShippingThresholdUsd: 260,
  serviceFeeRate: 0.15,
  minServiceFeeCny: 200,
});

export const REFERENCE_PRICE_COMMON_CONFIG = Object.freeze({
  domesticShippingCny: 30,
});

export function isPositiveFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function addDomesticShippingCny(
  referenceAmount,
  commonConfig = REFERENCE_PRICE_COMMON_CONFIG
) {
  if (!isPositiveFiniteNumber(referenceAmount)) return null;
  const domesticShippingCny = safeRate(commonConfig?.domesticShippingCny, 0);
  return referenceAmount + domesticShippingCny;
}

export function calculateDanishPipeShopReferencePrice({
  sourcePriceAmount,
  usdToCny,
  pricingConfig = DANISH_PIPE_SHOP_PRICING_CONFIG,
}) {
  if (!isPositiveFiniteNumber(sourcePriceAmount) || !isPositiveFiniteNumber(usdToCny)) {
    return null;
  }

  const netExportPriceUsd = sourcePriceAmount / (1 + pricingConfig.danishVatRate);
  const shippingUsd =
    netExportPriceUsd > pricingConfig.freeShippingThresholdUsd
      ? 0
      : pricingConfig.shippingUsd;
  const taxableProductCostCny = netExportPriceUsd * usdToCny * pricingConfig.taxFactor;
  const shippingCny = shippingUsd * usdToCny;
  const baseCostCny = taxableProductCostCny + shippingCny;
  const serviceFeeCny = Math.max(
    baseCostCny * pricingConfig.serviceFeeRate,
    pricingConfig.minServiceFeeCny
  );

  return addDomesticShippingCny(baseCostCny + serviceFeeCny);
}

function safeRate(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getSmokingpipesDiscountRate(brandName, pricingConfig) {
  const normalizedBrand = String(brandName ?? "").trim();
  const brandRates = pricingConfig?.brandDiscountRates || {};
  const rate = Object.prototype.hasOwnProperty.call(brandRates, normalizedBrand)
    ? brandRates[normalizedBrand]
    : pricingConfig?.defaultDiscountRate;

  return safeRate(rate, 0);
}

const SMOKINGPIPES_DEFAULT_SHIPPING_TIERS_USD = Object.freeze([
  Object.freeze({
    minPurchaseUsd: 0,
    maxPurchaseUsdExclusive: 150,
    shippingUsd: 6,
  }),
  Object.freeze({
    minPurchaseUsd: 150,
    maxPurchaseUsdExclusive: 400,
    shippingUsd: 19,
  }),
  Object.freeze({
    minPurchaseUsd: 400,
    maxPurchaseUsdExclusive: null,
    shippingUsd: 60,
  }),
]);

export function getSmokingpipesShippingTier(purchasePriceUsd, pricingConfig) {
  if (!isPositiveFiniteNumber(purchasePriceUsd)) return null;

  const tiers = Array.isArray(pricingConfig?.shippingTiersUsd)
    ? pricingConfig.shippingTiersUsd
    : SMOKINGPIPES_DEFAULT_SHIPPING_TIERS_USD;

  return (
    tiers.find((tier) => {
      const min = safeRate(tier.minPurchaseUsd, 0);
      const max = tier.maxPurchaseUsdExclusive;
      return (
        purchasePriceUsd >= min &&
        (max === null ||
          max === undefined ||
          purchasePriceUsd < safeRate(max, Number.POSITIVE_INFINITY))
      );
    }) || null
  );
}

export function getSmokingpipesShippingUsd(purchasePriceUsd, pricingConfig) {
  const tier = getSmokingpipesShippingTier(purchasePriceUsd, pricingConfig);
  return tier ? safeRate(tier.shippingUsd, 0) : null;
}

export function calculateSmokingpipesReferencePrice({
  sourcePriceAmount,
  brandName,
  usdToCny,
  pricingConfig,
}) {
  if (!isPositiveFiniteNumber(sourcePriceAmount) || !isPositiveFiniteNumber(usdToCny)) {
    return {
      siteDisplayReady: false,
      siteDisplayAmount: null,
      siteDisplayCurrency: null,
      brandDiscountRate: null,
      purchasePriceUsd: null,
      shippingUsd: null,
      taxableProductCostCny: null,
      shippingCny: null,
      baseCostCny: null,
      serviceFeeCny: null,
      domesticShippingCny: null,
    };
  }

  const brandDiscountRate = getSmokingpipesDiscountRate(brandName, pricingConfig);
  const purchasePriceUsd = sourcePriceAmount * (1 - brandDiscountRate);
  const shippingUsd = getSmokingpipesShippingUsd(purchasePriceUsd, pricingConfig);

  if (shippingUsd === null) {
    return {
      siteDisplayReady: false,
      siteDisplayAmount: null,
      siteDisplayCurrency: null,
      brandDiscountRate,
      purchasePriceUsd,
      shippingUsd: null,
      taxableProductCostCny: null,
      shippingCny: null,
      baseCostCny: null,
      serviceFeeCny: null,
      domesticShippingCny: null,
    };
  }

  const serviceFeeRate = safeRate(pricingConfig?.serviceFeeRate, 0);
  const minServiceFeeCny = safeRate(pricingConfig?.minServiceFeeCny, 0);
  const taxableProductCostCny = purchasePriceUsd * usdToCny;
  const shippingCny = shippingUsd * usdToCny;
  const baseCostCny = taxableProductCostCny + shippingCny;
  const serviceFeeCny = Math.max(baseCostCny * serviceFeeRate, minServiceFeeCny);
  const domesticShippingCny = safeRate(
    REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
    0
  );
  const siteDisplayAmount = baseCostCny + serviceFeeCny + domesticShippingCny;

  return {
    siteDisplayReady: true,
    siteDisplayAmount,
    siteDisplayCurrency: "CNY",
    brandDiscountRate,
    purchasePriceUsd,
    shippingUsd,
    taxableProductCostCny,
    shippingCny,
    baseCostCny,
    serviceFeeCny,
    domesticShippingCny,
  };
}
