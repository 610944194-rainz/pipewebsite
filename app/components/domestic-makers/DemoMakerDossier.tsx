import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/app/components/SiteFooter";
import SiteHeader from "@/app/components/SiteHeader";
import type {
  DemoMakerProduct,
  DemoMakerStudio,
} from "@/lib/demo/maker-studio-fixtures";
import {
  MakerProfileAbout,
  MakerWorksDirectory,
  MakerWorksStats,
} from "./MakerWorksDirectory";

type DemoMakerDossierProps = {
  maker: DemoMakerStudio;
  works: readonly DemoMakerProduct[];
};

function displayName(name: string) {
  return name.replace(/^示例(?:斗师|工作室)\s*·\s*/, "");
}

function kindLabel(kind: DemoMakerStudio["kind"]) {
  return kind === "maker" ? "斗师" : "工作室";
}

function MakerHeroVisual({ maker }: { maker: DemoMakerStudio }) {
  if (maker.heroImage) {
    return <Image src={maker.heroImage} alt="" fill priority sizes="(max-width: 767px) 100vw, 1240px" className="object-cover object-[62%_center]" />;
  }

  if (maker.slug === "demo-studio-muchuan") {
    return (
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_28%,rgba(207,157,93,0.36),transparent_18%),radial-gradient(circle_at_74%_74%,rgba(125,76,41,0.52),transparent_30%),linear-gradient(120deg,#2b170d,#593822_66%,#21130b)]">
        <svg viewBox="0 0 160 160" aria-hidden="true" className="absolute right-2 top-1/2 h-[78%] w-auto -translate-y-1/2 text-[rgba(232,197,143,0.42)]">
          <path d="M35 118 124 29M48 31l80 80M31 60l16-16 63 63-16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="35" cy="118" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      </div>
    );
  }

  const monogram = maker.slug === "demo-maker-zhou-yu" ? "周屿" : "南岸制斗";
  return (
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_40%,rgba(129,81,42,0.44),transparent_28%),linear-gradient(122deg,#24140c,#4b2f1d_68%,#28170d)]">
      <p className="absolute right-[10%] top-1/2 -translate-y-1/2 text-[40px] font-medium tracking-[0.08em] text-[rgba(228,193,141,0.28)] sm:text-[52px]">{monogram}</p>
    </div>
  );
}

function MakerHero({ maker }: { maker: DemoMakerStudio }) {
  const name = displayName(maker.name);
  return (
    <section className="relative isolate h-[400px] overflow-hidden border-y border-[rgba(213,166,81,0.12)] bg-[#2e1a0f] min-[430px]:h-[430px] md:h-[520px]">
      <MakerHeroVisual maker={maker} />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgba(29,12,5,0.84)] via-[rgba(29,12,5,0.56)] to-[rgba(29,12,5,0.16)]" />
      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-[rgba(29,12,5,0.76)] to-transparent" />
      <div className="relative mx-auto flex h-full max-w-[1240px] flex-col justify-center px-4 pb-3 pt-10 sm:px-6 sm:pt-14 lg:px-10 lg:pt-20">
        <div className="flex items-center gap-2 text-[10px] font-normal tracking-[0.1em] text-[#e4c18d]">
          <span>{kindLabel(maker.kind)}</span><span className="h-px w-4 bg-[rgba(228,193,141,0.6)]" /><span>示例资料</span>
        </div>
        <h1 className="mt-3 text-[28px] font-medium leading-[1.25] text-[#f4eee7] sm:text-[32px]">{name}</h1>
        <p className="mt-2 text-[12px] font-normal leading-[1.4] text-[#e4c18d]">{maker.region}</p>
        <p className="mt-4 max-w-[330px] text-[12.5px] font-normal leading-[1.55] text-[rgba(244,238,231,0.82)] sm:max-w-[410px]">{maker.intro}</p>
      </div>
    </section>
  );
}

function MakerConsultationCta({ maker }: { maker: DemoMakerStudio }) {
  const name = displayName(maker.name);
  const returnTo = `/domestic-makers/${maker.slug}?demo=1`;
  const params = new URLSearchParams({ demo: "1", maker: maker.slug, makerName: name, returnTo });
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
      <div className="flex min-h-[72px] items-center justify-between gap-3 rounded-[5px] border border-[rgba(213,166,81,0.14)] bg-[linear-gradient(90deg,#3c2617,#2a180e)] px-4 py-3 sm:px-5">
        <h2 className="min-w-0 whitespace-nowrap text-[13px] font-medium leading-[1.35] text-[#f4eee7] sm:text-[14px]">定制/咨询{name}的烟斗作品</h2>
        <Link href={`/request?${params.toString()}`} className="shrink-0 rounded-[4px] bg-[#c28b49] px-3.5 py-2 text-[12px] font-medium text-[#24160f] transition-colors hover:bg-[#e4c18d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#f4eee7]">立即咨询</Link>
      </div>
    </section>
  );
}

export default function DemoMakerDossier({ maker, works }: DemoMakerDossierProps) {
  return (
    <div className="min-h-screen bg-[#2a180e] text-[#f4eee7] [&_a]:font-inherit [&_button]:font-inherit" style={{ fontFamily: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif' }}>
      <SiteHeader variant="dark" />
      <main>
        <div className="relative">
          <MakerHero maker={maker} />
          <p className="absolute left-4 top-3 z-10 text-[10px] font-normal leading-8 text-[rgba(228,193,141,0.78)] sm:left-6 lg:left-10">示例资料 · 仅用于页面开发与功能验收</p>
        </div>
        <MakerWorksStats maker={maker} works={works} />
        <MakerProfileAbout maker={maker} />
        <MakerWorksDirectory maker={maker} works={works} />
        <MakerConsultationCta maker={maker} />
      </main>
      <SiteFooter variant="dark" />
    </div>
  );
}
