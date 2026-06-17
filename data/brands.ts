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
  logoText?: string;
  logoUrl?: string;
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

const BRAND_FINAL_ZH: Record<string, string> = {
  "Alan": "杰夫·阿兰",
  "Ardor": "阿道尔",
  "Ashton": "阿什顿",
  "Balleby": "库尔特·巴拉比",
  "Barling": "巴林",
  "Bjarne": "比耶恩",
  "Briarworks": "石楠工坊",
  "Brigham": "布里格姆",
  "Bruno Nuttens": "布鲁诺·努滕斯",
  "Butz-Choquin": "BC",
  "Caminetto": "白胡子",
  "Cavicchi": "卡维奇",
  "Charatan's": "查拉坦",
  "Comoy's": "科莫伊",
  "Davide Iafisco": "雅法",
  "Duca": "杜卡",
  "Erik Stokkebye 4th Generation": "埃里克·斯托克比4代",
  "Former": "佛么",
  "GH Zhang": "张国辉",
  "Jacono": "杰克诺",
  "Jerry Zenn": "曾朝阳",
  "Jody Davis": "乔迪·戴维斯",
  "Lanatra": "鸭子",
  "Lv Zelong": "吕泽龙",
  "Mastro Geppetto": "马斯特罗·杰佩托",
  "Musico": "音乐家",
  "Nanna Ivarsson": "娜娜·伊瓦松",
  "Old German Clay": "老德国陶土",
  "Radice": "雷迪斯",
  "Rinaldo": "里纳尔多",
  "Ropp": "罗普",
  "Rossi": "罗西",
  "S. Bang": "斯邦",
  "Sam Adebayo": "山姆·阿德巴约",
  "Ser Jacopo": "雅克博",
  "Skovgaard": "拉塞",
  "Todd Johnson": "托德·约翰逊",
  "Tsuge": "拓植",
  "Valbruna": "瓦尔布鲁纳",
  "Werner Mummert": "维纳·孟买特",
  "White Elephant": "白象",
  "Winsløw": "温斯洛",
  "Wojtek Pastuch": "帕斯图赫",
  "Yang Kun": "杨坤",
};

type BrandEnrichmentProfileInput = Omit<
  PipeBrand,
  "slug" | "aliases" | "founded" | "suitableFor" | "priceRange" | "status"
> &
  Partial<
    Pick<PipeBrand, "slug" | "aliases" | "founded" | "suitableFor" | "priceRange" | "status">
  >;

function makeBrandEnrichmentProfile(profile: BrandEnrichmentProfileInput): PipeBrand {
  return {
    ...profile,
    slug: profile.slug || slugifyBrand(profile.name),
    aliases: profile.aliases?.length ? profile.aliases : [profile.name],
    founded: profile.founded || "待补充",
    suitableFor:
      profile.suitableFor || "适合希望按品牌了解当前库存、基础风格和后续资料更新的用户。",
    priceRange: profile.priceRange || "以当前库存页和人工确认为准",
    status: profile.status || "verified",
  } satisfies PipeBrand;
}

