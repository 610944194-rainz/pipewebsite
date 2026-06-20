import type { PublicCatalogProduct } from "./types";
import { getProductDisplayName } from "../product-display-name";

const COUNTRY_ZH: Record<string, string> = {
  Brazil: "巴西",
  Bulgaria: "保加利亚",
  "Czech Republic": "捷克",
  Denmark: "丹麦",
  "Denmark / Germany": "丹麦 / 德国",
  France: "法国",
  "France / United Kingdom": "法国 / 英国",
  Germany: "德国",
  Ireland: "爱尔兰",
  Italy: "意大利",
  Russia: "俄罗斯",
  Scotland: "苏格兰",
  Sweden: "瑞典",
  Turkey: "土耳其",
  "United Kingdom": "英国",
  "United States": "美国",
};

export function sourceLabel(source: PublicCatalogProduct["source"]) {
  return source === "danish" ? "Danish Pipe Shop" : "Smokingpipes";
}

export function countryLabel(value: string | null | undefined) {
  const country = String(value || "").trim();
  return COUNTRY_ZH[country] || country;
}

export function conditionDisplayLabel(
  conditionType: string | null | undefined,
  conditionLabel: string | null | undefined
) {
  if (conditionType === "new" || conditionLabel === "new") return "新斗";
  if (conditionType === "estate" || conditionLabel === "estate") return "回流斗";
  return String(conditionLabel || conditionType || "").trim();
}

export function filterDisplayLabel(value: string | null | undefined) {
  const filter = String(value || "").trim();
  const normalized = filter.toLowerCase();

  if (!filter) return "";
  if (normalized === "none" || normalized === "no filter") return "无滤芯";
  return filter;
}

export function sourceImageCandidates(value: string | null | undefined) {
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
      const rackCdnUrl = `https://c647068.ssl.cf2.rackcdn.com${pathname.replace(
        /^\/images/,
        ""
      )}`;

      return [
        rackCdnUrl,
        source,
      ];
    }
  } catch {
    // Non-URL values keep their original form.
  }

  return [source];
}

export function inventoryLabel(
  status: PublicCatalogProduct["inventoryStatus"]
) {
  return status === "sold" ? "已售参考" : "在售";
}

export function formatSourcePrice(product: PublicCatalogProduct) {
  if (
    typeof product.sourcePriceAmount === "number" &&
    product.sourcePriceCurrency
  ) {
    return `${product.sourcePriceCurrency} ${product.sourcePriceAmount.toLocaleString(
      "zh-CN",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )}`;
  }

  return "人工确认";
}

export function formatSitePrice(product: PublicCatalogProduct) {
  if (
    product.siteDisplayReady &&
    typeof product.siteDisplayAmount === "number" &&
    product.siteDisplayCurrency === "CNY"
  ) {
    return `约 ¥${Math.ceil(product.siteDisplayAmount).toLocaleString("zh-CN")}`;
  }

  return "价格待确认";
}

export function displayProductName(product: PublicCatalogProduct) {
  return getProductDisplayName(product).title;
}

export function displayProductEnglishName(product: PublicCatalogProduct) {
  return getProductDisplayName(product).subtitle || "";
}

export { shapeDisplayLabel } from "./shape";
