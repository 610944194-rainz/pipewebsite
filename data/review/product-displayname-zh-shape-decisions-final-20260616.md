# 斗型 / 结构词人工决策 Final 20260616

## 1. 规则原则

- 用户提供的当前处理视为最终中文处理结果。
- 不杜撰斗型中文名；后续应用时优先使用本 final 决策。
- Stack 和 Skater 不作为斗型展示，不得生成 `Stack 斗` 或 `Skater 斗`。
- Horn 必须做语境判断：作为斗型时显示“号角斗”；材质或装饰语境不得当作号角斗。
- Reverse Calabash 虽偏结构词，但商品展示中可作为识别性尾缀使用。

## 2. 确认为斗型并展示

| 原词 | 中文名 | 出现次数 | 备注 |
|---|---|---:|---|
| Freehand | 自由式斗 | 310 |  |
| Calabash | 葫芦斗 | 115 |  |
| Horn | 号角斗 | 107 | translate-contextual；仅在斗型语境展示 |
| Sitter | 坐斗 | 86 |  |
| Oom Paul | 匈牙利式斗 | 68 |  |
| Tomato | 番茄斗 | 66 |  |
| Volcano | 火山斗 | 62 |  |
| Nosewarmer | 暖鼻斗 | 59 |  |
| Reverse Calabash | 大气室斗 | 24 | Reverse Calabash 也可理解为结构 / 气室设计，但商品展示中可作为识别性尾缀使用。 |
| Blowfish | 河豚斗 | 21 |  |
| Barrel | 酒桶斗 | 17 |  |
| Tulip | 郁金香斗 | 16 |  |
| Ball | 球形斗 | 9 |  |
| Pickaxe | 十字镐斗 | 8 |  |
| Diplomat | 外交官斗 | 7 |  |
| Cavalier | 骑士斗 | 6 |  |
| Poker Sitter | 扑克斗 | 2 | Poker Sitter 展示时按扑克斗处理，不额外显示坐斗。 |
| Shield | 盾牌斗 | 1 |  |
| Strawberry | 草莓斗 | 1 |  |

## 3. 不作为斗型展示

| 原词 | 出现次数 | 处理 | 备注 |
|---|---:|---|---|
| Stack | 7 | do-not-display | 用户确认：不属于斗型，不展示。不得生成 Stack 斗。 |
| Skater | 3 | do-not-display | 用户确认：不展示。不得生成 Skater 斗。 |

## 4. Horn 语境规则

### 作为斗型时显示

- 中文名：号角斗
- 条件：
  - shape field equals Horn
  - original title uses Horn as standalone shape token

### 不作为斗型时处理为材质或描述

- w. Horn
- with Horn
- w/Horn
- Horn stem
- Horn mount
- Horn accent
- Horn ferrule
- horn application
- horn material context

## 5. 备注

- 用户提供的当前处理列视为最终中文处理。
- Stack 和 Skater 用户确认不展示，不得作为斗型尾缀。
- Horn 必须做语境判断，不能把 w. Horn / with Horn 等材质语境误判为号角斗。
- Reverse Calabash 虽偏结构词，但作为商品展示识别信息可显示为大气室斗。
