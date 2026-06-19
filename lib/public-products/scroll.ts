export function productReturnScrollKey(returnTo: string) {
  return `yandoubuy:return-scroll:${returnTo}`;
}

export function productReturnNavigationKey(productId: string) {
  return `yandoubuy:return-navigation:${productId}`;
}

export function productAnchorId(productId: string) {
  return `product-${productId}`;
}

export type ProductReturnPosition = {
  productId: string;
  scrollY: number;
};

export type ProductReturnNavigation = {
  returnTo: string;
  anchor: string;
  savedAt: number;
};

export function parseProductReturnNavigation(
  value: string | null
): ProductReturnNavigation | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<ProductReturnNavigation>;
    if (
      typeof parsed.returnTo === "string" &&
      parsed.returnTo.startsWith("/") &&
      typeof parsed.anchor === "string" &&
      /^product-[a-z0-9][a-z0-9-]*$/i.test(parsed.anchor) &&
      typeof parsed.savedAt === "number" &&
      Number.isFinite(parsed.savedAt)
    ) {
      return {
        returnTo: parsed.returnTo,
        anchor: parsed.anchor,
        savedAt: parsed.savedAt,
      };
    }
  } catch {}

  return null;
}

export function parseProductReturnPosition(
  value: string | null
): ProductReturnPosition | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<ProductReturnPosition>;
    if (
      typeof parsed.productId === "string" &&
      parsed.productId &&
      typeof parsed.scrollY === "number" &&
      Number.isFinite(parsed.scrollY)
    ) {
      return {
        productId: parsed.productId,
        scrollY: parsed.scrollY,
      };
    }
  } catch {}

  const scrollY = Number.parseFloat(value);
  if (Number.isFinite(scrollY)) return { productId: "", scrollY };

  return null;
}
