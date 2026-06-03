"use client";

import { useMemo } from "react";

type ProductGalleryProps = {
  productId?: number;
  name: string;
  imageUrl: string;
  galleryImages?: string[];
  initialIndex?: number;
};

function uniqueImages(images: string[]) {
  const seen = new Set<string>();

  return images.filter((image) => {
    if (!image) return false;
    if (seen.has(image)) return false;

    seen.add(image);
    return true;
  });
}

function safeId(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function ProductGallery({
  productId,
  name,
  imageUrl,
  galleryImages = [],
}: ProductGalleryProps) {
  const images = useMemo(() => {
    return uniqueImages([imageUrl, ...galleryImages]);
  }, [imageUrl, galleryImages]);

  const galleryId = `pipe-gallery-${productId || safeId(name) || "item"}`;

  const dynamicCss = images
    .map((_, index) => {
      return `
        #${galleryId}-radio-${index}:checked ~ .${galleryId}-main .${galleryId}-main-image-${index} {
          display: flex;
        }

        #${galleryId}-radio-${index}:checked ~ .${galleryId}-thumbs label[for="${galleryId}-radio-${index}"] {
          border-color: #d1934a;
          box-shadow: 0 0 0 2px rgba(209, 147, 74, 0.38);
        }
      `;
    })
    .join("\n");

  if (images.length === 0) {
    return (
      <section
        id="gallery"
        className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-3 sm:p-5"
      >
        <div className="flex aspect-[4/3] items-center justify-center rounded-[1.5rem] bg-white text-sm tracking-[0.35em] text-[#c9904c]">
          PIPE IMAGE
        </div>
      </section>
    );
  }

  return (
    <section
      id="gallery"
      className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-3 sm:p-5"
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .${galleryId}-main-image {
              display: none;
            }

            ${dynamicCss}
          `,
        }}
      />

      {images.map((_, index) => (
        <input
          key={`${galleryId}-radio-${index}`}
          id={`${galleryId}-radio-${index}`}
          name={`${galleryId}-radio`}
          type="radio"
          defaultChecked={index === 0}
          className="sr-only"
        />
      ))}

      <div
        className={`${galleryId}-main pipe-image-surface aspect-[4/3] overflow-hidden rounded-[1.5rem] bg-white p-1 sm:p-2`}
      >
        {images.map((image, index) => (
          <div
            key={`${image}-main-${index}`}
            className={`${galleryId}-main-image ${galleryId}-main-image-${index} pipe-image-surface h-full w-full items-center justify-center bg-white`}
          >
            <img
              src={image}
              alt={name}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <div
          className={`${galleryId}-thumbs mt-4 grid grid-cols-4 gap-3 sm:mt-5 sm:grid-cols-5`}
        >
          {images.map((image, index) => (
            <label
              key={`${image}-thumb-${index}`}
              htmlFor={`${galleryId}-radio-${index}`}
              className={[
                "pipe-image-surface flex aspect-square cursor-pointer select-none items-center justify-center overflow-hidden rounded-2xl border border-[#4a2f20] bg-white p-1 transition",
                "active:scale-[0.98]",
              ].join(" ")}
              aria-label={`查看 ${name} 第 ${index + 1} 张图片`}
            >
              <img
                src={image}
                alt={`${name} 图片 ${index + 1}`}
                className="pointer-events-none h-full w-full object-contain"
                draggable={false}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}