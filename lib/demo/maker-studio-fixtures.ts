export type DemoMakerStudioKind = "maker" | "studio";
export type DemoWorkAvailability = "available" | "sold-reference";

export type DemoMakerStudio = {
  id: string;
  slug: string;
  name: string;
  kind: DemoMakerStudioKind;
  region: string;
  experience: string;
  intro: string;
  longIntro: string;
  coverImage?: string;
  heroImage?: string;
  isDemo: true;
  source: "ui-fixture";
};

export type DemoMakerProduct = {
  id: string;
  slug: string;
  sourceProductId: string;
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
  availability: DemoWorkAvailability;
  demoReferencePrice: number;
  images: string[];
  description: string;
  isDemo: true;
  source: "ui-fixture";
};

const safeWorkImage = "/pics/weekly-featured-head.png";

export const demoMakersAndStudios: readonly DemoMakerStudio[] = [
  {
    id: "demo-maker-lin-yan",
    slug: "demo-maker-lin-yan",
    name: "示例斗师 · 林砚",
    kind: "maker",
    region: "上海",
    experience: "4 年+",
    intro: "注重经典比例、烟道结构与日常使用体验。",
    longIntro:
      "林砚的示例作品以经典斗型为基础，关注斗钵、斗柄与烟嘴之间的比例关系。在造型之外，也重视烟道结构、重量分布和日常持握体验。\n\n作品风格偏沉稳实用，表面处理以光面、喷砂和细密锈面为主。该资料仅用于页面开发与功能验收，不代表真实斗师。",
    coverImage: "/domestic-makers/demo/lin-yan-hero.png",
    heroImage: "/domestic-makers/demo/lin-yan-hero.png",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-studio-muchuan",
    slug: "demo-studio-muchuan",
    name: "示例工作室 · 木川工房",
    kind: "studio",
    region: "浙江杭州",
    experience: "8 年+",
    intro: "以天然材料、简洁造型和手工细节为主要方向。",
    longIntro:
      "木川工房是用于页面开发的虚拟工作室案例。作品强调石楠木纹理、简洁轮廓与克制装饰，注重材料本身的自然表现。\n\n示例作品覆盖经典斗型与少量自由式设计，方便测试工作室详情、作品筛选和产品目录等页面能力。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-maker-zhou-yu",
    slug: "demo-maker-zhou-yu",
    name: "示例斗师 · 周屿",
    kind: "maker",
    region: "四川成都",
    experience: "3 年+",
    intro: "偏好自由式造型与流畅线条。",
    longIntro:
      "周屿是用于开发验收的虚拟斗师案例，作品方向偏向自由式造型，注重斗钵体量、斗柄曲线和整体视觉重心。\n\n示例作品用于测试自由式河豚斗、白兰地斗和反葫芦结构等内容的展示效果，不代表任何真实人物或真实制斗经历。",
    isDemo: true,
    source: "ui-fixture",
  },
  {
    id: "demo-studio-nanan",
    slug: "demo-studio-nanan",
    name: "示例工作室 · 南岸制斗",
    kind: "studio",
    region: "广东广州",
    experience: "2 年+",
    intro: "资料与公开作品正在整理中。",
    longIntro:
      "南岸制斗是用于测试无作品状态的虚拟工作室案例。详情页保留完整主体介绍，但作品目录展示“暂无公开作品”。\n\n该案例用于验证工作室没有公开作品时的数据带、空状态、咨询入口和页面布局。",
    isDemo: true,
    source: "ui-fixture",
  },
] as const;

type DemoWorkSeed = Omit<DemoMakerProduct, "images" | "isDemo" | "source">;