const BRAND_ENRICHMENT_PROFILES: PipeBrand[] = ([
  {
    name: "Savinelli",
    nameZh: "沙芬",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "经典量产 / 入门进阶",
    summary: "意大利经典量产品牌，产品线丰富，适合作为入门到进阶的长期参照。｜EN: A classic Italian maker with broad lines and steady everyday options.",
    story: "Savinelli 是国内斗客最容易接触到的意大利品牌之一，常见系列覆盖光面、喷砂、锈蚀和多种经典斗型。本站先以库存关联和常见系列为主展示，后续再逐步补充更细的系列档案。｜EN: Savinelli is one of the most accessible Italian pipe brands, covering classic shapes, finishes, and many long-running lines. This profile starts from inventory linkage and will be expanded with series-level notes.",
    features: ["意大利经典", "系列丰富", "入门友好"],
    representativeStyles: ["Autograph", "Roma", "Miele", "Trevi"],
    sourceUrls: [],
    logoText: "Savinelli",
    status: "verified",
  },
  {
    name: "Peterson",
    nameZh: "彼得森",
    country: "爱尔兰",
    countryEn: "Ireland",
    priority: "high",
    level: "经典量产 / 入门进阶",
    summary: "爱尔兰经典品牌，系统斗与弯斗风格辨识度高。｜EN: A classic Irish pipe maker known for distinctive systems and bent shapes.",
    story: "Peterson 在国内斗圈认知度很高，适合放在品牌库中作为“经典量产品牌”的重点入口。具体系列、年代与戳记差异较多，后续会以单独资料页继续拆解。｜EN: Peterson is widely recognized among pipe smokers, with many series, stamp variations, and system designs that deserve dedicated follow-up notes.",
    features: ["爱尔兰经典", "系统斗", "弯斗辨识度"],
    representativeStyles: ["System", "Premier", "Aran", "Killarney"],
    sourceUrls: [],
    logoText: "Peterson",
    status: "verified",
  },
  {
    name: "Dunhill",
    nameZh: "登喜路",
    country: "英国",
    countryEn: "United Kingdom",
    priority: "high",
    level: "经典高端",
    summary: "英式经典高端品牌，适合关注传统英伦审美和收藏体系的用户。｜EN: A classic British high-end name for traditional English aesthetics and collecting.",
    story: "Dunhill 的品牌体系、年代、戳记与工艺线较复杂，本站本轮先提供品牌级入口，避免在没有逐支核验前写入过细年份判断。｜EN: Dunhill involves complex dating, stamping, and finish systems; this first-pass profile keeps the information conservative until item-level checks are made.",
    features: ["英式经典", "收藏体系", "传统斗型"],
    representativeStyles: ["Shell Briar", "Root Briar", "Bruyere"],
    sourceUrls: [],
    logoText: "Dunhill",
    status: "verified",
  },
  {
    name: "Chacom",
    nameZh: "查科姆",
    country: "法国",
    countryEn: "France",
    priority: "high",
    level: "入门 / 进阶",
    summary: "法国圣克洛德体系中的经典品牌，日用性和性价比突出。｜EN: A classic French Saint-Claude maker with practical everyday appeal.",
    story: "Chacom 适合作为法国量产烟斗的主要代表之一，常见库存覆盖撞球斗、都柏林斗、郁金香斗等基础斗型。本站会把它作为新手入门和法式品牌对比的重要样本。｜EN: Chacom is a useful reference for French factory-made pipes, with many classic shapes and accessible lines.",
    features: ["法式经典", "日用性强", "入门友好"],
    representativeStyles: ["Club", "Atlas", "Reverse Calabash"],
    sourceUrls: [],
    logoText: "Chacom",
    status: "verified",
  },
  {
    name: "Stanwell",
    nameZh: "史丹威",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "high",
    level: "入门 / 进阶",
    summary: "丹麦设计感强的经典量产品牌，兼顾日用和造型辨识度。｜EN: A Danish classic combining everyday usability with design-led shapes.",
    story: "Stanwell 很适合在品牌库中承担“丹麦设计入门”的角色。它的很多造型与丹麦设计传统关联密切，但本轮先做品牌概览，后续再补系列和设计师背景。｜EN: Stanwell works well as an entry point into Danish pipe design; deeper designer and series notes can be expanded later.",
    features: ["丹麦设计", "日用稳定", "经典量产"],
    representativeStyles: ["Danish classics", "Royal Guard"],
    sourceUrls: [],
    logoText: "Stanwell",
    status: "verified",
  },
  {
    name: "Barling",
    nameZh: "巴林",
    country: "英国",
    countryEn: "United Kingdom",
    priority: "high",
    level: "经典英式 / 收藏",
    summary: "英国经典烟斗名号，常与英式传统斗型和老斗收藏联系在一起。｜EN: A classic British name often associated with traditional shapes and estate collecting.",
    story: "Barling 的历史阶段与商标时期较复杂，本轮先保守呈现为英国经典品牌入口，避免未经逐项核验就写入具体断代结论。｜EN: Barling has complex historical periods and stamping nuances, so this profile remains conservative until item-level dating is reviewed.",
    features: ["英式传统", "回流收藏", "经典斗型"],
    representativeStyles: ["Billiard", "Dublin", "Bulldog"],
    sourceUrls: [],
    logoText: "Barling",
    status: "verified",
  },
  {
    name: "Cavicchi",
    nameZh: "卡维奇",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利手工 / 中高端",
    summary: "意大利手工品牌，常见作品强调饱满线条和清晰木纹表现。｜EN: An Italian handmade brand often associated with full forms and expressive grain.",
    story: "Cavicchi 适合放在意大利手工品牌阵列中，与 Castello、Radice、Ser Jacopo 等形成对照。本轮描述先聚焦库存观感和风格标签。｜EN: Cavicchi belongs naturally in the Italian handmade context, useful for comparison with other Italian makers.",
    features: ["意大利手工", "饱满线条", "木纹表现"],
    representativeStyles: ["Smooth", "Sandblasted", "Freehand"],
    sourceUrls: [],
    logoText: "Cavicchi",
    status: "verified",
  },
  {
    name: "GH Zhang",
    nameZh: "张国辉",
    country: "中国",
    countryEn: "China",
    priority: "high",
    level: "独立手工",
    summary: "中国手工烟斗作者品牌，适合关注国产手工与当代作者作品的用户。｜EN: A Chinese artisan maker for users interested in contemporary handmade pipes from China.",
    story: "GH Zhang / 张国辉作为 Smokingpipes 数据中出现的中国作者品牌，本轮先按用户确认中文名进入品牌库，并以实际库存样本持续校正描述。｜EN: GH Zhang is included with the user-confirmed Chinese name, with profile details refined through actual inventory evidence.",
    features: ["中国作者", "手工作品", "库存样本校正"],
    representativeStyles: ["Horn context pieces", "Freehand", "Sandblasted"],
    sourceUrls: [],
    logoText: "GH Zhang",
    status: "verified",
  },
  {
    name: "Brigham",
    nameZh: "布里格姆",
    country: "加拿大",
    countryEn: "Canada",
    priority: "high",
    level: "经典量产 / 日用",
    summary: "加拿大经典品牌，适合关注实用性和稳定日用烟斗的用户。｜EN: A Canadian classic focused on practical everyday pipes.",
    story: "Brigham 在品牌库中可作为加拿大烟斗品牌的代表入口。本轮先补基础介绍与库存关联，不展开过滤系统等细项。｜EN: Brigham is a useful Canadian brand entry; technical details can be expanded later.",
    features: ["加拿大品牌", "日用取向", "稳定实用"],
    representativeStyles: ["Classic shapes", "Filtered pipes"],
    sourceUrls: [],
    logoText: "Brigham",
    status: "verified",
  },
  {
    name: "Erik Stokkebye 4th Generation",
    nameZh: "埃里克·斯托克比4代",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "medium",
    level: "经典量产 / 生活方式",
    summary: "带有丹麦烟斗与斗草文化背景的品牌线，风格偏经典日用。｜EN: A Danish-rooted line with a classic everyday positioning.",
    story: "Erik Stokkebye 4th Generation 在库存中更适合作为生活方式和日用线品牌展示，暂不写入过度复杂的品牌历史。｜EN: This line is treated as a practical, lifestyle-oriented brand entry in the current catalog.",
    features: ["丹麦背景", "日用线", "经典造型"],
    representativeStyles: ["Classic shapes"],
    sourceUrls: [],
    logoText: "Erik Stokkebye 4th Generation",
    status: "verified",
  },
  {
    name: "Ser Jacopo",
    nameZh: "雅克博",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利手工 / 中高端",
    summary: "意大利 Pesaro 风格的重要品牌之一，常见作品带有强烈意式线条。｜EN: An important Italian Pesaro-style name with expressive Italian forms.",
    story: "Ser Jacopo 适合与 Caminetto、Mastro Geppetto、Rinaldo 等意大利品牌一起建立品牌谱系。本站先以风格识别和库存关联为主。｜EN: Ser Jacopo sits naturally alongside other Italian makers in the catalog, with this profile focused on style recognition and stock linkage.",
    features: ["意大利手工", "Pesaro 风格", "线条感强"],
    representativeStyles: ["Picta", "La Fuma", "Delecta"],
    sourceUrls: [],
    logoText: "Ser Jacopo",
    status: "verified",
  },
  {
    name: "Rossi",
    nameZh: "罗西",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "入门 / 日用",
    summary: "意大利日用型品牌，常作为更亲民的实用选择出现。｜EN: An Italian everyday brand often positioned as an accessible practical choice.",
    story: "Rossi 适合在品牌库中作为意大利日用品牌入口，与 Savinelli 等经典量产品牌形成互补。｜EN: Rossi complements the Italian factory-made segment with practical, accessible pipes.",
    features: ["意大利日用", "价格友好", "基础斗型"],
    representativeStyles: ["Classic shapes"],
    sourceUrls: [],
    logoText: "Rossi",
    status: "verified",
  },
  {
    name: "Lorenzetti",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "意大利量产 / 日用",
    summary: "意大利烟斗品牌，适合按库存继续观察其具体系列与风格。｜EN: An Italian pipe brand to be further profiled through current stock.",
    story: "Lorenzetti 本轮保留英文名，不强行汉化；描述仅做保守品牌入口，后续根据可靠资料补充。｜EN: Lorenzetti remains untranslated for now, with a conservative inventory-led profile.",
    features: ["意大利品牌", "资料待细化", "库存观察"],
    representativeStyles: ["Classic shapes"],
    sourceUrls: [],
    logoText: "Lorenzetti",
    status: "verified",
  },
  {
    name: "Winsløw",
    nameZh: "温斯洛",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "medium",
    level: "丹麦手工 / 进阶",
    summary: "丹麦手工品牌，适合关注现代丹麦线条和个性化饰面的用户。｜EN: A Danish handmade brand for modern Danish lines and expressive finishes.",
    story: "Winsløw 本轮按用户确认中文名进入品牌库，具体作者脉络和系列资料后续再补。｜EN: Winsløw is included with the confirmed Chinese name, with maker background to be expanded later.",
    features: ["丹麦手工", "现代线条", "饰面多样"],
    representativeStyles: ["Freehand", "Danish shapes"],
    sourceUrls: [],
    logoText: "Winsløw",
    status: "verified",
  },
  {
    name: "Old German Clay",
    nameZh: "老德国陶土",
    country: "德国",
    countryEn: "Germany",
    priority: "medium",
    level: "陶土烟斗 / 小众",
    summary: "以陶土材质和复古气质为主要识别点的小众品牌条目。｜EN: A niche clay-pipe entry with a historical and material-focused appeal.",
    story: "Old German Clay 与常见石楠木烟斗不同，适合在品牌库中作为材质和历史风格补充。｜EN: Old German Clay differs from briar-focused brands and adds a material/historical dimension to the catalog.",
    features: ["陶土材质", "复古风格", "小众品类"],
    representativeStyles: ["Clay pipes"],
    sourceUrls: [],
    logoText: "Old German Clay",
    status: "verified",
  },
  {
    name: "Ashton",
    nameZh: "阿什顿",
    country: "英国",
    countryEn: "United Kingdom",
    priority: "high",
    level: "英式手工 / 中高端",
    summary: "英国手工烟斗品牌，常被视作传统英式风格的重要现代延续。｜EN: A British handmade pipe name associated with modern continuity of classic English style.",
    story: "Ashton 的库存可作为英式手工与传统造型的重点入口。本轮同时把 Ashton for Paul Olsen 合并回 Ashton。｜EN: Ashton is treated as a core British handmade entry; Ashton for Paul Olsen is merged back into the Ashton brand context.",
    features: ["英式手工", "传统斗型", "回流关注"],
    representativeStyles: ["Sovereign", "Pebble Grain", "Old Church"],
    sourceUrls: [],
    logoText: "Ashton",
    status: "verified",
  },
  {
    name: "Radice",
    nameZh: "雷迪斯",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利手工 / 中高端",
    summary: "意大利经典手工品牌，常见作品有鲜明的意式比例和饰面。｜EN: A classic Italian handmade name with recognizable proportions and finishes.",
    story: "Radice 适合在品牌库中作为意大利手工的重要节点，与 Castello、Caminetto 等品牌形成对照。｜EN: Radice is an important Italian handmade reference point within the catalog.",
    features: ["意大利手工", "意式比例", "饰面辨识度"],
    representativeStyles: ["Rind", "Silk Cut", "Clear"],
    sourceUrls: [],
    logoText: "Radice",
    status: "verified",
  },
  {
    name: "Ropp",
    nameZh: "罗普",
    country: "法国",
    countryEn: "France",
    priority: "medium",
    level: "法国经典 / 日用",
    summary: "法国经典品牌，常见库存具有复古、实用和价格友好的特点。｜EN: A classic French name often seen in vintage-leaning, practical, accessible pipes.",
    story: "Ropp 适合补充法国品牌阵列，尤其适合做日用和复古风格库存入口。｜EN: Ropp helps round out the French segment with practical and vintage-leaning inventory.",
    features: ["法国经典", "复古气质", "日用友好"],
    representativeStyles: ["Vintage style", "Classic shapes"],
    sourceUrls: [],
    logoText: "Ropp",
    status: "verified",
  },
  {
    name: "White Elephant",
    nameZh: "白象",
    country: "德国",
    countryEn: "Germany",
    priority: "low",
    level: "配件 / 品牌关联",
    summary: "以“白象”中文名入库，具体品牌边界后续继续核验。｜EN: Included under the confirmed Chinese name while the exact brand context remains under review.",
    story: "White Elephant 本轮先按用户确认中文名进入品牌库，但资料仍以库存证据为主，暂不展开未经核验的品牌故事。｜EN: White Elephant is included conservatively, with details to be refined from reliable sources and stock evidence.",
    features: ["资料待核验", "库存关联", "保守展示"],
    representativeStyles: ["Inventory-linked"],
    sourceUrls: [],
    logoText: "White Elephant",
    status: "verified",
  },
  {
    name: "Mastro Geppetto",
    nameZh: "马斯特罗·杰佩托",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "意大利品牌 / 进阶",
    summary: "意大利品牌，适合放在意式手工与量产之间的库存观察入口。｜EN: An Italian brand entry for stock-led profiling between handmade and production contexts.",
    story: "Mastro Geppetto 本轮先补中文名、国家和保守风格描述，具体历史与系列后续再核验。｜EN: This profile adds basic name, country, and conservative style notes for later enrichment.",
    features: ["意大利品牌", "资料待细化", "库存观察"],
    representativeStyles: ["Classic Italian shapes"],
    sourceUrls: [],
    logoText: "Mastro Geppetto",
    status: "verified",
  },
  {
    name: "Tsuge",
    nameZh: "拓植",
    country: "日本",
    countryEn: "Japan",
    priority: "high",
    level: "日本经典 / 手工与量产",
    summary: "日本经典烟斗品牌，Ikebana 等系列应归入 Tsuge，而不是独立品牌。｜EN: A classic Japanese pipe brand; Ikebana is treated as a Tsuge series, not a separate brand.",
    story: "Tsuge / 拓植是日本烟斗品牌的重要入口。本轮特别修正 Tsuge Ikebana 的品牌边界，把 Ikebana 作为系列处理。｜EN: Tsuge is the canonical Japanese brand entry here, with Ikebana handled as a series under Tsuge.",
    features: ["日本品牌", "系列体系", "Ikebana 归并"],
    representativeStyles: ["Ikebana", "The Tasting", "Kaga"],
    sourceUrls: [],
    logoText: "Tsuge",
    status: "verified",
  },
  {
    name: "Caminetto",
    nameZh: "白胡子",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利经典 / 中高端",
    summary: "意大利经典品牌，国内常称“白胡子”，适合关注意式传统的用户。｜EN: A classic Italian name known in Chinese pipe circles as “White Beard”.",
    story: "Caminetto 在国内有“白胡子”的常用称呼，品牌库中按用户确认中文名展示，后续可补充与意大利手工传统相关的资料。｜EN: Caminetto is shown with its commonly used Chinese nickname, with deeper background to be added later.",
    features: ["意大利经典", "国内俗称白胡子", "意式传统"],
    representativeStyles: ["Business", "New Dear", "A.R."],
    sourceUrls: [],
    logoText: "Caminetto",
    status: "verified",
  },
  {
    name: "Musico",
    nameZh: "音乐家",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "意大利品牌 / 进阶",
    summary: "意大利品牌，中文名按“音乐家”展示，资料后续继续细化。｜EN: An Italian brand shown with the confirmed Chinese name, to be expanded later.",
    story: "Musico 本轮先完成品牌库中文显示与库存关联，避免写入未经核验的细节。｜EN: This first-pass profile focuses on Chinese naming and stock linkage without over-specifying unverified details.",
    features: ["意大利品牌", "资料待细化", "库存关联"],
    representativeStyles: ["Classic shapes"],
    sourceUrls: [],
    logoText: "Musico",
    status: "verified",
  },
  {
    name: "Jacono",
    nameZh: "杰克诺",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利手工 / 进阶",
    summary: "意大利品牌，库存中常见作品带有明显手工与系列辨识度。｜EN: An Italian brand with inventory that often shows handmade character and series identity.",
    story: "Jacono 本轮按“杰克诺”进入品牌库，结合库存继续整理系列与饰面差异。｜EN: Jacono is included under the confirmed Chinese name, with series and finish notes to be refined.",
    features: ["意大利品牌", "手工感", "系列辨识"],
    representativeStyles: ["Knight", "Pawn", "Checkmate"],
    sourceUrls: [],
    logoText: "Jacono",
    status: "verified",
  },
  {
    name: "Rinaldo",
    nameZh: "里纳尔多",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "意大利手工 / 进阶",
    summary: "意大利手工品牌，适合关注饱满意式造型和收藏感的用户。｜EN: An Italian handmade brand for users interested in full Italian forms and collectability.",
    story: "Rinaldo 本轮先补品牌基础资料，后续可结合具体库存补充系列、等级和饰面体系。｜EN: This profile starts with basics and can later be expanded with series, grade, and finish notes.",
    features: ["意大利手工", "饱满造型", "收藏感"],
    representativeStyles: ["Lithos", "Triade"],
    sourceUrls: [],
    logoText: "Rinaldo",
    status: "verified",
  },
  {
    name: "Lanatra",
    nameZh: "鸭子",
    country: "意大利",
    countryEn: "Italy",
    priority: "medium",
    level: "意大利品牌 / 进阶",
    summary: "意大利品牌，中文名“鸭子”有较强识别度。｜EN: An Italian brand with a distinctive Chinese nickname, “Duck”.",
    story: "Lanatra 本轮按用户确认中文名进入品牌库，具体品牌故事后续再补充。｜EN: Lanatra is included with the confirmed Chinese name, with details to be expanded later.",
    features: ["意大利品牌", "中文名识别度高", "资料待细化"],
    representativeStyles: ["Italian classics"],
    sourceUrls: [],
    logoText: "Lanatra",
    status: "verified",
  },
  {
    name: "Briarworks",
    nameZh: "石楠工坊",
    country: "美国",
    countryEn: "United States",
    priority: "medium",
    level: "美国现代 / 日用进阶",
    summary: "美国现代品牌，适合关注实用、现代和价格相对清晰的烟斗。｜EN: A modern American brand with practical, contemporary positioning.",
    story: "Briarworks 可作为美国现代烟斗品牌入口，后续可围绕系列和生产方式继续扩写。｜EN: Briarworks serves as a modern American brand entry, with series details to be added later.",
    features: ["美国现代", "实用取向", "现代设计"],
    representativeStyles: ["Classic shapes", "Modern finishes"],
    sourceUrls: [],
    logoText: "Briarworks",
    status: "verified",
  },
  {
    name: "Ardor",
    nameZh: "阿道尔",
    country: "意大利",
    countryEn: "Italy",
    priority: "high",
    level: "意大利手工 / 中高端",
    summary: "意大利手工品牌，常见作品强调体量感、饰面和装饰细节。｜EN: An Italian handmade brand often associated with volume, finish, and decorative detail.",
    story: "Ardor 适合在品牌库中作为意大利手工的重要入口之一，后续可按系列和等级继续细分。｜EN: Ardor is a strong Italian handmade entry in the catalog, with grades and series to be expanded later.",
    features: ["意大利手工", "体量感", "饰面丰富"],
    representativeStyles: ["Giove", "Urano", "Fantasy"],
    sourceUrls: [],
    logoText: "Ardor",
    status: "verified",
  },
  {
    name: "Former",
    nameZh: "佛么",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "high",
    level: "丹麦手工 / 收藏",
    summary: "丹麦手工名家品牌，中文名按国内斗圈常用“佛么”展示。｜EN: A Danish artisan name shown with the commonly used Chinese rendering.",
    story: "Former 是丹麦手工烟斗语境中很重要的名字。本轮先按用户确认中文名和保守描述入库，具体履历资料后续再扩写。｜EN: Former is an important Danish artisan name; this entry begins with confirmed naming and conservative profile text.",
    features: ["丹麦手工", "名家作品", "收藏关注"],
    representativeStyles: ["Danish classics", "Freehand"],
    sourceUrls: [],
    logoText: "Former",
    status: "verified",
  },
  {
    name: "Charatan's",
    nameZh: "查拉坦",
    country: "英国",
    countryEn: "United Kingdom",
    priority: "high",
    level: "英式经典 / 收藏",
    summary: "英国经典烟斗名号，适合关注英式老斗和传统造型的用户。｜EN: A classic British pipe name for traditional English shapes and estate interest.",
    story: "Charatan's 的历史与不同时期作品需要谨慎核验，本轮先完成中文名和品牌入口展示。｜EN: Charatan's has period-specific details that need careful checking; this first pass focuses on naming and index entry.",
    features: ["英式经典", "老斗关注", "传统造型"],
    representativeStyles: ["Executive", "Selected", "Make"],
    sourceUrls: [],
    logoText: "Charatan's",
    status: "verified",
  },
  {
    name: "Comoy's",
    nameZh: "科莫伊",
    country: "英国",
    countryEn: "United Kingdom",
    priority: "high",
    level: "英式经典 / 日用收藏",
    summary: "英式经典品牌，适合关注传统斗型与老斗体系的用户。｜EN: A classic English name for traditional shapes and estate collecting.",
    story: "Comoy's 本轮按用户确认中文名进入品牌库，具体年代、戳记和系列后续另行整理。｜EN: Comoy's is included with the confirmed Chinese name; date stamps and series notes can be expanded later.",
    features: ["英式经典", "传统斗型", "回流关注"],
    representativeStyles: ["Tradition", "Grand Slam", "Blue Riband"],
    sourceUrls: [],
    logoText: "Comoy's",
    status: "verified",
  },
  {
    name: "S. Bang",
    nameZh: "斯邦",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "high",
    level: "丹麦手工 / 收藏",
    summary: "丹麦手工名家品牌，适合关注收藏级手工斗的用户。｜EN: A Danish artisan name for collectors of handmade pipes.",
    story: "S. Bang 在丹麦手工语境中辨识度很高，本轮先确保中文名和品牌边界准确，后续再补作者与作品体系。｜EN: S. Bang is an important Danish artisan entry; this profile starts with correct naming and catalog linkage.",
    features: ["丹麦手工", "收藏级", "名家作品"],
    representativeStyles: ["Danish handmade", "Smooth grain"],
    sourceUrls: [],
    logoText: "S. Bang",
    status: "verified",
  },
  {
    name: "Bjarne",
    nameZh: "比耶恩",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "medium",
    level: "丹麦品牌 / 日用进阶",
    summary: "丹麦品牌，适合作为丹麦日用与进阶库存的补充入口。｜EN: A Danish brand useful for everyday and intermediate stock browsing.",
    story: "Bjarne 本轮按确认中文名进入品牌库，具体系列与历史资料后续补充。｜EN: Bjarne is included under the confirmed Chinese name, with details to be expanded later.",
    features: ["丹麦品牌", "日用进阶", "资料待细化"],
    representativeStyles: ["Danish shapes"],
    sourceUrls: [],
    logoText: "Bjarne",
    status: "verified",
  },
  {
    name: "Butz-Choquin",
    nameZh: "BC",
    country: "法国",
    countryEn: "France",
    priority: "high",
    level: "法式经典 / 入门进阶",
    summary: "法国经典量产品牌，中文简称按国内常用“BC”展示。｜EN: A classic French factory brand shown with the common Chinese abbreviation “BC”.",
    story: "Butz-Choquin 是法国烟斗品牌库中需要重点覆盖的品牌之一，适合新手和日用库存浏览。｜EN: Butz-Choquin is a key French brand for entry-level and everyday browsing.",
    features: ["法国经典", "BC", "日用友好"],
    representativeStyles: ["Classic shapes", "Rocaille"],
    sourceUrls: [],
    logoText: "Butz-Choquin",
    status: "verified",
  },
  {
    name: "Nørding",
    country: "丹麦",
    countryEn: "Denmark",
    priority: "high",
    level: "丹麦品牌 / 自由式",
    summary: "丹麦品牌，Eriksen Keystone 与 SON 等相关条目应归并到 Nørding。｜EN: A Danish brand; Eriksen Keystone and SON related entries are merged under Nørding.",
    story: "Nørding 本轮重点修正品牌边界：Eriksen Keystone filter pipe 和 SON (Nording) 不作为独立品牌展示，而是回到 Nørding 语境。｜EN: This profile focuses on canonical brand handling, merging Eriksen Keystone and SON entries under Nørding.",
    features: ["丹麦品牌", "自由式取向", "品牌边界修正"],
    representativeStyles: ["Eriksen Keystone", "SON", "Freehand"],
    sourceUrls: [],
    logoText: "Nørding",
    status: "verified",
  },
] satisfies BrandEnrichmentProfileInput[]).map(makeBrandEnrichmentProfile);


