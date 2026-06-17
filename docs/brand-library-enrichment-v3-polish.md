# 品牌库 V3 视觉与命名小修

本轮处理 V1/V2 上线检查中发现的三个前端体验问题：

- 英文品牌名从库存数据进入品牌库时可能保留小写，例如 `gh zhang`、`ser jacopo`。
- 品牌卡片 logo fallback 使用较长 wordmark 时会在 92px 方形框内溢出裁切。
- Nanna Ivarsson 中文名应为“娜娜·伊瓦松”，此前部分数据为“南娜·伊瓦松”。

处理原则：

- 数据层增加 `formatBrandDisplayName`，避免只在页面做表层修饰。
- 列表页与详情页同时增加 `brandDisplayName`，保证即使未来公共索引传入小写品牌名，前端仍按品牌名规范展示。
- 无图片 logo 时统一用 initials / monogram，占位视觉与原有品牌卡逻辑保持一致，不使用外站热链 logo。
- 中文名误字同时修正 alias 与 safe candidates，避免商品名和品牌名不一致。
