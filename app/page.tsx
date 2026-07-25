import { getDemoMakersAndStudios } from "@/lib/demo/maker-studio-fixtures";
import { getPublicBrandProfiles } from "@/lib/public-products/brands";
import { getDailyProductUpdates } from "@/lib/public-products/daily-updates";
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

const featuredBrandSlugs = [
  "peterson",
  "savinelli",
  "stanwell",
  "dunhill",
  "chacom",
];

const featuredBrandAssets: Record<
  string,
  {
    logoSrc: string;
    logoMaxWidth: string;
    logoMaxHeight: string;
    logoScale: number;
    logoObjectPosition: string;
  }
> = {
  peterson: {
    logoSrc: "/brands/featured/peterson-logo-1600x800.png",
    logoMaxWidth: "98px",
    logoMaxHeight: "42px",
    logoScale: 1.08,
    logoObjectPosition: "center",
  },
  savinelli: {
    logoSrc: "/brands/featured/savinelli-logo-1600x800.png",
    logoMaxWidth: "94px",
    logoMaxHeight: "42px",
    logoScale: 1,
    logoObjectPosition: "center",
  },
  stanwell: {
    logoSrc: "/brands/featured/stanwell-logo-1600x800.png",
    logoMaxWidth: "92px",
    logoMaxHeight: "38px",
    logoScale: 0.88,
    logoObjectPosition: "center",
  },
  dunhill: {
    logoSrc: "/brands/featured/dunhill-logo-1600x800.png",
    logoMaxWidth: "82px",
    logoMaxHeight: "38px",
    logoScale: 1,
    logoObjectPosition: "center",
  },
  chacom: {
    logoSrc: "/brands/featured/chacom-logo-1600x800.png",
    logoMaxWidth: "82px",
    logoMaxHeight: "40px",
    logoScale: 0.95,
    logoObjectPosition: "center",
  },
};

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

function todayProduct(product: PublicCatalogProduct): HomeRailProduct {
  return {
    id: product.id,
    image: product.mainImage || "",
    brand: product.brandName || "品牌待确认",
    name: displayProductName(product),
    price: formatSitePrice(product),
    status: inventoryLabel(product.inventoryStatus),
  };
}

function getTodayProducts() {
  return (getDailyProductUpdates()?.products || [])
    .filter((product) => product.mainImage)
    .slice(0, 6)
    .map(todayProduct);
}

function getFeaturedBrands(): HomeFeaturedBrand[] {
  const profilesBySlug = new Map(
    getPublicBrandProfiles().map((brand) => [brand.slug, brand])
  );

  return featuredBrandSlugs.flatMap((slug) => {
    const brand = profilesBySlug.get(slug);
    const asset = featuredBrandAssets[slug];
    if (!brand || !asset) return [];

    return [{
      slug: brand.slug,
      name: brand.name,
      nameZh: brand.nameZh,
      country: brand.countryZh || brand.country,
      ...asset,
    }];
  });
}

function getFeaturedMakers(): HomeFeaturedMaker[] {
  return getDemoMakersAndStudios().map((maker) => ({
    slug: maker.slug,
    displayName: maker.name.replace(/^示例(?:斗师|工作室)\s*·\s*/, ""),
    city: maker.region,
    typeLabel: maker.kind === "maker" ? "斗师" : "工作室",
    intro: maker.intro,
    image: maker.coverImage || maker.heroImage || "",
    visual: maker.slug,
    objectPosition: "62% center",
  }));
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = searchParams ? await searchParams : {};
  const weeklyProducts = getHomepageFeaturedProducts().map(weeklyProduct);
  const todayProducts = getTodayProducts();
  const brands = getFeaturedBrands();
  const makers = getFeaturedMakers();

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
        makers={makers}
        makersDemo
      />
      <SiteFooter />
    </main>
  );
}
