import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DemoMakerDossier from "../../components/domestic-makers/DemoMakerDossier";
import { getDemoMakerOrStudioBySlug } from "@/lib/demo/maker-studio-fixtures";
import { getDemoMakerProducts } from "@/lib/demo/maker-studio-product-adapter";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const legacyMakerSlugs = new Set([
  "qingyan-studio",
  "nanshan-handmade",
  "haishang-pipe-room",
]);

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  return firstParam(params.demo) === "1"
    ? {
        title: "斗师 / 工作室示例资料｜烟斗派 YandouBuy",
        robots: { index: false, follow: false },
      }
    : {};
}

export default async function DomesticMakerDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  if (firstParam(resolvedSearchParams.demo) !== "1") {
    if (legacyMakerSlugs.has(slug)) redirect("/domestic-makers");
    notFound();
  }

  const maker = getDemoMakerOrStudioBySlug(slug);
  if (!maker) notFound();

  return <DemoMakerDossier maker={maker} works={getDemoMakerProducts(maker.slug)} />;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
