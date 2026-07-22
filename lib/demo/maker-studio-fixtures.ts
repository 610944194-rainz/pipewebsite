export type DemoMakerStudioKind = "maker" | "studio";

export type DemoMakerStudio = {
  id: string;
  slug: string;
  name: string;
  kind: DemoMakerStudioKind;
  region: string;
  intro: string;
  longIntro: string;
  coverImage?: string;
  isDemo: true;
  source: "ui-fixture";
};

export type DemoMakerProduct = {
  id: string;
  slug: string;
  makerSlug: string;
  nameZh: string;
  nameEn?: string;
  shape: string;
  bowlMaterial: string;
  finish: string;
  stemMaterial: string;
  filterSpec: string;
  weightGrams: number;
  lengthMillimeters: number;
  bowlHeightMillimeters: number;
  bowlWidthMillimeters: number;
  chamberDiameterMillimeters: number;
  chamberDepthMillimeters: number;
  status: "展示样例";
  demoReferencePrice: number;
  images: string[];
  description: string;
  isDemo: true;
  source: "ui-fixture";
};

const unbrandedPipeImage = "/pics/weekly-featured-head.png";

export const demoMakersAndStudios: readonly DemoMakerStudio[] = [
  {
    id: "demo-maker-lin-yan",
    slug: "demo-maker-lin-yan",
    name: "示例斗师 · 林砚",
    kind: "maker",
    region: "上海",
    intro: "注重经典比例、烟道结构与日常使用体验。",
    longIntro:
      "示例资料，仅用于验证斗师目录、作品关系与后续详情页的信息层级，不代表真实斗师、合作关系或公开库存。",
    coverImage: unbrandedPipeImage,
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-studio-muchuan",
    slug: "demo-studio-muchuan",
    name: "示例工作室 · 木川工房",
    kind: "studio",
    region: "浙江杭州",
    intro: "以天然材料、简洁造型和手工细节为主要方向。",
    longIntro:
      "示例资料，仅用于验证工作室目录、公开作品数量与后续详情页的内容接口，不代表真实工作室或公开库存。",
    coverImage: unbrandedPipeImage,
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-maker-zhou-yu",
    slug: "demo-maker-zhou-yu",
    name: "示例斗师 · 周屿",
    kind: "maker",
    region: "四川成都",
    intro: "偏好自由式造型与流畅线条。",
    longIntro:
      "示例资料，仅用于验证无图片时的文字字标回退与斗师作品关系，不代表真实斗师、作品或公开库存。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-studio-nanan",
    slug: "demo-studio-nanan",
    name: "示例工作室 · 南岸制斗",
    kind: "studio",
    region: "广东广州",
    intro: "资料与作品正在整理中。",
    longIntro:
      "示例资料，仅用于验证暂无公开作品的工作室状态，不代表真实工作室、合作关系或公开库存。",
    isDemo: true,
    source: "ui-fixture",
  },
] as const;

