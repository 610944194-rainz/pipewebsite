# 前端路由与数据地图

基线：`6de7952697e68929e17268c134306d918a96f2db`。除 `app/request/page.tsx` 外，以下 page 文件均为 Server Component；表中列出的 Client 项为其直接的交互叶组件。

| 路由 | 页面文件 | Server/Client | 主要组件 | 数据函数 | 数据来源 | URL 状态/redirect | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `app/page.tsx` | Server + Client cards | `SiteHeader`、局部 `ProductCard`、共享 `ProductCardImage`/`ProductCard`、局部 Footer | `getHomepageFeaturedProducts()`、本页 `get*` helpers | `featured.json`/catalog；另有 `data/pipes.ts` | CTA 用 `buildProductsHref()`；`#daily-picks` anchor | 两套商品来源和局部重复卡片。 |
| `/products` | `app/products/page.tsx` | Server -> `ProductsPageClient` (Client) | Header、filter sheet、`ProductGrid`、`ProductCard`、页内 Pagination | `queryPublicProducts()`、`getProductUiFilterOptions()`、`buildProductsHref()` | `catalog.json`、`filters.json` | `q,status/inventory,source,brand,country,shape,condition,weight,finish,bowlMaterial,stemMaterial,filter,sort,page`; client push + `scroll:false` | URL 解析、页码重置、滚动恢复。 |
| `/products/[id]` | `app/products/[id]/page.tsx` | Server + `ProductGallery`/`ProductBackButton` (Client) | Header、Footer、详情规格、画廊、返回、品牌/找斗 CTA | `resolvePublicProductId()`、`getPublicProductDetailById()`、`getProductDisplayName()` | `detail-lookup.json` -> `details/<shard>.json`; `data/brands.ts` | 数字 Danish source ID redirect 到 canonical ID；保留 `returnTo`、`anchor` 等安全参数 | ID 兼容、sessionStorage return、图片回退/zoom。 |
| `/brands` | `app/brands/page.tsx` | Server | Header、局部搜索/`BrandCard`/Pagination | `getPublicBrandProfiles()`、`parseBrandSummary()`、`isNameOnlyBrand()` | `brands.json` + `data/brands.ts`/brand profile content | `q,letter,page`；页面内 `buildBrandsHref()` | 逻辑/展示重复，不能遗漏 name-only 降级。 |
| `/brands/[slug]` | `app/brands/[slug]/page.tsx` | Server + `BrandSeriesFilterDrawer`/`ProductGrid` (Client) | Header、局部 Hero/Facts/Story、drawer、`ProductGrid`、`ProductPagination` | `getPublicBrandProfileBySlug()`、`getCanonicalBrandSlugForInput()`、`getPublicProductsByIds()`、`getPublicBrandSeriesOptions()` | `brands.json`、`series.json`、`catalog.json`、`data/brands.ts` | 非规范 slug redirect；`series,page` | canonical slug、关联 productIds、系列分页和抽屉焦点。 |
| `/featured` | `app/featured/page.tsx` | Server + `ProductGrid` (Client) | Header、`ProductGrid` | `getFeaturedProducts()` | `featured.json`，不存在/不足时 catalog fallback | 卡片 `returnTo="/featured"` | 返回位置与精选规则。 |
| `/request` | `app/request/page.tsx` | Client | Header、Footer、本页表单 | `useMemo()`/`copyMessage()`；`siteConfig` | `data/site.ts` | 无 URL state；clipboard 写入 | 文案字段、复制失败处理、服务边界文案。 |
| `/service` | `app/service/page.tsx` | Server | Header、Footer、局部 Step/FAQ/Boundary card | 无读取函数 | 页面常量 | CTA links | 静态信息层级及 CTA 目标。 |
| `/cooperate` | `app/cooperate/page.tsx` | Server | Header、Footer、局部 InfoCard | 无读取函数 | 页面常量 | CTA links | 复用样式而非改变合作内容。 |
| `/domestic-makers` | `app/domestic-makers/page.tsx` | Server | Header、Footer、局部 MakerCard | `getDomesticMakerTypeLabel()`、`getDomesticProductsByMakerSlug()` | `data/domestic-makers.ts`、`data/domestic-products.ts` | `q,type`，页面 `buildDomesticMakersHref()` | 仅孤立 `SiteMenu` 暴露；不能误删为死页。 |
| `/domestic-makers/[slug]` | `app/domestic-makers/[slug]/page.tsx` | Server，`generateStaticParams()` | Header、Footer、局部作品卡 | `getDomesticMakerBySlug()`、`getDomesticProductsByMakerSlug()` | domestic TS 数据 | `params.slug`，未知 `notFound()` | 静态 params 与作品关联。 |
| `/domestic-products/[id]` | `app/domestic-products/[id]/page.tsx` | Server，`generateStaticParams()` | Header、Footer、局部占位/详情 | `getDomesticProductById()`、`getDomesticProductMaker()`、`formatDomesticPrice()` | `data/domestic-products.ts` | `params.id`，未知 `notFound()` | 静态 params、斗师交叉引用、纹理 inline style。 |

## 路由可达性

- 当前 `SiteHeader.tsx` 的移动菜单只暴露 `/products`、`/brands`、`/request`、`/service`，并从 logo 回 `/`。
- `SiteMenu.tsx`（未被引用）额外暴露 `/cooperate` 与 `/domestic-makers`；因此后二者及国内详情在当前 Header 中是隐藏/孤立路由，而不是不存在的路由。
- `/featured` 由首页精选 CTA 可达，但不在 Header 菜单；`/domestic-products/[id]` 由国内斗师详情内链接进入。

## 读写边界

`lib/public-products/server.ts` 标注 `server-only`，仅同步读取生成 JSON 并 cache；没有 API route、客户端 fetch、数据库或表单提交。UI Sprint 必须保持这一单向 Server data -> Client interaction 的边界。
