import { domesticMakers } from "./domestic-makers";

export type DomesticProductStatus =
  | "可咨询"
  | "可购买"
  | "已售"
  | "展示样例";

export type DomesticProductPriceMode =
  | "fixed"
  | "inquiry"
  | "sold"
  | "sample";

export type DomesticProductSourceType =
  | "domestic-maker"
  | "studio"
  | "shop";

export type DomesticProduct = {
  id: string;
  makerSlug: string;
  name: string;
  makerName: string;
  studioName: string;
  origin: "domestic";
  sourceType: DomesticProductSourceType;
  status: DomesticProductStatus;
  priceMode: DomesticProductPriceMode;
  priceCny: number | null;
  imageUrl: string;
  galleryImages: string[];
  material: string;
  shape: string;
  finish: string;
  stemMaterial: string;
  filterSpec: string;
  specsText: string[];
  tags: string[];
  detail: string;
  contactNote: string;
  isSample: boolean;
};

export const domesticProducts: DomesticProduct[] = [
  {
    id: "domestic-qy-billard-01",
    makerSlug: "qingyan-studio",
    name: "青岩样例 Billard 光面直斗",
    makerName: "青岩制斗工作室",
    studioName: "青岩制斗工作室",
    origin: "domestic",
    sourceType: "studio",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "石楠木",
    shape: "Billard",
    finish: "光面染色",
    stemMaterial: "亚克力",
    filterSpec: "资料待补充",
    specsText: ["展示样例参数", "尺寸、重量和钵径待合作方补充"],
    tags: ["展示样例", "工作室", "Billard"],
    detail:
      "这是用于展示国内斗师 / 工作室作品详情结构的样例作品，不代表真实库存或真实价格。真实入驻后可补充作品照片、尺寸、材质来源和交付方式。",
    contactNote: "样例作品暂不接受购买，真实合作后可开放人工咨询。",
    isSample: true,
  },
  {
    id: "domestic-qy-bent-02",
    makerSlug: "qingyan-studio",
    name: "青岩样例 Bent Apple 手作弯斗",
    makerName: "青岩制斗工作室",
    studioName: "青岩制斗工作室",
    origin: "domestic",
    sourceType: "studio",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "石楠木",
    shape: "Bent Apple",
    finish: "浅色半光面",
    stemMaterial: "硫化硬胶",
    filterSpec: "资料待补充",
    specsText: ["展示样例参数", "烟嘴材质、滤芯规格和交付周期待补充"],
    tags: ["展示样例", "弯斗", "手作感"],
    detail:
      "该样例用于演示工作室作品卡片和详情页的信息层级。页面只做展示，不接入在线支付，也不自动成交。",
    contactNote: "合作资料确认后，可展示实际库存和咨询方式。",
    isSample: true,
  },
  {
    id: "domestic-ns-dublin-01",
    makerSlug: "nanshan-handmade",
    name: "南山样例 Dublin 砂面作品",
    makerName: "南山手作烟斗",
    studioName: "南山手作烟斗",
    origin: "domestic",
    sourceType: "domestic-maker",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "石楠木",
    shape: "Dublin",
    finish: "砂面",
    stemMaterial: "亚克力",
    filterSpec: "无滤芯 / 待确认",
    specsText: ["展示样例参数", "斗钵深度、重量、长度待补充"],
    tags: ["展示样例", "个人斗师", "砂面"],
    detail:
      "这是个人斗师主页下的样例作品，用于说明作品列表和作品详情的展示方式。所有内容均为占位资料。",
    contactNote: "当前为展示样例，真实作品需由斗师确认后展示。",
    isSample: true,
  },
  {
    id: "domestic-ns-freehand-02",
    makerSlug: "nanshan-handmade",
    name: "南山样例 Freehand 自由手作",
    makerName: "南山手作烟斗",
    studioName: "南山手作烟斗",
    origin: "domestic",
    sourceType: "domestic-maker",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "石楠木",
    shape: "Freehand",
    finish: "自然边 / 待确认",
    stemMaterial: "手工烟嘴",
    filterSpec: "资料待补充",
    specsText: ["展示样例参数", "作品编号、年份和尺寸待补充"],
    tags: ["展示样例", "Freehand", "资料待补充"],
    detail:
      "该样例展示自由手作作品在详情页中的资料组织方式，后续可扩展为真实斗师作品档案。",
    contactNote: "样例作品仅用于页面结构展示。",
    isSample: true,
  },
  {
    id: "domestic-hs-estate-01",
    makerSlug: "haishang-pipe-room",
    name: "海上斗房样例 回流斗整理展示",
    makerName: "海上斗房",
    studioName: "海上斗房",
    origin: "domestic",
    sourceType: "shop",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "资料待补充",
    shape: "Classic Bent",
    finish: "整理状态待补充",
    stemMaterial: "资料待补充",
    filterSpec: "资料待补充",
    specsText: ["展示样例参数", "回流来源、整理状态和成色需人工确认"],
    tags: ["展示样例", "回流斗", "线下店"],
    detail:
      "这是线下合作店 / 回流渠道的展示样例。真实页面需要清楚标注来源、成色、清洁整理状态和售后边界。",
    contactNote: "回流作品需人工确认成色、价格和售后方式。",
    isSample: true,
  },
  {
    id: "domestic-hs-shop-02",
    makerSlug: "haishang-pipe-room",
    name: "海上斗房样例 展会合作陈列",
    makerName: "海上斗房",
    studioName: "海上斗房",
    origin: "domestic",
    sourceType: "shop",
    status: "展示样例",
    priceMode: "sample",
    priceCny: null,
    imageUrl: "",
    galleryImages: [],
    material: "资料待补充",
    shape: "Assorted",
    finish: "展会陈列",
    stemMaterial: "资料待补充",
    filterSpec: "资料待补充",
    specsText: ["展示样例参数", "展会合作内容、陈列数量和咨询方式待补充"],
    tags: ["展示样例", "展会合作", "线下渠道"],
    detail:
      "该样例用于展示展会合作或线下店陈列页的作品入口。PipeSearch 只承接展示和咨询线索，不自动成交。",
    contactNote: "适合展会前后补充陈列清单和联系方式。",
    isSample: true,
  },
];

export function getDomesticProductsByMakerSlug(slug: string) {
  return domesticProducts.filter((product) => product.makerSlug === slug);
}

export function getDomesticProductById(id: string) {
  return domesticProducts.find((product) => product.id === id);
}

export function getDomesticProductMaker(product: DomesticProduct) {
  return domesticMakers.find((maker) => maker.slug === product.makerSlug);
}

export function formatDomesticPrice(product: DomesticProduct) {
  if (product.priceMode === "fixed" && product.priceCny) {
    return `¥${product.priceCny.toLocaleString("zh-CN")}`;
  }

  if (product.priceMode === "inquiry") {
    return "咨询价";
  }

  if (product.priceMode === "sold") {
    return "已售参考";
  }

  return "展示样例";
}
