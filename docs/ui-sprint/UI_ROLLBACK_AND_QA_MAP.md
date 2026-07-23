# 移动端 UI Sprint：回滚与 QA 地图

## 基线与提交策略

- 基线提交：`6de7952697e68929e17268c134306d918a96f2db`（`origin/main`）。
- 当前文档提交单独落为 `docs: record frontend baseline for mobile UI sprint`；后续 UI 工作必须按页面组拆分提交，不能混入 `data/**`、`scripts/**`、锁文件或部署配置。
- 每阶段先跑 `npm.cmd run build`、`git diff --check`，再做桌面/移动截图；失败时先回退该阶段 UI 文件，不改业务数据/读取模块来“修”构建。

| 阶段 | 建议文件范围 | 必测契约 | 最小回滚 |
| --- | --- | --- | --- |
| 0：共享骨架/token | `app/globals.css`、`app/components/{SiteHeader,SiteFooter}.tsx` 和新增纯 UI 文件 | Header 菜单开关/链接、键盘和遮罩、所有路由基本渲染 | 仅回退该阶段 shared UI 提交。 |
| 1：商品浏览 | `app/products/page.tsx`、`components/products/{ProductsPageClient,ProductGrid,ProductCard,ProductCardImage,ProductPagination}.tsx` | 所有筛选 URL、排序、分页、清空、滚动位置、卡片详情链接 | 完整回退商品 UI 文件；不改 `lib/public-products/{query,url,scroll}.ts`。 |
| 2：商品详情 | `app/products/[id]/{page,ProductGallery}.tsx` | canonical/legacy ID redirect、returnTo/anchor、缩略图、zoom、图片失败回退、品牌/找斗 CTA | 同时回退详情页+画廊；不回退 `server.ts` 或 JSON。 |
| 3：品牌 | `app/brands/**`、`components/brands/BrandSeriesFilterDrawer.tsx` | `q/letter/page`、slug redirect、`series/page`、关联库存、drawer Escape/关闭 | 同时回退品牌页面与 drawer。 |
| 4：首页与静态页 | `app/page.tsx`、`app/{featured,request,service,cooperate}/page.tsx` | 首页双数据源、精选 `/featured`、找斗复制、每个 CTA | 回退单页；不得迁移 `data/pipes.ts` 或 `site.ts`。 |
| 5：国内隐藏页面 | `app/domestic-makers/**`、`app/domestic-products/[id]/page.tsx` | `generateStaticParams()`、notFound、斗师-作品链接 | 回退该页组；保持 domestic TS 数据不变。 |

## 必跑 QA

每阶段：

1. `npm.cmd run build`
2. `git diff --check`
3. 检查 `git status --short` 只有本阶段批准文件
4. 视口：`375x812`、`390x844`、`768x1024`、`1440x900`

核心手工路径：

- `/products?q=savinelli&brand=savinelli&sort=price-asc&page=2`：修改筛选、清空、翻页、刷新与返回均保持预期。
- 从 `/products` 与 `/featured` 各进入一件商品，再用详情返回按钮：需恢复卡片锚点或精确 scrollY。
- 访问一个 legacy 纯数字 `/products/[id]`：应 redirect 到规范 ID；再访问错误 ID：应 `notFound`。
- `/brands?letter=S&page=2`、规范和非规范 `/brands/[slug]`：确认 canonical redirect、库存分页和系列抽屉。
- `/request`：填写所有字段、复制咨询文本、无 clipboard 权限时仍保留可读文本。
- `/domestic-makers` -> maker -> domestic product：确认静态详情、返回链接与移动布局。

## 截图对比清单

- `/`：Hero、精选、近期库存、服务 CTA、Footer。
- `/products`：默认、带筛选、筛选 sheet 打开、空状态、分页。
- `/products/[id]`：多图、无图/图片失败、zoom、规格长文本、返回 CTA。
- `/brands`：搜索、字母筛选、品牌卡与空状态。
- `/brands/[slug]`：品牌资料完整与 name-only/缺字段降级、系列 drawer、关联库存。
- `/request`、`/service`、`/cooperate`、`/domestic-makers`、国内详情：至少移动与桌面各一张。

## 异常时的回滚顺序

1. Build/hydration：先恢复最近阶段的 Client UI 组件，确认 `server-only` 的读取链未被导入客户端。
2. 数据错配：恢复相关页面的展示层；禁止修改 `catalog.json`、detail shard、`data/*.ts` 或生成脚本作为 UI 回滚手段。
3. URL/redirect 或返回位置：完整恢复该路由的 page 与相关 Client leaf，保留 `query.ts`、`url.ts`、`scroll.ts`、`server.ts`。
4. 跨页 Header 问题：恢复共享骨架提交，再逐页 reapply；不要以删除隐藏国内路由或 `SiteMenu.tsx` 规避验证。
