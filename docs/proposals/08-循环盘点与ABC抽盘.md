# 设计文档 08 · 循环盘点与 ABC 抽盘

> 状态：**设计定稿，待实现**
> 核心取向：**复用现有盘点内核，只在"抽盘范围生成方式"上创新**——不新造任何盘点执行 / 漂移校验 / 库存调整逻辑。
> 本文所有"可机械验证的声明"均对着 2026-07-29 的当前代码核实过（`backend/src/modules/stockcheck/stockcheck.service.js`、`backend/src/database/022_create_warehouse_locations.sql`、`backend/src/engine/containerEngine.js`、`backend/src/constants/permissions.js`）。实现时若发现代码已变，以代码为准并回来订正本文。
> 权威约束参见 `CLAUDE.md` 第 7.5 节（盘点链路）、第 9 节（库存核心不变量）、第 10 节（`stockcheck` 状态机）、第 11 节（并发/事务）。

---

## 1. 背景与现状问题

系统已有一套**全盘**盘点内核（`inventory_checks` / `inventory_check_items`，状态机 `1 进行中 → 2 已完成 / 3 已取消`）。它的账面口径与执行逻辑都是干净的：

- **账面数实时取自 ACTIVE 容器合计**，不信任 `inventory_stock` 缓存：
  `stockcheck.service.js:28`（`listBookStocksFromActiveContainers`，`WHERE c.status = ACTIVE` 且 `HAVING SUM(remaining_qty) > 0`）。
- **新建即自动拉取全仓所有有货商品为明细**：
  `stockcheck.service.js:74`（`create` 内 `stocks = await listBookStocksFromActiveContainers(conn, warehouseId)`，逐行 `INSERT inventory_check_items`，见 `:86`–`:89`）。
- **提交时整单校验漂移、任一行漂移整单拒绝(409)**：
  `stockcheck.service.js:173`–`:184`（逐行 `getCurrentBookQty` 对比创建时的 `book_qty`，只要有一行变了就把全部漂移行列出来抛 409）。
- **通过后逐行 `adjustContainersForStockcheck`**：盘盈建容器、盘亏 FIFO 扣减，并写 `inventory_logs`：`stockcheck.service.js:185`–`:223`。
- **统一加锁顺序防死锁**：提交前对**本单全部被盘商品**按 `product_id` 升序 `lockStockDimension`，再逐行 `getCurrentBookQty`（`FOR UPDATE` 锁容器）：`stockcheck.service.js:165`–`:168`。

这套内核对**小仓 / 少 SKU**完全够用。但对**大仓**有结构性局限，根因都在"一次盘全仓"这个前提上：

1. **一张单拉全仓所有 SKU（`:86`），无法一次数完。** 上万 SKU 的仓库，一张盘点单几千上万行，现场不可能在一个时点数完，单据会长期挂在"进行中"。
2. **"整单校验漂移，任一行漂移整单拒绝(409)"（`:173`–`:184`）在大仓几乎必然触发。** 盘点周期越长、SKU 越多，盘点期间某个商品发生出入库的概率越接近 100%。哪怕只有 1 个 SKU 在你数第 5000 行时被拣了一单，整张单提交就被 409 打回。**全盘 + 不停机 = 永远提交不了。** 现状要盘准全仓，实际隐含"停机盘点"（冻结全仓出入库），这与 flowcube "不停机运营"的定位冲突。
3. **提交等于锁住全仓库存维度。** `:165`–`:168` 对本单所有商品加 `lockStockDimension`，再 `:174` 逐行 `FOR UPDATE` 锁容器。全盘单提交时，等于把全仓每个商品的库存维度锁一遍，与并发的出库/上架/调拨强争锁，阻塞面极大（虽然加锁顺序已统一、不会死锁，但会长时间阻塞）。
4. **盘点价值分布不均，全盘不划算。** 仓库里少数高周转、高价值商品（A 类）最容易出账实不符、最需要频繁盘；大量低值慢动销商品（C 类）一年盘一次就够。全盘对所有 SKU 一视同仁，把有限的盘点人力平摊到不需要频繁盘的 C 类上。

**循环盘点（Cycle Counting）** 是仓储业的标准解法：不停机，每次只盘一小部分；高价值/高周转商品盘得勤、低值商品盘得疏（**ABC 抽盘**）；按库区/库位轮流走，一段时间内覆盖全仓。本功能就是把这套范围调度接到现有盘点内核上——**盘点怎么执行一个字不改，只改"这次盘哪些"。**

