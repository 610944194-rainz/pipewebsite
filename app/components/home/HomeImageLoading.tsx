"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const FixedImagesReady = createContext(true);

export function useFixedHomeImagesReady() {
  return useContext(FixedImagesReady);
}

export default function HomeImageLoading({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const cleanups: Array<() => void> = [];
    const images = Array.from(container.current?.querySelectorAll<HTMLImageElement>("img[data-home-fixed-image]") || [])
      .filter((image) => image.getClientRects().length > 0);

    const loaded = images.map((image) => new Promise<void>((resolve) => {
      const finish = () => {
        image.removeEventListener("load", finish);
        image.removeEventListener("error", finish);
        // A broken fixed asset must not leave product images waiting forever.
        if (!image.naturalWidth) { resolve(); return; }
        image.decode().catch(() => {}).then(() => resolve());
      };
      if (image.complete) finish();
      else {
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
        cleanups.push(() => {
          image.removeEventListener("load", finish);
          image.removeEventListener("error", finish);
        });
      }
    }));

    Promise.all(loaded).then(() => { if (live) setReady(true); });
    return () => { live = false; cleanups.forEach((cleanup) => cleanup()); };
  }, []);

  return <div ref={container} className="contents" data-home-image-stage={ready ? "products" : "fixed"}>
    <FixedImagesReady.Provider value={ready}>{children}</FixedImagesReady.Provider>
  </div>;
}
