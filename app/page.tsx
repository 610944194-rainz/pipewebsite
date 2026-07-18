import { pipeProducts, type PipeProduct } from "@/data/pipes";
import { getPublicBrandProfiles } from "@/lib/public-products/brands";
import { getHomepageFeaturedProducts } from "@/lib/public-products/server";
import {
  displayProductName,
  formatSitePrice,
  inventoryLabel,
} from "@/lib/public-products/presentation";
import type { PublicCatalogProduct } from "@/lib/public-products/types";
import SiteFooter from "./components/SiteFooter";
import SiteHeader from "./components/SiteHeader";
import HomeEditorialSections, {
  type HomeFeaturedBrand,
} from "./components/home/HomeEditorialSections";
import HomeHero from "./components/home/HomeHero";
import type { HomeRailProduct } from "./components/home/HomeProductRail";
import { getRmbReferencePrice } from "./utils/price";

const featuredBrandSlugs = [
  "peterson",
  "savinelli",
  "stanwell",
  "dunhill",
  "chacom",
];

function weeklyProduct(product: PublicCatalogProduct): HomeRailProduct {
  return {
    id: product.id,
    image: product.mainImage || "",
    brand: product.brandName || "品牌待确认",
    name: displayProductName(product),
    price: formatSitePrice(product),
    status: inventoryLabel(product.inventoryStatus),
  };
}

function updatedTimestamp(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatUpdatedAt(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? `${match[2]}-${match[3]} ${match[4]}:${match[5]}` : value.trim();
}

function displayableProductImage(product: PipeProduct) {
  const candidates = [product.imageUrl, ...(product.galleryImages || [])];

  return candidates.find((value) => {
    const source = String(value || "").trim();
    if (!source || /(?:placeholder|no[-_ ]?image|spacer|blank)/i.test(source)) {
      return false;
    }

    try {
      const url = new URL(source);
      return /^(https?):$/.test(url.protocol) && /\.(?:avif|jpe?g|png|webp)$/i.test(url.pathname);
    } catch {
      return source.startsWith("/") && /\.(?:avif|jpe?g|png|webp)(?:[?#]|$)/i.test(source);
    }
  });
}

function todayProduct(product: PipeProduct, image: string): HomeRailProduct {
  return {
    id: String(product.id),
    image,
    brand: product.brand || "品牌待确认",
    name: product.nameZh || product.name,
    price: getRmbReferencePrice(product),
    status: product.status,
    updatedAt: formatUpdatedAt(product.updatedAt),
  };
}

function getTodayProducts() {
  return [...pipeProducts]
    .filter((product) => !/已售|sold|out/i.test(product.status))
    .flatMap((product) => {
      const image = displayableProductImage(product);
      return image ? [{ product, image }] : [];
    })
    .sort((left, right) => updatedTimestamp(right.product.updatedAt) - updatedTimestamp(left.product.updatedAt))
    .slice(0, 6)
    .map(({ product, image }) => todayProduct(product, image));
}

function getFeaturedBrands(): HomeFeaturedBrand[] {
  const profilesBySlug = new Map(
    getPublicBrandProfiles().map((brand) => [brand.slug, brand])
  );

  return featuredBrandSlugs.flatMap((slug) => {
    const brand = profilesBySlug.get(slug);
    if (!brand) return [];

    return [{
      slug: brand.slug,
      name: brand.name,
      nameZh: brand.nameZh,
      logoText: brand.logoText,
      country: brand.countryZh || brand.country,
    }];
  });
}

export default function HomePage() {
  const weeklyProducts = getHomepageFeaturedProducts().map(weeklyProduct);
  const todayProducts = getTodayProducts();
  const brands = getFeaturedBrands();

  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />
      <div className="mx-auto max-w-[1200px]">
        <HomeHero />
      </div>
      <HomeEditorialSections
        weeklyProducts={weeklyProducts}
        todayProducts={todayProducts}
        brands={brands}
      />
      <SiteFooter />
    </main>
  );
}
