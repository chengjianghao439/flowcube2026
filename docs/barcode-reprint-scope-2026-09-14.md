# 打印记录页与补打口径（2026-09-14）

## 用户规则（最终）

1. **打印记录页只记唯一码**：库存条码、从塑料盒拆出的散货条码、出库箱贴、物流面单——
   这些都指向唯一对象，丢了能按记录补打。非唯一的固定码（塑料盒自身的码、货架/库位码）
   不记录，在各自功能里重复打印。理由：「只要发出打印任务都要记录」（方案 A）。
2. **补打只有一个入口：打印记录页**。其它页面不得提供补打。
3. 订单类页面只用于**看进度**：销售订单是出货的，不展示条码打印；收货订单只保留任务进度，
   不展示打印记录。

## 各类码的归属

| 条码 | 对象/来源 | 进打印记录页 | 重复打印入口 |
|---|---|---|---|
| 库存条码 `I…/CNT…` | 收货、拆分、调拨、盘点等产生的容器 | 进 | 记录页「重新打印」（唯一补打入口） |
| 拆分散货 `B…`（`container_split` / `sale_order_adjustment_return`） | 从塑料盒拆出的散货，每次新建 | 进 | 同上 |
| 可复用空盒 `B…`（`plastic_box_create`） | 塑料盒自身的固定码 | **不进** | 塑料盒页「打印条码」（重复打印，不是补打） |
| 出库箱贴 `L…/BOX…` | 装箱产生的箱子 | 进 | 记录页「重新打印」 |
| 物流面单 | 运单 | 进 | 记录页「重新打印」 |
| 货架 `R…/RCK…`、库位 `LOC…` | 仓库固定设施 | 不进（本就不在取数范围） | 货架页 / 库位页各自的标签打印 |

区分两个 `B` 码靠 `source_ref_type`：空盒是 `plastic_box_create`，拆分散货是
`container_split` / `sale_order_adjustment_return`；两者都是 `container_type=2`，看前缀分不出来。

## 方案 A：没有可用打印机也要留记录

原实现里「解析不到打印机」会直接跳过入队，于是**收货时没有可用打印机的容器根本没有打印记录**，
既不会出现在打印记录页，也没有任何补打入口——标签永远打不出来。

现在改为：容器标签（`container_label`）、箱贴（`package_label`）、面单（`waybill`）三类在解析不到
打印机时，落一条 `printer_id = NULL`、`status = 3(失败)`、`error_message = 'no printer available'`
的记录：

- 对象因此出现在打印记录页（状态显示「超时待确认」，可被 failed/timeout 筛选命中）；
- 绑定打印机后从记录页补打即可（`reprint*` 会重新解析打印机并生成真正可打印的任务）；
- **物理打印完全不受影响**：`claim-client` 按 `printer_id` 过滤，NULL 行不会被任何客户端领取；
- 返回值带 `unprintable: true`，调用方据此区分「已排到打印机」与「只留了记录」，收货/拆分的
  `noPrinterCount` 与文案据此调整，不会把没打出来的标签说成「已提交打印」。

迁移 `242_print_jobs_allow_no_printer.sql` 把 `print_jobs.printer_id` 改为可空（该列无外键）。
货架/库位/商品标签维持原行为（解析不到打印机时不建记录）：它们不在打印记录页的取数范围内，
各自页面本来就能重复打印，留记录只会产生查不到的噪音。

## 实现清单

**打印记录页范围**（`backend/src/modules/print-jobs/print-jobs.query.js`）

- 入库：`AND pj.id IS NOT NULL AND IFNULL(c.source_ref_type,'') <> 'plastic_box_create'`（列表与计数）
- 出库：`AND pj.id IS NOT NULL`（列表与计数）
- 物流：本就取自 `print_jobs`

**补打接口**（`print-jobs.label-command.js` / `print-jobs.controller.js`）

- 空盒 → 400 `PRINT_BARCODE_NOT_UNIQUE`（提示到塑料盒页重复打印）
- 无打印记录 → 400 `PRINT_BARCODE_NO_PRINT_RECORD`
- 无可用打印机 → `queued:false` + 说明「已记录本次补打，请先绑定打印机后再补打」

**页面**

- `OrderDetailSections`：打印记录标签只保留 `sale-return`、`wave`；**收货订单不再显示打印记录**
- 销售订单详情：**不显示**条码打印（销售是出货侧）
- 塑料盒页：新增「打印条码」（重复打印，非补打）
- PDA 收货 / 退货收货回执：无打印机时提示「收货已记录并留有打印记录；请先配置标签打印机，
  再到『打印记录』页补打」
