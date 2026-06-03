import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "../../components/SiteFooter";
import { pipeProducts } from "../../../data/pipes";
import ProductGallery from "./ProductGallery";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    img?: string;
  }>;
};

type ProductWithExtras = (typeof pipeProducts)[number] & {
  galleryImages?: string[];
  specsText?: string[];
  tags?: string[];
  sourceUrl?: string;
};

export function generateStaticParams() {
  return pipeProducts.map((product) => ({
    id: String(product.id),
  }));
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialImageIndex = Number(resolvedSearchParams.img || 0);

  const product = pipeProducts.find(
    (item) => String(item.id) === String(id)
  ) as ProductWithExtras | undefined;

  if (!product) {
    notFound();
  }

  const galleryImages = product.galleryImages ?? [];
  const specsText = product.specsText ?? [];
  const tags = product.tags ?? [];

  return (
    <main className="min-h-screen bg-[#100a07] px-4 py-6 text-[#fff8ec] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 border-b border-[#3a2419] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.45em] text-[#c9904c]">
                PIPE DETAIL
              </p>

              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                烟斗详情
              </h1>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
              <Link
                href="/products"
                className="flex min-h-11 items-center justify-center rounded-full border border-[#6b422b] px-5 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
              >
                返回商品库
              </Link>

              <Link
                href="/"
                className="flex min-h-11 items-center justify-center rounded-full bg-[#d1934a] px-5 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
              >
                回到首页
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <ProductGallery
            productId={product.id}
            name={product.name}
            imageUrl={product.imageUrl}
            galleryImages={galleryImages}
            initialIndex={initialImageIndex}
          />

          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#2a1a12] px-3 py-1 text-xs text-[#d1934a]">
                {product.condition}
              </span>

              <span className="rounded-full bg-[#2a1a12] px-3 py-1 text-xs text-[#d1934a]">
                {product.status}
              </span>

              <span className="rounded-full bg-[#2a1a12] px-3 py-1 text-xs text-[#d1934a]">
                {product.source}
              </span>

              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[#2a1a12] px-3 py-1 text-xs text-[#d8b58a]"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div>
              <p className="mb-2 text-sm text-[#d1934a]">{product.brand}</p>

              <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-tight text-[#fff8ec] sm:text-5xl">
                {product.name}
              </h2>
            </div>

            <p className="max-w-3xl text-base leading-8 text-[#f1dfc5] sm:text-lg">
              {product.detail}
            </p>

            <section className="rounded-[1.5rem] border border-[#4a2f20] bg-[#21150f] p-5 sm:p-6">
              <h3 className="mb-5 text-xl font-black">价格与库存参考</h3>

              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between border-b border-[#342116] pb-3">
                  <span className="text-[#b99b7d]">海外原价</span>
                  <span className="font-bold text-[#f6c177]">
                    {product.originalPrice}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-[#342116] pb-3">
                  <span className="text-[#b99b7d]">人民币参考价</span>
                  <span className="font-bold">{product.estimatedCny}</span>
                </div>

                <div className="flex items-center justify-between border-b border-[#342116] pb-3">
                  <span className="text-[#b99b7d]">来源网站</span>
                  <span className="font-bold">{product.source}</span>
                </div>

                <div className="flex items-center justify-between border-b border-[#342116] pb-3">
                  <span className="text-[#b99b7d]">库存状态</span>
                  <span className="font-bold">{product.status}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[#b99b7d]">更新时间</span>
                  <span className="font-bold">{product.updatedAt}</span>
                </div>
              </div>
            </section>

            {specsText.length > 0 && (
              <section className="rounded-[1.5rem] border border-[#4a2f20] bg-[#21150f] p-5 sm:p-6">
                <h3 className="mb-5 text-xl font-black">参数信息</h3>

                <div className="grid gap-3 sm:grid-cols-2">
                  {specsText.map((spec) => (
                    <div
                      key={spec}
                      className="rounded-2xl bg-[#160d09] px-4 py-3 text-sm font-bold text-[#fff8ec]"
                    >
                      {spec}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {product.sourceUrl && (
                <a
                  href={product.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center justify-center rounded-full border border-[#6b422b] px-5 text-sm font-bold text-[#fff8ec] transition hover:border-[#d1934a] hover:text-[#d1934a]"
                >
                  查看原站链接
                </a>
              )}

              <a
                href="#consult"
                className="flex min-h-12 items-center justify-center rounded-full bg-[#d1934a] px-5 text-sm font-bold text-[#120b08] transition hover:bg-[#e3a85c]"
              >
                咨询这只斗
              </a>
            </div>
          </div>
        </section>

        <section
          id="consult"
          className="mt-10 rounded-[1.8rem] border border-[#4a2f20] bg-[#21150f] p-5 sm:p-7"
        >
          <p className="mb-2 text-xs uppercase tracking-[0.35em] text-[#c9904c]">
            SERVICE NOTE
          </p>

          <h3 className="mb-5 text-2xl font-black">咨询代购说明</h3>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-[#160d09] p-5">
              <p className="mb-2 text-sm font-bold text-[#d1934a]">01</p>
              <h4 className="mb-2 font-black">人工确认库存</h4>
              <p className="text-sm leading-7 text-[#d8b58a]">
                页面展示的是采集时信息，下单前需要人工重新确认是否仍有库存。
              </p>
            </div>

            <div className="rounded-2xl bg-[#160d09] p-5">
              <p className="mb-2 text-sm font-bold text-[#d1934a]">02</p>
              <h4 className="mb-2 font-black">确认最终成本</h4>
              <p className="text-sm leading-7 text-[#d8b58a]">
                最终价格会结合原站价格、国际运费、预计税费与服务费综合确认。
              </p>
            </div>

            <div className="rounded-2xl bg-[#160d09] p-5">
              <p className="mb-2 text-sm font-bold text-[#d1934a]">03</p>
              <h4 className="mb-2 font-black">适合找斗参考</h4>
              <p className="text-sm leading-7 text-[#d8b58a]">
                已售商品也可以作为品牌、斗型、价格区间参考，用于寻找相近库存。
              </p>
            </div>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
