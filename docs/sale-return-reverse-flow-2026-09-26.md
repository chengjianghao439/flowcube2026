# 销售退货单「返货出库」流程设计（任务 1 · 第二期）

> 2026-09-26 一致性审查 · 任务 1。业务方已拍板：退货单取消时，已入库的货**退回给客户**，
> 且**另起一张独立的退货返货出库单**（不新建销售单）。本文件为动手前的设计，实施随本文件一起留在工作区。
> 全部改动未提交、未推送、未部署。

## 〇 实施后订正（2026-09-26 落地后回填，**先读这一节**）

本文件是**动手前的设计**，其中三处与最终实现相反。原文保留（见下文各处的「订正」块），此处集中列出，
避免维护者照设计稿去理解现有代码：

| 设计稿写的 | 实际实现 | 依据 |
|---|---|---|
| 返货走**与销售出库同一套**界面：拣货 → **复核 → 打包** → 出库 | 返货**跳过复核与打包**，拣货完成直接进入待出库 | `warehouse-tasks.pick.js` `readyToShipWithinTransaction`：`isReturnOut` 时目标状态直接是 `WT_STATUS.SHIPPING`，只在销售出库(`sale_out`)才进 `SORTING`；§三/§六相应订正 |
| 任务出现在**既有 PDA 出库任务池**，扫物流箱码出库 | 返货**没有包裹与物流箱码**，PDA 出库页**扫不到**它们；另建独立「待出库」列表（`GET /warehouse-tasks/return-out-pending`）由仓库点着出库 | 前端 `api/warehouse-tasks.ts:101-102` 的注释与 `ReturnOutPendingTask` 类型；`pda/ship.tsx` 的返货待出库 tab |
| 重复点「取消」→ **409** 并指向既有任务单号 | **幂等**：不报错，直接返回既有返货出库单号（`alreadyRequested: true`） | `returns-sale.service.js` `enterSaleReturnReverse` 开头按 `task_type='sale_return_out' AND return_id=? AND status NOT IN (已出库,已取消)` 查既有单并原样返回 |

另外两处落地时的形态变化：

- **新增了关联列**（设计稿说「不新增能力」，实际为返货明细行级关联加了迁移）：
  `262_warehouse_task_item_sale_return_link.sql`。返货出库要按 `sale_return_items` 行取退货单价，
  仅靠已有的 `warehouse_tasks.return_id` 落不到行。
- **PDA 拣货推荐对返货特殊处理**：返货建单时把原批次容器整批预锁给本任务，若沿用默认口径，
  推荐列表会把「同商品别的批」也推出来（点了必被返货白名单 409），而真正该拣的原批次因带锁定标记
  被前端禁用。现按 `taskType` 只展示原单预锁容器，且本任务预锁容器**可点可扫**
  （`warehouse-tasks.pick.js` `onlyLockedByTask`）。**此项已改代码，PDA 真机验证仍是缺口**（见 §七）。

**验证边界**（不要把设计稿当验收证据）：本文件不含测试结论。已跑通的自动化证据在
`tests/sale-return-cancel-guard.smoke.test.js`（取消 + 反向引导 + 会计零变化）、
`tests/warehouse-ops.smoke.test.js` 与 `frontend/src/api/warehouse-tasks.return-out-paging.test.ts`
（返货待出库分页）。**PDA 真机（扫码、点推荐、加载更多）尚未验证；浏览器端返货卡片已于
2026-09-27 实测通过**（见 §七 实施后回填表下方的订正）。

## 一、先说结论：会计上一分钱都不动，而且必须不动

任务卡当时写的是「把退货时冲减的应收加回去」。**核查后不成立——本场景的应收从未被冲减，
所以"加回"与"再冲减"两个方向都是错账；本实现两者都不做。**
依据（均可复核）：

1. 能取消的退货单只有状态 **1/2**：`backend/src/constants/documentStatusRules.js:117-125`
   `saleReturn.cancel: { from: [1, 2], to: 4 }`。状态 3（已执行）**不允许取消**。
2. 应收冲减只发生在退货任务**全部上架完成**的那一刻——`return-tasks.service.js:341-358`
   `tryFinishReturnTaskPutaway` 判定待上架量归零 → 任务 4→5，并调 `syncSaleReturnCompleted`
   （`returns-sale.service.js:453-505`）把 `payment_records.total_amount` 减掉
   `SUM((checked_qty − rejected_qty) × unit_price)`（`returns.helpers.js:47`）。
