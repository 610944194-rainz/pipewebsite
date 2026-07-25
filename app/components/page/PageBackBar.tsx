import Link from "next/link";

type PageBackBarProps = {
  href?: string;
  label?: string;
};

export default function PageBackBar({
  href = "/",
  label = "返回首页",
}: PageBackBarProps) {
  return (
    <div className="mx-auto flex h-10 w-full max-w-[1240px] items-center px-4 sm:px-6 lg:px-10">
      <Link
        href={href}
        aria-label={label}
        className="-ml-1.5 inline-flex h-9 w-9 items-center justify-center text-[var(--coffee-dark)] transition-colors hover:text-[var(--brass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path
            d="M15.5 5.5 9 12l6.5 6.5M9.5 12H20"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </div>
  );
}