export const demoMakerProducts: readonly DemoMakerProduct[] = [
  {
    id: "demo-lin-yan-straight-billiard-01",
    slug: "demo-lin-yan-straight-billiard-01",
    makerSlug: "demo-maker-lin-yan",
    nameZh: "直式撞球斗 · 经典比例",
    nameEn: "Straight Billiard",
    shape: "直式撞球斗",
    bowlMaterial: "石楠木",
    finish: "光面",
    stemMaterial: "亚克力",
    filterSpec: "9 mm",
    weightGrams: 42.6,
    lengthMillimeters: 145.0,
    bowlHeightMillimeters: 46.0,
    bowlWidthMillimeters: 35.8,
    chamberDiameterMillimeters: 19.2,
    chamberDepthMillimeters: 37.5,
    status: "展示样例",
    demoReferencePrice: 1680,
    images: [unbrandedPipeImage],
    description: "以平衡比例与日常握持感为重点的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-lin-yan-bent-billiard-02",
    slug: "demo-lin-yan-bent-billiard-02",
    makerSlug: "demo-maker-lin-yan",
    nameZh: "弯式撞球斗 · 柔和曲线",
    nameEn: "Bent Billiard",
    shape: "弯式撞球斗",
    bowlMaterial: "石楠木",
    finish: "喷砂",
    stemMaterial: "硫化硬胶",
    filterSpec: "无滤芯",
    weightGrams: 46.8,
    lengthMillimeters: 138.5,
    bowlHeightMillimeters: 47.2,
    bowlWidthMillimeters: 36.4,
    chamberDiameterMillimeters: 19.0,
    chamberDepthMillimeters: 38.0,
    status: "展示样例",
    demoReferencePrice: 1880,
    images: [unbrandedPipeImage],
    description: "示例弯式结构，强调烟道连贯与重心控制。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-lin-yan-dublin-03",
    slug: "demo-lin-yan-dublin-03",
    makerSlug: "demo-maker-lin-yan",
    nameZh: "都柏林斗 · 细收斗钵",
    nameEn: "Dublin",
    shape: "都柏林斗",
    bowlMaterial: "石楠木",
    finish: "锈面",
    stemMaterial: "亚克力",
    filterSpec: "9 mm",
    weightGrams: 40.3,
    lengthMillimeters: 149.0,
    bowlHeightMillimeters: 48.6,
    bowlWidthMillimeters: 34.6,
    chamberDiameterMillimeters: 18.7,
    chamberDepthMillimeters: 38.5,
    status: "展示样例",
    demoReferencePrice: 1980,
    images: [unbrandedPipeImage],
    description: "通过锥形斗钵测试线条与工艺字段的展示。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-lin-yan-apple-04",
    slug: "demo-lin-yan-apple-04",
    makerSlug: "demo-maker-lin-yan",
    nameZh: "苹果斗 · 日常圆润款",
    nameEn: "Apple",
    shape: "苹果斗",
    bowlMaterial: "石楠木",
    finish: "光面",
    stemMaterial: "硫化硬胶",
    filterSpec: "无滤芯",
    weightGrams: 44.1,
    lengthMillimeters: 136.0,
    bowlHeightMillimeters: 45.4,
    bowlWidthMillimeters: 39.2,
    chamberDiameterMillimeters: 19.1,
    chamberDepthMillimeters: 36.8,
    status: "展示样例",
    demoReferencePrice: 1760,
    images: [unbrandedPipeImage],
    description: "圆润斗钵比例的示例日常使用取向作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-muchuan-brandy-01",
    slug: "demo-muchuan-brandy-01",
    makerSlug: "demo-studio-muchuan",
    nameZh: "白兰地斗 · 自然木纹",
    nameEn: "Brandy",
    shape: "白兰地斗",
    bowlMaterial: "石楠木",
    finish: "光面",
    stemMaterial: "亚克力",
    filterSpec: "9 mm",
    weightGrams: 48.5,
    lengthMillimeters: 142.0,
    bowlHeightMillimeters: 49.0,
    bowlWidthMillimeters: 39.0,
    chamberDiameterMillimeters: 19.5,
    chamberDepthMillimeters: 39.0,
    status: "展示样例",
    demoReferencePrice: 2180,
    images: [unbrandedPipeImage],
    description: "以天然木纹和圆润底部轮廓为重点的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-muchuan-reverse-calabash-02",
    slug: "demo-muchuan-reverse-calabash-02",
    makerSlug: "demo-studio-muchuan",
    nameZh: "反葫芦结构 · 空腔大气室",
    nameEn: "Reverse Calabash",
    shape: "反葫芦 / 空腔大气室",
    bowlMaterial: "石楠木",
    finish: "喷砂",
    stemMaterial: "亚克力",
    filterSpec: "无滤芯",
    weightGrams: 54.2,
    lengthMillimeters: 151.5,
    bowlHeightMillimeters: 52.0,
    bowlWidthMillimeters: 41.5,
    chamberDiameterMillimeters: 19.0,
    chamberDepthMillimeters: 34.2,
    status: "展示样例",
    demoReferencePrice: 2480,
    images: [unbrandedPipeImage],
    description: "用于验证反葫芦结构与完整尺寸字段的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-muchuan-dublin-03",
    slug: "demo-muchuan-dublin-03",
    makerSlug: "demo-studio-muchuan",
    nameZh: "都柏林斗 · 轻量砂面",
    nameEn: "Dublin",
    shape: "都柏林斗",
    bowlMaterial: "石楠木",
    finish: "喷砂",
    stemMaterial: "硫化硬胶",
    filterSpec: "9 mm",
    weightGrams: 39.6,
    lengthMillimeters: 147.0,
    bowlHeightMillimeters: 47.5,
    bowlWidthMillimeters: 34.8,
    chamberDiameterMillimeters: 18.8,
    chamberDepthMillimeters: 37.8,
    status: "展示样例",
    demoReferencePrice: 2080,
    images: [unbrandedPipeImage],
    description: "以轻量化与喷砂表面为方向的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-muchuan-apple-04",
    slug: "demo-muchuan-apple-04",
    makerSlug: "demo-studio-muchuan",
    nameZh: "苹果斗 · 温润锈面",
    nameEn: "Apple",
    shape: "苹果斗",
    bowlMaterial: "石楠木",
    finish: "锈面",
    stemMaterial: "亚克力",
    filterSpec: "无滤芯",
    weightGrams: 43.8,
    lengthMillimeters: 139.2,
    bowlHeightMillimeters: 46.3,
    bowlWidthMillimeters: 38.6,
    chamberDiameterMillimeters: 19.0,
    chamberDepthMillimeters: 37.2,
    status: "展示样例",
    demoReferencePrice: 1940,
    images: [unbrandedPipeImage],
    description: "用于展示锈面工艺与短文本说明的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-muchuan-bent-billiard-05",
    slug: "demo-muchuan-bent-billiard-05",
    makerSlug: "demo-studio-muchuan",
    nameZh: "弯式撞球斗 · 手工细节",
    nameEn: "Bent Billiard",
    shape: "弯式撞球斗",
    bowlMaterial: "石楠木",
    finish: "光面",
    stemMaterial: "硫化硬胶",
    filterSpec: "9 mm",
    weightGrams: 47.3,
    lengthMillimeters: 140.5,
    bowlHeightMillimeters: 48.1,
    bowlWidthMillimeters: 37.2,
    chamberDiameterMillimeters: 19.2,
    chamberDepthMillimeters: 38.4,
    status: "展示样例",
    demoReferencePrice: 2260,
    images: [unbrandedPipeImage],
    description: "以手工细节与稳定曲线为重点的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-zhou-yu-freehand-01",
    slug: "demo-zhou-yu-freehand-01",
    makerSlug: "demo-maker-zhou-yu",
    nameZh: "自由式河豚斗 · 流线轮廓",
    nameEn: "Freehand Blowfish",
    shape: "自由式河豚斗",
    bowlMaterial: "石楠木",
    finish: "锈面",
    stemMaterial: "亚克力",
    filterSpec: "无滤芯",
    weightGrams: 51.8,
    lengthMillimeters: 156.0,
    bowlHeightMillimeters: 51.0,
    bowlWidthMillimeters: 42.8,
    chamberDiameterMillimeters: 19.3,
    chamberDepthMillimeters: 38.6,
    status: "展示样例",
    demoReferencePrice: 2380,
    images: [unbrandedPipeImage],
    description: "流畅自由线条与局部纹理关系的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-zhou-yu-straight-billiard-02",
    slug: "demo-zhou-yu-straight-billiard-02",
    makerSlug: "demo-maker-zhou-yu",
    nameZh: "直式撞球斗 · 收束口沿",
    nameEn: "Straight Billiard",
    shape: "直式撞球斗",
    bowlMaterial: "石楠木",
    finish: "喷砂",
    stemMaterial: "硫化硬胶",
    filterSpec: "9 mm",
    weightGrams: 41.7,
    lengthMillimeters: 144.2,
    bowlHeightMillimeters: 45.8,
    bowlWidthMillimeters: 35.1,
    chamberDiameterMillimeters: 18.9,
    chamberDepthMillimeters: 37.0,
    status: "展示样例",
    demoReferencePrice: 1820,
    images: [unbrandedPipeImage],
    description: "直线比例与喷砂表面结合的示例作品。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-zhou-yu-brandy-03",
    slug: "demo-zhou-yu-brandy-03",
    makerSlug: "demo-maker-zhou-yu",
    nameZh: "白兰地斗 · 自由式过渡",
    nameEn: "Freehand Brandy",
    shape: "白兰地斗",
    bowlMaterial: "石楠木",
    finish: "光面",
    stemMaterial: "亚克力",
    filterSpec: "无滤芯",
    weightGrams: 49.4,
    lengthMillimeters: 148.0,
    bowlHeightMillimeters: 49.6,
    bowlWidthMillimeters: 40.4,
    chamberDiameterMillimeters: 19.4,
    chamberDepthMillimeters: 38.2,
    status: "展示样例",
    demoReferencePrice: 2150,
    images: [unbrandedPipeImage],
    description: "为验证自由式描述、尺寸与示例参考价展示准备的作品。",
    isDemo: true,
    source: "ui-fixture",
  },
] as const;

export function getDemoMakersAndStudios() {
  return demoMakersAndStudios;
}

export function getDemoMakerOrStudioBySlug(slug: string) {
  return demoMakersAndStudios.find((entry) => entry.slug === slug);
}

export function getDemoMakerProducts(makerSlug: string) {
  return demoMakerProducts.filter((product) => product.makerSlug === makerSlug);
}

export function getDemoMakerProduct(identifier: string) {
  return demoMakerProducts.find(
    (product) => product.id === identifier || product.slug === identifier
  );
}

export function getDemoRelatedProducts(product: DemoMakerProduct) {
  return demoMakerProducts.filter(
    (candidate) =>
      candidate.makerSlug === product.makerSlug && candidate.id !== product.id
  );
}

export function getDemoPublicWorkCount(makerSlug: string) {
  return getDemoMakerProducts(makerSlug).length;
}

export function isDemoMakerStudioRecord(
  value: DemoMakerStudio | DemoMakerProduct | undefined
) {
  return value?.isDemo === true && value.source === "ui-fixture";
}
