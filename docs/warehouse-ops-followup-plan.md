# 采购/收货/销售/退货深度扫描 — 后续实施计划

> 背景：2026-07-18 对采购、收货、销售、退货相关模块做了一轮深度代码扫描。已发现的高优先级 bug（P0-1~P0-3）和一批中优先级健壮性问题已在同一轮会话内修复并验证完毕（详见当时的 git 提交记录，涉及 `inbound-tasks`、`purchase`、`sale`、`returns`、`picking-waves` 等模块）。同一轮还额外做了两个双方讨论后决定新增的功能：
>
> - **采购单「撤回确认」**（`POST /purchase/:id/withdraw-confirm`，2→1，仅在还没创建收货订单时允许）
> - **收货订单「撤回收货」**（`POST /inbound-tasks/:id/void-receipt`，含已上架/已结算状态，整单撤回并反冲库存与应付）
>
> 这两项**已经实现并验证完毕，不在本计划范围内**，本文档只覆盖讨论后**决定要做、但还没动手**的项，交给下一个会话执行。

## 实施前必读

- **前端类型检查务必用 `cd frontend && npx tsc --noEmit -p tsconfig.app.json`**，不要用 `-p tsconfig.json`（根 tsconfig 是空壳 `files:[]+references`，不带 `--build` 永远返回 0 错误，等于没检查——上一轮会话在这上面吃过一次真实的亏，一个 `useInvalidate()` 事件名拼写错误在运行时直接抛异常，被这条假阳性命令放过了）。
- 每完成一项，按 `CLAUDE.md` 里的分层约定（routes→controller→service→db）实现，涉及库存/金额的写操作要在事务里做，参考本轮新增的 `inbound-tasks.void.js` / `withdrawConfirm` 的写法风格。
- 涉及状态机变更的，统一走 `backend/src/constants/documentStatusRules.js` 或 `warehouseTaskStatus.js` 加规则，不要绕过 `assertStatusAction`/`assertWarehouseTaskAction` 直接写 SQL 改状态。
- 每项做完请实际跑一遍（backend 起 `backend-dev` + `frontend-dev`，登录 admin/admin123，走一遍真实流程），不要只看 TypeScript/ESLint 过了就算数。

---

## 已讨论决定「不做」的项（明确记录，避免被误当成遗漏）

### 销售单不支持部分发货

现状：`sale.service.js` 的 `ship()` 一次性把整单占库商品推给一个仓库任务，一张销售单只能对应一个仓库任务。若客户要求分批发货，现在只能手动拆单模拟，原单和拆分单之间没有关联记录。

**结论：不做**。改动面牵涉状态机（一单对多仓库任务）、报表口径、退货关联，风险和工作量明显高于本计划其余各项，不适合作为"顺手修"处理。如果未来有强业务需求，建议单独立项，从头设计"销售单-仓库任务"一对多关联模型，而不是在现有单据结构上打补丁。

---

## 待实施项

### 1. 销售退货质检补充「不合格数量」字段

**问题**：`return-tasks.service.js` 的 `check()` 函数（约第186-251行）只接收 `passedQty`（合格通过数量），没有 `rejectedQty` 的概念。质检发现的次品/破损商品，要么被当成合格收了，要么在系统里"消失"——`return_task_items.received_qty - checked_qty` 的差值永远无法被显式清零，导致：
- 任务的"全部质检完成"判定（第229-239行，`SUM(received_qty - checked_qty) <= 0` 才能推进到待上架）在有不合格品时永远无法满足，任务会卡在"待质检"状态出不去。
- 不合格品对应的容器（`inventory_containers`，`status = PENDING_QA(5)`）没有任何路径可以被显式标记为"已处理/待报废"，只能一直挂在 PENDING_QA 状态。

