import Link from "next/link";

type ServiceBackButtonProps = {
  className?: string;
};

export default function ServiceBackButton({
  className = "",
}: ServiceBackButtonProps) {
  return (
    <Link
      href="/"
      aria-label="返回首页"
      className={[
        "inline-flex h-9 w-9 items-center justify-center",
        "text-[var(--coffee-dark)] transition-colors",
        "hover:text-[var(--brass)]",
        "focus-visible:outline focus-visible:outline-2",
        "focus-visible:outline-offset-3",
        "focus-visible:outline-[var(--brass)]",
        className,
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="h-[20px] w-[20px]"
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
  );
}
