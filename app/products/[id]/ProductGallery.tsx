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
  returnScope?: "product" | "maker-work";
  className?: string;
  ariaLabel?: string;
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

export function sanitizeProductReturnTo(
  value: string | null,
  scope: "product" | "maker-work" = "product"
) {
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
    const isMakerDossier =
      scope === "maker-work" &&
      /^\/domestic-makers\/[a-z0-9][a-z0-9-]*$/i.test(url.pathname);

    if (
      !isHomepage &&
      !isFeaturedList &&
      !isProductsList &&
      !isBrandDetail &&
      !isMakerDossier
    ) {
      return "";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function sanitizeProductAnchor(
  value: string | null,
  scope: "product" | "maker-work"
) {
  const anchor = String(value || "").trim();
  if (/^product-[a-z0-9][a-z0-9-]*$/i.test(anchor)) return anchor;
  return scope === "maker-work" && /^work-[a-z0-9][a-z0-9-]*$/i.test(anchor)
    ? anchor
    : "";
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
  returnScope = "product",
  className = "",
  ariaLabel,
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
    const returnTo = sanitizeProductReturnTo(rawReturnTo, returnScope);
    const anchor = sanitizeProductAnchor(rawAnchor, returnScope);
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
    <button
      type="button"
      onClick={handleBack}
      className={className}
      aria-label={ariaLabel}
    >
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
      <section id="gallery" className="min-w-0 max-w-full w-full bg-white">
        <div className="flex h-[clamp(300px,78vw,315px)] items-center justify-center rounded-[6px] border border-[#eee7df] bg-white text-[10px] font-normal tracking-[0.16em] text-[var(--brass)] sm:h-[380px] lg:h-[480px]">
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
      <section id="gallery" className="min-w-0 max-w-full w-full bg-white">
        <div className="relative min-w-0 max-w-full overflow-hidden rounded-[6px] border border-[#eee7df] bg-white">
          <div
            className="relative h-[clamp(300px,78vw,315px)] min-w-0 max-w-full w-full overflow-hidden bg-white px-3 py-4 sm:h-[380px] sm:p-5 lg:h-[480px] lg:p-6"
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
              className="block h-full max-h-full min-w-0 max-w-full w-full object-contain object-center"
              eager
            />

            <span className="absolute left-3 top-3 rounded-[3px] bg-white/72 px-2 py-1 text-[10px] font-normal leading-none text-[var(--text-primary)]">
              {currentIndex + 1} / {images.length}
            </span>

            <button
              type="button"
              onClick={() => setIsZoomOpen(true)}
              aria-label="查看大图"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-[4px] bg-white/72 text-[var(--coffee-dark)] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)] [font-family:inherit]"
            >
              <ExpandIcon className="h-[19px] w-[19px]" />
            </button>

            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goPrevious}
                  aria-label="上一张图片"
                  className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white/72 text-[var(--coffee-dark)] transition hover:bg-white sm:flex"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  aria-label="下一张图片"
                  className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white/72 text-[var(--coffee-dark)] transition hover:bg-white sm:flex"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </>
            ) : null}
          </div>

          {images.length > 1 ? (
            <div className="border-t border-[#eee7df] bg-white px-0 py-[10px] sm:py-3">
              <div className="min-w-0 max-w-full w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex min-w-full w-max gap-2">
                  {images.map((image, index) => {
                    const isActive = index === currentIndex;

                    return (
                      <button
                        key={`${image}-${index}`}
                        type="button"
                        onClick={() => setCurrentIndex(index)}
                        aria-label={`查看 ${name} 第 ${index + 1} 张图片`}
                        className={[
                          "flex h-[60px] w-[60px] shrink-0 basis-[60px] items-center justify-center overflow-hidden rounded-[4px] border bg-white p-1 transition min-[430px]:h-[64px] min-[430px]:w-[64px] min-[430px]:basis-[64px] sm:h-[72px] sm:w-[72px] sm:basis-[72px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]",
                          isActive
                            ? "border-[var(--brass)]"
                            : "border-[#eee7df]",
                        ].join(" ")}
                      >
                        <ResilientImage
                          src={image}
                          alt={`${name} 图片 ${index + 1}`}
                          className="block h-full max-h-full max-w-full w-full object-contain object-center"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {isZoomOpen ? (
        <div className="fixed inset-0 z-[80] bg-[#1b120d]/90 px-4 py-6">
          <div className="mx-auto flex h-full max-w-5xl flex-col">
            <div className="mb-3 flex items-center justify-between text-white">
              <span className="rounded-[3px] bg-white/12 px-2 py-1 text-[11px] font-normal">
                {currentIndex + 1} / {images.length}
              </span>

              <button
                type="button"
                onClick={() => setIsZoomOpen(false)}
                aria-label="关闭大图"
                className="flex h-10 w-10 items-center justify-center rounded-[4px] bg-white/12 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-[6px] bg-white">
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
                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white/78 text-[var(--coffee-dark)]"
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={goNext}
                    aria-label="下一张图片"
                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[4px] bg-white/78 text-[var(--coffee-dark)]"
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
                        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-white p-1",
                        isActive
                          ? "border-[var(--brass)]"
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