3. 退货凭证的取数条件是 **`sr.status = 3`**：`accounting/voucher-engine.js:354`
   `WHERE sr.status = 3 AND sr.deleted_at IS NULL`（同处生成「借 6001 冲收入 / 贷 1122 冲应收 /
   借 1405 退货入库 / 贷 6401 冲回成本」）。

⇒ **部分上架**（本次要处理的真实场景）时退货单仍是状态 2，所以：应收**没冲减过**、
退货凭证**没生成过**、库存商品（1405）账上**没增加过**。此时把货退回客户，
正确做法是**只动物理库存**：不碰 `payment_records`、不碰 6001/6401、不生成任何凭证。
账实因此回到一致（实物进来了又出去，账上从未动过）。

> **两个方向都是错账，本实现两个都不做**（应收保持未冲减的全额 10000，正是最终正确值）：
> · 照任务卡原文**「恢复 / 加回应收」**（+2000）→ 12000：货退给客户了还把应收加上去，
>   客户被**多收**一次钱、6001 收入虚增；
> · 若有人把它理解成**再「冲减」一次**（−2000，照抄 `adjustPaymentRecordForReturn`）→ 8000：
>   客户被**少收**一次钱、收入虚减。
> **故本设计明确两个都不做，并用测试把它钉住**
> （断言全程 `payment_records` 与凭证表零变化，见 §七）。

将来若放开「状态 3 可取消」，才需要给返货补一笔反向凭证（届时退货已入账：收入/应收已冲、
1405 已增、6401 已冲回）。本设计预留判定位置，不实现。

## 二、单据形态：复用 `warehouse_tasks`，不新建表

`backend/src/database/084_*.sql` 已给 `warehouse_tasks` 加了
`task_type`（`sale_out` / `purchase_return`）与 `return_id`，采购退货出库已经完整走这条路
（`warehouse-tasks.command.js:97-130` `createForPurchaseReturn` → PDA 拣货 → **出库** →
`returns-purchase.service.js:389-444` `syncPurchaseReturnShipped` 回写退货单）。
> 订正（2026-09-26 实施后）：原文写「→ 复核 → 出库」。采购退货与返货一样**不经复核/打包**，
> 只有销售出库(`sale_out`)才走分拣/复核/打包。

因此新增 `task_type = 'sale_return_out'`，`return_id = sale_returns.id`，其余完全复用：

- 出库任务自带 PDA 扫码（`pda/ship.tsx`）、逐容器锁定扣减、`FOR UPDATE` 并发锁、
  `operation_requests` 幂等键（`ship.js:94-100`，action `warehouse.ship.<taskId>`）、
  限仓与设备仓校验、任务事件留痕。
- 新表要重做以上全部，且与 PDA 出库页脱节——不划算。

**一行关键约定：`sale_order_id` 必须为 NULL。** 出库服务里应收重算与销售单校验都由
`sale_order_id`/`saleRow` 驱动（`ship.js:105-168`），为 NULL 时天然不进入；
但**不依赖这个隐式安全**：`ship.js` 增加显式分支与守卫，`task_type='sale_return_out'` 时
既不调 `syncShippedByWarehouseTaskWithinTransaction`，也不做信用复查与销售单状态校验，
并在 `sale_order_id` 非空时直接 500（程序错误，不静默）。

## 三、流程与状态机

### 取消退货单（`returns-sale.service.js` `cancelSR`）

| 场景 | 第一期止血时的行为（**历史**，已被本设计取代） | 本设计 |
|---|---|---|
| 无 ACTIVE 容器 | 直接取消（作废未上架容器 + 作废任务） | **不变**（实现即如此） |
| 有 ACTIVE 容器 | 409「反向处理流程尚未上线」 | 进入 **待反向处理**，返回 202 + 返货出库单号 |

> 表头订正（2026-09-26 实施后）：左列原写「现在的行为（第一期止血）」，容易被读成"现在仍返回
> 409"。实际实现里**有 ACTIVE 容器时不再 409**，改由 `enterSaleReturnReverse` 生成返货出库单并
> 返回 202；那行 409 文案属**第一期止血时的历史行为**，现在取不到这条路径。

进入待反向处理的一个事务里做四件事：

1. 该退货单下所有 `return_tasks` → 状态 **REVERSING(7)**（`RT_STATUS_REVERSING` 与边
   `4→7`、`7→6` 早已预留且从未被写入，`return-tasks.service.js:15-16,37,41`）；
2. 未上架的容器（`PENDING_QA=5` / `PENDING_PUTAWAY=4`）**立即作废**（沿用
   `return-tasks.service.js:569-573` 的既有 SQL，它本来就不含 ACTIVE）——它们不可能再上架；
