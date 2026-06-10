import { danishProducts } from "./danish-products";

export type PipeProduct = {
  id: number;
  brand: string;
  name: string;
  originalPrice: string;
  originalCurrency: string;
  originalPriceValue: number;
  estimatedCny: string;
  estimatedCnyValue: number;
  source: string;
  sourceUrl: string;
  imageUrl: string;
  galleryImages?: string[];
  specsText?: string[];
  condition: string;
  status: string;
  updatedAt: string;
  audience: string;
  comment: string;
  detail: string;
  tags: string[];
  nameZh?: string;
  canonicalBrand?: string;
  canonicalBrandSlug?: string;
  brandCountry?: string;
  brandCountryEn?: string;
  shape?: string;
  shapeZh?: string;
  shapeGroup?: string;
  bendType?: string;
  finish?: string;
  finishZh?: string;
  material?: string;
  materialZh?: string;
  stemMaterial?: string;
  stemMaterialZh?: string;
  engineeringFeature?: string;
  engineeringFeatureZh?: string;
  grainPattern?: string;
  grainPatternZh?: string;
  weightGrams?: number | null;
  weightRange?: string;
  dimensions?: {
    bowlOuterDiameterMm: number | null;
    chamberDiameterMm: number | null;
    chamberDepthMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    buttonWidthMm: number | null;
    bitThicknessMm: number | null;
  };
  parsedTags?: string[];
  parseWarnings?: string[];
  conditionType?: string;
  smokedStatus?: string;
  conditionLabel?: string;
};

export const filters = [
  "全部",
  "新手友好",
  "进阶选择",
  "高端收藏",
  "预算友好",
  "已售参考",
  "多图完整",
  "图片可用",
  "低清待复核",
];

export const pipeProducts: PipeProduct[] = [
  ...danishProducts,
];
