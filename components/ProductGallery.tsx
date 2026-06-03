"use client";

import { useMemo, useState } from "react";

type ProductGalleryProps = {
  name: string;
  imageUrl: string;
  galleryImages?: string[];
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

export default function ProductGallery({
  name,
  imageUrl,
  galleryImages = [],
}: ProductGalleryProps) {
  const images = useMemo(() => {
    return uniqueImages([imageUrl, ...galleryImages]);
  }, [imageUrl, galleryImages]);

  const [selectedImage, setSelectedImage] = useState(images[0] || imageUrl);

  if (!selectedImage) {
    return (
      <div className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-5">
        <div className="flex aspect-[4/3] items-center justify-center rounded-[1.5rem] bg-[#120b08] text-sm tracking-[0.3em] text-[#c9904c]">
          PIPE IMAGE
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-[2rem] border border-[#4a2f20] bg-[#21150f] p-5">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[1.5rem] bg-[#f3eee5]">
        <img
          src={selectedImage}
          alt={name}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>

      {images.length > 1 && (
        <div className="mt-5 grid grid-cols-4 gap-3 sm:grid-cols-5">
          {images.map((image, index) => {
            const isActive = image === selectedImage;

            return (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setSelectedImage(image)}
                className={[
                  "aspect-square overflow-hidden rounded-2xl border bg-[#f3eee5] p-2 transition",
                  isActive
                    ? "border-[#d1934a] ring-2 ring-[#d1934a]/40"
                    : "border-[#4a2f20] hover:border-[#d1934a]/70",
                ].join(" ")}
                aria-label={`查看第 ${index + 1} 张图片`}
              >
                <img
                  src={image}
                  alt={`${name} 图片 ${index + 1}`}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}