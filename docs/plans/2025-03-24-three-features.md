# 三项并行：货架条码 / 容器拆分 / 物流箱贴打印

> 历史方案说明：本文是 2025-03-24 的阶段性实现计划。  
> 文中旧条码前缀（如 `RCK`、`CNT`）与当前统一条码术语和编码方案已不完全一致，仅保留为历史实施记录，不作为当前新开发规范。

## A. 货架条码（RCK）

- DB：`warehouse_racks.barcode`（唯一），存量行回填 `RCK`+6 位 id。
- 新建货架：插入后生成 `RCK000001` 格式。
- 解析：`parseBarcode` 增加 `RCK(\d+)` → `type: 'rack'`。
- 打印：`print-jobs` 增加 `buildRackLabelZpl` + `enqueueRackLabelJob`（与容器标共用标签机解析逻辑）。
- API：`POST /api/racks/:id/print-label`（需登录）。
- 前端：货架列表/表单展示条码；「打印货架标」按钮。

## B. 同仓容器拆分（散件容器）

- 引擎：`containerEngine.splitContainer`：从指定 `inventory_containers` 行扣减 `remaining_qty`，再 `createContainer` 生成新 CNT；`source_type=container_split`，`source_ref_id=父容器 id`；新容器继承 `location_id`、批次；可选 `UPDATE parent_id`。
- 约束：源容器须 `status=ACTIVE`、无 `locked_by_task_id`、`0 < qty < remaining_qty`。
- API：`POST /api/inventory/containers/:id/split` body `{ qty, remark? }`。
- 成功后：可选入队打印新容器标（与收货一致）。
- 前端：`utils/barcode.ts` 已支持 CNT。
- PDA：新页 `/pda/split` — 扫 CNT → 输入数量 → 提交 → 展示新条码。

## C. 物流箱贴（BOX）

- `print-jobs`：`buildPackageLabelZpl`（箱号 + 任务号 + 摘要）+ `enqueuePackageLabelJob`。
- `finishPackage` 成功后自动入队打印；`POST /api/packages/:id/print-label` 支持补打。
- PDA 打包页：每箱「打印箱贴」按钮。

## 依赖顺序

1. 迁移 + SOURCE_TYPE + `splitContainer` + 路由  
2. 打印 ZPL 三个 enqueue + racks/packages hooks  
3. 前端 + PDA