3. 建一张 `sale_return_out` 任务，并把该退货单下 **ACTIVE 容器**的
   `inventory_containers.locked_by_task_id` 指向它（精确容器，见 §四）；
4. 写事件（沿用 `return_order_events`）。

退货单本身**保持状态 2**：它要到返货出库真正完成才取消。页面据此展示「待返货出库」。
再次点击取消时：**不报错**，幂等返回既有返货出库单号（不重复建单）。
> 订正（2026-09-26 实施后）：原文这里写「已有 REVERSING 任务 → **返回 409** 并指向既有任务单号」。
> 实际实现**不返回 409**：`returns-sale.service.js` `enterSaleReturnReverse` 开头先按
> `task_type='sale_return_out' AND return_id=? AND status NOT IN (已出库, 已取消)` 查既有单，
> 命中就原样返回 `{ pendingReverse: true, taskId, taskNo, alreadyRequested: true }`。
> 不做成错误是因为这不是异常：一张退货单只允许一张进行中的返货单，重复点击属幂等重放。

### 返货出库（仓库从 PDA「待出库」列表发起）

拣货 → **直接待出库**（**跳过复核与打包**）。差异在两处：
> 订正（2026-09-26 实施后）：原文这里写「拣货 → 复核 → 出库，与销售出库同一套界面与校验」。
> 实际 `warehouse-tasks.pick.js` `readyToShipWithinTransaction` 把采购退货与返货统一当 `isReturnOut`：
> 拣货完成的目标状态直接是 `WT_STATUS.SHIPPING`，不进分拣/复核/打包；且返货**没有包裹与物流箱码**，
> PDA 出库页（扫箱码出库那条路）**扫不到**它，只能从独立列表 `GET /warehouse-tasks/return-out-pending`
> 点着出库。入口订正见 §六。

- `moveStock(..., lockedByTaskId = 任务 id)`：`inventoryEngine.js:174-178`
  → `deductFromTaskLockedContainers` **只从本任务锁定的容器扣减**（精确容器，不 FIFO）；
- **不调**销售应收重算；**不写** `payment_records`。改为调用
  `syncSaleReturnReversedWithinTransaction(conn, returnId, { taskId, taskNo })`
  （新增，形态对齐 `syncPurchaseReturnShipped`）。

### 真正取消（出库完成回调内，同一事务）

- 该退货单下不再有任何 ACTIVE 容器与未出库任务 → 相关 `return_tasks` **7 → 6（已取消）**；
- `sale_returns` **2 → 4（已取消）**（`compareAndSetStatus`），写事件；
- 退货单进入状态 4 后，凭证引擎的 `WHERE sr.status = 3` 永远取不到它 ⇒ 不会生成退货凭证 ⇒
  不会出现「货退了、凭证又冒出来」的滞后账。

> 一个退货单可能有多张 `return_tasks`（分批/分仓）。**只有全部返货任务出库完成**才真正取消，
> 否则停在 REVERSING 等待。这与「部分上架」的中间态天然兼容：未上架部分当场作废，
> 已入库部分走返货，不会互相阻塞。

## 四、精确容器：靠任务锁定，不新增能力

`inventory_containers.locked_by_task_id` 已存在，销售出库一直用它（占库时写入）。
本设计在**建返货任务时**把这批 ACTIVE 容器的 `locked_by_task_id` 指向新任务，
出库扣减即精确命中这批容器，不会 FIFO 发走仓库里别的批次。
容器来源为 `source_ref_type='sale_return'` 且 `source_ref_id = return_tasks.id`
（注意：**不是退货单 id**，需 JOIN `return_tasks` 落到本退货单）。

## 五、并发与中间态（实测项）

| 竞态 | 处理 |
|---|---|
| 同一退货单并发两次取消 | 取消事务内先 `FOR UPDATE` 锁 `sale_returns` 行；第二次看到 REVERSING 任务即返回既有单号 |
| 取消与「正在上架」并发 | 上架对该容器行与任务行加锁；取消只挑 `status=ACTIVE` 的容器，且在同一事务内锁定后再建任务 |
| 取消与返货出库并发 | 出库已锁任务行；取消建任务前先查该退货单是否已有未完成返货任务 |
| 重复出库 | `warehouse.ship.<taskId>` 幂等键回放（既有机制） |
| 加锁顺序 | 两侧统一为「退货单/任务行 → 容器行（按 container id 升序）」，与 `ship.js:139-142` 按 productId 排序的做法一致，避免死锁 |

## 六、入口引导