**涉及文件**：
- `backend/src/modules/return-tasks/return-tasks.service.js`：`check(conn, taskId, { productId, passedQty, requestKey, userId })`（约第186行起）
- `backend/src/modules/return-tasks/return-tasks.controller.js` / `return-tasks.routes.js`：check 对应的路由（`PUT /api/return-tasks/:id/check` 之类，需要在 routes 文件里确认具体路径和 Zod schema）
- 数据库：`return_task_items` 表（需要新增 `rejected_qty` 列，新迁移文件，编号接在现有最大迁移号之后，`backend/src/database/`）
- `inventory_containers` 表：不合格容器目前停留在 `status = 5 (PENDING_QA)`；需要决定给它们一个新的终态（新增一个 CONTAINER_STATUS，比如 `REJECTED = 6`，或者复用现有 `VOID = 3` 但需要能和"正常撤回"的 VOID 区分开，建议走前者，语义更清楚）。`containerEngine.js` 里已有 `splitContainer()` 函数（约第753行起）可以参考/复用，用于把一个批次容器里的一部分数量拆成单独一条记录再改状态，避免整批连坐。

**实现要点**：
1. `check()` 函数签名加 `rejectedQty` 参数，`passedQty + rejectedQty` 一起按 FIFO 分配到 `return_task_items.checked_qty`（此时 checked_qty 语义变为"已质检处理量"，不再等价于"已通过量"），额外用新列 `rejected_qty` 单独记录不合格量。
2. 容器处理：质检确认时，对该 `productId` 名下 `PENDING_QA` 的容器，按 `passedQty` 部分转 `PENDING_PUTAWAY(4)`（沿用现有逻辑），按 `rejectedQty` 部分转新增的 `REJECTED` 状态（如果一个容器同时跨越 passed/rejected 边界，需要用 `splitContainer()` 先拆分）。
3. "全部质检完成"判定改成 `SUM(received_qty - checked_qty) <= 0`（不用改，因为 checked_qty 语义已经涵盖 rejected），确认这条逻辑在语义变更后依然成立。
4. 前端：PDA 质检页面（找 `frontend/src/pages/pda/` 下退货质检相关页面，路由大概是 `/pda/sale-return/:id/check` 之类，需要确认具体文件名）加一个"不合格数量"输入框，和现有"合格数量"输入框并列。
5. ERP 端如果有退货任务详情页展示质检结果，需要同步展示 rejected_qty，并且要给出"不合格品去哪了"的可见性（哪怕只是列个"待报废容器"清单）。
6. 验证：模拟一次退货收货→质检（部分不合格）→确认任务能正常推进到待上架、正常商品数量对、不合格容器状态和数量对得上，且不会被后续正常上架流程误当成正常库存计入。

---

### 2. 打包环节支持「移出/调整箱内商品」

**问题**：`packages.service.js` 的 `addItem()`（约第123-233行）只支持往箱子里"加"商品，数据库层面 `package_items` 也没有 `status`/`deleted_at`，无法软删除单行。一旦扫错箱、多扫，现在**没有任何函数或接口能把某个商品从已装的箱子里移出**，也没有单箱作废的入口（唯一的作废函数 `cancelByTaskId` 是整个任务级联批量取消所有箱子，不是针对单个箱子）。前端 `frontend/src/pages/pda/pack.tsx` 的 `PackageCard`（约第116-172行）展示箱内商品也是纯只读，没有任何"移除"按钮。

**涉及文件**：
- `backend/src/modules/packages/packages.service.js`：需要新增 `removeItem(packageId, itemId, qty)` 或类似函数
- `backend/src/modules/packages/packages.controller.js` / `packages.routes.js`：需要新增对应路由，比如 `POST /api/packages/:id/remove-item` 或 `DELETE /api/packages/:id/items/:itemId`
- `frontend/src/pages/pda/pack.tsx`：`PackageCard` 组件（约第116-172行）需要加"移除该行"交互；`addMut`（约第300-313行）旁边加一个 `removeMut`
- `frontend/src/api/packages.ts`（需确认具体文件名）：新增对应 API 函数

