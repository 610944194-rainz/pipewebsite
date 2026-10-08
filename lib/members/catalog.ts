import "server-only";
import blendIndex from "@/data/members-blend-index.json";
import { getDomesticProductById } from "@/data/domestic-products";
import { getPublicCatalogMap, resolvePublicProductId } from "@/lib/public-products/server";
import { displayProductName } from "@/lib/public-products/presentation";
import { MemberError } from "./policy.mjs";

export type FavoriteItem = { productKey: string; productId: string; kind: string; title: string; brand: string; image: string | null; href: string; availability: string; savedAt?: string };
const blends = new Map(blendIndex.blends.map((blend) => [blend.id, blend]));
const aliases = new Map<string, string>();
for (const blend of blendIndex.blends) for (const legacy of blend.legacyIds) {
  const key = String(legacy);
  aliases.set(key, aliases.has(key) && aliases.get(key) !== blend.id ? "" : blend.id);
}
export function getBlend(value: unknown) {
  if (typeof value !== "string" || value.length > 100) throw new MemberError("INVALID_BLEND", "斗草条目不存在。", 404);
  const blend = blends.get(value) || blends.get(aliases.get(value) || "");
  if (!blend) throw new MemberError("INVALID_BLEND", "斗草条目不存在。", 404);
  return blend;
}
export function storedBlend(value: unknown, savedTitle: unknown) {
  const blend = typeof value === "string" ? blends.get(value) || blends.get(aliases.get(value) || "") : undefined;
  return blend || { title: typeof savedTitle === "string" && savedTitle ? `${savedTitle}（已归档）` : "已归档斗草条目", href: "" };
}
export function resolveFavorite(value: unknown, kind: unknown): FavoriteItem | null {
  if (typeof value !== "string" || value.length > 180 || !["overseas", "domestic"].includes(String(kind))) throw new MemberError("INVALID_PRODUCT", "烟斗条目不存在。", 404);
  if (kind === "domestic") {
    const product = getDomesticProductById(value);
    return product ? { productKey: `domestic:${product.id}`, productId: product.id, kind, title: product.name, brand: product.makerName, image: product.imageUrl || null, href: `/domestic-products/${encodeURIComponent(product.id)}`, availability: product.status === "已售" ? "sold" : product.isSample ? "sample" : "available" } : null;
  }
  const id = resolvePublicProductId(value);
  const product = id ? getPublicCatalogMap().get(id.id) : undefined;
  return product ? { productKey: `overseas:${product.id}`, productId: product.id, kind: "overseas", title: displayProductName(product), brand: product.brandName || "", image: product.mainImage, href: `/products/${encodeURIComponent(product.id)}`, availability: product.inventoryStatus } : null;
}
