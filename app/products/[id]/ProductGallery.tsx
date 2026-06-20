"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sourceImageCandidates } from "@/lib/public-products/presentation";
import {
  parseProductReturnNavigation,
  productReturnNavigationKey,
} from "@/lib/public-products/scroll";

type ProductGalleryProps = {
  productId?: number | string;
  name: string;
  imageUrl: string;
  galleryImages?: string[];
  initialIndex?: number;
};

type IconProps = {
  className?: string;
};

type ProductBackButtonProps = {
  productId: string;
  fallbackHref?: string;
  className?: string;
  children?: ReactNode;
};

type ResilientImageProps = {
  src: string;
  alt: string;
  className: string;
  eager?: boolean;
};

function uniqueImages(images: string[]) {
  const seen = new Set<string>();

  return images.filter((image) => {
    const value = String(image || "").trim();
    if (!value || seen.has(value)) return false;

    seen.add(value);
    return true;
  });
}

function ResilientImage({
  src,
  alt,
  className,
  eager = false,
}: ResilientImageProps) {
  const candidates = useMemo(() => sourceImageCandidates(src), [src]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);

  const current = candidates[candidateIndex] || "";

  function handleError() {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((index) => index + 1);
      return;
    }

    setFailed(true);
  }

  if (failed || !current) {
    return (
      <div className={`${className} flex items-center justify-center bg-white`}>
        <span className="text-[10px] font-medium tracking-[0.16em] text-[#A97838]">
          图片加载失败
        </span>
      </div>
    );
  }

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
    />
  );
}

