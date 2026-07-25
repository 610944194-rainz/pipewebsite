import { createHash } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import { getProductDisplayName } from "@/lib/product-display-name";
import WeChatContactCard from "../../components/contact/WeChatContactCard";
import ProductInquiryCopyButton from "./ProductInquiryCopyButton";
import {
  formatSitePrice,
  inventoryLabel,
} from "@/lib/public-products/presentation";
import {
  getPublicProductDetailById,
  resolvePublicProductId,
} from "@/lib/public-products/server";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildTemporaryPublicReference(productId: string) {
  const digest = createHash("sha256")
    .update(productId)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return `YD-${digest}`;
}

function safeReturnTo(value: string | undefined, productId: string) {
  const fallback = `/products/${encodeURIComponent(productId)}`;
  const raw = String(value || "").trim();

  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (!/^\/products\/[^?#]+(?:[?#].*)?$/.test(raw)) return fallback;

  return raw;
}

export default async function ProductInquiryPage({
  searchParams,
}: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawProductId = String(firstParam(params.product) || "").trim();

  if (!rawProductId) redirect("/request");

  const resolved = resolvePublicProductId(rawProductId);
  if (!resolved) redirect("/request");

  const product = getPublicProductDetailById(resolved.id);
  if (!product) redirect("/request");

  const display = getProductDisplayName(product);
  const productName = [display.title, display.subtitle]
    .filter(Boolean)
    .join(" ");
  const publicReference = buildTemporaryPublicReference(product.id);
  const price = formatSitePrice(product);
  const returnTo = safeReturnTo(firstParam(params.returnTo), product.id);
  const image = product.mainImage || product.gallery?.[0] || "";
  const inventoryText =
    product.inventoryStatus === "sold"
      ? "当前状态待确认"
      : `${inventoryLabel(product.inventoryStatus)}，需人工确认`;

  const copyText = [
    "【烟斗派商品咨询】",
    "",
    `商品：${productName}`,
    `烟斗派编号：${publicReference}`,
    `参考价格：${price}`,
    "",
    "我想咨询这把烟斗。",
  ].join("\n");

  return (
    <main className="min-h-screen bg-[var(--page-background)] text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto w-full max-w-[760px] px-5 pb-9 sm:px-7">
        <div className="flex h-[46px] items-center">
          <Link
            href={returnTo}
            aria-label="返回商品详情"
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center text-[var(--coffee-dark)] transition-colors hover:text-[var(--brass)]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="h-[20px] w-[20px]"
            >
              <path
                d="M15.5 5.5 9 12l6.5 6.5M9.5 12H20"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        <header className="pb-5 pt-1">
          <h1 className="text-[26px] font-medium leading-[1.08] tracking-[-0.035em] text-[var(--coffee-dark)]">
            咨询这把斗
          </h1>
          <p className="mt-3 text-[12.5px] font-normal leading-[1.5] text-[var(--text-secondary)]">
            商品信息已整理好，复制后发送到微信即可。
          </p>
        </header>

        <section className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-4 border-b border-[var(--border)] pb-5 sm:grid-cols-[144px_minmax(0,1fr)]">
          <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[5px] border border-[rgba(222,212,200,0.68)] bg-white p-2">
            {image ? (
              <img
                src={image}
                alt={display.title}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="px-3 text-center text-[10.5px] leading-[1.4] text-[#998b80]">
                商品图片暂不可用
              </span>
            )}
          </div>

          <div className="min-w-0 pt-0.5">
            <p className="text-[10px] font-medium uppercase leading-[1.3] tracking-[0.15em] text-[var(--brass)]">
              {product.brandName || "品牌待确认"}
            </p>
            <h2 className="mt-2 text-[15.5px] font-medium leading-[1.42] tracking-[-0.015em] text-[var(--coffee-dark)]">
              {display.title}
            </h2>
            {display.subtitle ? (
              <p className="mt-1 line-clamp-2 text-[10.5px] font-normal leading-[1.45] text-[var(--text-secondary)]">
                {display.subtitle}
              </p>
            ) : null}
            <p className="mt-3 text-[18px] font-medium leading-none text-[var(--brass)]">
              {price}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] font-normal leading-[1.4] text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                className="h-1 w-1 shrink-0 rounded-full bg-[var(--brass)]"
              />
              {inventoryText}
            </p>
          </div>
        </section>

        <section className="mt-6 border-y border-[var(--border)]">
          <div className="py-4">
            <p className="text-[15px] font-medium leading-[1.25] text-[var(--coffee-dark)]">
              商品咨询凭证
            </p>
          </div>

          <dl>
            <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 border-t border-[rgba(222,212,200,0.72)] py-3">
              <dt className="text-[10.5px] font-normal leading-[1.5] text-[var(--text-secondary)]">
                烟斗派编号
              </dt>
              <dd className="break-all font-mono text-[11.5px] font-medium leading-[1.5] tracking-[0.04em] text-[var(--coffee-dark)]">
                {publicReference}
              </dd>
            </div>

            <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 border-t border-[rgba(222,212,200,0.72)] py-3">
              <dt className="text-[10.5px] font-normal leading-[1.5] text-[var(--text-secondary)]">
                商品名称
              </dt>
              <dd className="text-[11.5px] font-normal leading-[1.5] text-[var(--coffee-dark)]">
                {productName}
              </dd>
            </div>

            <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 border-t border-[rgba(222,212,200,0.72)] py-3">
              <dt className="text-[10.5px] font-normal leading-[1.5] text-[var(--text-secondary)]">
                参考价格
              </dt>
              <dd className="text-[11.5px] font-medium leading-[1.5] text-[var(--coffee-dark)]">
                {price}
              </dd>
            </div>
          </dl>
        </section>

        <div className="py-6">
          <ProductInquiryCopyButton copyText={copyText} />
          <p className="mt-2 text-center text-[10.5px] font-normal leading-[1.4] text-[#95877b]">
            复制后发送到微信，也可以直接截图本页。
          </p>
        </div>
      </div>


        <WeChatContactCard className="mx-auto mt-6 w-full max-w-[760px] px-5 sm:px-7" />

      <footer className="border-t border-[rgba(222,212,200,0.78)] bg-[#f2ece3]">
        <div className="mx-auto max-w-[760px] px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <img
              src="/pics/yandoubuy-logo-header.png"
              alt="烟斗派 YandouBuy"
              className="h-auto w-[118px] object-contain object-left mix-blend-multiply"
            />
            <p className="text-right text-[9.5px] font-normal leading-[1.45] text-[#8d8075]">
              商品信息与库存以人工确认为准
            </p>
          </div>
          <div className="mt-3 border-t border-[rgba(222,212,200,0.78)] pt-3 text-[9.5px] font-normal leading-[1.45] text-[#95887d]">
            © 2026 烟斗派 YandouBuy
          </div>
        </div>
      </footer>
    </main>
  );
}