- **浏览器**（退货详情页 `frontend/src/pages/returns/sale/form/index.tsx` 的 `DetailView`）：状态 2
  且存在返货任务时，在基础信息卡片上方渲染 `ReverseTaskCard`——显示「返货出库（把已入库的货退回
  客户）」「返货出库单：<单号>」、三态进度条（拣货中 → 待出库 → 已出库，`REVERSE_PROGRESS_STEPS`）、
  待退回客户库存条码清单（**条码 · 商品名 · 件数**，没有库位列），以及「请仓库按 PDA 出库流程把
  这批货退回客户」的说明。
  > 订正（2026-09-26 实施后）：原文写的路径是 `frontend/src/pages/returns/index.tsx`（那是退货**列表**
  > 页，只有取消入口，不渲染详情卡片）；容器清单字段原文写「条码 / 库位 / 数量」，实际组件渲染的是
  > 「条码 / 商品名 / 件数」，不含库位；原文还说「取消按钮文案随状态改为『取消并生成返货出库单』」，
  > 实际**按钮文案不变**，改为在 `ConfirmDialog` 的 description 里说明「已有合格品入库则不会直接取消，
  > 而是生成一张返货出库单，等仓库把这批货退回客户后自动取消」。
  > **接线状态**：卡片已挂进渲染树（`{ret.reverseTask && <ReverseTaskCard .../>}`），`tsc -b` 与 eslint
  > 均通过；**并已于 2026-09-27 完成浏览器实测**（见 §七 订正块的实测记录），不再是「已接线、未实测」。
- **PDA**：**不走既有出库任务池**。返货没有包裹与物流箱码，出库页那条「扫箱码出库」的路扫不到它，
  故新增独立入口：`GET /warehouse-tasks/return-out-pending`
  （按 `task_type IN ('purchase_return','sale_return_out')` + `status=待出库` 查，
  限用户仓库范围并**按绑定设备仓过滤**，权限 `WAREHOUSE_TASK_SHIP`），
  由 `pda/ship.tsx` 的「待出库」tab 展示、点着发起出库。
> 订正（2026-09-26 实施后）：原文写「任务出现在既有出库任务池；**必须处理**列表查询里
> `COALESCE(wt.task_type,'sale_out')='sale_out'` 的过滤（`warehouse-tasks.sorting-bin.js:18` 等处），
> 否则仓库看不到任务；过滤改为『销售出库 + 退货返货出库』；复核/装箱/打印闭合校验对返货任务保留」。
> 实际**没有改那条过滤**——返货任务**不进分拣池**（分拣池查询只认 `sale_out`），走的是上面新增的独立列表；
> **复核/装箱/打印对返货任务一律跳过**（见 §三 订正），不存在「对返货保留」。
- **权限**：取消仍用 `RETURN_ORDER_CANCEL`；出库用 `WAREHOUSE_TASK_SHIP` 系;
  只读进度复用 `RETURN_ORDER_VIEW`。**不新增权限码**（免去"新增码不写迁移"的老问题）。

## 七、测试清单（含业务方点名的实测项）

1. **会计零变化**（最重要）：部分上架 → 取消 → 返货出库全程，
   `payment_records`（该销售单的 type=2 行）金额/`confirm_status` 不变；
   凭证表无新增/无修改；库存商品账不出现单边变动。
2. **部分上架中间态**：断言取消当时退货单仍为 2、应收未冲减、无退货凭证（前置条件本身要被断言，
   否则第 1 条的"零变化"可能是空对空）。
3. **精确容器**：仓库里放同商品的另一批库存，断言出库扣掉的是退货的那批容器（非 FIFO 其它批次）。
4. **未上架容器**：取消后 `PENDING_QA/PENDING_PUTAWAY` 容器立即作废，不出现在返货清单。
5. **完成闭环**：出库后任务 7→6、退货单 2→4、事件齐；再查 `GET /returns/:id` 状态为已取消。
6. **并发**：并发两次取消（只建一张任务）、取消与出库并发、重复出库幂等。
7. **回归**：无 ACTIVE 容器时取消的老路径不变（第一期行为）；销售出库、采购退货出库不受影响
   （`payable-void-guard`、`sale-return-cancel-guard`、`warehouse-ops`、`idempotency-request-key` 等）。

**实施后回填（2026-09-26）— 上面是设计时的清单，下面是实际跑过的自动化证据**：

