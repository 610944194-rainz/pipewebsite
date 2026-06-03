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

export function getBrandBySlug(slug: string) {
  return pipeBrands.find((brand) => brand.slug === slug);
}
