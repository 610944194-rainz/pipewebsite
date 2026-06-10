import {
  canonicalizeBrandName,
  normalizeBrandForIndex,
  shouldHideBrandFromIndex,
} from "./brand-aliases";
import {
  getBrandProfileByName,
  getBrandProfileBySlug,
  type BrandProfile,
} from "./brand-profiles";
import {
  brandContentProfiles,
  type BrandContentProfile,
} from "./brand-content";

export type PipeBrand = {
  slug: string;
  name: string;
  aliases: string[];
  country: string;
  founded: string;
  level: string;
  summary: string;
  story: string;
  features: string[];
  representativeStyles: string[];
  suitableFor: string;
  priceRange: string;
  sourceUrls: string[];
  status: "template" | "verified";
  nameZh?: string;
  countryZh?: string;
  countryEn?: string;
  regionZh?: string;
  profileStatus?: BrandProfile["profileStatus"];
  translationStatus?: BrandProfile["translationStatus"];
  brandType?: BrandProfile["brandType"] | string;
  priority?: string;
  brandIndexStatus?: string;
  reviewStatus?: string;
  detailIntro?: string;
  noteZh?: string;
};

type BrandContentEntry = {
  profile: BrandContentProfile;
  canonicalName: string;
  canonicalSlug: string;
  aliases: string[];
};

const templateStory =
  "当前为品牌库模板资料，后续将基于公开来源补充品牌历史、工艺特点和代表风格；现阶段主要用于展示信息结构与关联库存。";

const templateFeatures = [
  "模板资料，待公开来源核验",
  "工艺特点后续补充",
  "已接入当前库存关联",
];

export const pipeBrands: PipeBrand[] = [
  {
    slug: "anne-julie",
    name: "Anne Julie",
    aliases: ["Anne Julie"],
    country: "丹麦",
    founded: "待补充",
    level: "高端手工",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["手工自由式", "收藏级作品", "资料待补充"],
    suitableFor: "适合关注丹麦手工烟斗、收藏级作品和独特造型的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "berggreen-pipes",
    name: "Berggreen Pipes",
    aliases: ["Berggreen Pipes", "Berggreen"],
    country: "丹麦",
    founded: "待补充",
    level: "手工 / 进阶",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["现代手工", "自然材质搭配", "资料待补充"],
    suitableFor: "适合希望了解丹麦现代手工烟斗和进阶库存的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "castello",
    name: "Castello",
    aliases: ["Castello"],
    country: "意大利",
    founded: "待补充",
    level: "高端收藏",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["意大利经典", "高端收藏", "资料待补充"],
    suitableFor: "适合关注意大利高端品牌、经典斗型和收藏价值的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "chacom",
    name: "Chacom",
    aliases: ["Chacom"],
    country: "法国",
    founded: "待补充",
    level: "入门 / 进阶",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["法式经典", "日常使用", "资料待补充"],
    suitableFor: "适合寻找日常使用、预算友好和经典造型的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "dagner",
    name: "Dagner",
    aliases: ["Dagner", "Dagner Pipes"],
    country: "美国",
    founded: "待补充",
    level: "入门 / 日用",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["美式日用", "便携风格", "资料待补充"],
    suitableFor: "适合寻找日用烟斗、便携风格和入门选择的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "dunhill",
    name: "Dunhill",
    aliases: ["Dunhill", "Alfred Dunhill"],
    country: "英国",
    founded: "待补充",
    level: "经典高端",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["英式经典", "收藏级", "资料待补充"],
    suitableFor: "适合关注英式经典、品牌历史和收藏级库存的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "peterson",
    name: "Peterson",
    aliases: ["Peterson", "Peterson of Dublin"],
    country: "爱尔兰",
    founded: "待补充",
    level: "入门 / 经典",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["爱尔兰经典", "系统斗", "资料待补充"],
    suitableFor: "适合关注经典量产品牌、入门升级和日常使用的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
  {
    slug: "stanwell",
    name: "Stanwell",
    aliases: ["Stanwell"],
    country: "丹麦",
    founded: "待补充",
    level: "入门 / 进阶",
    summary: "模板资料，后续将补充公开来源整理。",
    story: templateStory,
    features: templateFeatures,
    representativeStyles: ["丹麦经典", "日常使用", "资料待补充"],
    suitableFor: "适合关注丹麦设计、稳定品控和日常使用的用户。",
    priceRange: "待补充，以实际库存和人工确认为准",
    sourceUrls: [],
    status: "template",
  },
];

export function normalizeBrandName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function transliterateBrandSlugText(value: string) {
  return value
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/å/g, "a")
    .replace(/Å/g, "A");
}