export function sanitizeProductReturnTo(value: string | null) {
  const rawValue = String(value || "").trim();

  if (!rawValue || !rawValue.startsWith("/")) return "";
  if (
    rawValue.startsWith("//") ||
    rawValue.includes("\\") ||
    /^\/%2f/i.test(rawValue)
  ) {
    return "";
  }

  try {
    const url = new URL(rawValue, window.location.origin);
    if (url.origin !== window.location.origin) return "";

    const isHomepage = url.pathname === "/";
    const isFeaturedList = url.pathname === "/featured";
    const isProductsList = url.pathname === "/products";
    const isBrandDetail = /^\/brands\/[a-z0-9][a-z0-9-]*$/i.test(
      url.pathname
    );

    if (
      !isHomepage &&
      !isFeaturedList &&
      !isProductsList &&
      !isBrandDetail
    ) {
      return "";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function sanitizeProductAnchor(value: string | null) {
  const anchor = String(value || "").trim();
  return /^product-[a-z0-9][a-z0-9-]*$/i.test(anchor) ? anchor : "";
}

function appendProductAnchor(returnTo: string, anchor: string) {
  if (!anchor) return returnTo;

  const url = new URL(returnTo, window.location.origin);
  url.hash = anchor;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function ProductBackButton({
  productId,
  fallbackHref = "/products",
  className = "",
  children,
}: ProductBackButtonProps) {
  const router = useRouter();

  function handleBack() {
    const rawReturnTo =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("returnTo")
        : null;
    const rawAnchor =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("anchor")
        : null;
    const returnTo = sanitizeProductReturnTo(rawReturnTo);
    const anchor = sanitizeProductAnchor(rawAnchor);
    const navigationKey = productReturnNavigationKey(productId);
    let canUseHistoryBack = false;

    try {
      const navigation = parseProductReturnNavigation(
        window.sessionStorage.getItem(navigationKey)
      );
      canUseHistoryBack = Boolean(
        navigation &&
          Date.now() - navigation.savedAt < 30 * 60 * 1000 &&
          navigation.returnTo === returnTo &&
          navigation.anchor === anchor
      );
      window.sessionStorage.removeItem(navigationKey);
    } catch {
      // A storage failure should still fall back to replace navigation.
    }

    if (canUseHistoryBack) {
      router.back();
      return;
    }

    if (returnTo) {
      router.replace(appendProductAnchor(returnTo, anchor));
      return;
    }

    router.replace(fallbackHref, { scroll: false });
  }

  return (
    <button type="button" onClick={handleBack} className={className}>
      {children}
    </button>
  );
}

export default function ProductGallery(props: ProductGalleryProps) {
  const { name, imageUrl, galleryImages = [], initialIndex = 0 } = props;

  const images = useMemo(() => {
    return uniqueImages([imageUrl, ...galleryImages]);
  }, [imageUrl, galleryImages]);

  const safeInitialIndex =
    initialIndex >= 0 && initialIndex < images.length ? initialIndex : 0;

  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const touchStartXRef = useRef(0);

  useEffect(() => {
    if (!isZoomOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsZoomOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isZoomOpen]);

  if (images.length === 0) {
    return (
      <section id="gallery" className="bg-[#FFFDF8] p-3 sm:p-4">
        <div className="flex aspect-[1.16/1] items-center justify-center rounded-[22px] border border-[#E5D7C5] bg-white text-[12px] font-medium tracking-[0.3em] text-[#9A6530]">
          PIPE IMAGE
        </div>
      </section>
    );
  }

  const currentImage = images[currentIndex] || images[0];

  function goPrevious() {
    setCurrentIndex((index) =>
      index === 0 ? images.length - 1 : index - 1
    );
  }

  function goNext() {
    setCurrentIndex((index) =>
      index === images.length - 1 ? 0 : index + 1
    );
  }

  return (
    <>
      <section id="gallery" className="bg-[#FFFDF8] p-3 sm:p-4">
        <div className="relative overflow-hidden rounded-[24px] border border-[#E5D7C5] bg-white">
          <div
            className="relative aspect-[1.16/1] bg-white p-3 sm:aspect-[4/3] sm:p-4"
            onTouchStart={(event) => {
              touchStartXRef.current = event.touches[0]?.clientX ?? 0;
            }}
            onTouchEnd={(event) => {
              const endX = event.changedTouches[0]?.clientX ?? 0;
              const diff = touchStartXRef.current - endX;

              if (Math.abs(diff) < 40) return;

              if (diff > 0) {
                goNext();
              } else {
                goPrevious();
              }
            }}
          >
            <ResilientImage
              key={currentImage}
              src={currentImage}
              alt={name}
              className="h-full w-full object-contain"
              eager
            />

            <span className="absolute left-3 top-3 rounded-full bg-white/88 px-3 py-1 text-[12px] font-semibold text-[#1F1A16] shadow-[0_5px_16px_rgba(31,26,22,0.08)]">
              {currentIndex + 1} / {images.length}
            </span>

            <button
              type="button"
              onClick={() => setIsZoomOpen(true)}
              aria-label="查看大图"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/72 text-[#063B32] shadow-[0_4px_12px_rgba(31,26,22,0.08)] backdrop-blur-sm transition hover:bg-white/92"
            >
              <ExpandIcon className="h-4 w-4" />
            </button>

            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goPrevious}
                  aria-label="上一张图片"
                  className="absolute left-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/68 text-[#063B32]/80 shadow-[0_4px_12px_rgba(31,26,22,0.06)] backdrop-blur-sm transition hover:bg-white/88 hover:text-[#063B32] sm:flex"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  aria-label="下一张图片"
                  className="absolute right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/68 text-[#063B32]/80 shadow-[0_4px_12px_rgba(31,26,22,0.06)] backdrop-blur-sm transition hover:bg-white/88 hover:text-[#063B32] sm:flex"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </>
            ) : null}
          </div>

          {images.length > 1 ? (
            <div className="border-t border-[#F0E6D8] bg-[#FFFDF8] px-3 py-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((image, index) => {
                  const isActive = index === currentIndex;

                  return (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      onClick={() => setCurrentIndex(index)}
                      aria-label={`查看 ${name} 第 ${index + 1} 张图片`}
                      className={[
                        "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border bg-white p-1 transition sm:h-20 sm:w-20",
                        isActive
                          ? "border-[#A97838] shadow-[0_0_0_2px_rgba(169,120,56,0.16)]"
                          : "border-[#E5D7C5]",
                      ].join(" ")}
                    >
                      <ResilientImage
                        src={image}
                        alt={`${name} 图片 ${index + 1}`}
                        className="h-full w-full object-contain"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isZoomOpen ? (
        <div className="fixed inset-0 z-[80] bg-[#061D18]/88 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-5xl flex-col">
            <div className="mb-3 flex items-center justify-between text-white">
              <span className="rounded-full bg-white/12 px-3 py-1 text-[13px] font-semibold">
                {currentIndex + 1} / {images.length}
              </span>

              <button
                type="button"
                onClick={() => setIsZoomOpen(false)}
                aria-label="关闭大图"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white transition hover:bg-white/20"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-[22px] bg-white">
              <ResilientImage
                key={`${currentImage}-zoom`}
                src={currentImage}
                alt={name}
                className="max-h-full max-w-full object-contain p-3"
                eager
              />

              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={goPrevious}
                    aria-label="上一张图片"
                    className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/78 text-[#063B32] shadow-md backdrop-blur-sm"
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={goNext}
                    aria-label="下一张图片"
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/78 text-[#063B32] shadow-md backdrop-blur-sm"
                  >
                    <ChevronRightIcon className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>

            {images.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((image, index) => {
                  const isActive = index === currentIndex;

                  return (
                    <button
                      key={`${image}-zoom-${index}`}
                      type="button"
                      onClick={() => setCurrentIndex(index)}
                      className={[
                        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border bg-white p-1",
                        isActive
                          ? "border-[#E7C48A] shadow-[0_0_0_2px_rgba(231,196,138,0.22)]"
                          : "border-white/20 opacity-72",
                      ].join(" ")}
                    >
                      <ResilientImage
                        src={image}
                        alt={`${name} 图片 ${index + 1}`}
                        className="h-full w-full object-contain"
                      />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChevronLeftIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m15 5-7 7 7 7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m9 5 7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon({ className = "" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