---

## 2. 目标 / 非目标

**目标**

- 支持**循环盘点**：不停机，每次只盘一个小范围（几十~几百 SKU），提交只锁这个范围的商品维度，把"整单漂移 409"的爆炸面从"全仓"缩到"本次抽盘范围"。
- 支持 **ABC 分类**：按近 N 天出库消耗金额（或库存占用金额）把每个仓的商品分为 A/B/C 三档，物化落表，可手动重算。
- 支持**两种抽盘范围生成方式**，可组合：
  - **按 ABC 频率**：A 类勤盘、B 类中等、C 类稀盘（频率可配），每次挑"到期未盘"的商品。
  - **按库位轮流**：按库区 / 货架顺序轮转，每次盘一个物理连续的区域（现场少走路）。
- **盘点覆盖可追踪**：记录每个商品最后一次被盘完成的时间，保证一段时间内全仓被覆盖、不漏盘。
- 复用现有盘点单的填报 / 提交 / 漂移校验 / 库存调整，**零改动执行内核**。

**非目标（本期不做，留后续或 Phase 2）**

- **盘点日程自动触发 / 排班**（每天自动生成今日抽盘单、推送任务）。Phase 1 是"运营点按钮生成一张抽盘单"，自动排程放 Phase 2。
- **PDA 现场扫码盘点**。当前盘点实盘录入在 ERP 端（`updateItems`），无 PDA 页面。抽盘更需要现场扫库位/扫容器录数，但这是独立的 PDA 交互改造，单列 Phase 2（见第 7 节）。
- **盘点差异的成本影响分析 / 责任到人考核**。差异已写 `inventory_logs`（`:204`），报表另立。
- **不修改 ABC 分类算法为"实时"**。ABC 是相对稳定的分类，物化 + 手动/周期重算即可，不做每次查询实时算（成本高、无必要）。

---

## 3. 与现有系统的关系（复用盘点内核）

**一句话：抽盘 = 全盘换一种"明细来源"，其余全部走原路。**

| 环节 | 全盘（现状） | 循环抽盘（本功能） | 是否改内核 |
|---|---|---|---|
| 建单 | `create` 拉全仓 ACTIVE 容器商品（`:86`） | `create` 只拉**命中抽盘范围**的 ACTIVE 容器商品 | 仅给 `create` 加一个"范围过滤"分支，不动执行 |
| 账面口径 | ACTIVE 容器 `SUM(remaining_qty)`（`:28`） | **完全相同**（同一函数，加 `WHERE` 过滤商品/库位） | 否 |
| 填实盘 | `updateItems`（`:97`） | **完全复用** | 否 |
| 漂移校验 | 整单逐行 `getCurrentBookQty` + 任一行漂移 409（`:173`–`:184`） | **完全复用**（范围小，409 爆炸面自然缩小） | 否 |
| 库存调整 | `adjustContainersForStockcheck` 盘盈建容器 / 盘亏 FIFO（`:189`） | **完全复用** | 否 |
| 状态机 | `documentStatusRules` 的 `stockcheck`（`1→2/3`） | **完全复用**（`check_type` 只是同一状态机上的一个属性列） | 否 |
| 加锁顺序 | 按 `product_id` 升序 `lockStockDimension`（`:165`） | **完全复用**（只锁本范围商品，锁面更小 → 并发更友好） | 否 |

**这条设计取向直接命中 `CLAUDE.md` 第 9 节不变量**：库存事实源仍是 `inventory_containers.remaining_qty`，调整仍只经 `adjustContainersForStockcheck`/`containerEngine`，`inventory_stock.quantity` 仍只由 `syncStockFromContainers` 写。抽盘不新增任何库存写路径，因此**天然不引入新的库存事故面**——这也是"复用内核"最大的安全收益。

**循环盘相对全盘的并发收益（要点）**：全盘提交锁全仓商品维度；抽盘提交只锁本次范围（几十~几百个 `product_id`）的维度。锁面小 → 阻塞短 → 漂移概率低 → 提交成功率高。这正是"不停机"能成立的机制原因。

---

## 4. 数据模型

设计遵循两条原则：**① 盘点执行表（`inventory_checks`/`_items`）只加最小属性列，不改结构语义；② ABC 分类与循环调度是"派生/配置"数据，单独建表，与执行解耦。**

