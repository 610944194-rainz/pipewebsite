export type DanishPipeShopPricingConfig = {
  danishVatRate: number;
  taxFactor: number;
  shippingUsd: number;
  freeShippingThresholdUsd: number;
  serviceFeeRate: number;
  minServiceFeeCny: number;
};

export type SmokingpipesShippingTierUsd = {
  minPurchaseUsd: number;
  maxPurchaseUsdExclusive: number | null;
  shippingUsd: number;
};

export type SmokingpipesPricingConfig = {
  schemaVersion: 1;
  source: "smokingpipes";
  taxFactor: number;
  serviceFeeRate: number;
  minServiceFeeCny: number;
  defaultDiscountRate: number;
  brandDiscountRates: Record<string, number>;
  shippingTiersUsd: SmokingpipesShippingTierUsd[];
};

export type ReferencePriceCommonConfig = {
  domesticShippingCny: number;
};

export type DanishPipeShopReferencePriceInput = {
  sourcePriceAmount: number | null;
  usdToCny: number | null;
  pricingConfig?: DanishPipeShopPricingConfig;
};

export type SmokingpipesReferencePriceInput = {
  sourcePriceAmount: number | null;
  brandName: string | null | undefined;
  usdToCny: number | null;
  pricingConfig: SmokingpipesPricingConfig;
};

export type SmokingpipesReferencePriceResult = {
  siteDisplayReady: boolean;
  siteDisplayAmount: number | null;
  siteDisplayCurrency: "CNY" | null;
  brandDiscountRate: number | null;
  purchasePriceUsd: number | null;
  shippingUsd: number | null;
  taxableProductCostCny: number | null;
  shippingCny: number | null;
  baseCostCny: number | null;
  serviceFeeCny: number | null;
  domesticShippingCny: number | null;
};

export const DANISH_PIPE_SHOP_PRICING_CONFIG: DanishPipeShopPricingConfig;
export const REFERENCE_PRICE_COMMON_CONFIG: ReferencePriceCommonConfig;
export function isPositiveFiniteNumber(value: unknown): value is number;
export function addDomesticShippingCny(
  referenceAmount: number | null,
  commonConfig?: ReferencePriceCommonConfig
): number | null;
export function calculateDanishPipeShopReferencePrice(
  input: DanishPipeShopReferencePriceInput
): number | null;
export function getSmokingpipesDiscountRate(
  brandName: string | null | undefined,
  pricingConfig: SmokingpipesPricingConfig
): number;
export function getSmokingpipesShippingTier(
  purchasePriceUsd: number | null,
  pricingConfig: SmokingpipesPricingConfig
): SmokingpipesShippingTierUsd | null;
export function calculateSmokingpipesReferencePrice(
  input: SmokingpipesReferencePriceInput
): SmokingpipesReferencePriceResult;
