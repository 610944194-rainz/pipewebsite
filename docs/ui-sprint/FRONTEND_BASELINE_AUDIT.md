# 烟斗派前端基线审计（移动端 UI Sprint）

## 基线与范围

- 审计源目录：`C:\Users\NING MEI\Desktop\pipewebsite-auto-release`（仅读）。审计时为干净的 `main`，HEAD `acd5cfe5416ad82828a198b781306730c36d26b5`。
- 远端最新基线：`origin/main` / `6de7952697e68929e17268c134306d918a96f2db`。`HEAD..origin/main` 仅包含 Smokingpipes 自动化脚本改动，没有前端或公开产品数据改动。
- 本 Sprint 克隆：`C:\Users\NING MEI\Desktop\pipewebsite-ui-sprint`，分支 `feat/mobile-ui-sprint`，起点为上述远端 SHA。
- 本文档是代码审计，不读取 raw 抓取缓存；未运行采集、Daily、List、Detail、部署或任何来源站访问。

## 技术栈与构建/部署

- Next.js `16.2.6`、React/React DOM `19.2.4`、TypeScript `^5`、Tailwind CSS `^4`（`@tailwindcss/postcss`）。
- App Router；`app/layout.tsx` 设置 `zh-CN`，`app/globals.css` 导入 Tailwind。页面默认 Server Component，局部以 `"use client"` 承担交互。
- `next.config.ts` 仅设置 `allowedDevOrigins: ["192.168.1.33"]`；无 `vercel.json`、Docker 或 Netlify 配置。默认构建为 `next build`，部署方式由宿主/默认 Vercel 流程决定。
- 可见前端生成/验证入口：`scripts/build-public-product-indexes-v1.mjs`、`scripts/validate-public-product-indexes-v1.mjs`、`scripts/generate-featured-products-v1.mjs`、`scripts/validate-featured-products-v1.mjs`。它们不是本 Sprint 的执行范围。

## 页面职责与组件地图

| 区域 | 真实入口 | 主要组成 | 备注 |
| --- | --- | --- | --- |
| 首页 | `app/page.tsx` | `SiteHeader`、本页局部 `ProductCard`、共享 `components/products/ProductCard`/`ProductCardImage`、本页局部 `SiteFooter` | 同时使用 `data/pipes.ts` 的近期卡片和 `getHomepageFeaturedProducts()` 的精选卡片；局部卡片/页脚与共享实现并存。 |
| 商品浏览 | `app/products/page.tsx` -> `components/products/ProductsPageClient.tsx` | `SiteHeader`、`ProductGrid`、`ProductCard`、`ProductCardImage`、本页内 `FilterSheet`、`Pagination` | 服务端读取并把结果传入客户端筛选抽屉；组件内有另一份分页实现。 |
| 商品详情 | `app/products/[id]/page.tsx` -> `app/products/[id]/ProductGallery.tsx` | `SiteHeader`、`SiteFooter`、`ProductGallery`、`ProductBackButton` | 详情页负责规格/品牌/CTA；画廊与返回逻辑为 Client Component。另有未被路由使用的 `components/ProductGallery.tsx`。 |
| 品牌列表 | `app/brands/page.tsx` | `SiteHeader`、本页局部 `BrandCard`、`Pagination`、搜索/筛选卡片 | 纯服务端 URL 筛选，但卡片、分页、logo 和名称格式化都在页面内。 |
| 品牌详情 | `app/brands/[slug]/page.tsx` | `SiteHeader`、本页局部品牌信息区、`BrandSeriesFilterDrawer`、`ProductGrid`、`ProductPagination` | 品牌资料与关联库存组合；未使用共享 `SiteFooter`。 |
| 精选 | `app/featured/page.tsx` | `SiteHeader`、`ProductGrid` | 共享商品卡片和返回位置契约。 |
| 找斗 | `app/request/page.tsx` | `SiteHeader`、`SiteFooter`、本页表单控件 | 唯一完整 Client Page；生成咨询文本并复制。 |
| 服务/合作 | `app/service/page.tsx`、`app/cooperate/page.tsx` | `SiteHeader`、`SiteFooter`、本页局部信息卡 | 静态内容；卡片/区块未抽成共享原子组件。 |
| 国内斗师/作品 | `app/domestic-makers/**`、`app/domestic-products/[id]/page.tsx` | `SiteHeader`、`SiteFooter`、局部卡片 | `generateStaticParams()` 静态生成；只由旧 `SiteMenu` 发现，不在当前 `SiteHeader` 菜单。 |