**实现要点**：
1. **约束边界**：只允许对 `packages.status = 1（打包中）` 的箱子操作，`status = 2（已完成）` 之后禁止（`addItem` 已有这层判断，`removeItem` 要对齐）。任务一旦通过 `packDone` 推进到 SHIPPING 之后，`assertTaskPackagingClosure` 已经跑过，不应该再有任何函数能碰 `package_items`——`removeItem` 内部也要重新校验任务状态仍是 `PACKING`，不能只查箱子状态。
2. **数量处理**：移出数量 ≤ 该行当前 `qty` 时直接 `UPDATE ... SET qty = qty - ?`；等于时该行要不要整行删除（建议删除，避免留 qty=0 的空行污染打包明细）。
3. **和 `warehouse_task_items.checked_qty` 的联动**：`addItem` 里有"同任务同商品跨箱累计已装数量不能超过 `checked_qty`"这道闸门（约第164-176行），移出后这个累计值要能正确回落，重新装箱时不能被这道闸门误挡（即移出操作要和加箱操作共享同一套"当前已装总量"计算逻辑，不要各写一套）。
4. 是否需要"单箱作废"（而不只是"移出某一行"）也一并评估——如果整箱装错想重来，走"逐行移除"比较繁琐，可以考虑加一个"作废本箱"的操作（把箱子 status 置为一个新的"已作废"值，同任务下商品重新可装，不影响其它已完成箱子）。
5. 验证：模拟装箱→移出部分商品→确认可装数量正确回落→重新装箱→正常走完 `finishPackage`→`packDone`，全程数量和状态都对。

---

### 3. 分拣格（PUT wall）容量阈值告警

**问题**：`sorting_bins` 表（`backend/src/database/030_create_sorting_bins.sql`）只有二值状态机（1=空闲 2=占用），没有任何容量/件数字段。真正的分拣件数统计落在 `warehouse_task_items.sorted_qty`（`warehouse-tasks.service.js` 的 `sortTaskWithinTransaction`，约第567-701行），和 `sorting_bins` 表完全脱节——现有代码结构里"格子"和"格子里装了多少东西"是两条不相交的数据链路。前端 PDA 分拣页 `frontend/src/pages/pda/sort.tsx` 的格子总览区（约第219-248行）只显示"空闲N/占用N"，不展示任何件数信息。

**涉及文件**：
- `backend/src/database/`：新增迁移，给 `sorting_bins` 加 `capacity`（可空，NULL=不限）字段
- `backend/src/modules/sorting-bins/sorting-bins.service.js`：`assignToTask`/`releaseByTask`（约第202-224行）等函数所在文件，需要新增一个"查询/更新当前占用量"的辅助函数
- `backend/src/modules/warehouse-tasks/warehouse-tasks.service.js`：`sortTaskWithinTransaction`（约第567-701行）是实际写入分拣数量的地方，告警判断要挂在这里
- `frontend/src/pages/pda/sort.tsx`：`handleBinScan`（约第94-128行）分拣确认成功后的提示逻辑，以及格子总览区（约第219-248行）的展示

**实现要点**：
1. **容量口径**：由于件数统计实际落在 `warehouse_task_items.sorted_qty` 而不是 `sorting_bins` 表，"某个格子当前有多少东西"需要通过 `sorting_bins.current_task_id` 反查该任务下 `SUM(sorted_qty)` 来算，而不是在 `sorting_bins` 表上直接维护一个累加字段（避免两处数据源不一致）。
2. **告警时机**：在 `sortTaskWithinTransaction` 写入 `sorted_qty` 之后，如果该任务绑定了分拣格且格子配置了 `capacity`，计算当前总件数是否超过阈值，超过则在返回结果里带一个 `warning` 字段，不阻断流程（这是"提醒"不是"拦截"，符合仓库现场"先分拣完再腾格子"的实际操作习惯）。
3. **前端展示**：`sort.tsx` 的 `handleBinScan` 成功回调里，如果后端返回了 warning，用现有的 `warn()`（PDA 反馈提示，参考本轮 `receive.tsx` 里 `noPrinterCount` 的提示写法）弹一条"该格已接近/超过容量，请注意"；格子总览区可以选择性地给接近容量的格子加个视觉提示（不是本项必须，视时间决定）。
4. **容量配置入口**：需要一个地方能设置/编辑每个格子的 `capacity`，可以放在后台管理页 `frontend/src/pages/sorting-bins/index.tsx`（已存在）的编辑表单里加一个字段，不需要新页面。
5. 验证：给某个分拣格配置一个小容量阈值，实际分拣到超过阈值时确认 PDA 端能看到提醒但不影响正常分拣流程完成。

