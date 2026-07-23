import { pipeProducts, type PipeProduct } from "@/data/pipes";
import { getDemoMakersAndStudios } from "@/lib/demo/maker-studio-fixtures";
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

function updatedTimestamp(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
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
  const demo = (Array.isArray(params.demo) ? params.demo[0] : params.demo) === "1";
  const weeklyProducts = getHomepageFeaturedProducts().map(weeklyProduct);
  const todayProducts = getTodayProducts();
  const brands = getFeaturedBrands();
  const makers = demo ? getFeaturedMakers() : [];

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
        makersDemo={demo}
      />
      <SiteFooter />
    </main>
  );
}
