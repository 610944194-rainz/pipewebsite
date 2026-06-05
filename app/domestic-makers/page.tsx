import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import {
  domesticMakers,
  getDomesticMakerTypeLabel,
  type DomesticMaker,
  type DomesticMakerType,
} from "../../data/domestic-makers";
import { getDomesticProductsByMakerSlug } from "../../data/domestic-products";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    type?: string;
  }>;
};

const makerTypes = [
  { value: "all", label: "全部" },
  { value: "maker", label: "斗师" },
  { value: "studio", label: "工作室" },
  { value: "shop", label: "线下店" },
];

const paperTextureStyle = {
  backgroundColor: "#FBF7EF",
  backgroundImage:
    "linear-gradient(135deg, rgba(154, 101, 48, 0.08) 0 1px, transparent 1px), linear-gradient(45deg, rgba(44, 33, 28, 0.04) 0 1px, transparent 1px)",
  backgroundSize: "22px 22px, 30px 30px",
};

function getSearchText(maker: DomesticMaker) {
  return [
    maker.name,
    maker.displayName,
    maker.city,
    maker.intro,
    maker.longIntro,
    getDomesticMakerTypeLabel(maker.type),
    ...maker.styleTags,
    ...maker.specialties,
  ]
    .join(" ")
    .toLowerCase();
}

function buildDomesticMakersHref({
  query,
  type,
}: {
  query?: string;
  type?: string;
}) {
  const params = new URLSearchParams();

  if (query?.trim()) {
    params.set("q", query.trim());
  }

  if (type && type !== "all") {
    params.set("type", type);
  }

  const queryString = params.toString();
  return queryString ? `/domestic-makers?${queryString}` : "/domestic-makers";
}

