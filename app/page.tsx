import { pipeProducts, type PipeProduct } from "@/data/pipes";
import {
  domesticMakers,
  getDomesticMakerTypeLabel,
} from "@/data/domestic-makers";
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
  { logoSrc: string; logoWidth: string }
> = {
  peterson: {
    logoSrc: "/brands/featured/peterson-logo-1600x800.png",
    logoWidth: "94px",
  },
  savinelli: {
    logoSrc: "/brands/featured/savinelli-logo-1600x800.png",
    logoWidth: "94px",
  },
  stanwell: {
    logoSrc: "/brands/featured/stanwell-logo-1600x800.png",
    logoWidth: "96px",
  },
  dunhill: {
    logoSrc: "/brands/featured/dunhill-logo-1600x800.png",
    logoWidth: "82px",
  },
  chacom: {
    logoSrc: "/brands/featured/chacom-logo-1600x800.png",
    logoWidth: "84px",
  },
};

const featuredMakerAssets: Record<
  string,
  { image: string; objectPosition: string }
> = {
  "qingyan-studio": {
    image: "/domestic-makers/demo/fictional-pipe-maker-01.png",
    objectPosition: "50% 38%",
  },
  "nanshan-handmade": {
    image: "/domestic-makers/demo/fictional-pipe-maker-02.png",
    objectPosition: "50% 38%",
  },
  "haishang-pipe-room": {
    image: "/domestic-makers/demo/fictional-pipe-maker-03.png",
    objectPosition: "50% 35%",
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
  return domesticMakers.flatMap((maker) => {
    const asset = featuredMakerAssets[maker.slug];
    if (!asset) return [];

    return [{
      slug: maker.slug,
      displayName: maker.displayName,
      city: maker.city,
      typeLabel: getDomesticMakerTypeLabel(maker.type),
      intro: maker.intro.replace(/^展示样例。/, ""),
      ...asset,
    }];
  });
}

export default function HomePage() {
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
      />
      <SiteFooter />
    </main>
  );
}