export function slugifyBrand(name: string) {
  const slug = normalizeBrandName(transliterateBrandSlugText(name))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "unknown";
}

export const BRAND_INDEX_STATUS_VISIBLE = "品牌库显示";
export const BRAND_INDEX_STATUS_NAME_ONLY = "仅展示品牌名";

function isExplicitlyVisibleBrandContent(profile: BrandContentProfile) {
  return (
    profile.brandIndexStatus === BRAND_INDEX_STATUS_VISIBLE ||
    profile.brandIndexStatus === BRAND_INDEX_STATUS_NAME_ONLY
  );
}

function shouldUseBrandContentProfile(profile: BrandContentProfile) {
  if (shouldHideBrandFromIndex(profile.name)) {
    return false;
  }

  if (profile.reviewStatus === "暂不展示") {
    return isExplicitlyVisibleBrandContent(profile);
  }

  return isExplicitlyVisibleBrandContent(profile);
}

function getBrandContentSlug(profile: BrandContentProfile) {
  return normalizeBrandForIndex(profile.name).canonicalSlug;
}

const brandContentProfilesForIndex = brandContentProfiles.filter(
  shouldUseBrandContentProfile
);

function getContentProfileRank(profile: BrandContentProfile) {
  if (profile.brandIndexStatus === BRAND_INDEX_STATUS_VISIBLE) return 0;
  if (profile.reviewStatus === "可入库") return 1;
  return 2;
}

function uniqueText(items: string[]) {
  return Array.from(
    new Set(items.map((item) => item.trim()).filter(Boolean))
  );
}

const brandContentEntriesBySlug = new Map<string, BrandContentEntry>();

for (const profile of brandContentProfilesForIndex) {
  const canonical = normalizeBrandForIndex(profile.name);
  const existing = brandContentEntriesBySlug.get(canonical.canonicalSlug);
  const aliases = uniqueText([profile.name, profile.slug]);

  if (!existing) {
    brandContentEntriesBySlug.set(canonical.canonicalSlug, {
      profile,
      canonicalName: canonical.canonicalName,
      canonicalSlug: canonical.canonicalSlug,
      aliases,
    });
    continue;
  }

  existing.aliases = uniqueText([...existing.aliases, ...aliases]);

  if (getContentProfileRank(profile) < getContentProfileRank(existing.profile)) {
    existing.profile = profile;
  }
}

const brandContentEntries = Array.from(brandContentEntriesBySlug.values());

const brandContentBySlug = new Map<string, BrandContentEntry>();
const brandContentByName = new Map<string, BrandContentEntry>();

for (const entry of brandContentEntries) {
  brandContentBySlug.set(entry.canonicalSlug, entry);
  brandContentByName.set(normalizeBrandName(entry.canonicalName), entry);

  for (const alias of entry.aliases) {
    brandContentBySlug.set(slugifyBrand(alias), entry);
    brandContentByName.set(normalizeBrandName(canonicalizeBrandName(alias)), entry);
    brandContentByName.set(normalizeBrandName(alias), entry);
  }
}

export function isNameOnlyBrand(brand: Pick<PipeBrand, "brandIndexStatus">) {
  return brand.brandIndexStatus === BRAND_INDEX_STATUS_NAME_ONLY;
}

