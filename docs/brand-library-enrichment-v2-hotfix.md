# Brand Library Enrichment V2 Hotfix

修复 V1 中 `BRAND_ENRICHMENT_PROFILES` 直接声明为 `PipeBrand[]` 导致的 TypeScript 报错。

V2 使用 `BrandEnrichmentProfileInput` + `makeBrandEnrichmentProfile()` 为品牌丰富资料自动补齐：
- `slug`
- `aliases`
- `founded`
- `suitableFor`
- `priceRange`
- `status`

业务内容与 V1 保持一致。
