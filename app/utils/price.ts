import { customsExchangeRates } from "../../data/exchange-rates";

export const RMB_REFERENCE_LABEL = "人民币参考价";
export const RMB_REFERENCE_UNKNOWN = "人工确认";

export const PRICE_CALCULATION_CONFIG = {
  danishPipeShop: {
    danishVatRate: 0.25,
    taxFactor: 1.2,
    shippingUsd: 21,
    freeShippingThresholdUsd: 260,
    serviceFeeRate: 0.15,
    minServiceFeeCny: 200,
  },
} as const;

const FALLBACK_RMB_FIELD_KEYS = [
  "estimatedCnyValue",
  "estimatedCny",
  "cnyPrice",
  "priceCny",
] as const;

const ORIGINAL_PRICE_FIELD_KEYS = [
  "originalPriceValue",
  "originalPrice",
  "price",
] as const;

type ExchangeCurrency = keyof typeof customsExchangeRates.rates;

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parsePriceNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  let numeric = value
    .replace(/[^\d,.-]/g, "")
    .replace(/,-$/, ",00")
    .replace(/\.-$/, ".00")
    .replace(/-/g, "");

  if (!numeric) {
    return null;
  }

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    numeric =
      lastComma > lastDot
        ? numeric.replace(/\./g, "").replace(",", ".")
        : numeric.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = numeric.split(",");
    const decimalPart = parts[parts.length - 1] || "";

    numeric =
      parts.length === 2 && decimalPart.length > 0 && decimalPart.length <= 2
        ? numeric.replace(",", ".")
        : numeric.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOriginalPriceValue(product: Record<string, unknown>): number | null {
  for (const key of ORIGINAL_PRICE_FIELD_KEYS) {
    const parsed = parsePriceNumber(product[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getFallbackRmbValue(product: Record<string, unknown>): number | null {
  for (const key of FALLBACK_RMB_FIELD_KEYS) {
    const parsed = parsePriceNumber(product[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getCustomsExchangeRate(currency: string): number | null {
  const normalizedCurrency = normalizeText(currency || "USD").toUpperCase();
  const rate =
    customsExchangeRates.rates[normalizedCurrency as ExchangeCurrency];

  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function isDanishPipeShopProduct(product: Record<string, unknown>): boolean {
  const sourceText = [
    product.source,
    product.site,
    product.sourceUrl,
    product.originalUrl,
    product.href,
  ]
    .map(normalizeText)
    .join(" ")
    .toLowerCase();

  return (
    sourceText.includes("danish pipe shop") ||
    sourceText.includes("danishpipeshop.com")
  );
}

function calculateDanishPipeShopRmb(product: Record<string, unknown>) {
  const overseasPriceUsd = getOriginalPriceValue(product);
  const usdToCny = getCustomsExchangeRate(
    normalizeText(product.originalCurrency) || "USD"
  );

  if (overseasPriceUsd === null || usdToCny === null) {
    return null;
  }

  const { danishPipeShop } = PRICE_CALCULATION_CONFIG;
  const netExportPriceUsd =
    overseasPriceUsd / (1 + danishPipeShop.danishVatRate);
  const shippingUsd =
    netExportPriceUsd > danishPipeShop.freeShippingThresholdUsd
      ? 0
      : danishPipeShop.shippingUsd;
  const taxableCost = netExportPriceUsd * usdToCny * danishPipeShop.taxFactor;
  const shippingCny = shippingUsd * usdToCny;
  const baseCost = taxableCost + shippingCny;
  const serviceFee = Math.max(
    baseCost * danishPipeShop.serviceFeeRate,
    danishPipeShop.minServiceFeeCny
  );

  return baseCost + serviceFee;
}

export function calculateRmbReferencePriceValue(
  product: Record<string, unknown>
): number | null {
  if (isDanishPipeShopProduct(product)) {
    return calculateDanishPipeShopRmb(product);
  }

  return getFallbackRmbValue(product);
}

export function formatRmbReferencePrice(value: unknown): string {
  const parsed = parsePriceNumber(value);

  if (parsed === null) {
    return RMB_REFERENCE_UNKNOWN;
  }

  return `约 ¥${Math.ceil(parsed).toLocaleString("zh-CN")}`;
}

export function getRmbReferencePrice(product: Record<string, unknown>): string {
  return formatRmbReferencePrice(calculateRmbReferencePriceValue(product));
}
