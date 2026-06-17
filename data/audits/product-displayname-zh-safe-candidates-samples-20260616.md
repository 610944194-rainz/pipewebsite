# 商品中文展示名 Safe Candidates Final Apply Report 20260616

生成脚本版本：v8-finish-validator-hotfix-20260617

## 核心统计

- total: 7301
- ready: 1001
- candidate: 6136
- fallback-original: 164
- brandFinalAppliedCount: 537
- shapeFinalAppliedCount: 920
- aliasCorrectionAppliedCount: 55
- doNotDisplayShapeSuppressedCount: 9
- hornMaterialContextCount: 56
- hornAsShapeCount: 50
- titlesWithStackDouCount: 0
- titlesWithSkaterDouCount: 0

## 关键样本

### brandFinal

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| danish-36578 | Estate S. Bang, Billard w. silver, Presmoked | 斯邦 Silver 撞球斗 | 斯邦 Silver 撞球斗 | shortNameNeedsReview |
| danish-36787 | Johs Pipes, Bent Brandy, 9 mm. | 约斯 白兰地斗 | 约斯 白兰地斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-36780 | Johs Pipes, Squat Bulldog | 约斯 斗牛犬斗 | 约斯 斗牛犬斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-36670 | Ken Dederichs, Bent Brandy | Ken Dederichs 白兰地斗 | Ken Dederichs 白兰地斗 |  |
| danish-36669 | Ken Dederichs, Soft Pickaxe | Ken Dederichs Soft 系列 十字镐斗 | Ken Dederichs Soft 系列 十字镐斗 |  |
| danish-33190 | Ken Pipes, Canted Rhodesian, 25627 | Ken Pipes 牛头斗 | Ken Pipes 牛头斗 |  |
| danish-36215 | Luiz Lavos, Strawberry w. horn | Luiz Lavos w. horn 系列 草莓斗 | Luiz Lavos w. horn 系列 草莓斗 | hornMaterialContext, shapeMissingOrUnknown |
| danish-36216 | Luiz Lavos, Virgin Acorn w. Jupati | Luiz Lavos, Virgin w. Jupati 橡果斗 | Luiz Lavos, Virgin w. Jupati 橡果斗 | shapeStillUnknown, shortNameNeedsReview, fallbackRecommended |

### aliasCorrections

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| danish-1486 | Eriksen Keystone filter pipe, black/rusticated | Eriksen Keystone filter Eriksen Keystone filter, black/ 系列 锈蚀 | Eriksen Keystone filter Eriksen Keystone filter, black/ 系列 锈蚀 | shortNameNeedsReview, shapeMissingOrUnknown |
| danish-31397 | Eriksen Keystone filter pipe, green/rusticated | Eriksen Keystone filter Eriksen Keystone filter, green/ 系列 锈蚀 | Eriksen Keystone filter Eriksen Keystone filter, green/ 系列 锈蚀 | shortNameNeedsReview, shapeMissingOrUnknown |
| danish-1489 | Eriksen Keystone filter pipe, orange/rustic | Eriksen Keystone filter Eriksen Keystone filter, orange/ 系列 | Eriksen Keystone filter Eriksen Keystone filter, orange/ 系列 | shapeMissingOrUnknown |
| danish-7613 | Eriksen Keystone filter pipe, pistachio/rustic | Eriksen Keystone filter Eriksen Keystone filter, pistachio/ 系列 | Eriksen Keystone filter Eriksen Keystone filter, pistachio/ 系列 | shapeMissingOrUnknown |
| danish-34870 | Estate Ashton for Paul Olsen, Dublin, Presmoked | 阿什顿 都柏林斗 | 阿什顿 都柏林斗 |  |
| danish-33543 | Estate Savinelli, Autograph, Tall Freehand, Presm. | 沙芬 Autograph 系列 自由式斗 | 沙芬 Autograph 系列 自由式斗 | shortNameNeedsReview, missingShapeFromOriginal |
| danish-36722 | Estate SON (Nording), Full Bent Egg, Presmoked | Nørding Estate SON, Presmoked 系列 弯式蛋形斗 | Nørding Estate SON, Presmoked 系列 弯式蛋形斗 |  |
| smokingpipes-477302 | Smooth Tomato with Horn (Fukuda) (R) (146) (2021) Tobacco Pipe | 拓植 146号 光面 R 番茄斗 | 拓植 146号 光面 R 番茄斗 | shortNameNeedsReview, missingModelNumberFromOriginal, hornMaterialContext |

