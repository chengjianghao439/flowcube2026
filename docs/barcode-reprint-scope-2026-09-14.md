# 打印记录页口径：只记唯一码（2026-09-14）

## 用户规则（最终）

> 所有的唯一的条码都需要记录在打印记录页面中，例如库存条码和从塑料盒出的散货条码，
> 以及物流条码，因为这个条码是唯一性的。如果因为丢失什么的，可以从打印记录中补打。
> 不是唯一性的条码不要记录，例如塑料盒条码、货架条码等等，在对应的功能中可以重复打印。

即：**打印记录页 = 唯一对象的打印记录**。「唯一」= 这条码指向一个唯一对象（某批货、某个箱子、
某张面单），丢了能按记录补打；可复用的固定码（同一个塑料盒反复装不同货、同一个货架）不属于此列。

## 各类条码的归属

| 条码 | 对象/来源 | 是否进打印记录页 | 重复打印入口 |
|---|---|---|---|
| 库存条码 `I…/CNT…` | 收货、拆分、调拨、盘点等产生的容器 | 进（需有打印记录） | 打印记录页「重新打印」；收货单详情「整单/明细/条码补打」 |
| 拆分散货 `B…`（`container_split` / `sale_order_adjustment_return`） | 从塑料盒里拆出来的散货，每次新建 | 进（需有打印记录） | 同上 |
| 可复用空盒 `B…`（`plastic_box_create`） | 塑料盒自身的固定码 | **不进** | **本次新增**：塑料盒页「打印条码」 |
| 出库箱贴 `L…/BOX…` | 装箱产生的箱子 | 进（需有打印记录） | 打印记录页「重新打印」 |
| 物流面单/标签 | 运单 | 进 | 打印记录页「重新打印」 |
| 货架 `R…/RCK…`、库位 `LOC…` | 仓库固定设施 | **不进**（本来就不在取数范围） | 货架页 / 库位页各自的标签打印 |

区分两个 `B` 码靠 `source_ref_type`：空盒是 `plastic_box_create`，拆分散货是
`container_split` / `sale_order_adjustment_return`。两者都是 `container_type=2`，只看前缀区分不了。

## 实现

**打印记录页范围（`backend/src/modules/print-jobs/print-jobs.query.js`）**

- 入库：`AND pj.id IS NOT NULL AND IFNULL(c.source_ref_type,'') <> 'plastic_box_create'`（列表与计数）
- 出库：`AND pj.id IS NOT NULL`（列表与计数）
- 物流：本就取自 `print_jobs`

**补打接口（`print-jobs.label-command.js`）**

- 空盒 → 400 `PRINT_BARCODE_NOT_UNIQUE`（提示到塑料盒页重复打印）
- 无打印记录 → 400 `PRINT_BARCODE_NO_PRINT_RECORD`
- 出库箱贴同样要求有打印记录

**顺带修掉的既有缺陷**：出库**计数**查询里最新任务子查询别名写成 `j`，状态条件却按 `pj` 拼——
给「出库条码」加任何状态筛选都会报 `Unknown column 'pj.status'`。已统一为 `pj`，回归里加了带
状态筛选的出库查询。

**塑料盒重复打印（新增）**

- `POST /api/plastic-boxes/:id/print-label`（`INVENTORY_VIEW`，与库位标签同口径：只读业务）
- 塑料盒页行操作新增「打印条码」；无可用打印机时提示先绑定打印机

**订单页面的打印进度（客服看进度用）**

- 后端 `document-progress.js` 已经为 `inbound`、`sale-return`、`sale`、`wave` 产出 `print` 分组
- 前端 `OrderDetailSections` 已露出 inbound / sale-return / wave；**本次补上销售订单详情**
  的「条码打印」标签（`DocumentActivityPanel type="sale" view="print"`），客服可据此看每个箱贴
  打到哪一步
- `purchase-return` 后端没有 `print` 分组（`packageSections` 被显式跳过），因此没有该标签页

**文案**

- PDA 收货无打印机提示：指向**本单**的「查看打印 / 补打」
- 补打中心状态筛选项移除已不可能命中的「未生成任务」；三个类目说明改为「打印记录与补打」

## 验证

本地临时 MySQL（`mysql:8.0`，colima-flowcube）新建独立测试库 `flowcube_print_test`，
跑完整迁移（241 个文件）后执行 `npm run smoke:print-queue`：**12 passed, 0 failed**，
其中新增/更新五项覆盖：

- 补打中心=唯一码的打印记录：空盒不进；散货/库存条码要有记录才进
- 补打接口只接受有打印记录的对象（空盒另有 `PRINT_BARCODE_NOT_UNIQUE`）
- 可复用空盒不进打印记录，但在「塑料盒」功能里可重复打印
- 出库箱贴同样只列有打印记录的对象（含状态筛选别名回归）

另有：后端 `eslint src/` 无错误、前端 `tsc --noEmit` 通过、`eslint` 0 error、
`build` / `build:pda` 通过。临时容器与临时文件已清理。

## 仍然存在的缺口

**退货任务在「从未生成打印记录」时没有兜底入口。** 常规路径没问题：退货容器只要打过标签，
就在打印记录页「入库条码」里（列表只要求有打印记录，不要求属于收货单），可以直接重打。
但若退货收货时没有可用打印机（根本没有打印记录），则没有任何入口可补——
收货侧有订单详情的「整单/明细/条码补打」，退货侧还没有对应按钮。

建议后续给退货任务补一个对称入口（复用 `queueReturnLabels`），本次未做。

## 未做

- 真机打印未复测。
- 未把「无可用打印机」的容器改成先建任务后补打（需要 `print_jobs.printer_id` 允许为空，属迁移级改动）。
