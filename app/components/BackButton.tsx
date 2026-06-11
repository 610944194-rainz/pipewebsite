"use client";

import { useRouter } from "next/navigation";

type BackButtonProps = {
  fallbackHref?: string;
  className?: string;
  children?: React.ReactNode;
};

export default function BackButton({
  fallbackHref = "/products",
  className = "",
  children = "返回",
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined") {
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");

      if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        router.push(returnTo);
        return;
      }
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={className}
    >
      {children}
    </button>
  );
}
