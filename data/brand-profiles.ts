import {
  canonicalizeBrandName,
  normalizeBrandAliasKey,
} from "./brand-aliases";

export type BrandProfileStatus = "basic" | "needs_review";
export type BrandTranslationStatus = "common" | "tentative" | "keep_original";
export type BrandType = "factory" | "historic" | "artisan" | "house_brand";

export type BrandProfile = {
  name: string;
  nameZh: string;
  countryZh: string;
  country: string;
  regionZh?: string;
  profileStatus: BrandProfileStatus;
  translationStatus: BrandTranslationStatus;
  brandType: BrandType;
  noteZh?: string;
};

export const brandProfiles: BrandProfile[] = [
  {
    name: "Nørding",
    nameZh: "诺丁",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "Savinelli",
    nameZh: "沙芬",
    countryZh: "意大利",
    country: "Italy",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "Chacom",
    nameZh: "查科姆",
    countryZh: "法国",
    country: "France",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "factory",
  },
  {
    name: "Peterson",
    nameZh: "彼得森",
    countryZh: "爱尔兰",
    country: "Ireland",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "Vauen",
    nameZh: "华云",
    countryZh: "德国",
    country: "Germany",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "factory",
  },
  {
    name: "W.Ø. Larsen",
    nameZh: "W.Ø. 拉森",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "historic",
  },
  {
    name: "Dunhill",
    nameZh: "登喜路",
    countryZh: "英国",
    country: "United Kingdom",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "historic",
  },
  {
    name: "Rattray's",
    nameZh: "拉特雷",
    countryZh: "苏格兰",
    country: "Scotland",
    regionZh: "英国",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "historic",
  },
  {
    name: "Stanwell",
    nameZh: "史丹威",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "BPK",
    nameZh: "BPK",
    countryZh: "捷克",
    country: "Czech Republic",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "factory",
  },
  {
    name: "Falcon",
    nameZh: "猎鹰",
    countryZh: "英国",
    country: "United Kingdom",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "factory",
  },
  {
    name: "White Star Pipes",
    nameZh: "白星",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "factory",
  },
  {
    name: "Dagner Pipes",
    nameZh: "Dagner Pipes",
    countryZh: "美国",
    country: "United States",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "factory",
  },
  {
    name: "Brebbia",
    nameZh: "芭比",
    countryZh: "意大利",
    country: "Italy",
    profileStatus: "needs_review",
    translationStatus: "tentative",
    brandType: "factory",
    noteZh: "中文名可能与 Barbie 混淆，后续可评估是否改为“布雷比亚”。",
  },
  {
    name: "Georg Jensen",
    nameZh: "乔治·杰森",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "historic",
    noteZh: "注意与同名珠宝/银器品牌区分。",
  },
  {
    name: "Kai Nielsen",
    nameZh: "凯·尼尔森",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Nuttens Pipes",
    nameZh: "Nuttens Pipes",
    countryZh: "比利时",
    country: "Belgium",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "artisan",
  },
  {
    name: "Johs Pipes",
    nameZh: "Johs Pipes",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "artisan",
  },
  {
    name: "BBB",
    nameZh: "BBB",
    countryZh: "英国",
    country: "United Kingdom",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "historic",
  },
  {
    name: "Missouri Meerschaum",
    nameZh: "密苏里海泡石",
    countryZh: "美国",
    country: "United States",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "Benner",
    nameZh: "Benner",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "artisan",
  },
  {
    name: "Peder Jeppesen",
    nameZh: "吉普森",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Berggreen Pipes",
    nameZh: "贝格格林",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Bay Denmark",
    nameZh: "丹麦贝",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Volkan",
    nameZh: "沃尔坎",
    countryZh: "意大利",
    country: "Italy",
    profileStatus: "needs_review",
    translationStatus: "tentative",
    brandType: "artisan",
    noteZh: "国家归属后续需要查证。",
  },
  {
    name: "Hans Former Nielsen",
    nameZh: "佛么",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
    noteZh: "前端可保留英文名辅助显示，避免中文名识别度不足。",
  },
  {
    name: "Neerup",
    nameZh: "Neerup",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "keep_original",
    brandType: "artisan",
  },
  {
    name: "Castello",
    nameZh: "卡斯特罗",
    countryZh: "意大利",
    country: "Italy",
    profileStatus: "basic",
    translationStatus: "common",
    brandType: "factory",
  },
  {
    name: "George Boyadjiev",
    nameZh: "博雅杰夫",
    countryZh: "保加利亚",
    country: "Bulgaria",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Suhr Pipes",
    nameZh: "苏尔",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "needs_review",
    translationStatus: "tentative",
    brandType: "historic",
  },
  {
    name: "Søren Refbjerg",
    nameZh: "索伦",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Tom Eltang",
    nameZh: "汤姆·艾尔唐",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Henri Pipes",
    nameZh: "亨利",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Poul Winsløw",
    nameZh: "保罗·温斯洛",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "Sara Eltang Pipes",
    nameZh: "萨拉·艾尔唐",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
  {
    name: "TDPS",
    nameZh: "TDPS",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "needs_review",
    translationStatus: "keep_original",
    brandType: "house_brand",
    noteZh: "可能属于 Danish Pipe Shop 相关线，先作为站点/合作线处理。",
  },
  {
    name: "Anne Julie",
    nameZh: "安妮·朱莉",
    countryZh: "丹麦",
    country: "Denmark",
    profileStatus: "basic",
    translationStatus: "tentative",
    brandType: "artisan",
  },
];

const brandProfileLookup = new Map(
  brandProfiles.flatMap((profile) => {
    const canonicalName = canonicalizeBrandName(profile.name);
    const aliases = [profile.name, canonicalName].filter(Boolean);

    return aliases.map((name) => [normalizeBrandAliasKey(name), profile]);
  })
);

export function getBrandProfileByName(name: string) {
  const canonicalName = canonicalizeBrandName(name);
  return (
    brandProfileLookup.get(normalizeBrandAliasKey(canonicalName)) ||
    brandProfileLookup.get(normalizeBrandAliasKey(name))
  );
}

export function getBrandProfileBySlug(slug: string) {
  return brandProfiles.find(
    (profile) =>
      normalizeBrandAliasKey(profile.name).replace(/\s+/g, "-") === slug
  );
}