共享但需要谨慎处理的组件：`app/components/SiteHeader.tsx`、`SiteFooter.tsx`、`BackButton.tsx`，`components/products/{ProductsPageClient,ProductGrid,ProductCard,ProductCardImage,ProductPagination}.tsx`，以及 `components/brands/BrandSeriesFilterDrawer.tsx`。`app/components/SiteMenu.tsx` 有完整导航（含国内斗师），但当前没有任何引用，属于孤立实现；不能把它误当成线上 Header。

## 数据流与内容映射

### 公开商品

1. `app/products/page.tsx` 将 URL `searchParams` 传给 `queryPublicProducts()`（`lib/public-products/query.ts`）。
2. `parseProductQueryState()` 规范化 `q`、`status`/`inventory`、`source`、`brand`、`country`、`shape`、`condition`、`weight`、`finish`、`bowlMaterial`、`stemMaterial`、`filter`、`sort`、`page`；`buildProductsHref()`（`lib/public-products/url.ts`）反向写回 URL。
3. `queryPublicProducts()` 读取 `getPublicCatalog()` 与 `getPublicFilters()`；`lib/public-products/server.ts` 以进程内 cache 从 `data/generated/public-products/catalog.json`、`filters.json` 同步读取。
4. `ProductsPageClient` 将已经筛选的结果呈给 `ProductGrid` / `ProductCard`。展示名由 `lib/product-display-name-server.ts` 的 `withSafeDisplayName()` 注入安全中文显示字段，卡片显示由 `lib/public-products/presentation.ts`（价格、状态、国家、斗型、滤芯）映射。

商品详情链路是：`/products/[id]` -> `resolvePublicProductId()` -> `data/generated/public-products/detail-lookup.json`；直接 ID 从 `byId` 找 shard，纯数字 ID 兼容 `bySourceProduct["danish:<id>"]` 并 redirect 至规范 ID。随后 `getPublicProductDetailById()` 读取 `details/<00..3f>.json`。页面中的 `getProductDisplayName()`、`shapeDisplayLabel()`、`countryLabel()`、`conditionDisplayLabel()`、`filterDisplayLabel()` 和 `formatSitePrice()` 负责原始字段至展示字段的转换。

### 品牌

`getPublicBrandProfiles()`（`lib/public-products/brands.ts`）以 `getPublicBrands()` 读取 `data/generated/public-products/brands.json`，再与 `data/brands.ts` 的 `getBrandMetaBySlug()` / `getBrandByName()` 合并；缺失资料则 `createFallbackBrand()`。`getPublicBrandProfileBySlug()` 调用 `normalizeBrandForBrandIndex()` 处理 canonical slug。详情页若初次查找失败，会用 `getCanonicalBrandSlugForInput()` 尝试后 redirect 到规范 `/brands/<slug>`；仍失败才 `notFound()`。

品牌详情用 `brand.productIds` 经 `getPublicProductsByIds()` 回到 catalog，`getPublicBrandSeriesOptions()` 读取 `data/generated/public-products/series.json`；`series`、`page` 保持在 URL。品牌名称/中文名/logo/简介在 `app/brands/page.tsx` 和 `app/brands/[slug]/page.tsx` 各自实现一份格式化/降级逻辑，`parseBrandSummary()` 位于 `app/utils/display.ts`。

### 其余内容

- 首页精选：`getHomepageFeaturedProducts()` 优先 `data/generated/public-products/featured.json`，回退至 `getFallbackFeaturedProducts()`；`/featured` 用 `getFeaturedProducts()`。
- 首页近期库存：独立从 `data/pipes.ts` 的 `pipeProducts` 读取，因此与公开 catalog 是并行来源，重构时不可擅自合并为单一来源。
- 国内页面：`data/domestic-makers.ts`、`data/domestic-products.ts` 的静态 TS 数据；动态路由都通过 `generateStaticParams()` 列出。
- 联系方式/服务文案：`data/site.ts` 的 `siteConfig`，找斗页将表单字段和该配置合成为剪贴板文本。

## 交互、状态与必须保留的契约

