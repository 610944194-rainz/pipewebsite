"use client";

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { sourceImageCandidates } from "@/lib/public-products/presentation";

type ProductCardImageProps = {
  imageUrl: string | null | undefined;
  alt: string;
  brandName?: string | null;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "auto" | "low";
  className?: string;
  imageClassName?: string;
  children?: ReactNode;
};

function brandInitials(value: string | null | undefined) {
  const words = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/gi);

  if (!words?.length) return "PI";

  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return words[0].slice(0, 2).toUpperCase();
}

function PipeOutlineIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 9h20v9.5C26 27.1 20.2 33 12.5 33 8.4 33 5 29.6 5 25.5V10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M26 23h14.5c4.2 0 7.6-3.4 7.6-7.6V13h10.4v4.2c0 9.3-7.5 16.8-16.8 16.8H21.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 14h15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ProductCardImage({
  imageUrl,
  alt,
  brandName,
  loading = "lazy",
  fetchPriority = "auto",
  className = "",
  imageClassName = "",
  children,
}: ProductCardImageProps) {
  const candidates = useMemo(
    () => sourceImageCandidates(imageUrl),
    [imageUrl]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);
  const currentImage = candidates[candidateIndex] || "";

  const handleImageError = useCallback(() => {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((index) => index + 1);
      return;
    }

    setFailed(true);
  }, [candidateIndex, candidates.length]);

  return (
    <div
      className={`relative overflow-hidden bg-white ${className}`}
      data-image-state={failed ? "fallback" : "image"}
    >
      {failed || !currentImage ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#FFFDF8] to-[#F1E7D8] px-3 text-center">
          <PipeOutlineIcon className="h-8 w-12 text-[#B68A55]" />
          <span className="mt-1 text-[10px] font-semibold tracking-[0.16em] text-[#9A6530]">
            {brandInitials(brandName)}
          </span>
          <span className="mt-1 text-[10px] text-[#9A8F84]">
            图片待确认
          </span>
        </div>
      ) : (
        <img
          key={currentImage}
          src={currentImage}
          alt={alt}
          className={[
            "absolute inset-0 h-full w-full bg-white object-contain p-2.5",
            imageClassName,
          ].join(" ")}
          draggable={false}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
      )}

      {children}
    </div>
  );
}