export function getBrandContentProfileBySlug(slug: string) {
  const canonicalSlug = normalizeBrandForIndex(slug.replace(/-/g, " "))
    .canonicalSlug;
  return (
    brandContentBySlug.get(canonicalSlug)?.profile ||
    brandContentBySlug.get(slugifyBrand(slug))?.profile
  );
}

export function getBrandContentProfileByName(name: string) {
  const canonicalName = canonicalizeBrandName(name);
  return (
    brandContentByName.get(normalizeBrandName(canonicalName))?.profile ||
    brandContentByName.get(normalizeBrandName(name))?.profile
  );
}

export function getCanonicalBrandSlugForInput(value: string) {
  return normalizeBrandForIndex(value.replace(/-/g, " ")).canonicalSlug;
}

function getBrandContentAliasesForSlug(slug: string) {
  return brandContentEntriesBySlug.get(slug)?.aliases || [];
}

function applyManualBrandProfile(brand: PipeBrand) {
  const profile =
    getBrandProfileByName(brand.name) || getBrandProfileBySlug(brand.slug);

  if (!profile) {
    return brand;
  }

  return {
    ...brand,
    nameZh: profile.nameZh,
    country: profile.countryZh || brand.country,
    countryZh: profile.countryZh,
    countryEn: profile.country,
    regionZh: profile.regionZh,
    profileStatus: profile.profileStatus,
    translationStatus: profile.translationStatus,
    brandType: profile.brandType,
    noteZh: profile.noteZh,
    story: profile.profileStatus === "needs_review" ? "" : brand.story,
    features: profile.profileStatus === "needs_review" ? [] : brand.features,
    representativeStyles:
      profile.profileStatus === "needs_review"
        ? []
        : brand.representativeStyles,
    suitableFor:
      profile.profileStatus === "needs_review" ? "" : brand.suitableFor,
  };
}

function applyBrandContentProfile(brand: PipeBrand) {
  const content =
    getBrandContentProfileBySlug(brand.slug) ||
    getBrandContentProfileByName(brand.name);

  if (!content) {
    return brand;
  }

  const nameOnly = content.brandIndexStatus === BRAND_INDEX_STATUS_NAME_ONLY;

  return {
    ...brand,
    nameZh: content.nameZh || brand.nameZh,
    country: content.country || brand.country,
    countryZh: content.country || brand.countryZh,
    countryEn: content.countryEn || brand.countryEn,
    brandType: content.brandType || brand.brandType,
    priority: content.priority || brand.priority,
    brandIndexStatus: content.brandIndexStatus || brand.brandIndexStatus,
    reviewStatus: content.reviewStatus || brand.reviewStatus,
    detailIntro: nameOnly ? "" : content.detailIntro || brand.detailIntro || "",
    summary: nameOnly ? "" : content.summary || brand.summary,
    story: nameOnly ? "" : content.story || brand.story,
    features: nameOnly
      ? []
      : content.features.length > 0
        ? content.features
        : brand.features,
    representativeStyles: nameOnly
      ? []
      : content.representativeStyles.length > 0
        ? content.representativeStyles
        : brand.representativeStyles,
    suitableFor: nameOnly ? "" : content.suitableFor || brand.suitableFor,
    sourceUrls: nameOnly
      ? []
      : content.sourceUrls.length > 0
        ? content.sourceUrls
        : brand.sourceUrls,
    noteZh: content.noteZh || brand.noteZh,
    status: content.reviewStatus === "可入库" ? "verified" : brand.status,
  };
}

function applyBrandProfiles(brand: PipeBrand) {
  return applyBrandContentProfile(applyManualBrandProfile(brand));
}

export function createFallbackBrand(name: string, slug = slugifyBrand(name)) {
  return applyBrandProfiles({
    slug,
    name,
    aliases: [name],
    country: "待补充",
    founded: "待补充",
    level: "库存品牌",
    summary: "当前收录来自公开库存页的产品，品牌资料后续补充。",
    story: "当前页面先用于展示该品牌的公开库存关联，品牌历史与工艺资料后续补充。",
    features: ["库存品牌", "资料后续补充"],
    representativeStyles: ["当前库存关联"],
    suitableFor: "适合希望按品牌查看当前公开库存的用户。",
    priceRange: "以当前库存页和人工确认为准",
    sourceUrls: [],
    status: "template",
  } satisfies PipeBrand);
}