const demoWorkSeeds: readonly DemoWorkSeed[] = [
  { id: "demo-lin-yan-straight-billiard-01", slug: "demo-lin-yan-straight-billiard-01", sourceProductId: "danish-15346", makerSlug: "demo-maker-lin-yan", nameZh: "经典直式撞球斗", nameEn: "Classic Straight Billiard", shape: "直式撞球斗", bowlMaterial: "石楠木", finish: "光面", stemMaterial: "亚克力", filterSpec: "9 mm", weightGrams: 42.6, lengthMillimeters: 145, bowlHeightMillimeters: 46, bowlWidthMillimeters: 35.8, chamberDiameterMillimeters: 19.2, chamberDepthMillimeters: 37.5, availability: "available", demoReferencePrice: 1680, description: "以平衡比例与日常持握感为重点的示例作品。" },
  { id: "demo-lin-yan-bent-billiard-02", slug: "demo-lin-yan-bent-billiard-02", sourceProductId: "smokingpipes-725372", makerSlug: "demo-maker-lin-yan", nameZh: "弯式喷砂撞球斗", nameEn: "Bent Sandblasted Billiard", shape: "弯式撞球斗", bowlMaterial: "石楠木", finish: "喷砂", stemMaterial: "硬化橡胶", filterSpec: "无滤芯", weightGrams: 46.8, lengthMillimeters: 138.5, bowlHeightMillimeters: 47.2, bowlWidthMillimeters: 36.4, chamberDiameterMillimeters: 19, chamberDepthMillimeters: 38, availability: "available", demoReferencePrice: 1880, description: "强调烟道连贯与重心控制的弯式示例作品。" },
  { id: "demo-lin-yan-dublin-03", slug: "demo-lin-yan-dublin-03", sourceProductId: "smokingpipes-676849", makerSlug: "demo-maker-lin-yan", nameZh: "细收都柏林斗", nameEn: "Tapered Dublin", shape: "都柏林斗", bowlMaterial: "石楠木", finish: "锈面", stemMaterial: "亚克力", filterSpec: "9 mm", weightGrams: 40.3, lengthMillimeters: 149, bowlHeightMillimeters: 48.6, bowlWidthMillimeters: 34.6, chamberDiameterMillimeters: 18.7, chamberDepthMillimeters: 38.5, availability: "sold-reference", demoReferencePrice: 1980, description: "用于测试线条与细收斗钵展示的已售参考作品。" },
  { id: "demo-lin-yan-apple-04", slug: "demo-lin-yan-apple-04", sourceProductId: "smokingpipes-728840", makerSlug: "demo-maker-lin-yan", nameZh: "日常苹果斗", nameEn: "Everyday Apple", shape: "苹果斗", bowlMaterial: "石楠木", finish: "光面", stemMaterial: "硬化橡胶", filterSpec: "无滤芯", weightGrams: 44.1, lengthMillimeters: 136, bowlHeightMillimeters: 45.4, bowlWidthMillimeters: 39.2, chamberDiameterMillimeters: 19.1, chamberDepthMillimeters: 36.8, availability: "sold-reference", demoReferencePrice: 1760, description: "圆润斗钵比例的已售参考作品。" },
  { id: "demo-muchuan-straight-billiard-01", slug: "demo-muchuan-straight-billiard-01", sourceProductId: "smokingpipes-695569", makerSlug: "demo-studio-muchuan", nameZh: "光面直式撞球斗", nameEn: "Smooth Straight Billiard", shape: "直式撞球斗", bowlMaterial: "石楠木", finish: "光面", stemMaterial: "亚克力", filterSpec: "9 mm", weightGrams: 48.5, lengthMillimeters: 142, bowlHeightMillimeters: 49, bowlWidthMillimeters: 39, chamberDiameterMillimeters: 19.5, chamberDepthMillimeters: 39, availability: "available", demoReferencePrice: 2180, description: "突出天然木纹与圆润底部轮廓的示例作品。" },
  { id: "demo-muchuan-bent-billiard-02", slug: "demo-muchuan-bent-billiard-02", sourceProductId: "smokingpipes-722224", makerSlug: "demo-studio-muchuan", nameZh: "锈面弯式撞球斗", nameEn: "Rusticated Bent Billiard", shape: "弯式撞球斗", bowlMaterial: "石楠木", finish: "锈面", stemMaterial: "硬化橡胶", filterSpec: "无滤芯", weightGrams: 47.3, lengthMillimeters: 140.5, bowlHeightMillimeters: 48.1, bowlWidthMillimeters: 37.2, chamberDiameterMillimeters: 19.2, chamberDepthMillimeters: 38.4, availability: "sold-reference", demoReferencePrice: 2260, description: "以手工纹理与稳定曲线为重点的已售参考作品。" },
  { id: "demo-muchuan-brandy-03", slug: "demo-muchuan-brandy-03", sourceProductId: "smokingpipes-725318", makerSlug: "demo-studio-muchuan", nameZh: "天然白兰地斗", nameEn: "Natural Brandy", shape: "白兰地斗", bowlMaterial: "石楠木", finish: "光面", stemMaterial: "亚克力", filterSpec: "9 mm", weightGrams: 43.8, lengthMillimeters: 139.2, bowlHeightMillimeters: 46.3, bowlWidthMillimeters: 38.6, chamberDiameterMillimeters: 19, chamberDepthMillimeters: 37.2, availability: "available", demoReferencePrice: 1940, description: "以自然木纹与饱满轮廓为方向的示例作品。" },
  { id: "demo-muchuan-dublin-04", slug: "demo-muchuan-dublin-04", sourceProductId: "smokingpipes-721746", makerSlug: "demo-studio-muchuan", nameZh: "轻量都柏林斗", nameEn: "Lightweight Dublin", shape: "都柏林斗", bowlMaterial: "石楠木", finish: "喷砂", stemMaterial: "硬化橡胶", filterSpec: "9 mm", weightGrams: 39.6, lengthMillimeters: 147, bowlHeightMillimeters: 47.5, bowlWidthMillimeters: 34.8, chamberDiameterMillimeters: 18.8, chamberDepthMillimeters: 37.8, availability: "sold-reference", demoReferencePrice: 2080, description: "用于测试轻量化与喷砂表面信息的已售参考作品。" },
  { id: "demo-muchuan-reverse-calabash-05", slug: "demo-muchuan-reverse-calabash-05", sourceProductId: "smokingpipes-676848", makerSlug: "demo-studio-muchuan", nameZh: "反葫芦结构作品", nameEn: "Reverse Calabash", shape: "反葫芦 / 空腔大气室", bowlMaterial: "石楠木", finish: "喷砂", stemMaterial: "亚克力", filterSpec: "无滤芯", weightGrams: 54.2, lengthMillimeters: 151.5, bowlHeightMillimeters: 52, bowlWidthMillimeters: 41.5, chamberDiameterMillimeters: 19, chamberDepthMillimeters: 34.2, availability: "available", demoReferencePrice: 2480, description: "用于验证反葫芦结构与完整尺寸字段的示例作品。" },
  { id: "demo-zhou-yu-freehand-blowfish-01", slug: "demo-zhou-yu-freehand-blowfish-01", sourceProductId: "smokingpipes-722223", makerSlug: "demo-maker-zhou-yu", nameZh: "自由式河豚斗", nameEn: "Freehand Blowfish", shape: "自由式河豚斗", bowlMaterial: "石楠木", finish: "锈面", stemMaterial: "亚克力", filterSpec: "无滤芯", weightGrams: 51.8, lengthMillimeters: 156, bowlHeightMillimeters: 51, bowlWidthMillimeters: 42.8, chamberDiameterMillimeters: 19.3, chamberDepthMillimeters: 38.6, availability: "available", demoReferencePrice: 2380, description: "以自由线条与局部纹理关系为重点的示例作品。" },
  { id: "demo-zhou-yu-freehand-brandy-02", slug: "demo-zhou-yu-freehand-brandy-02", sourceProductId: "smokingpipes-727442", makerSlug: "demo-maker-zhou-yu", nameZh: "自由式白兰地斗", nameEn: "Freehand Brandy", shape: "白兰地斗", bowlMaterial: "石楠木", finish: "光面", stemMaterial: "亚克力", filterSpec: "无滤芯", weightGrams: 49.4, lengthMillimeters: 148, bowlHeightMillimeters: 49.6, bowlWidthMillimeters: 40.4, chamberDiameterMillimeters: 19.4, chamberDepthMillimeters: 38.2, availability: "sold-reference", demoReferencePrice: 2150, description: "用于测试自由式描述、尺寸与示例参考价的已售参考作品。" },
  { id: "demo-zhou-yu-apple-03", slug: "demo-zhou-yu-apple-03", sourceProductId: "smokingpipes-728878", makerSlug: "demo-maker-zhou-yu", nameZh: "流线型苹果斗", nameEn: "Streamlined Apple", shape: "苹果斗", bowlMaterial: "石楠木", finish: "喷砂", stemMaterial: "硬化橡胶", filterSpec: "9 mm", weightGrams: 41.7, lengthMillimeters: 144.2, bowlHeightMillimeters: 45.8, bowlWidthMillimeters: 35.1, chamberDiameterMillimeters: 18.9, chamberDepthMillimeters: 37, availability: "sold-reference", demoReferencePrice: 1820, description: "以流畅斗柄曲线为重点的已售参考作品。" },
];

