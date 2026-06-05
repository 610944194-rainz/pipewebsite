export type DomesticMakerType = "maker" | "studio" | "shop";

export type DomesticMakerStatus = "开放合作" | "资料待补充" | "展示样例";

export type DomesticMaker = {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  type: DomesticMakerType;
  city: string;
  intro: string;
  longIntro: string;
  styleTags: string[];
  specialties: string[];
  avatarUrl: string;
  coverUrl: string;
  status: DomesticMakerStatus;
  contactNote: string;
  featuredProductIds: string[];
};

export const domesticMakers: DomesticMaker[] = [
  {
    id: "maker-qingyan",
    slug: "qingyan-studio",
    name: "青岩制斗工作室",
    displayName: "青岩制斗工作室",
    type: "studio",
    city: "上海",
    intro:
      "展示样例。偏向克制线条、手工小批量作品与展会沟通场景，资料后续补充。",
    longIntro:
      "当前为 PipeSearch 国内斗师 / 工作室板块展示样例，不代表真实库存或已授权合作。后续可用于整理工作室介绍、工艺方向、作品档案和展会合作信息。",
    styleTags: ["手作感", "经典斗型", "小批量", "展示样例"],
    specialties: ["弯斗", "Billard", "自然染色", "亚克力烟嘴"],
    avatarUrl: "",
    coverUrl: "",
    status: "展示样例",
    contactNote: "资料待合作方确认，当前仅作为页面结构展示。",
    featuredProductIds: ["domestic-qy-billard-01", "domestic-qy-bent-02"],
  },
  {
    id: "maker-nanshan",
    slug: "nanshan-handmade",
    name: "南山手作烟斗",
    displayName: "南山手作烟斗",
    type: "maker",
    city: "杭州",
    intro:
      "展示样例。以个人创作者主页形式呈现，适合展示风格、作品系列和咨询入口。",
    longIntro:
      "当前页面内容为展示样例，人物与作品均为占位资料。真实入驻后，可补充斗师经历、常用石楠木来源、斗型偏好、交付周期与售后方式。",
    styleTags: ["个人斗师", "自由手作", "轻量作品档案", "资料待补充"],
    specialties: ["Freehand", "Dublin", "砂面处理", "手工烟嘴"],
    avatarUrl: "",
    coverUrl: "",
    status: "资料待补充",
    contactNote: "合作资料整理后可开放咨询。",
    featuredProductIds: ["domestic-ns-dublin-01", "domestic-ns-freehand-02"],
  },
  {
    id: "maker-haishang",
    slug: "haishang-pipe-room",
    name: "海上斗房",
    displayName: "海上斗房",
    type: "shop",
    city: "上海",
    intro:
      "展示样例。面向线下合作店、展会展位与回流斗渠道的信息展示入口。",
    longIntro:
      "当前为线下合作店展示模板，可用于陈列合作渠道、展会活动、店内作品与回流斗资料。页面不接入在线支付，所有库存、价格和交付方式均需人工确认。",
    styleTags: ["线下店", "展会合作", "回流渠道", "展示样例"],
    specialties: ["现货展示", "回流斗整理", "展会活动", "人工咨询"],
    avatarUrl: "",
    coverUrl: "",
    status: "开放合作",
    contactNote: "欢迎补充店铺资料、作品图片和合作方式。",
    featuredProductIds: ["domestic-hs-estate-01", "domestic-hs-shop-02"],
  },
];

export function getDomesticMakerBySlug(slug: string) {
  return domesticMakers.find((maker) => maker.slug === slug);
}

export function getDomesticMakerTypeLabel(type: DomesticMakerType) {
  const labels: Record<DomesticMakerType, string> = {
    maker: "斗师",
    studio: "工作室",
    shop: "线下店",
  };

  return labels[type];
}
