import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import { pipeProducts } from "@/data/pipes";

type PipeLike = Record<string, unknown>;

type IconProps = {
  className?: string;
};

function getText(item: PipeLike, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = item[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

function getImage(item: PipeLike) {
  const direct = getText(item, [
    "imageUrl",
    "detailImageUrl",
    "image",
    "thumbnail",
    "cover",
  ]);

  if (direct) return direct;

  const galleryImages = item.galleryImages;

  if (Array.isArray(galleryImages) && typeof galleryImages[0] === "string") {
    return galleryImages[0];
  }

  const images = item.images;

  if (Array.isArray(images) && typeof images[0] === "string") {
    return images[0];
  }

  return "";
}

function getPrice(item: PipeLike) {
  const rawPrice = getText(item, ["price", "displayPrice", "rawPrice"], "");

  if (!rawPrice) return "价格待确认";

  const cleaned = rawPrice
    .replace(/\s+/g, " ")
    .replace(/\$\s+/g, "$")
    .replace(/€\s+/g, "€")
    .replace(/£\s+/g, "£")
    .replace(/,\s*-/g, "")
    .replace(/\s*-\s*$/g, "")
    .trim();

  const match = cleaned.match(/^([$€£])\s?([\d.,]+)/);

  if (!match) return cleaned;

  const symbol = match[1];
  const numberPart = match[2];

  // 处理欧洲价格格式：644,80 / 1128,40
  if (/^\d+,\d{2}$/.test(numberPart)) {
    const [intPart, decimalPart] = numberPart.split(",");
    const formattedInt = Number(intPart).toLocaleString("en-US");
    return `${symbol}${formattedInt}.${decimalPart}`;
  }

  // 处理普通整数格式：9672 / 1128
  if (/^\d+$/.test(numberPart)) {
    return `${symbol}${Number(numberPart).toLocaleString("en-US")}`;
  }

  // 已经有标准小数点：1,128.40
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(numberPart)) {
    return `${symbol}${numberPart}`;
  }

  return cleaned;
}

function getProductHref(item: PipeLike) {
  const id = getText(item, ["id", "slug"], "");

  if (id) return `/products/${encodeURIComponent(id)}`;

  return "/products";
}

function getBrand(item: PipeLike) {
  const brand = getText(item, ["brand", "maker"], "");

  if (brand) return brand;

  const name = getText(item, ["name", "title"], "PIPE");
  return name.split(" ")[0] || "PIPE";
}

function getProductName(item: PipeLike) {
  return getText(item, ["name", "title", "model"], "精选烟斗");
}

function getStatus(item: PipeLike) {
  const status = getText(item, ["status", "availability"], "In Stock");

  if (/sold|已售|out/i.test(status)) return "Sold";
  if (/reserve|预订/i.test(status)) return "Reserved";

  return "In Stock";
}

function getMeta(item: PipeLike) {
  const country = getText(item, ["country", "origin"], "");
  const filter = getText(item, ["filter", "filterSize"], "");
  const shape = getText(item, ["shape"], "");

  const parts = [country, filter, shape].filter(Boolean);

  if (parts.length > 0) return parts.slice(0, 2).join(" · ");

  return "人工确认库存";
}

const allPipes = Array.isArray(pipeProducts)
  ? (pipeProducts as PipeLike[])
  : [];

const availablePipes = allPipes.filter((item) => getStatus(item) !== "Sold");

const featuredPipes = (availablePipes.length ? availablePipes : allPipes).slice(
  0,
  4
);

const recentPipes = (availablePipes.length ? availablePipes : allPipes).slice(
  4,
  8
);

const quickLinks = [
  {
    title: "海外库存",
    desc: "实时库存，持续更新",
    href: "/products",
    icon: GlobeIcon,
  },
  {
    title: "品牌库",
    desc: "探索品牌与经典系列",
    href: "/brands",
    icon: ShieldIcon,
  },
  {
    title: "人工找斗",
    desc: "提交需求，精准找斗",
    href: "/request",
    icon: SearchIcon,
  },
  {
    title: "代购流程",
    desc: "简单透明，安心代购",
    href: "/service",
    icon: BriefcaseIcon,
  },
];

const collectionCards = [
  {
    title: "英式风格",
    desc: "经典传统，绅士之选",
    href: "/products",
    image: "/pics/collection-british.jpg",
  },
  {
    title: "美式风格",
    desc: "粗犷实用，收藏氛围",
    href: "/products",
    image: "/pics/collection-american.jpg",
  },
  {
    title: "意式经典",
    desc: "工艺精细，设计优雅",
    href: "/products",
    image: "/pics/collection-italian.jpg",
  },
  {
    title: "丹麦手工",
    desc: "简约自然，手工匠心",
    href: "/products",
    image: "/pics/collection-danish.jpg",
  },
];

const guideCards = [
  {
    title: "新手入门指南",
    desc: "如何选择第一支烟斗",
    href: "/service",
    image: "/pics/guide-beginner.jpg",
  },
  {
    title: "保养使用指南",
    desc: "延长烟斗寿命的小技巧",
    href: "/service",
    image: "/pics/guide-care.jpg",
  },
];

const whyItems = [
  {
    title: "严选库存",
    desc: "精选海外公开库存",
    icon: AwardIcon,
  },
  {
    title: "人工核验",
    desc: "确认价格与状态",
    icon: CheckShieldIcon,
  },
  {
    title: "找斗支持",
    desc: "按预算与偏好筛选",
    icon: UserIcon,
  },
];

export default function HomePage() {
  return (
    <main
      className="min-h-screen bg-[#FBF7EF] text-[#1F1A16]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "PingFang TC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
        fontVariantNumeric: "lining-nums",
      }}
    >
      <TopNotice />

      <SiteHeader />

      <div className="mx-auto max-w-6xl">
        <SearchBar />

        <HeroSection />

        <section className="space-y-9 px-4 pb-10 pt-7 sm:px-6 lg:px-8">
          <FeaturedSection />

          <QuickLinksSection />

          <CollectionSection />

          {recentPipes.length > 0 ? <RecentInventorySection /> : null}

          <GuideSection />

          <WhySection />

          <ServiceBoundary />

          <FinalCTA />
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

function TopNotice() {
  return (
    <div className="bg-[#063B32] px-4 py-2 text-center text-[12px] tracking-[0.12em] text-[#E7C48A] sm:text-[13px]">
      <span className="mx-2 text-[#B8863B]">•</span>
      精选海外烟斗库存 · 人工选品咨询
      <span className="mx-2 text-[#B8863B]">•</span>
    </div>
  );
}

function SearchBar() {
  return (
    <div className="border-b border-[#E7DDD0] bg-[#FBF7EF] px-4 py-4 sm:px-6 lg:px-8">
      <Link
        href="/products"
        className="mx-auto flex h-12 max-w-3xl items-center gap-3 rounded-full border border-[#D8CFC2] bg-white/70 px-4 text-[14px] text-[#746A5F] shadow-[0_8px_24px_rgba(31,26,22,0.04)]"
      >
        <SearchIcon className="h-5 w-5 text-[#8A8176]" />
        <span>搜索品牌、斗型、型号</span>
      </Link>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-[#E7DDD0]">
      <div className="relative min-h-[430px] bg-[#063B32] sm:min-h-[520px]">
        <img
          src="/pics/home-hero-01-inventory.jpg"
          alt="烟斗派精选海外库存"
          className="absolute inset-0 h-full w-full object-cover object-center brightness-105 contrast-105 saturate-105"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-[#031B17]/82 via-[#063B32]/42 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#031B17]/26 via-transparent to-transparent" />

        <div className="relative flex min-h-[430px] items-end px-6 pb-9 pt-12 sm:min-h-[520px] sm:px-10 lg:px-16">
          <div className="max-w-xl">
            <p className="mb-4 text-[13px] uppercase tracking-[0.26em] text-[#E7C48A]">
              Curated Pipes &amp; Sourcing
            </p>

            <h1 className="font-serif text-[54px] leading-[0.95] tracking-[0.08em] text-white sm:text-[72px]">
              烟斗派
            </h1>

            <p
              className="mt-2 text-[43px] leading-none tracking-[0.035em] text-[#C9964B] sm:text-[60px]"
              style={{
                fontFamily: '"Georgia", "Times New Roman", serif',
                fontWeight: 500,
              }}
            >
              YandouBuy
            </p>

            <p className="mt-6 text-[18px] font-semibold leading-8 text-[#F8F1E7] sm:text-[21px]">
              <span className="block">精选海外烟斗库存，</span>
              <span className="block">人工确认价格与入手成本。</span>
            </p>

            <Link
              href="/products"
              className="mt-7 inline-flex min-h-[52px] items-center justify-center rounded-md border border-[#B8863B] bg-[#063B32]/76 px-7 text-[16px] font-medium tracking-[0.08em] text-[#E7C48A] shadow-[0_14px_36px_rgba(0,0,0,0.22)] transition hover:bg-[#0A4A3E]"
            >
              查看海外库存
              <ArrowRightIcon className="ml-2 h-4 w-4" />
            </Link>

            <div className="mt-8 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-white" />
              <span className="h-2 w-2 rounded-full bg-white/45" />
              <span className="h-2 w-2 rounded-full bg-white/45" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturedSection() {
  return (
    <section>
      <SectionHeader title="今日精选" href="/products" linkText="查看更多" />

      <div className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0">
        {featuredPipes.map((item, index) => (
          <ProductCard key={`${getProductName(item)}-${index}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function RecentInventorySection() {
  return (
    <section>
      <SectionHeader title="近期海外上新" href="/products" linkText="查看全部" />

      <div className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0">
        {recentPipes.map((item, index) => (
          <ProductCard
            key={`${getProductName(item)}-recent-${index}`}
            item={item}
          />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ item }: { item: PipeLike }) {
  const image = getImage(item);
  const brand = getBrand(item);
  const name = getProductName(item);
  const status = getStatus(item);
  const price = getPrice(item);
  const meta = getMeta(item);

  return (
    <Link
      href={getProductHref(item)}
      className="min-w-[41%] snap-start overflow-hidden rounded-xl border border-[#E7DDD0] bg-white shadow-[0_8px_22px_rgba(31,26,22,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(31,26,22,0.11)] sm:min-w-0"
    >
      <div className="relative aspect-[1.25/1] bg-[#F7F3EA]">
        {image ? (
          <img
            src={image}
            alt={name}
            className="h-full w-full object-contain p-3"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F7F3EA] to-[#EDE3D6] text-[12px] tracking-[0.18em] text-[#A97838]">
            YANDOUBUY
          </div>
        )}

        <span className="absolute left-2 top-2 rounded bg-[#063B32] px-2 py-1 text-[10px] leading-none text-white">
          {status}
        </span>

        <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-[#063B32] shadow-sm">
          <HeartIcon className="h-4 w-4" />
        </span>
      </div>

      <div className="space-y-1.5 p-2.5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#063B32]">
          {brand}
        </p>

        <h3 className="line-clamp-2 min-h-[38px] text-[14px] font-medium leading-[1.35] text-[#1F1A16]">
          {name}
        </h3>

        <p className="line-clamp-1 text-[11px] text-[#746A5F]">{meta}</p>

        <div className="pt-1">
          <p
            className="leading-none text-[#A97838]"
            style={{
              fontFamily: '"Georgia", "Times New Roman", "PingFang SC", serif',
              fontSize: "18px",
              fontWeight: 400,
              letterSpacing: "0.005em",
              fontVariantNumeric: "lining-nums",
            }}
          >
            {price}
          </p>

          <p className="mt-1 text-[10px] leading-4 tracking-[0.04em] text-[#746A5F]">
            原站参考价
          </p>
        </div>
      </div>
    </Link>
  );
}

function QuickLinksSection() {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#E7DDD0] bg-white/78 shadow-[0_10px_26px_rgba(31,26,22,0.04)]">
      <div className="grid grid-cols-2 divide-x divide-y divide-[#E7DDD0]">
        {quickLinks.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.title}
              href={item.href}
              className="group relative min-h-[114px] p-4 transition hover:bg-[#F7F3EA]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FBF7EF] text-[#A97838]">
                  <Icon className="h-5 w-5" />
                </span>

                <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-[#8A8176] transition group-hover:translate-x-0.5" />
              </div>

              <div className="mt-4">
                <h3 className="whitespace-nowrap text-[17px] font-semibold leading-none tracking-[0.02em] text-[#1F1A16]">
                  {item.title}
                </h3>

                <p className="mt-2 text-[12px] leading-5 text-[#746A5F]">
                  {item.desc}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function CollectionSection() {
  return (
    <section>
      <SectionHeader title="海外库存速览" href="/products" linkText="查看全部" />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {collectionCards.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="group overflow-hidden rounded-xl border border-[#E7DDD0] bg-[#063B32] shadow-[0_10px_24px_rgba(31,26,22,0.08)]"
          >
            <div
              className="relative aspect-[0.78/1] bg-cover bg-center transition duration-300 group-hover:scale-[1.015]"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.06), rgba(4,32,27,0.76)), url('${item.image}')`,
              }}
            >
              <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                <h3 className="text-[16px] font-semibold leading-tight">
                  {item.title}
                </h3>

                <p className="mt-1 text-[11px] leading-4 text-white/82">
                  {item.desc}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-6 text-[#746A5F]">
        以上为浏览方向，具体库存、价格和入手成本以人工确认为准。
      </p>
    </section>
  );
}

function GuideSection() {
  return (
    <section>
      <SectionHeader
        title="烟斗知识与选购指南"
        href="/service"
        linkText="查看指南"
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        {guideCards.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="overflow-hidden rounded-xl border border-[#E7DDD0] bg-white shadow-[0_10px_24px_rgba(31,26,22,0.07)]"
          >
            <div
              className="aspect-[1.2/1] bg-[#063B32] bg-cover bg-center"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06)), url('${item.image}')`,
              }}
            />

            <div className="p-3">
              <h3 className="text-[15px] font-semibold text-[#1F1A16]">
                {item.title}
              </h3>

              <p className="mt-1 text-[12px] leading-5 text-[#746A5F]">
                {item.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function WhySection() {
  return (
    <section>
      <div className="mb-5 text-center">
        <h2 className="font-serif text-[25px] font-semibold tracking-[0.06em] text-[#1F1A16]">
          为什么选择烟斗派
        </h2>

        <div className="mx-auto mt-3 h-px w-16 bg-[#A97838]" />
      </div>

      <div className="grid grid-cols-3 divide-x divide-[#E7DDD0] rounded-2xl bg-white/50 py-2 shadow-[0_10px_26px_rgba(31,26,22,0.035)]">
        {whyItems.map((item) => {
          const Icon = item.icon;

          return (
            <div key={item.title} className="px-3 py-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center text-[#A97838]">
                <Icon className="h-7 w-7" />
              </div>

              <h3 className="mt-2 text-[14px] font-semibold text-[#1F1A16]">
                {item.title}
              </h3>

              <p className="mt-2 text-[11px] leading-5 text-[#746A5F]">
                {item.desc}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ServiceBoundary() {
  return (
    <section className="rounded-2xl border border-[#E7DDD0] bg-[#F7F3EA] p-5">
      <div className="flex gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#A97838]">
          <LeafIcon className="h-6 w-6" />
        </div>

        <div>
          <h2 className="text-[18px] font-semibold text-[#1F1A16]">
            我们的服务边界
          </h2>

          <p className="mt-2 text-[13px] leading-7 text-[#746A5F]">
            本站展示海外公开库存信息与人工选品咨询，不提供站内支付。
            价格、状态、运费、关税及入手成本以人工确认为准。
          </p>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="overflow-hidden rounded-2xl bg-[#063B32] p-5 text-white shadow-[0_18px_42px_rgba(4,42,36,0.22)]">
      <div
        className="rounded-xl border border-white/10 bg-cover bg-center p-5"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(6,59,50,0.96), rgba(6,59,50,0.88)), url('/pics/bg-brand-dark-green.jpg')",
        }}
      >
        <h2 className="font-serif text-[26px] tracking-[0.08em]">
          开始您的寻斗之旅
        </h2>

        <p className="mt-3 text-[14px] leading-7 text-white/78">
          浏览海外库存，或告诉我们您想找的烟斗。
        </p>

        <div className="mt-5 grid gap-3">
          <Link
            href="/products"
            className="flex h-12 items-center justify-center rounded-md border border-[#B8863B] bg-[#A97838] px-5 text-[15px] font-medium tracking-[0.08em] text-white"
          >
            查看海外库存
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Link>

          <Link
            href="/request"
            className="flex h-12 items-center justify-center rounded-md border border-[#B8863B] bg-[#FBF7EF] px-5 text-[15px] font-medium tracking-[0.08em] text-[#8A5D26]"
          >
            提交找斗需求
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="overflow-hidden bg-[#063B32] px-5 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#B8863B]/70 bg-[#FBF7EF]">
            <img
              src="/pics/yandoubuy-icon.png"
              alt="烟斗派"
              className="h-9 w-9 object-contain"
            />
          </span>

          <div className="min-w-0">
            <p className="font-serif text-[24px] leading-none tracking-[0.08em] text-white">
              烟斗派
              <span
                className="ml-2 text-[18px] tracking-normal text-[#E7C48A]"
                style={{
                  fontFamily: '"Georgia", "Times New Roman", serif',
                  fontWeight: 500,
                }}
              >
                YandouBuy
              </span>
            </p>

            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#E7C48A]/85">
              Curated Pipes &amp; Sourcing
            </p>
          </div>
        </div>

        <p className="max-w-md text-[13px] leading-7 text-white/78">
          海外烟斗库存与人工选品咨询平台，为每一位烟斗爱好者找到心仪之斗。
        </p>

        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[12px] leading-6 text-white/68">
            本站展示海外公开库存信息与人工选品咨询，不提供站内支付。价格、状态、运费、关税及入手成本以人工确认为准。
          </p>
        </div>

        <div className="mt-7 border-t border-white/10 pt-5">
          <h3 className="text-[13px] uppercase tracking-[0.2em] text-[#E7C48A]">
            快速导航
          </h3>

          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-[14px] text-white/82">
            <Link href="/products" className="hover:text-[#E7C48A]">
              海外库存
            </Link>

            <Link href="/brands" className="hover:text-[#E7C48A]">
              品牌库
            </Link>

            <Link href="/request" className="hover:text-[#E7C48A]">
              人工找斗
            </Link>

            <Link href="/service" className="hover:text-[#E7C48A]">
              代购流程
            </Link>
          </div>
        </div>

        <div className="mt-7 border-t border-white/10 pt-4 text-center text-[12px] text-white/45">
          © 2026 烟斗派 YandouBuy. All Rights Reserved.
        </div>
      </div>
    </footer>
  );
}

function SectionHeader({
  title,
  href,
  linkText,
}: {
  title: string;
  href: string;
  linkText: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-serif text-[23px] font-semibold tracking-[0.06em] text-[#1F1A16]">
        {title}
      </h2>

      <Link
        href={href}
        className="flex items-center text-[13px] text-[#746A5F] hover:text-[#063B32]"
      >
        {linkText}
        <ArrowRightIcon className="ml-1 h-4 w-4" />
      </Link>
    </div>
  );
}

function SearchIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m16.2 16.2 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HeartIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20s-7-4.2-9-9.1C1.8 8 3.5 5.2 6.4 5.1c1.7-.1 3.1.8 3.9 2.1.8-1.3 2.2-2.2 3.9-2.1 2.9.1 4.6 2.9 3.4 5.8C19 15.8 12 20 12 20Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.8 12h16.4M12 3.5c2.2 2.1 3.3 4.9 3.3 8.5S14.2 18.4 12 20.5C9.8 18.4 8.7 15.6 8.7 12S9.8 5.6 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 19 6v5.4c0 4.5-2.8 7.6-7 9.1-4.2-1.5-7-4.6-7-9.1V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8.8 12 2.1 2.1 4.4-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BriefcaseIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 8V6.5c0-1.4 1-2.5 2.5-2.5h2c1.5 0 2.5 1.1 2.5 2.5V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5 8h14c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 13h18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AwardIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m8.7 13-1.2 7 4.5-2.5 4.5 2.5-1.2-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m10.2 8.5 1.2 1.2 2.4-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckShieldIcon({ className = "" }: IconProps) {
  return <ShieldIcon className={className} />;
}

function UserIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 20c1.4-3.6 4-5.4 7.5-5.4s6.1 1.8 7.5 5.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LeafIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19.5 4.5c-6.5.2-11.2 2.5-13.7 6.8-1.8 3.1-1.1 6.3 1.1 8.2 2.4 2 5.9 1.5 8.3-1.2 2.9-3.3 4.1-8 4.3-13.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 18.5c2.3-4.4 5.4-7.4 9.4-9.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}