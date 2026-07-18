import { domesticMakers, getDomesticMakerTypeLabel } from "@/data/domestic-makers";
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
  type HomeFeaturedMaker,
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

function todayProduct(product: PipeProduct): HomeRailProduct {
  return {
    id: String(product.id),
    image: product.imageUrl || product.galleryImages?.[0] || "",
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
    .sort((left, right) => updatedTimestamp(right.updatedAt) - updatedTimestamp(left.updatedAt))
    .slice(0, 8)
    .map(todayProduct);
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

function getFeaturedMaker(): HomeFeaturedMaker | undefined {
  const maker = domesticMakers.find(
    (candidate) => candidate.coverUrl.trim() && candidate.status !== "展示样例"
  );
  if (!maker) return undefined;

  return {
    slug: maker.slug,
    name: maker.displayName,
    city: maker.city,
    type: getDomesticMakerTypeLabel(maker.type),
    intro: maker.intro,
    coverUrl: maker.coverUrl,
  };
}

export default function HomePage() {
  const weeklyProducts = getHomepageFeaturedProducts().map(weeklyProduct);
  const todayProducts = getTodayProducts();
  const brands = getFeaturedBrands();
  const maker = getFeaturedMaker();

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
        maker={maker}
      />
      <SiteFooter />
    </main>
  );
}