新迁移编号：**取当前最大 +1**（截至本文当前最大为 `150_create_customer_addresses.sql`，故约为 `151`~`154`；实现时以 `ls backend/src/database/*.sql | sort | tail -1` 为准，**不要写死编号**）。

### 4.1 `inventory_checks` 加类型与范围快照（迁移「最大+1」）

```sql
ALTER TABLE `inventory_checks`
  ADD COLUMN `check_type` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '盘点类型：1=全盘 2=循环抽盘' AFTER `warehouse_name`,
  ADD COLUMN `scope_type` VARCHAR(16) NULL
    COMMENT '抽盘范围维度：abc / zone / manual；全盘为 NULL' AFTER `check_type`,
  ADD COLUMN `scope_value` VARCHAR(64) NULL
    COMMENT '范围取值快照，如 A / B / C（abc）或 A区 / 货架编码（zone）；全盘为 NULL' AFTER `scope_type`;
```

- `check_type` 默认 1，**存量全盘单与现有 `create` 路径零影响**。
- `scope_type` / `scope_value` 是**审计快照**（本单当初盘的是哪个范围），不是执行依赖——生成明细时范围已展开成具体 `inventory_check_items` 行，事后改分类不影响已建单。语义与 `payment_records.settlement_type` 快照同理（历史事实不回溯）。

### 4.2 `product_abc_classes`：ABC 分类物化结果（按仓）