- 商品筛选、搜索、排序和分页：规范状态在 URL；`ProductsPageClient.navigate()` 以 `router.push(..., { scroll: false })` 更新，刷新后保留。打开筛选 sheet、草稿值、输入文本是 React state，刷新不保留。
- 商品返回位置：`ProductCard.saveReturnPosition()` 写入 `sessionStorage`（键来自 `lib/public-products/scroll.ts`）；`ProductGrid` 与详情页 `ProductBackButton` 读取、定位并清除。`returnTo`、`anchor`、`productId`、`scrollY` 的 sanitization 及 `scroll:false` 是重构高风险契约。
- 图片：`ProductCardImage` 与详情 `ProductGallery` 均使用 `sourceImageCandidates()` 多 URL 回退；详情支持缩略图、前后切换、键盘和 zoom 弹层。不得把远程图片失败替换为无状态 `img`。
- 品牌系列：`BrandSeriesFilterDrawer` 用 React state 管理开关/搜索/草稿，并以 URL `series` 导航；Escape 与背景关闭需保留。
- 移动菜单：实际线上 `SiteHeader` 的 `open` state 控制左侧覆盖层；菜单内链接和关闭按钮必须关闭菜单。`SiteMenu` 另有 dialog/Escape 实现但未被调用。
- 找斗：字段 `budget`、`brand`、`condition`、`pipeShape`、`weight`、`tobaccoType`、`experience`、`note` 由 `useState` 管理；`useMemo` 生成文本，`navigator.clipboard.writeText` 复制并短暂显示 copied 状态。

## 视觉系统现状

- `globals.css` 只有 Tailwind 导入、默认白/黑变量、深色媒体变量和图片白底兜底；实际设计 token 主要散落在 Tailwind 任意值中。
- 主视觉：墨绿 `#063B32`（95 处）、暖白 `#FFFDF8`（78）、深棕字 `#2B211C`（70）、灰褐文字 `#746A5F`（65）、浅褐边界 `#E7DDD0`（65）、金棕 `#9A6530`（48）和金色 `#E7C48A`（41）。最大容器常用 `max-w-6xl`；Header 高 `72px`，移动内边距常为 `px-4`，`sm:px-6 lg:px-8`。
- 组件大量使用 `rounded-[18px]`、`rounded-2xl`、`rounded-[24px]`、`rounded-full` 与自定义阴影，存在未统一的卡片和按钮语言。`Georgia/Times New Roman` 以局部 inline style 出现在商品/品牌页面；全局为 Arial/Helvetica。
- 存在多个局部 `style={{...}}`（首页、商品列表、详情、品牌、国内页、精选），以及国内页的 `paperTextureStyle` 重复。建议 Sprint 先建立可替代 token，不改变现有颜色语义或图片兜底规则。

## 高风险区、问题与最小回滚

| 风险 | 相关文件 | 不可破坏的契约 | 最小回滚 |
| --- | --- | --- | --- |
| 筛选 URL/分页 | `lib/public-products/query.ts`、`url.ts`、`ProductsPageClient.tsx` | 所有参数的解析、canonical 品牌和 page reset/scroll:false | 仅回退商品页 UI 文件；保留 query/url。 |
| 详情兼容与返回 | `app/products/[id]/{page,ProductGallery}.tsx`、`server.ts`、`scroll.ts` | legacy 数字 ID redirect、returnTo/anchor/sessionStorage、画廊回退 | 一起回退详情页和画廊，不回退生成数据。 |
| 品牌 canonical/库存 | `app/brands/[slug]/page.tsx`、`lib/public-products/brands.ts`、`server.ts` | slug redirect、series/page URL、brand.productIds -> catalog | 一起回退品牌详情和 drawer；不改 profile/data 合并。 |
| 双首页数据源 | `app/page.tsx`、`data/pipes.ts`、`server.ts` | 近期库存与精选分别来自旧 TS 和 generated catalog | 仅回退首页展示，不迁移数据。 |
| Server/Client 边界 | 所有标记 `use client` 的组件 | `server-only` 文件系统读取不得进入客户端 bundle | UI 容器改动限于现有 Client leaf。 |
| 图片与 hydration | 卡片/画廊组件、`presentation.ts` | source URL fallback、SSR 传入数据与客户端初始 index 一致 | 回退整个图片组件，保留展示映射。 |

## Sprint 实施边界

允许：在既有页面/组件上做移动端布局、层级、可访问性和样式重构；将重复的纯 UI 原子组件/样式 token 抽出；每个页面分阶段提交与截图对比。

禁止：修改 `data/**`、`scripts/**`、公开索引格式、采集/自动化、环境变量、Vercel 配置、路由 URL、详情/品牌 redirect 与数据读取函数；不引入新 UI 组件库或 Impeccable。