### shapeFinal

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| danish-33109 | Anne Julie, Unica Blowfish | 安妮·朱莉 Unica 系列 河豚斗 | 安妮·朱莉 Unica 系列 河豚斗 | shortNameNeedsReview, missingShapeFromOriginal |
| danish-36857 | Bay Denmark, Rusticated Horn | 贝伊 锈蚀 号角斗 | 贝伊 锈蚀 号角斗 | shortNameNeedsReview |
| danish-36850 | Bay Denmark, Shield w. Horn | Bay Denmark w. Horn 盾牌斗 | Bay Denmark w. Horn 盾牌斗 | shortNameNeedsReview, fallbackRecommended, hornMaterialContext, shapeMissingOrUnknown |
| danish-5726 | Chacom, New Gentleman, 1095, Bent Acorn | 查科姆 New Gentleman 系列 1095号 弯式橡果斗 | 查科姆 New Gentleman 系列 1095号 弯式橡果斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-35639 | George Boyadjiev, Grade A, Army Mount Blowfish | 乔治·博雅杰夫 Army 河豚斗 | 乔治·博雅杰夫 Army 河豚斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-36429 | Hans Former Nielsen, Freehand Pickaxe | Hans 佛么 Nielsen 自由式斗 十字镐斗 | Hans 佛么 Nielsen 自由式斗 十字镐斗 | shortNameNeedsReview, fallbackRecommended |
| danish-35095 | Kai Nielsen, Jewel X, Bent Canted Tulip | 凯·尼尔森 Jewel X 系列 郁金香斗 | 凯·尼尔森 Jewel X 系列 郁金香斗 |  |
| danish-36669 | Ken Dederichs, Soft Pickaxe | Ken Dederichs Soft 系列 十字镐斗 | Ken Dederichs Soft 系列 十字镐斗 |  |

### doNotDisplaySuppressed

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| smokingpipes-608617 | Dark Sandblasted Stack with Horn (Ping Zhan) (04) (2024) Tobacco Pipe | 张国辉 Dark 系列 04号 喷砂 斗 | 张国辉 Dark 系列 04号 喷砂 | shapeStillUnknown, shortNameNeedsReview, missingShapeFromOriginal, hornMaterialContext |
| smokingpipes-608695 | Smooth Stack with Horn (Ping Zhan) (04) (2024) Tobacco Pipe | 张国辉 04号 光面 斗 | 张国辉 04号 光面 | shapeStillUnknown, shortNameNeedsReview, missingShapeFromOriginal, hornMaterialContext |
| smokingpipes-673651 | Pawn Stack Sitter (Checkmate) (2024) Tobacco Pipe | 杰克诺 Pawn 系列 2024号 坐斗 | 杰克诺 Pawn 系列 2024号 坐斗 | shapeStillUnknown |
| smokingpipes-694039 | Knight Stack (Checkmate) (2025) Tobacco Pipe | 杰克诺 Knight 系列 2025号 斗 | 杰克诺 Knight 系列 2025号 | shapeStillUnknown |
| smokingpipes-722481 | Smooth Bent Stack with Boxwood (D) Tobacco Pipe | 杜卡 Boxwood 系列 光面 斗 | 杜卡 Boxwood 系列 光面 | shapeStillUnknown, shortNameNeedsReview |
| smokingpipes-722660 | Smooth Skater (Mcinar) (with Case) Tobacco Pipe | AKB 光面 | AKB 光面 | shapeStillUnknown, shortNameNeedsReview, shapeMissingOrUnknown |
| smokingpipes-722665 | Rusticated Skater (with Case) Tobacco Pipe | AKB 锈蚀 | AKB 锈蚀 | shapeStillUnknown, shortNameNeedsReview, shapeMissingOrUnknown |
| smokingpipes-723083 | Lattice Stack (with Case) Tobacco Pipe | AKB Lattice 系列 斗 | AKB Lattice 系列 | shapeStillUnknown |

### hornMaterialContext

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| danish-36858 | Bay Denmark, Rusticated Billard w. Horn | 贝伊 锈蚀 撞球斗 | 贝伊 锈蚀 撞球斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle, hornMaterialContext |
| danish-36850 | Bay Denmark, Shield w. Horn | Bay Denmark w. Horn 盾牌斗 | Bay Denmark w. Horn 盾牌斗 | shortNameNeedsReview, fallbackRecommended, hornMaterialContext, shapeMissingOrUnknown |
| danish-35776 | Henri Pipes, Apple w. horn | 亨利 苹果斗 | 亨利 苹果斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle, hornMaterialContext |
| danish-36215 | Luiz Lavos, Strawberry w. horn | Luiz Lavos w. horn 系列 草莓斗 | Luiz Lavos w. horn 系列 草莓斗 | hornMaterialContext, shapeMissingOrUnknown |
| danish-36301 | Suhr Pipes, Canted Tulip w. horn | Suhr Pipes, w. horn 郁金香斗 | Suhr Pipes, w. horn 郁金香斗 | shortNameNeedsReview, fallbackRecommended, hornMaterialContext |
| danish-36302 | Suhr Pipes, Pear w. horn | Suhr Pipes w. horn 梨式斗 | Suhr Pipes w. horn 梨式斗 | shortNameNeedsReview, fallbackRecommended, hornMaterialContext |
| danish-36856 | Bay Denmark, Classic Billard w. Horn | 贝伊 撞球斗 | 贝伊 撞球斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle, hornMaterialContext |
| danish-36854 | Bay Denmark, Classic Dublin w. Horn | 贝伊 都柏林斗 | 贝伊 都柏林斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle, hornMaterialContext |

