import type { ImgHTMLAttributes } from "react";
import imageManifest from "./home-images.json";

type Asset = { src: string; srcSet: string; width: number; height: number };
const assets: Record<string, Asset> = imageManifest;
const transparentImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

type HomeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  src: string;
  media?: string;
};

export default function HomeImage({ src, media, sizes = "100vw", loading = "eager", decoding = "async", alt = "", ...props }: HomeImageProps) {
  const asset = assets[src];
  const image = <img {...props} data-home-fixed-image alt={alt} src={media ? transparentImage : asset?.src || src}
    srcSet={media ? undefined : asset?.srcSet} sizes={sizes}
    width={asset?.width} height={asset?.height} loading={loading} decoding={decoding} />;

  // The source media also prevents hidden desktop/mobile art from downloading.
  return media ? <picture className="contents"><source media={media} srcSet={asset?.srcSet || src} sizes={sizes} />{image}</picture> : image;
}

export function HomeImagePreload({ src, sizes, media }: { src: string; sizes: string; media: string }) {
  const asset = assets[src];
  return <link rel="preload" as="image" href={asset?.src || src} imageSrcSet={asset?.srcSet} imageSizes={sizes} media={media} fetchPriority="high" />;
}