```sql
CREATE TABLE `product_abc_classes` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`  BIGINT UNSIGNED NOT NULL              COMMENT '所属仓库ID（ABC 是按仓分类）',
  `product_id`    BIGINT UNSIGNED NOT NULL,
  `abc_class`     CHAR(1)         NOT NULL DEFAULT 'C'  COMMENT 'A / B / C',
  `metric_type`   VARCHAR(16)     NOT NULL DEFAULT 'sold_value'
                                                        COMMENT '分类依据：sold_value 出库消耗金额 / stock_value 库存占用金额',
  `metric_value`  DECIMAL(18,4)   NOT NULL DEFAULT 0    COMMENT '排序指标值（消耗金额或库存金额）',
  `cumulative_pct` DECIMAL(9,6)   NOT NULL DEFAULT 0    COMMENT '帕累托累计占比（0~1），落 A/B 阈值用',
  `window_days`   INT UNSIGNED    NOT NULL DEFAULT 90   COMMENT '统计窗口天数（sold_value 时有意义）',
  `computed_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本次分类计算时刻',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_product` (`warehouse_id`,`product_id`),
  INDEX `idx_wh_class` (`warehouse_id`,`abc_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='商品 ABC 分类物化结果（按仓，可重算覆盖）';
```

- **不设 `deleted_at`**：这是可重算的派生数据，重算即"按仓整仓覆盖"（`DELETE WHERE warehouse_id=? ; INSERT ...` 或 `INSERT ... ON DUPLICATE KEY UPDATE`）。软删会和唯一键打架（同文档 01 的哨兵表处理原则）。
- `UNIQUE(warehouse_id, product_id)`：一个商品在一个仓只有一个当前分类。
- 未被分类（无出库、无库存）的商品：**不落行**或落 `C`。抽盘生成时 `LEFT JOIN` 缺行按 `C` 兜底（最稀盘），符合"没数据的当低值处理"直觉。

### 4.3 `inventory_cycle_rules`：循环盘频率配置（按仓 + ABC 类）

```sql
CREATE TABLE `inventory_cycle_rules` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`  BIGINT UNSIGNED NOT NULL DEFAULT 0    COMMENT '0=全局默认；>0=特定仓覆盖（同文档01哨兵技巧）',
  `abc_class`     CHAR(1)         NOT NULL              COMMENT 'A / B / C',
  `interval_days` INT UNSIGNED    NOT NULL              COMMENT '该类盘点周期（天）：到期未盘即进入抽盘候选',
  `batch_limit`   INT UNSIGNED    NOT NULL DEFAULT 200  COMMENT '单次该类抽盘最多拉多少 SKU（防单据过大）',
  `enabled`       TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_class` (`warehouse_id`,`abc_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='循环盘频率规则（按仓+ABC类，warehouse_id=0 为全局默认）';
```

- **`warehouse_id=0` 作全局默认**（非 `NULL`，理由同文档 01：`NULL` 不被唯一索引约束，默认值会不唯一）。取值 `COALESCE(本仓规则, warehouse_id=0 默认)`。
- **seed 迁移写入全局默认三行**：`(0,'A',30)`、`(0,'B',90)`、`(0,'C',365)`（A 月盘、B 季盘、C 年盘），`batch_limit` 默认 200。这三个数是行业常见起点，**待与用户确认**实际盘点人力后微调。

### 4.4 `inventory_count_coverage`：盘点覆盖游标（按仓 + 商品）

抽盘"轮到谁"需要知道"每个商品上次被盘完成于何时"。直接从 `inventory_checks`+`inventory_check_items` 反查每个商品的最后盘点时间成本高（大表 JOIN + GROUP BY），故**物化一张覆盖游标表**，在盘点提交成功时 upsert：

```sql
CREATE TABLE `inventory_count_coverage` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id`   BIGINT UNSIGNED NOT NULL,
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `last_counted_at` DATETIME       NOT NULL              COMMENT '该商品在该仓最后一次被盘点提交完成的时刻',
  `last_check_id`  BIGINT UNSIGNED NOT NULL              COMMENT '最后一次覆盖它的盘点单ID',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wh_product` (`warehouse_id`,`product_id`),
  INDEX `idx_wh_last` (`warehouse_id`,`last_counted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='盘点覆盖游标：每个商品最后一次被盘完成时间（全盘/抽盘都写）';
```

- **全盘单提交也写这张表**（全盘覆盖全仓，等于把全仓 `last_counted_at` 刷到当前）——这样全盘后短期内不会又被抽盘挑中，两种盘点方式在覆盖上**统一到同一游标**，不会重复劳动。
- 缺行 = 从未被盘 = 最该盘（`ORDER BY last_counted_at ASC` 时 `NULL` 排最前，或 `LEFT JOIN` 后 `COALESCE(last_counted_at, '1970-01-01')`）。

> **库位关联**：抽盘"按库位轮流"用现有 `warehouse_locations`（`022_create_warehouse_locations.sql`：`id/warehouse_id/code/zone/aisle/rack/level/position`）与容器的 `location_id`（`containerEngine.js:161` 建容器写入、`:840`/`:974` 读取）。**无需新表**，直接 JOIN。

---

## 5. 核心流程

### 5.1 ABC 分类计算（写 `product_abc_classes`）

**触发**：Phase 1 手动（运营在页面点"重算 ABC"，或建抽盘单前惰性检查过期自动算一次）；Phase 2 可挂 `scheduler.js`（当前只跑 `operation_requests` TTL 清理，可扩展为每日凌晨重算）。

**口径（默认 `metric_type='sold_value'`，出库消耗金额，帕累托）**：

```
消耗金额(商品,仓) = Σ 近 window_days 天该仓出库量 × 单位成本
  出库量：warehouse_tasks(task_type='sale_out', status=7 已出库) JOIN warehouse_task_items.picked_qty
          —— 与文档 01「日均销量」同口径（实拣=实发，排除采购退货出库、未发/取消单）
  单位成本：product_items.avg_cost（移动加权成本，CLAUDE.md 第8节）
```

分类规则（帕累托累计占比）：按仓内 `消耗金额` 降序，算累计占比 `cumulative_pct`：

```
cumulative_pct ≤ 0.80          → A
0.80 < cumulative_pct ≤ 0.95   → B
cumulative_pct > 0.95          → C
（阈值 0.80 / 0.95 可配，作为服务端常量，待确认）
```

**备选口径 `metric_type='stock_value'`（库存占用金额）**：`Σ ACTIVE 容器 remaining_qty × product_items.avg_cost`。适合"按压仓金额分类"的场景。两种口径都物化到同表，`metric_type` 记录当次用的哪种。**推荐主口径用 `sold_value`**——循环盘的目的是"高周转多盘"，周转由出库量驱动，库存金额高但不动的呆滞品不该被频繁盘（呆滞另有文档 09 处理）。

> ⚠️ 计算过程是**只读聚合，绝不碰库存**。可直接读 ACTIVE 容器或 `inventory_stock` 缓存（分类是统计展示场景，容忍缓存微漂移）。**必接仓库数据权限**：只算 `req.user.warehouseIds` 范围内的仓（`warehouseScope.scopeFilter`）。

### 5.2 抽盘范围生成（决定"这次盘哪些"）

建循环抽盘单时，前端传 `checkType=2` + 范围参数，后端据此算出**候选 `product_id` 集合**，交给 `create` 生成明细。三种范围模式：

**模式 A · 按 ABC 频率（主线）**
```sql
-- 挑「本类 + 到期未盘」的商品，缺口最久的排前，取 batch_limit 条
SELECT s.product_id
FROM ( /* 本仓 ACTIVE 容器有货商品 = listBookStocksFromActiveContainers 同源 */ ) s
JOIN product_abc_classes a
  ON a.warehouse_id = ? AND a.product_id = s.product_id AND a.abc_class = ?   -- 'A'/'B'/'C'
JOIN inventory_cycle_rules r
  ON r.abc_class = a.abc_class AND r.enabled = 1
     -- COALESCE(本仓规则, warehouse_id=0 默认)，取 interval_days / batch_limit
LEFT JOIN inventory_count_coverage cov
  ON cov.warehouse_id = ? AND cov.product_id = s.product_id
WHERE cov.last_counted_at IS NULL
   OR cov.last_counted_at < DATE_SUB(NOW(), INTERVAL r.interval_days DAY)
ORDER BY COALESCE(cov.last_counted_at, '1970-01-01') ASC
LIMIT r.batch_limit
```

**模式 B · 按库位轮流（补充）**：传 `zone`（库区）或 `rack`（货架），取该区域**所有 ACTIVE 容器涉及的商品**。物理连续、现场少走路：
```sql
SELECT DISTINCT c.product_id
FROM inventory_containers c
JOIN warehouse_locations l ON l.id = c.location_id
WHERE c.warehouse_id = ? AND c.status = /*ACTIVE*/ 1 AND c.deleted_at IS NULL
  AND l.zone = ?                    -- 或 l.rack = ?
```

**模式 C · 手动指定**：运营直接勾选商品 / 从某个分类列表里选。`scope_type='manual'`。

三种模式产出的都是"一批 `product_id`"，之后完全同构。**模式 A 与 B 可叠加**（如"A 区里的 A 类商品"），实现时把两个 `product_id` 集合取交集。

### 5.3 执行：完全复用现有内核

拿到候选 `product_id` 集合后：

1. **建单**：`create` 走同一路径，唯一区别是明细来源——把 `listBookStocksFromActiveContainers` 加一个可选 `productIds` / `zone` 过滤（`WHERE ... AND c.product_id IN (...)` 或 `AND c.location_id IN (该zone库位)`），只 INSERT 命中范围的行。`check_type`/`scope_type`/`scope_value` 一并写入单头。**执行内核（`updateItems`/`submit`/漂移校验/`adjustContainersForStockcheck`）一行不改。**
2. **填实盘**：`updateItems`（`:97`）原样。
3. **提交**：`submit`（`:136`）原样——同样的整单漂移校验（`:173`）、同样的 `lockStockDimension` 加锁顺序（`:165`）、同样的 `adjustContainersForStockcheck`（`:189`）。**唯一新增副作用**：提交成功、`compareAndSetStatus` 之后、`commit` 之前，在**同一事务内**把本单涉及商品 upsert 进 `inventory_count_coverage`（`last_counted_at=NOW()`, `last_check_id=本单`）。这是唯一要往 `submit` 里加的东西，且只写派生游标表、**不碰库存**。全盘单同样写（覆盖全仓商品）。

```
[运营] 重算 ABC (5.1) ──▶ product_abc_classes 落表
[运营] 建抽盘单：选模式A(某ABC类)/B(某库区)/C(手动) ──▶ 5.2 生成候选 product_id
        └─▶ create(check_type=2, scope, productIds) ──▶ inventory_check_items 只含范围内商品
[现场] 数数 ──▶ updateItems 填实盘（现状 ERP；Phase 2 PDA）
[运营] submit ──▶ 【复用】整单漂移校验(409) ──▶ 【复用】adjustContainersForStockcheck 盘盈/盘亏
        └─▶ 【新增】upsert inventory_count_coverage.last_counted_at=NOW()（同事务，不碰库存）
        └─▶ 状态 1→2 已完成
```

---

## 6. 后端改动清单

| 落点 | 改什么 |
|---|---|
| `database/<最大+1>_stockcheck_cycle_type.sql`（新建） | 4.1 的 `ALTER inventory_checks` 加 `check_type`/`scope_type`/`scope_value` |
| `database/<+2>_product_abc_classes.sql`（新建） | 4.2 建表 |
| `database/<+3>_inventory_cycle_rules.sql`（新建） | 4.3 建表 + seed 三行全局默认（A30/B90/C365） |
| `database/<+4>_inventory_count_coverage.sql`（新建） | 4.4 建表 |
| `modules/stockcheck/stockcheck.service.js` | ① `listBookStocksFromActiveContainers` 加可选 `productIds`/`zone` 过滤参数；② `create` 接收 `checkType/scopeType/scopeValue/productIds`，`check_type=1` 时行为完全不变，`=2` 时按范围拉明细并写单头三列；③ `submit` 末尾（`compareAndSetStatus` 后、`commit` 前）新增 `inventory_count_coverage` upsert；④ `fmt` 带出 `checkType/scopeType/scopeValue` |
| `modules/stockcheck/`（新增窄文件，建议 `stockcheck.cycle.js`） | ABC 计算（`recomputeAbc(warehouseId, metricType, windowDays)` 帕累托分类落表）+ 抽盘范围生成（5.2 三模式查询）。**按 `CLAUDE.md` 第6节"新逻辑放窄文件"，不塞回 `stockcheck.service.js` 门面** |
| `modules/stockcheck/stockcheck.routes.js` + `.controller.js` | 新增：`POST /stockcheck/abc/recompute`（重算 ABC）、`GET /stockcheck/abc`（分类结果列表，带 scopeFilter+分页）、`GET /stockcheck/cycle/candidates`（预览某范围会盘哪些商品，供建单前确认）、`GET /stockcheck/cycle/rules` + `PUT /stockcheck/cycle/rules`（频率规则维护）；`create` 的 zod schema 加 `checkType/scopeType/scopeValue/productIds?` 可选字段 |

**关键实现约束（照抄现有规矩）**：

- ABC 计算与候选生成都是**只读统计**，走缓存投影或 ACTIVE 容器聚合皆可，**绝不 `FOR UPDATE`、绝不改库存**。必接 `scopeFilter(req.user.warehouseIds, ...)`。
- `create`/`submit` 的事务、加锁顺序、漂移校验**一个字不动**——这是本设计安全性的根基（第 3 节）。新增的 coverage upsert 必须在**已有事务连接 `conn`** 上做，不新开事务，不做外部 I/O。
- 抽盘单与全盘单共用 `inventory_checks` 表和状态机，`check_type` 只是筛选/展示属性，**不新增状态、不改 `documentStatusRules`**。

---

## 7. 前端改动清单（含 PDA）

### 7.1 ERP（Phase 1）

| 落点 | 改什么 |
|---|---|
| `types/stockcheck.ts` | `StockCheck` 加 `checkType/scopeType/scopeValue`；新增 `AbcClassRow`、`CycleRule`、`CycleCandidate` 类型 |
| `api/stockcheck.ts` | 加 `recomputeAbcApi`、`getAbcListApi`、`getCycleCandidatesApi`、`getCycleRulesApi`、`saveCycleRulesApi`；`createStockCheckApi` 参数扩 `checkType/scopeType/scopeValue/productIds` |
| `pages/stockcheck/index.tsx`（列表） | 列表加"类型"列（用 `StatusBadge`/`SoftStatusLabel`，tone `info`：全盘/循环抽盘）；筛选加 `checkType` |
| `pages/stockcheck/create.tsx`（建单） | 建单向导加"盘点方式"切换：**全盘**（现状）｜**循环抽盘**。选抽盘后展开范围选择（ABC 类 / 库区下拉 / 手动勾选），调 `getCycleCandidatesApi` **预览将盘 N 个商品**再确认建单。数字列右对齐+等宽（沿用最新表格规范） |
| `pages/stockcheck/abc.tsx`（新建，可选） | ABC 分类结果页：商品 / 分类 / 指标值 / 累计占比 / 计算时间 + "重算 ABC"按钮（选口径与窗口）。仿 `pages/reports/*` 结构 |
| `pages/settings/`（循环盘规则，可选） | 频率规则维护（A/B/C 各多少天、单次上限），仿现有配置页 |
| `router/routeRegistry.ts` | 新增页 lazy import + RouteEntry（权限见第 8 节，`nav.group` 归"库存"或"盘点"） |

**盘点执行页（填实盘/提交）无需为抽盘单做任何区分**——抽盘单就是明细更少的盘点单，现有详情页原样渲染。

### 7.2 PDA（Phase 2，非本期）

当前盘点**无 PDA 页面**（`CLAUDE.md` 第 14 节 PDA 页面清单里没有盘点；实盘录入在 ERP `updateItems`）。循环盘的现场价值主要靠 PDA 扫码兑现，规划为 Phase 2：

- 新 PDA 路由 `/pda/stockcheck` + `/pda/stockcheck/:id`：领取抽盘任务 → 扫库位/扫容器条码 → 逐容器录实盘 → 提交。
- 复用 `usePdaScanner`（扫码枪键盘模式）、`useCriticalPdaAction`（关键动作断网阻断 + 回执兜底）、`X-Client: pda` 头、`X-Request-Key` 幂等、PDA 设备会话（`pdaSessionRequired`）。
- **仓库端不做决策**（`CLAUDE.md` 铁律 & MEMORY「仓库侧不能有决策权」）：PDA 只按系统给的抽盘范围逐库位数数，不提供"自己选盘哪些"的入口——盘哪些由 ERP 端生成范围决定。
- 提交仍回后端 `submit` 走同一漂移校验与库存调整，PDA 侧不复制任何盘点业务规则（`CLAUDE.md` 第 13 节）。

> **待确认**：PDA 盘点是否本期需要。若现场坚持用 ERP 平板/PC 录数，Phase 2 可延后。

---

## 8. 权限

现有盘点权限码（`permissions.js:75`–`:79`）：`stockcheck.view / create / update / submit / cancel`。

**建单/填报/提交/取消复用现有 `stockcheck.*` 权限**——抽盘单和全盘单是同一种单据，不为"类型不同"拆权限。

新增两个权限码（涉配置/分类的新能力，按 `CLAUDE.md` 第 12 节**三处手工同步** + `test:permissions` 校验 + seed 迁移授权）：

| 权限码 | 覆盖接口 | 授予角色（seed） |
|---|---|---|
| `stockcheck.abc.manage` | `POST /stockcheck/abc/recompute`、`PUT /stockcheck/cycle/rules` | 仓库管理 / 管理员 |
| `stockcheck.abc.view` | `GET /stockcheck/abc`、`GET /stockcheck/cycle/rules`、`GET /stockcheck/cycle/candidates` | 复用 `stockcheck.view` 的角色 |

> **待确认**：是否愿意为分类/规则新增两个权限码，还是把它们并入现有 `stockcheck.create`（建单时才用候选预览）/ 复用某个"库存管理"码以省掉三处同步成本。文档 01 的取向是"能复用就不新增"；此处倾向**至少新增 `stockcheck.abc.manage`**（配置类操作应受独立控制），`view/candidates` 复用 `stockcheck.view`。最终以用户确认为准。
> `roleId===1` 超管跳过所有校验（前后端），不受上述影响。

---

## 9. 分阶段落地

**Phase 1（核心价值，不含 PDA）**
1. 四个迁移：`inventory_checks` 加三列、`product_abc_classes`、`inventory_cycle_rules`（含 seed 默认）、`inventory_count_coverage`。
2. 后端：ABC 计算（`recomputeAbc`）、抽盘范围生成（三模式）、`create` 范围分支、`submit` coverage upsert、新增查询接口。
3. 前端：建单向导加"盘点方式/范围选择 + 候选预览"、列表加类型列、ABC 结果页、频率规则维护。
4. 权限码 + seed。

**Phase 2（增强）**
- **PDA 现场扫码盘点**（7.2）。
- **自动排程**：`scheduler.js` 每日凌晨重算 ABC + 按覆盖游标自动生成"今日抽盘单"草稿，运营确认即派发。
- **覆盖率看板**：仪表盘小组件"近 90 天全仓盘点覆盖率""按 ABC 类到期未盘数"（照抄 dashboard registry 现成范例，见 `CLAUDE.md` 第 13 节 & MEMORY「仪表盘可编辑重构」）。

---

## 10. 验证清单

**库存一致性（必测，最高优先级）**——本功能走的是同一个 `adjustContainersForStockcheck`，库存不变量理论上天然保持，但**必须实测确认没有旁路破坏**：

- `npm run test:integration`（库存一致性集成测试，独立测试库）——盘盈/盘亏后容器与 `inventory_stock` 缓存必须一致。
- `GET /inventory/check-consistency` 或 `npm --prefix backend run resync:inventory-stock`：抽盘提交后跑一遍，确认缓存与 ACTIVE 容器合计零漂移。
- 手测：制造某商品 A 仓可用=100，建 A 类抽盘单只含它，实盘录 95 → 提交后应盘亏 5（FIFO 扣减建 `inventory_logs`），`check-consistency` 无漂移；再建同商品全盘单，`book_qty` 应=95（证明抽盘调整真实生效、覆盖游标已更新）。

**并发与漂移（复用内核，但范围变了要回归）**：

- `npm run smoke:concurrency-guards`：抽盘提交与并发出库/上架的加锁顺序仍是"先 `lockStockDimension` 后锁容器"（`:165`），不得因抽盘引入 ABBA 死锁。
- 漂移 409 回归：抽盘单创建后，对其范围内某商品做一笔出库，再提交 → 必须整单 409（校验未被削弱）；范围外商品出库不应影响本抽盘单提交。

**主链路与权限**：

- `npm run smoke:mainline`（盘点不回归）。
- `npm run smoke:warehouse-scope`（**数据权限必测**：ABC 列表 / 候选 / 抽盘单列表不得越权跨仓）。
- `npm run test:permissions`（新增权限码前后端一致 + seed 已授权）。

**静态**：`npm --prefix backend run lint`、`npm --prefix frontend run lint`（只看 error）、`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit`。

**前端**：`preview_start` 起本地服务，实点建单向导的三种范围模式 + 候选预览 + 提交。

---

## 11. 风险与待确认

1. **漂移校验绝不能因"范围小"而被削弱**。抽盘缩小了范围，但整单漂移 409（`:173`–`:184`）的强度必须原样保留——范围内任一商品在盘点期间发生出入库，仍要整单打回重盘。**这是硬约束**，不得为"提升抽盘成功率"而放宽（放宽=把正常业务变动误记成盘盈盘亏，直接账实不符）。
2. **覆盖游标与漂移的时序**：`inventory_count_coverage` 只在 `submit` **成功提交**（状态 `1→2`、库存已调整）后写。取消（`cancel` `1→3`）与漂移 409 回滚都**不得**写覆盖——只有真正数过并对账成功才算"覆盖过"，否则会漏盘（游标误标已盘，商品实际没被数）。
3. **ABC 数据源边界**：`sold_value` 口径依赖 `warehouse_tasks(sale_out, status=7)` + `picked_qty` + `product_items.avg_cost`。`avg_cost` 只随入库正向移动、退货不反冲（`CLAUDE.md` 第 20 节风险 9），故 ABC 金额是近似值——**分类用途容忍此近似**（只影响盘点频率档位，不影响任何金额账）。新商品无出库历史 → 落 C（最稀盘），符合直觉但**首次上架的高值新品可能被低估**，可用 `stock_value` 口径或手动置 A 兜底。
4. **`avg_cost` 为 0 的商品**（从未上架成功过）会让 `sold_value/stock_value` 恒为 0 → 落 C。属预期，但要在 ABC 页提示"成本缺失"，避免误判。
5. **库位轮流依赖 `location_id` 准确**：模式 B 按 `warehouse_locations.zone`/`rack` 聚合容器，前提是上架时容器 `location_id` 写对（`containerEngine.js:161`）。若历史容器 `location_id` 为空，按库位抽盘会漏掉它们——**建议模式 B 对 `location_id IS NULL` 的容器单列"未分配库位"兜底范围**，或以 ABC 模式（模式 A，不依赖库位）为主线。
6. **迁移编号不写死**：本文一律"当前最大 +1"，实现时以 `ls backend/src/database/*.sql | sort | tail -1` 为准，且存在重复编号/缺号历史（`CLAUDE.md` 第 8 节），取最大数值 +1 即可。
7. **seed 频率默认值（A30/B90/C365）待确认**：取决于实际盘点人力与 SKU 规模。SKU 极多时 A 类月盘也可能盘不完，需配 `batch_limit` 分多次；这属运营参数调优，**上线后按覆盖率看板（Phase 2）反馈迭代**。
8. **ABC 阈值（80%/95%）与口径选择待确认**：默认帕累托经典切点，可作服务端常量暴露配置。主口径 `sold_value` vs `stock_value` 建议与用户确认业务意图（"按周转盘"还是"按压仓金额盘"）。
9. **`inventory_checks` 加列对存量单据的兼容**：`check_type DEFAULT 1` 保证存量单自动视为全盘，`create` 全盘路径零改动。上线前确认 `fmt`（`stockcheck.service.js:11`）带出新列不破坏前端解析（新字段前端可选读取）。
10. **PDA 是否本期**（第 7.2 节）：当前无 PDA 盘点页，抽盘现场执行的最大价值靠 PDA 兑现但改造独立。建议 Phase 1 先用 ERP 录数打通闭环，PDA 放 Phase 2。