### keyRegressionChecks

| id | 原名 | 修改前 | 修改后 | warnings |
|---|---|---|---|---|
| danish-33109 | Anne Julie, Unica Blowfish | 安妮·朱莉 Unica 系列 河豚斗 | 安妮·朱莉 Unica 系列 河豚斗 | shortNameNeedsReview, missingShapeFromOriginal |
| danish-36578 | Estate S. Bang, Billard w. silver, Presmoked | 斯邦 Silver 撞球斗 | 斯邦 Silver 撞球斗 | shortNameNeedsReview |
| danish-35639 | George Boyadjiev, Grade A, Army Mount Blowfish | 乔治·博雅杰夫 Army 河豚斗 | 乔治·博雅杰夫 Army 河豚斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-36429 | Hans Former Nielsen, Freehand Pickaxe | Hans 佛么 Nielsen 自由式斗 十字镐斗 | Hans 佛么 Nielsen 自由式斗 十字镐斗 | shortNameNeedsReview, fallbackRecommended |
| danish-35095 | Kai Nielsen, Jewel X, Bent Canted Tulip | 凯·尼尔森 Jewel X 系列 郁金香斗 | 凯·尼尔森 Jewel X 系列 郁金香斗 |  |
| danish-36669 | Ken Dederichs, Soft Pickaxe | Ken Dederichs Soft 系列 十字镐斗 | Ken Dederichs Soft 系列 十字镐斗 |  |
| danish-36301 | Suhr Pipes, Canted Tulip w. horn | Suhr Pipes, w. horn 郁金香斗 | Suhr Pipes, w. horn 郁金香斗 | shortNameNeedsReview, fallbackRecommended, hornMaterialContext |
| danish-33538 | Tine Balleby, Bent Brandy w. Box Wood, Virgin | 蒂娜·巴勒比 白兰地斗 | 蒂娜·巴勒比 白兰地斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-33536 | Tine Balleby, Canted Facet Bulldog | 蒂娜·巴勒比 斗牛犬斗 | 蒂娜·巴勒比 斗牛犬斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-33106 | Anne Julie, Tulip Lovat | 安妮·朱莉 罗瓦斗 郁金香斗 | 安妮·朱莉 罗瓦斗 郁金香斗 | shortNameNeedsReview, missingShapeFromOriginal, brandOnlyTitle |
| danish-35055 | BBB, Arsenal 722S, Bent Diplomat | BBB Arsenal 系列 722S 外交官斗 | BBB Arsenal 系列 722S 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-7786 | BBB, Arsenal 722S, Bent Stubby Diplomat | BBB Arsenal, Bent 系列 722S 外交官斗 | BBB Arsenal, Bent 系列 722S 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-7787 | BBB, Chelsea 722S, Bent Diplomat | BBB Chelsea 系列 722S 外交官斗 | BBB Chelsea 系列 722S 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-35056 | BBB, Chelsea 722S, Bent Stubby Diplomat | BBB Chelsea, Bent 系列 722S 外交官斗 | BBB Chelsea, Bent 系列 722S 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-33243 | Berggreen Pipes, Model 86, Diplomat | 贝格格林 Model 系列 86号 外交官斗 | 贝格格林 Model 系列 86号 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-33245 | Berggreen Pipes, Model 86, Diplomat | 贝格格林 Model 系列 86号 外交官斗 | 贝格格林 Model 系列 86号 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-33247 | Berggreen Pipes, Model 86, Diplomat | 贝格格林 Model 系列 86号 外交官斗 | 贝格格林 Model 系列 86号 外交官斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-5024 | Chacom, Berlingot 22, Tulip, Matte | 查科姆 Berlingot, Matte 系列 22号 郁金香斗 | 查科姆 Berlingot, 哑光 系列 22号 郁金香斗 | shortNameNeedsReview, missingModelNumberFromOriginal |
| danish-31757 | Chacom, The French Pipe, No. 1, Tulip, Sand | 查科姆 The French, No., 喷砂 系列 郁金香斗 | 查科姆 The French, No., 喷砂 系列 郁金香斗 |  |
| danish-27376 | Chacom, The French Pipe, No. 1, Tulip, Smooth | 查科姆 The French, No. 系列 光面 郁金香斗 | 查科姆 The French, No. 系列 光面 郁金香斗 | shortNameNeedsReview |