export const demoMakerProducts: readonly DemoMakerProduct[] = demoWorkSeeds.map(
  (work) => ({ ...work, images: [safeWorkImage], isDemo: true, source: "ui-fixture" })
);

export function getDemoMakersAndStudios() {
  return demoMakersAndStudios;
}

export function getDemoMakerOrStudioBySlug(slug: string) {
  return demoMakersAndStudios.find((entry) => entry.slug === slug);
}

export function getDemoMakerProducts(makerSlug: string) {
  return demoMakerProducts.filter((product) => product.makerSlug === makerSlug);
}

export const getDemoWorksByMakerSlug = getDemoMakerProducts;

export function getDemoMakerProductsByAvailability(
  makerSlug: string,
  availability: DemoWorkAvailability
) {
  return getDemoMakerProducts(makerSlug).filter(
    (product) => product.availability === availability
  );
}

export function getDemoMakerStats(makerSlug: string) {
  const works = getDemoMakerProducts(makerSlug);
  return {
    totalWorks: works.length,
    availableWorks: works.filter((work) => work.availability === "available").length,
  };
}

export function getDemoMakerProduct(identifier: string) {
  return demoMakerProducts.find(
    (product) => product.id === identifier || product.slug === identifier
  );
}

export function getDemoRelatedProducts(product: DemoMakerProduct) {
  return demoMakerProducts.filter(
    (candidate) => candidate.makerSlug === product.makerSlug && candidate.id !== product.id
  );
}

export function getDemoPublicWorkCount(makerSlug: string) {
  return getDemoMakerStats(makerSlug).totalWorks;
}

export function isDemoMakerStudioRecord(
  value: DemoMakerStudio | DemoMakerProduct | undefined
) {
  return value?.isDemo === true && value.source === "ui-fixture";
}
