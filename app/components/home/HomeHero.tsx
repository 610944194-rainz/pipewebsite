"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const slides = [
  {
    title: "精选海外烟斗库存",
    description: "人工选品 · 信息清晰 · 持续更新",
    cta: "查看海外库存",
    href: "/products",
    image: "/pics/home-hero-01-inventory.jpg",
    position: "object-center",
  },
  {
    title: "没有找到合适的烟斗？",
    description: "告诉我们你的偏好与预算",
    cta: "提交找斗需求",
    href: "/request",
    image: "/pics/collection-american.jpg",
    position: "object-center",
  },
] as const;

export default function HomeHero() {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slides.length);
    }, 6000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section aria-label="首页推荐" className="relative h-[clamp(220px,60vw,244px)] overflow-hidden bg-[var(--coffee-dark)] lg:h-[340px]">
      {slides.map((slide, index) => (
        <div
          key={slide.href}
          aria-hidden={index !== activeSlide}
          className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
            index === activeSlide ? "z-10 opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <img
            src={slide.image}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${slide.position}`}
            draggable={false}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,8,5,0.72)_0%,rgba(12,8,5,0.35)_48%,rgba(12,8,5,0.02)_78%)]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent" />

          <div className="relative mx-auto flex h-full max-w-[1200px] items-end px-5 pb-8 sm:px-8 sm:pb-10 lg:px-12 lg:pb-12">
            <div className="max-w-[390px] text-[#f4eee7] [text-shadow:0_1px_2px_rgba(0,0,0,0.22)]">
              {index === 0 ? (
                <h1 className="text-[20px] font-medium leading-[1.4] tracking-[0.01em] sm:text-[22px] lg:text-[26px]">
                  {slide.title}
                </h1>
              ) : (
                <h2 className="text-[20px] font-medium leading-[1.4] tracking-[0.01em] sm:text-[22px] lg:text-[26px]">
                  {slide.title}
                </h2>
              )}
              <p className="mt-3 text-[12px] font-normal leading-[1.65] text-[rgba(244,238,231,0.78)] sm:text-[13px]">{slide.description}</p>
              <Link
                href={slide.href}
                className="mt-5 inline-flex items-center border-b border-[var(--brass)] pb-1 text-[12px] font-normal leading-[1.4] text-[#e4c18d] transition-colors hover:text-[#f4eee7] motion-reduce:transition-none"
              >
                {slide.cta}
                <ArrowIcon className="ml-2 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ))}

      <div className="absolute bottom-2.5 left-1/2 z-20 flex -translate-x-1/2 gap-2" role="tablist" aria-label="Hero 轮播">
        {slides.map((slide, index) => (
          <button
            key={slide.href}
            type="button"
            role="tab"
            aria-label={`显示第 ${index + 1} 张推荐`}
            aria-selected={index === activeSlide}
            onClick={() => setActiveSlide(index)}
            className={`h-1.5 w-1.5 rounded-full border border-white/75 transition-colors motion-reduce:transition-none ${
              index === activeSlide ? "bg-white" : "bg-transparent"
            }`}
          />
        ))}
      </div>
    </section>
  );
}

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