function MakerMark({ maker }: { maker: DomesticMaker }) {
  return (
    <div
      className="relative flex aspect-[4/3] min-h-[128px] items-center justify-center overflow-hidden rounded-[20px] border border-[#E5D7C5] p-4"
      style={paperTextureStyle}
    >
      <div className="absolute inset-4 rounded-[18px] border border-[#E8DDCF]" />
      <div className="absolute left-6 top-6 h-px w-20 bg-[#D8C5AE]" />
      <div className="absolute bottom-6 right-6 h-px w-16 bg-[#E5D7C5]" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[#D8C5AE] bg-[#FFFDF8] text-center text-[18px] font-black leading-tight text-[#9A6530]">
        {maker.displayName.slice(0, 2)}
      </div>
    </div>
  );
}

function MakerCard({ maker }: { maker: DomesticMaker }) {
  const productCount = getDomesticProductsByMakerSlug(maker.slug).length;

  return (
    <article className="flex h-full flex-col rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
      <MakerMark maker={maker} />

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#9A6530]">
          {getDomesticMakerTypeLabel(maker.type)}
        </span>
        <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#75695F]">
          {maker.city}
        </span>
        <span className="rounded-full bg-[#F6F1E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#75695F]">
          {maker.status}
        </span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold leading-tight text-[#2B211C]">
            {maker.displayName}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
            {maker.intro}
          </p>
        </div>

        <div className="shrink-0 rounded-[16px] border border-[#E5D7C5] bg-[#FAF7F0] px-3 py-2 text-center">
          <p className="text-[22px] font-bold leading-none text-[#2B211C]">
            {productCount}
          </p>
          <p className="mt-1 text-[11px] font-medium text-[#75695F]">作品</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {maker.styleTags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[#E5D7C5] bg-white px-2.5 py-1 text-[11px] font-medium text-[#75695F]"
          >
            {tag}
          </span>
        ))}
      </div>

      <Link
        href={`/domestic-makers/${maker.slug}`}
        className="mt-5 flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
      >
        进入主页
      </Link>
    </article>
  );
}

export default async function DomesticMakersPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = String(resolvedSearchParams?.q || "").trim();
  const activeType = String(resolvedSearchParams?.type || "all").trim();
  const safeType = makerTypes.some((item) => item.value === activeType)
    ? activeType
    : "all";
  const keyword = searchQuery.toLowerCase();
  const filteredMakers = domesticMakers.filter((maker) => {
    const matchesSearch = !keyword || getSearchText(maker).includes(keyword);
    const matchesType = safeType === "all" || maker.type === safeType;

    return matchesSearch && matchesType;
  });

  return (
    <main className="min-h-screen bg-[#FAF7F0] text-[#2B211C]">
      <SiteHeader />

      <section className="px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="rounded-[28px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 shadow-[0_6px_22px_rgba(43,33,28,0.035)] sm:p-7">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.34em] text-[#9A6530]">
              DOMESTIC MAKERS
            </p>
            <h1 className="text-[30px] font-bold leading-tight tracking-tight text-[#2B211C] sm:text-5xl">
              国内斗师 / 工作室
            </h1>
            <p className="mt-3 max-w-3xl text-[14px] leading-7 text-[#75695F] sm:text-[16px]">
              收录国内斗师、工作室与线下合作渠道的烟斗器具作品，当前阶段以合作展示与人工咨询为主。
            </p>
          </header>

          <section className="mt-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-4 shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-5">
            <form
              action="/domestic-makers"
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-[#75695F]">
                  搜索名称 / 城市 / 风格
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="例如 青岩、上海、Freehand"
                  className="h-10 w-full rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] text-[#2B211C] outline-none transition placeholder:text-[#A09387] focus:border-[#A9682B]"
                />
                {safeType !== "all" && (
                  <input type="hidden" name="type" value={safeType} />
                )}
              </label>

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="h-10 rounded-full bg-[#A9682B] px-5 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
                >
                  搜索
                </button>
                {(searchQuery || safeType !== "all") && (
                  <Link
                    href="/domestic-makers"
                    className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-4 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
                  >
                    清空
                  </Link>
                )}
              </div>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              {makerTypes.map((item) => {
                const isActive = safeType === item.value;

                return (
                  <Link
                    key={item.value}
                    href={buildDomesticMakersHref({
                      query: searchQuery,
                      type: item.value,
                    })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                      isActive
                        ? "border-[#A9682B] bg-[#A9682B] text-white"
                        : "border-[#E5D7C5] bg-white text-[#75695F] hover:border-[#A9682B] hover:text-[#9A6530]",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <p className="mt-4 text-[12px] leading-6 text-[#75695F]">
              当前收录{" "}
              <span className="font-bold text-[#9A6530]">
                {domesticMakers.length}
              </span>{" "}
              个展示主体，筛选结果{" "}
              <span className="font-bold text-[#9A6530]">
                {filteredMakers.length}
              </span>{" "}
              个。
            </p>
          </section>

          {filteredMakers.length > 0 ? (
            <div className="mt-5 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {filteredMakers.map((maker) => (
                <MakerCard key={maker.slug} maker={maker} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-8 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)]">
              <p className="text-[20px] font-bold text-[#2B211C]">
                暂无匹配结果
              </p>
              <p className="mt-2 text-[13px] leading-6 text-[#75695F]">
                可以减少关键词，或切换回全部类型查看展示样例。
              </p>
            </div>
          )}

          <section className="mt-8 rounded-[24px] border border-[#E5D7C5] bg-[#FFFDF8] p-5 text-center shadow-[0_5px_18px_rgba(43,33,28,0.03)] sm:p-8">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.3em] text-[#9A6530]">
              NEXT
            </p>
            <h2 className="text-[22px] font-bold leading-tight text-[#2B211C] sm:text-3xl">
              希望展示作品或提交找斗需求？
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-6 text-[#75695F] sm:text-[15px]">
              国内斗师 / 工作室板块当前以资料展示和人工咨询为主，后续可扩展真实作品档案和合作主页。
            </p>
            <div className="mt-5 grid gap-2.5 sm:flex sm:justify-center">
              <Link
                href="/cooperate"
                className="flex h-10 items-center justify-center rounded-full bg-[#A9682B] px-7 text-[13px] font-semibold text-white transition hover:bg-[#8F5522]"
              >
                查看合作入驻
              </Link>
              <Link
                href="/request"
                className="flex h-10 items-center justify-center rounded-full border border-[#D8C5AE] bg-white px-7 text-[13px] font-semibold text-[#2B211C] transition hover:border-[#A9682B]"
              >
                提交找斗需求
              </Link>
            </div>
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