---

### 4. 代码结构拆分（工程债清理，非功能性）

两个文件按行数已经明显偏大，实测行数（2026-07-18）：

```
warehouse-tasks.service.js   1593 行
returns.service.js            895 行
```

对比：`inbound-tasks` 模块已经是按 `command/query/putaway/settle/void/status/helpers` 拆分的（本轮新增的 `inbound-tasks.void.js` 也延续了这个模式），改起来定位代码很快，可以作为拆分范式参考。

#### 4a. `returns.service.js` 拆分（优先做这个，边界清晰、风险低）

按"采购退货 / 销售退货"两条完全独立的业务线拆开：
- `returns-purchase.service.js`：`createPR / confirmPR / cancelPR / validatePurchaseReturnItems / loadPurchaseSourceOrderByNo / findAllPR / findByIdPR` 等（`fmtPR` 相关）
- `returns-sale.service.js`：`createSR / confirmSR / cancelSR / validateSaleReturnItems / loadSaleSourceOrderByNo / findAllSR / findByIdSR / syncSaleReturnCompleted` 等（`fmtSR` 相关）
- 两个文件共用的工具函数（`genNo`、`recordReturnEvent` 引用等）可以留一个 `returns.helpers.js`，或者各自保留一份（视重复量决定）
- `returns.controller.js`/`returns.routes.js` 可以保持不变，只改 `require` 指向，或者也一并按 PR/SR 拆分 controller（视改动量决定，非必须）
- **注意**：拆分过程中要小心 `returns.service.js` 内部 PR 和 SR 之间是否有交叉引用（目前印象中没有，但要实际 grep 确认一遍再动手），以及 `warehouse-tasks.service.js`/`return-tasks.service.js` 里通过 `require('../returns/returns.service')` 的懒加载引用（本轮新增的 `cancelPR`/`cancelSR` 级联取消逻辑就用了这个模式）需要同步改成指向新文件路径。

#### 4b. `warehouse-tasks.service.js` 拆分（工作量更大，且是几乎每个仓库任务动作都会碰的核心文件，改动风险更高，建议放在 4a 稳定之后再做）

按状态机阶段拆分，建议的切分方式（拆分前务必先通读一遍全文件，确认函数之间的依赖关系，不要凭函数名猜边界）：
- 拣货阶段（pick 相关）
- 分拣阶段（sort 相关，含本文档第3项要修改的 `sortTaskWithinTransaction`）
- 复核阶段（check 相关）
- 打包阶段（pack 相关，注意这部分主要逻辑其实在 `packages.service.js`，`warehouse-tasks.service.js` 里可能只有 `packDoneWithinTransaction` 之类的收口函数）
- 出库阶段（ship 相关）
- 取消/查询等共享逻辑（`cancel`、`findAll`、`findById`、各种 `assertXxxClosure` 校验函数）

拆分时要特别注意：这个文件里大量函数是"WithinTransaction"版本 + 外层包一层事务的公开版本（比如 `sortTaskWithinTransaction` + `sortTask`），拆分时两者要放在一起不要拆散，且要确认没有其它模块通过懒加载 `require('../warehouse-tasks/warehouse-tasks.service')` 直接依赖某个具体函数（本轮 `picking-waves.service.js` 的波次取消联动就直接引用了 `warehouse-tasks.service.js` 的 `cancel`，拆分后这个引用路径要跟着改）。

---

## 建议实施顺序

1. 第1项（质检不合格数量）——独立性强，不依赖其它三项
2. 第2项（打包移出商品）——独立性强
3. 第3项（分拣格容量告警）——独立性强，且相对最轻量
4. 第4a项（returns.service.js 拆分）——纯重构，建议在功能项做完、确认没有并行冲突后单独一个提交做
5. 第4b项（warehouse-tasks.service.js 拆分）——工作量最大、风险最高，放最后，且建议单独开一次会话专门做，不要和功能开发混在一起提交