| 清单项 | 实际证据 | 状态 |
|---|---|---|
| 1 会计零变化 / 2 部分上架中间态 / 5 完成闭环 / 6 并发取消 | `tests/sale-return-cancel-guard.smoke.test.js`（已改为返货出库闭环断言） | 已跑通 |
| 返货待出库**分页**（设计稿未预见：原实现写死 50 条） | `frontend/src/api/warehouse-tasks.return-out-paging.test.ts`（拦截真实请求参数，先红后绿） | 已跑通 |
| 6 并发 / 7 回归 | `tests/finance-period-lock-order.smoke.test.js`（期间闸门×结账锁序）、`payable-void-guard` 等 | 部分跑通，**未跑完整串行回归** |

**尚未验证（缺口，不要当成已验收）**：PDA 真机上的扫码出库、点推荐批次、列表「加载更多」翻页、
设备仓过滤的实际观感。这些只有单元/接口级证据。

> 订正（2026-09-26，本轮）：原文这里把「浏览器端退货详情页的返货单展示」也整个归入未验证。
> 现状分开说：**代码已接线**（`ReverseTaskCard` 本来只定义未挂载、且引用的
> `SaleReturnReverseTask` 类型从未导入，`tsc -b` 直接报 TS2304；本轮补上导入并挂进
> `DetailView` 渲染树），当时**仍未做浏览器实测**。

**浏览器实测（2026-09-27，已完成）** —— 不再是缺口：

- **方法**：在独立、可弃的验收库 `flowcube_ui_accept_test` 里，借 `tests/sale-return-cancel-guard.smoke.test.js`
  的同一套建单步骤（销售出库 → 退货收货质检 → 只上架第 1 包 → 取消），造出「退货单已确认(2) +
  返货出库单拣货中」的中间态后**暂停清理**；浏览器（前端 :5173 连该库后端 :3000，账号 `smoke_admin`）
  打开退货详情页 `#/returns/sale/1` 真实查看。
- **观感与数据逐项核对**：卡片渲染在基础信息卡片**上方**；标题「返货出库（把已入库的货退回客户）」；
  「返货出库单：**WT20260927002**」与库内 `warehouse_tasks.task_no` 一致；状态徽标「拣货中」；
  三态进度条停在第一步（● 拣货中 → ○ 待出库 → ○ 已出库）；条码清单「**I000002 · 返货卡片验收商品 · 5 件**」
  与库内 `locked_by_task_id` 预锁容器逐字段一致（该任务预锁 1 个 ACTIVE 容器，未上架那包已是 VOID(3)）。
- **入口引导**：取消按钮的 `ConfirmDialog` 文案确为「…若该退货单已有合格品入库，系统不会直接取消，
  而是生成一张返货出库单，等仓库把这批货退回客户后自动取消。」（按钮文案确如订正所述**不变**）。
- **幂等（重复点取消）**：再点一次并确认，前端提示「该退货单已有进行中的返货出库单 **WT20260927002**，
  无需重复申请」；随后只读核对库内 `task_type='sale_return_out'` 仍**只有 1 张**、退货单仍为 2，
  未重复建单、未产生第二条预锁。
- **收尾**：验收完成后该库 **DROP + 重建 + 重跑 262 个迁移**，复核回到干净迁移态
  （142 张表、业务表全 0、`printer_bindings` 0 行、种子 `acct_accounts` 31 / `sys_roles` 12 恢复）；
  临时建单脚本留在 `/tmp`（不在仓库内），未改动共享库与 `flowcube_dev8`。
- **仍未验**：PDA 真机/浏览器 PDA 路由（`#/pda/ship` 的「待出库」tab 在浏览器里被 PDA 连接门弹回，
  需 PDA 环境），以及点推荐批次、列表「加载更多」翻页、设备仓过滤的实际观感。

## 八、残余风险与未决

1. **历史数据**：本次不写脚本修历史（任务卡明确禁止）。已存在的「部分上架后取消」脏数据
   （货已入库、单据已取消）不在本流程覆盖内，需人工盘点。
2. ~~**返货单据的打印/装箱**：本设计沿用销售出库的复核/装箱要求；若业务上返货不需要装箱，
   需另行确认后调整（当前按"要真发货给客户"从严）。~~
   **订正（2026-09-26 实施后，本项已关闭）**：实施时按业务实际改为**跳过复核与打包**——
   返货是退回给客户/供应商，不是销售发货，装箱打印那套没有对应物
   （`warehouse-tasks.pick.js` 的 `isReturnOut` 分支直接进 `WT_STATUS.SHIPPING`）。
   **不再列为待确认项。**
3. **退货单状态 3 的取消**：仍不允许。若将来放开，返货需补反向凭证（收入/应收/成本/库存），
   本设计未实现。
4. **凭证落期**：返货不产生凭证，故不涉及跨期问题；但若将来补反向凭证，需与任务 7 的
   跨期补录机制对齐。