const NON_INDEPENDENT_BRAND_TARGETS: Record<string, string> = {
  "savinelli autograph": "Savinelli",
  "tsuge ikebana": "Tsuge",
  "eriksen keystone filter pipe": "Nørding",
  "eriksen keystone filter": "Nørding",
  "ashton for paul olsen": "Ashton",
  "son nording": "Nørding",
  "son (nording)": "Nørding",
};

const HIDDEN_BRAND_INDEX_NAMES = new Set([
  "pipe key ring",
  "pipepack",
]);

function brandIndexKey(value: string) {
  return normalizeBrandName(value.replace(/[-_]+/g, " ").replace(/[()]/g, " "));
}

const BRAND_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "akb": "AKB",
  "bbb": "BBB",
  "gh zhang": "GH Zhang",
  "s bang": "S. Bang",
  "s. bang": "S. Bang",
  "ser jacopo": "Ser Jacopo",
  "old german clay": "Old German Clay",
  "white elephant": "White Elephant",
  "mastro geppetto": "Mastro Geppetto",
  "davide iafisco": "Davide Iafisco",
  "jody davis": "Jody Davis",
  "todd johnson": "Todd Johnson",
  "jerry zenn": "Jerry Zenn",
  "sam adebayo": "Sam Adebayo",
  "werner mummert": "Werner Mummert",
  "yang kun": "Yang Kun",
  "lv zelong": "Lv Zelong",
  "wojtek pastuch": "Wojtek Pastuch",
  "butz choquin": "Butz-Choquin",
  "butz-choquin": "Butz-Choquin",
  "charatan's": "Charatan's",
  "comoy's": "Comoy's",
  "nording": "Nørding",
  "nørding": "Nørding",
  "nanna ivarsson": "Nanna Ivarsson",
  "wo larsen": "W.Ø. Larsen",
  "w o larsen": "W.Ø. Larsen",
  "w.ø. larsen": "W.Ø. Larsen",
  "w.o. larsen": "W.Ø. Larsen",
};