export function getBrandMetaBySlug(slug: string) {
  const normalizedSlug = slugifyBrand(slug);

  const staticBrand = pipeBrands.find((brand) => {
    const candidateSlugs = [brand.slug, brand.name, ...brand.aliases].map(
      slugifyBrand
    );

    return candidateSlugs.includes(normalizedSlug);
  });

  if (staticBrand) {
    return applyBrandProfiles(staticBrand);
  }

  const contentProfile = getBrandContentProfileBySlug(slug);

  if (contentProfile) {
    const canonical = normalizeBrandForIndex(contentProfile.name);
    return createFallbackBrand(
      canonical.canonicalName,
      canonical.canonicalSlug
    );
  }

  const profile = getBrandProfileBySlug(slug);

  return profile ? createFallbackBrand(profile.name, slugifyBrand(profile.name)) : undefined;
}

export function getBrandBySlug(slug: string) {
  return getBrandMetaBySlug(slug);
}

export function getBrandByName(name: string) {
  const canonicalName = canonicalizeBrandName(name);
  const normalizedName = normalizeBrandName(canonicalName);

  const staticBrand = pipeBrands.find((brand) => {
    const brandNames = [brand.name, ...brand.aliases].map(normalizeBrandName);

    return brandNames.includes(normalizedName);
  });

  if (staticBrand) {
    return applyBrandProfiles(staticBrand);
  }

  const contentProfile = getBrandContentProfileByName(canonicalName);

  if (contentProfile) {
    const canonical = normalizeBrandForIndex(contentProfile.name);
    return createFallbackBrand(
      canonical.canonicalName,
      canonical.canonicalSlug
    );
  }

  const profile = getBrandProfileByName(canonicalName);

  return profile ? createFallbackBrand(profile.name) : undefined;
}

export function getBrandContentBrandsForIndex() {
  return brandContentEntries.map((entry) => ({
    ...createFallbackBrand(entry.canonicalName, entry.canonicalSlug),
    name: entry.canonicalName,
    slug: entry.canonicalSlug,
    aliases: uniqueText([entry.canonicalName, ...entry.aliases]),
  }));
}

export function getProductBrandGroups<T extends { brand?: string }>(
  products: T[]
) {
  const groups = new Map<
    string,
    {
      name: string;
      slug: string;
      products: T[];
      hideFromBrandIndex: boolean;
      aliases: string[];
    }
  >();

  products.forEach((product) => {
    const rawBrandName = String(product.brand || "").trim().replace(/\s+/g, " ");
    const canonicalBrand = normalizeBrandForIndex(rawBrandName);
    const brandName = canonicalBrand.canonicalName;

    if (!brandName) {
      return;
    }

    const key = canonicalBrand.canonicalSlug;
    const hideFromBrandIndex = shouldHideBrandFromIndex(rawBrandName);
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.products.push(product);
      existingGroup.hideFromBrandIndex =
        existingGroup.hideFromBrandIndex || hideFromBrandIndex;
      existingGroup.aliases = uniqueText([
        ...existingGroup.aliases,
        rawBrandName,
        ...getBrandContentAliasesForSlug(key),
      ]);
      return;
    }

    groups.set(key, {
      name: brandName,
      slug: canonicalBrand.canonicalSlug,
      products: [product],
      hideFromBrandIndex,
      aliases: uniqueText([rawBrandName, ...getBrandContentAliasesForSlug(key)]),
    });
  });

  return Array.from(groups.values()).filter((group) => !group.hideFromBrandIndex).sort((left, right) => {
    if (right.products.length !== left.products.length) {
      return right.products.length - left.products.length;
    }

    return left.name.localeCompare(right.name, "en");
  });
}