- 打印记录页：状态筛选项移除已不可能命中的「未生成打印任务」；类目说明改为「打印记录与补打」

**顺带修掉的既有缺陷**：出库**计数**查询里最新任务子查询别名写成 `j`，状态条件却按 `pj` 拼——
给「出库条码」加任何状态筛选都会报 `Unknown column 'pj.status'`。已统一为 `pj`。

## 验证

本地临时 MySQL（`mysql:8.0`，colima-flowcube）新建独立测试库 `flowcube_print_test`，
跑完整迁移（242 个文件）后执行 `npm run smoke:print-queue`：**13 passed, 0 failed**。
新增/更新覆盖：

- 补打中心=唯一码的打印记录：空盒不进；散货/库存条码要有记录才进
- 补打接口只接受有打印记录的对象（空盒另有 `PRINT_BARCODE_NOT_UNIQUE`）
- 可复用空盒不进打印记录，但在「塑料盒」功能里可重复打印
- **没有可用打印机时也留打印记录，对象因此可被找到**
- 出库箱贴同样只列有打印记录的对象（含状态筛选别名回归）
- 无面单绑定 / 无同仓打印机时仍然**不回退**到别的打印机（改为断言 `printerId=null` + `unprintable`）

另有：后端 `eslint src/` 无错误、前端 `tsc --noEmit` 通过、`eslint` 0 error、
`build` / `build:pda` 通过、`receive.test.tsx` 3/3。临时容器与临时文件已清理。

## 未做

- 真机打印未复测（本次改的是记录范围、无打印机时的记录、以及页面可见性）。
- 后端 `POST /api/inbound-tasks/:id/reprint`（整单/明细/条码补打）**没有任何前端调用**：
  按「补打只在打印记录页」的规则，它已不属于 UI 入口。保留未删（避免擅自弃用接口），
  后续要不要下线由用户决定。

## 自审发现并已修复（同一批次）

1. **打印失败通知指错地方**：`INBOUND_PRINT_FAILED` 原本跳到
   `/inbound-tasks/:id?focus=print-batches`，而收货详情已不再展示打印记录、也没有补打入口。
   改为落 `打印记录页 + inboundTaskId 过滤`（`/settings/barcode-print-query?category=inbound&status=failed&inboundTaskId=…`）。
2. **打包控制器把「只留记录」当成功**：`POST /packages/:id/print-label` 在无打印机时返回
   `queued:true / 已加入打印队列` 且拿 `printerCode=null` 去算派发提示。现在返回
   `queued:false` + 「已记录本次打印，请先绑定打印机再到打印记录页补打」，PDA 打包页也补了对应提示。
3. **`packDone` 的派发提示**同样会对无打印机记录算出「客户端未绑定」，已跳过该判断。
4. **幂等键误标**：`recordUnprintableJob` 在幂等键命中、返回的是**已存在的真实任务**时，
   也会被加上 `unprintable`，会让调用方把一次真实打印报成「没打印机」。现在只有确实是
   本次落下的无打印机记录（`printerId=null` + 失败 + `no printer available`）才标记。

### 自审核过、确认不是问题

- 幂等唯一键 `uk_print_jobs_idem_scope_live` 含生成列 `idem_scope_live_guard`，`status=3` 时为
  NULL——**同键多条失败记录不会被唯一键拒绝**，重复入队不会 409。
- 领取（claim-client）与失联回收都 `INNER JOIN printers`，`printer_id` 为 NULL 的行**永远不会被
  任何客户端领取**，物理打印路径不受影响。
- `focus=print-batches` 深链：正则 `/[?&]focus=print(?:&|$)/` 不会命中它，会落到「作业进度」，
  不会出现空面板。
- 打印记录页列表、单据进度、通知统计对 `printers` 都是 `LEFT JOIN`，`printer_id` 为空不会丢行。

### 记录未改（供决策）

- 「N 条打印任务失败，建议补打」统计所有 `status=3`，含货架/库位/商品这类不进记录页的标签失败，
  数字可能大于记录页可见行数（既有口径，本次未动）。
- 塑料盒「打印条码」用 `INVENTORY_VIEW`（与库位标签同口径），而货架标签用专门的
  `RACK_PRINT_LABEL`、记录页补打用 `PRINT_JOB_REPRINT`——权限口径不完全一致。