const LOWERCASE_BRAND_WORDS = new Set(["by", "for", "and", "of", "the"]);

function titleCaseBrandWord(word: string, index: number) {
  const lower = word.toLowerCase();
  if (index > 0 && LOWERCASE_BRAND_WORDS.has(lower)) return lower;

  return lower.replace(/(^|[-'’])([a-zøæå])/g, (match, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
}

export function formatBrandDisplayName(value: string) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return raw;

  const normalizedKey = brandIndexKey(raw);
  const directOverride = BRAND_DISPLAY_NAME_OVERRIDES[normalizedKey] || BRAND_DISPLAY_NAME_OVERRIDES[raw.toLowerCase()];
  if (directOverride) return directOverride;

  return raw
    .split(" ")
    .map((word, index) => {
      const clean = word.replace(/[.]/g, "").toLowerCase();
      const override = BRAND_DISPLAY_NAME_OVERRIDES[clean] || BRAND_DISPLAY_NAME_OVERRIDES[word.toLowerCase()];
      if (override) return override;
      if (/^[a-z]{2,3}$/i.test(word) && word === word.toUpperCase()) return word;
      return titleCaseBrandWord(word, index);
    })
    .join(" ");
}

function correctBrandZh(value?: string) {
  return String(value || "").replace(/南娜·伊瓦松/g, "娜娜·伊瓦松");
}

export function normalizeBrandForBrandIndex(value: string) {
  const raw = String(value || "").trim();
  const key = brandIndexKey(raw);

  if (!raw || HIDDEN_BRAND_INDEX_NAMES.has(key) || shouldHideBrandFromIndex(raw)) {
    return {
      canonicalName: "",
      canonicalSlug: "",
      hidden: true,
    };
  }

  const target = NON_INDEPENDENT_BRAND_TARGETS[key];
  const canonical = normalizeBrandForIndex(target || raw);

  return {
    canonicalName: formatBrandDisplayName(canonical.canonicalName),
    canonicalSlug: canonical.canonicalSlug,
    hidden: false,
  };
}

export function isHiddenBrandIndexName(value: string) {
  return normalizeBrandForBrandIndex(value).hidden;
}

function getBrandFinalZh(name: string) {
  const canonical = normalizeBrandForBrandIndex(name);
  const candidates = uniqueText([
    name,
    formatBrandDisplayName(name),
    canonical.canonicalName,
    canonicalizeBrandName(name),
  ]);

  for (const candidate of candidates) {
    const translated = BRAND_FINAL_ZH[candidate];
    if (translated) return translated;
  }

  return "";
}

const brandEnrichmentByName = new Map<string, PipeBrand>();
const brandEnrichmentBySlug = new Map<string, PipeBrand>();

for (const profile of BRAND_ENRICHMENT_PROFILES) {
  const normalized = normalizeBrandForBrandIndex(profile.name);
  if (normalized.hidden) continue;
  const aliases = uniqueText([profile.name, ...(profile.aliases || [])]);
  const enrichedProfile = {
    ...profile,
    slug: profile.slug || normalized.canonicalSlug,
    name: formatBrandDisplayName(normalized.canonicalName || profile.name),
    aliases: uniqueText(aliases.map(formatBrandDisplayName)),
  } satisfies PipeBrand;

  brandEnrichmentBySlug.set(enrichedProfile.slug, enrichedProfile);
  brandEnrichmentByName.set(normalizeBrandName(enrichedProfile.name), enrichedProfile);
  for (const alias of aliases) {
    brandEnrichmentByName.set(normalizeBrandName(alias), enrichedProfile);
    brandEnrichmentByName.set(normalizeBrandName(canonicalizeBrandName(alias)), enrichedProfile);
  }
}

function getBrandEnrichmentBySlug(slug: string) {
  const normalized = normalizeBrandForBrandIndex(slug.replace(/-/g, " "));
  return (
    brandEnrichmentBySlug.get(normalized.canonicalSlug) ||
    brandEnrichmentBySlug.get(slugifyBrand(slug))
  );
}

function getBrandEnrichmentByName(name: string) {
  const normalized = normalizeBrandForBrandIndex(name);
  return (
    brandEnrichmentByName.get(normalizeBrandName(normalized.canonicalName)) ||
    brandEnrichmentByName.get(normalizeBrandName(name)) ||
    brandEnrichmentByName.get(normalizeBrandName(canonicalizeBrandName(name)))
  );
}

function applyBrandFinalZh(brand: PipeBrand) {
  const translated = getBrandFinalZh(brand.name);
  const correctedNameZh = correctBrandZh(translated || brand.nameZh);
  return {
    ...brand,
    name: formatBrandDisplayName(brand.name),
    nameZh: correctedNameZh || undefined,
  };
}

function applyBrandEnrichmentProfile(brand: PipeBrand) {
  const enrichment =
    getBrandEnrichmentBySlug(brand.slug) || getBrandEnrichmentByName(brand.name);

  if (!enrichment) return brand;

  return {
    ...brand,
    ...enrichment,
    slug: brand.slug || enrichment.slug,
    name: brand.name || enrichment.name,
    aliases: uniqueText([...(brand.aliases || []), ...(enrichment.aliases || []), enrichment.name]),
    sourceUrls:
      enrichment.sourceUrls.length > 0 ? enrichment.sourceUrls : brand.sourceUrls,
    status: enrichment.status || brand.status,
  };
}


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
  return normalizeBrandForBrandIndex(value.replace(/-/g, " ")).canonicalSlug;
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
  return applyBrandFinalZh(
    applyBrandEnrichmentProfile(applyBrandContentProfile(applyManualBrandProfile(brand)))
  );
}

export function createFallbackBrand(name: string, slug = slugifyBrand(name)) {
  return applyBrandProfiles({
    slug,
    name: formatBrandDisplayName(name),
    aliases: [formatBrandDisplayName(name), name],
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
  const normalizedBrand = normalizeBrandForBrandIndex(slug.replace(/-/g, " "));

  if (normalizedBrand.hidden) return undefined;

  const normalizedSlug = normalizedBrand.canonicalSlug || slugifyBrand(slug);

  const staticBrand = pipeBrands.find((brand) => {
    const candidateSlugs = [brand.slug, brand.name, ...brand.aliases].map(
      slugifyBrand
    );

    return candidateSlugs.includes(normalizedSlug);
  });

  if (staticBrand) {
    return applyBrandProfiles(staticBrand);
  }

  const contentProfile = getBrandContentProfileBySlug(normalizedBrand.canonicalSlug || slug);

  if (contentProfile) {
    const canonical = normalizeBrandForIndex(contentProfile.name);
    return createFallbackBrand(
      canonical.canonicalName,
      canonical.canonicalSlug
    );
  }

  const profile = getBrandProfileBySlug(slug);

  if (profile) return createFallbackBrand(profile.name, slugifyBrand(profile.name));

  const enrichment = getBrandEnrichmentBySlug(normalizedSlug);
  if (enrichment || getBrandFinalZh(normalizedBrand.canonicalName)) {
    return createFallbackBrand(normalizedBrand.canonicalName, normalizedSlug);
  }

  return undefined;
}

export function getBrandBySlug(slug: string) {
  return getBrandMetaBySlug(slug);
}

export function getBrandByName(name: string) {
  const normalizedBrand = normalizeBrandForBrandIndex(name);

  if (normalizedBrand.hidden) return undefined;

  const canonicalName = canonicalizeBrandName(normalizedBrand.canonicalName || name);
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

  if (profile) return createFallbackBrand(profile.name);

  const enrichment = getBrandEnrichmentByName(canonicalName);
  if (enrichment || getBrandFinalZh(canonicalName)) {
    return createFallbackBrand(canonicalName);
  }

  return undefined;
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
    const canonicalBrand = normalizeBrandForBrandIndex(rawBrandName);
    const brandName = canonicalBrand.canonicalName;

    if (!brandName || canonicalBrand.hidden) {
      return;
    }

    const key = canonicalBrand.canonicalSlug;
    const hideFromBrandIndex = canonicalBrand.hidden;
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
