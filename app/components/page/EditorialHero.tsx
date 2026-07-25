type EditorialHeroProps = {
  imageSrc: string;
  imageAlt?: string;
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
  imagePosition?: string;
};

export default function EditorialHero({
  imageSrc,
  imageAlt = "",
  eyebrow,
  title,
  description,
  meta,
  imagePosition = "65% 58%",
}: EditorialHeroProps) {
  return (
    <header className="relative h-[194px] overflow-hidden rounded-[6px] bg-[var(--coffee-dark)] sm:h-[210px] lg:h-[300px]">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: imagePosition }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgba(36,22,15,0.88)] via-[rgba(36,22,15,0.56)] to-[rgba(36,22,15,0.08)]" />
      <div className="relative flex h-full max-w-[300px] flex-col justify-end px-5 pb-5 sm:max-w-[370px] sm:px-7 sm:pb-7 lg:max-w-[430px] lg:px-10 lg:pb-9">
        <p className="text-[9.5px] font-normal uppercase leading-[1.4] tracking-[0.19em] text-[var(--brass)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-[18px] font-medium leading-[1.28] tracking-[-0.018em] text-[#f4eee7] sm:text-[20px] lg:text-[24px]">
          {title}
        </h1>
        <p className="mt-2 max-w-[390px] text-[11px] font-normal leading-[1.6] text-[rgba(244,238,231,0.8)] sm:text-[11.5px] lg:text-[12px]">
          {description}
        </p>
        {meta ? (
          <p className="mt-3 text-[10.5px] font-medium leading-[1.4] text-[var(--brass)] sm:text-[11px]">
            {meta}
          </p>
        ) : null}
      </div>
    </header>
  );
}
