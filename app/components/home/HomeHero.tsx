"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const slides = [
  {
    title: "精选海外品牌烟斗",
    description: "人工选品 · 信息清晰 · 持续更新",
    cta: "查看海外烟斗",
    href: "/products",
    image: "/home/hero/home-hero-day.png",
    position: "object-[62%_center] lg:object-[58%_center]",
    overlay:
      "bg-[linear-gradient(90deg,rgba(12,8,5,0.76)_0%,rgba(12,8,5,0.40)_34%,rgba(12,8,5,0.08)_55%,transparent_68%)]",
  },
  {
    title: "没有找到合适的烟斗？",
    description: "告诉我们你的偏好与预算",
    cta: "提交找斗需求",
    href: "/request",
    image: "/home/hero/home-hero-night.png",
    position: "object-[60%_center] lg:object-[56%_center]",
    overlay:
      "bg-[linear-gradient(90deg,rgba(12,8,5,0.64)_0%,rgba(12,8,5,0.30)_34%,rgba(12,8,5,0.04)_54%,transparent_66%)]",
  },
] as const;

const SWIPE_DISTANCE = 44;
const SWIPE_AXIS_RATIO = 1.15;
const SWIPE_MAX_DURATION = 900;

type TouchPoint = {
  x: number;
  y: number;
  startedAt: number;
};

export default function HomeHero() {
  const [activeSlide, setActiveSlide] = useState(0);
  const touchStartRef = useRef<TouchPoint | null>(null);
  const touchEndRef = useRef<{ x: number; y: number } | null>(null);

  const showSlide = useCallback((index: number) => {
    const normalized = (index + slides.length) % slides.length;
    setActiveSlide(normalized);
  }, []);

  const showNextSlide = useCallback(() => {
    setActiveSlide((current) => (current + 1) % slides.length);
  }, []);

  const showPreviousSlide = useCallback(() => {
    setActiveSlide(
      (current) => (current - 1 + slides.length) % slides.length,
    );
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    if (reducedMotion.matches) return;

    const timer = window.setInterval(showNextSlide, 6000);

    return () => window.clearInterval(timer);
  }, [showNextSlide]);

  function handleTouchStart(
    event: React.TouchEvent<HTMLElement>,
  ) {
    const touch = event.touches[0];

    if (!touch) return;

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedAt: Date.now(),
    };

    touchEndRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleTouchMove(
    event: React.TouchEvent<HTMLElement>,
  ) {
    const touch = event.touches[0];

    if (!touch || !touchStartRef.current) return;

    touchEndRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleTouchEnd() {
    const start = touchStartRef.current;
    const end = touchEndRef.current;

    touchStartRef.current = null;
    touchEndRef.current = null;

    if (!start || !end) return;

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const duration = Date.now() - start.startedAt;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    const isHorizontalSwipe =
      horizontalDistance >= SWIPE_DISTANCE &&
      horizontalDistance > verticalDistance * SWIPE_AXIS_RATIO &&
      duration <= SWIPE_MAX_DURATION;

    if (!isHorizontalSwipe) return;

    if (deltaX < 0) {
      showNextSlide();
      return;
    }

    showPreviousSlide();
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
    touchEndRef.current = null;
  }

  return (
    <section
      aria-label="首页推荐"
      className="relative h-[clamp(220px,60vw,244px)] touch-pan-y select-none overflow-hidden bg-[var(--coffee-dark)] lg:h-[340px]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {slides.map((slide, index) => (
        <div
          key={slide.href}
          aria-hidden={index !== activeSlide}
          className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
            index === activeSlide
              ? "z-10 opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        >
          <img
            src={slide.image}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${slide.position}`}
            draggable={false}
          />
          <div className={`absolute inset-0 ${slide.overlay}`} />
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

              <p className="mt-3 text-[12px] font-normal leading-[1.65] text-[rgba(244,238,231,0.78)] sm:text-[13px]">
                {slide.description}
              </p>

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

      <div
        className="absolute bottom-2.5 left-1/2 z-20 flex -translate-x-1/2 gap-2"
        role="tablist"
        aria-label="Hero 轮播"
      >
        {slides.map((slide, index) => (
          <button
            key={slide.href}
            type="button"
            role="tab"
            aria-label={`显示第 ${index + 1} 张推荐`}
            aria-selected={index === activeSlide}
            onClick={() => showSlide(index)}
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
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 8h10M9 4.5 12.5 8 9 11.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
