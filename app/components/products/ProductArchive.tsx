export type ProductArchiveSpecRow = {
  label: string;
  value: string;
};

export type ProductArchiveSpecGroups = {
  basic: ProductArchiveSpecRow[];
  materials: ProductArchiveSpecRow[];
  dimensions: ProductArchiveSpecRow[];
};

export default function ProductArchive({
  groups,
}: {
  groups: ProductArchiveSpecGroups;
}) {
  return (
    <div>
      <p className="text-[9px] font-normal uppercase tracking-[0.18em] text-[var(--brass)]">
        Specifications
      </p>
      <h2 className="mt-1 text-[18px] font-medium leading-[1.35] text-[var(--text-primary)] lg:text-[20px]">
        产品档案
      </h2>

      {groups.basic.length > 0 ? (
        <ProductSpecGroup index="01" title="基本信息" specs={groups.basic} />
      ) : null}
      {groups.materials.length > 0 ? (
        <ProductSpecGroup
          index="02"
          title="材质与工艺"
          specs={groups.materials}
          className="mt-4"
        />
      ) : null}
      {groups.dimensions.length > 0 ? (
        <ProductSpecGroup
          index="03"
          title="尺寸数据"
          specs={groups.dimensions}
          className="mt-4"
        />
      ) : null}
    </div>
  );
}

function ProductSpecGroup({
  index,
  title,
  specs,
  className = "mt-4",
}: {
  index: string;
  title: string;
  specs: ProductArchiveSpecRow[];
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="relative">
        <h3 className="flex items-baseline gap-2 text-[12px] font-medium leading-[1.4] text-[var(--text-primary)]">
          <span className="text-[9px] font-medium tracking-[0.12em] text-[var(--brass)]">
            {index}
          </span>
          <span>{title}</span>
        </h3>
        <span
          className="absolute left-0 top-[calc(100%+6px)] h-px w-6 bg-[var(--brass)]"
          aria-hidden="true"
        />
      </div>
      <div className="mt-[9px] grid grid-cols-2 gap-x-4 gap-y-0 lg:grid-cols-3 lg:gap-x-6">
        {specs.map((spec, index) => (
          <div
            key={`${spec.label}-${index}`}
            className="min-w-0 border-t border-[rgba(126,105,87,0.12)] pb-2 pt-[7px]"
          >
            <p className="text-[9.5px] font-normal leading-[1.35] text-[#94877C]">
              {spec.label}
            </p>
            <p className="mt-[3px] line-clamp-2 break-words text-[11.5px] font-medium leading-[1.4] text-[var(--text-primary)]">
              {spec.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
