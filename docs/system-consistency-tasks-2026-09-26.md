# 系统一致性审查 · 可执行任务卡（2026-09-26）

> 配套报告：`docs/system-consistency-audit-2026-09-26.md`
> **本文件不是生产部署授权。** 实施与合入遵守项目现有约定；上线需另获明确授权。

---

## 给实施者（DeepSeek）的总则——请先读完再动手

1. **必须先复核当前代码，不要盲信本文件的判断。**
   本文件的行号与结论来自 2026-09-26 的静态阅读，
   期间若有改动，以你现在看到的代码为准。**若发现描述与代码不符，先报告差异，不要按描述硬改。**
2. 本文件写作时的仓库基线：`main` @ `b818a08`，工作区干净。
3. **涉及数据库的测试必须用独立测试库**（`NODE_ENV=test` + 回环显式 `DB_*` +
   `flowcube_<用途>_test` 库名），凭据在 `~/.config/flowcube/operations20260912-test.env`
   （`set -a; source …; set +a`）。**绝不允许连生产库。**
4. **不得写入生产测试数据、不得执行生产迁移、不得清理生产数据。**
5. 每个任务独立提交，提交前 `git status --short --branch` 确认改动范围，
   **不要 `git add .`**。
6. 若任务的修复方式涉及业务规则选择，任务卡里已标明；**未经确认不要自行选一种实现**。

---

## 排期总览（2026-09-26：四项业务决策已全部拍板）

| 顺序 | 任务 | 业务方向 |
|---|---|---|
| 立即做 ① | 任务 1：销售退货单取消 → 新增反向引导 | **退回给客户**（已落地两期：第一期止血 409 → 第二期改为生成独立返货出库单） |
| 立即做 ② | 任务 2：已付款的采购收货不可撤回 + 修正"已付清"误判 | **拒绝撤回** |
| 立即做 ③ | 任务 7：跨期补录 | **允许，但必须人工审批留痕** |
| 顺手做 | 任务 4、5（幂等键、守卫正则） | 成本极低，可随任务 1 一起提交 |
| 先核实 | 任务 6：printer-bindings 仓库范围 | 已定：公司级绑定仅超管可设 |
| 已完成 | 任务 3：运费与手工应付未进总账 | 原为"触发条件待办"；已实施并通过 `payable-posting` 验证（见下方状态表） |

**四项业务决策已全部拍板，实施者可据此动手，无需再等确认。**
唯一仍需业务方补答的是"生产上的历史跨期数据如何处理"（不阻塞任务 7 开工）。

---

## 实施状态总览（2026-09-26 续 · 业务方授权"按需处理，开始全部修复"后回填）

| 任务 | 状态 | 与任务卡原方案的差异 / 证据 |
|---|---|---|
| 1 退货单取消反向引导 | **已实施（两期）** | 第一期止血 409 已被第二期取代：有已入库容器时不再 409，而是**生成独立的退货返货出库单**由仓库出库后才真正取消；`sale-return-cancel-guard`（已改为返货闭环断言）**33/0**（2026-09-27 在独占库 `flowcube_return_cancel_test` 复跑。原版隐式依赖共享库 `printer_bindings` 的历史行——出库链路要「仓库 + `package_label`」绑定，共享库恰好有、独立库没有，会卡在 `PRINT_BINDING_MISSING`；现已在套件内**自备夹具**（自建 `package_label`/`container_label`/`rack_label` 三条、收尾按本轮 INSERT 的 `id` 精确删——不用 `warehouse_id+print_type` 条件删，避免并发替换时误删他人行），空库复跑 33/0 且库内绑定零残留）、`audit-return-putaway` 9/0（**本轮未复跑**）、返货待出库分页 `warehouse-tasks.return-out-paging.test.ts`。**浏览器返货卡片已于 2026-09-27 实测通过**（在独立可弃库 `flowcube_ui_accept_test` 借同一套建单步骤造出「退货单已确认(2) + 返货出库单拣货中」的中间态 → 退货详情页 `#/returns/sale/1` 实看：卡片位于基础信息上方、单号 `WT20260927002`、三态进度停在第一步、条码清单与库内预锁容器逐字段一致；再点取消得「已有进行中的返货出库单 …无需重复申请」且库内仍只有 1 张返货单；验收后该库已 DROP 重建为干净迁移态）。**PDA 真机未验证** |
| 2 已付款收货不可撤回 + 修正"已付清" | **已实施** | 守卫改为**只拦 `paid_amount > 0`**，报错消息改指向**采购退货单**（任务卡预设单层守卫，实际按两层实施）；`payable-void-guard` 21/0 |
| 3 运费/手工应付进总账 | **已实施且已验证**（**订正原"未做"**） | 非单据应付已接入凭证主流程：`voucher-engine.js:524` 在 `generateVouchers` 里 `...await buildUnbilledPayable(conn)`，按 `is_freight` 分派 `FREIGHT_SETTLE` / `MANUAL_PAYABLE`；迁移 `259_payment_debit_account.sql` 加 `payment_records.debit_account_code`（NULL=历史未分类，**引擎跳过不猜科目**）；手工录入走 `payments.service.js` `createManual`（`assertDebitAccount` 拦不存在/停用/汇总/2202 本身），运费侧 `logistics.freight.js` 写 `6601`；测试 `tests/payable-posting.smoke.test.js` 覆盖 A–D |
| 4 幂等请求键（手动出库 / 退款执行） | **已实施** | 全部在**前端**（`api/inventory.ts`、`api/refund.ts`、`hooks/*`），后端零改动，与任务卡一致 |
| 5 守卫正则支持别名 Router | **已实施** | 正则由 `router.` 放宽为任意 Router 变量名；放宽后扫到 **63 个路由文件、294 条写路由**（2026-09-27 复跑实测，原记 62/289），`route-permission-contract` PASS |
| 6 printer-bindings 仓库范围 | **已实施**（方案变更） | 任务卡当时是"核实后再定"。业务方拍板"公司级绑定仅超管可设"；实现为**仓库范围校验**（`assertBoundWarehouseInScope`），**未新增权限码**；新增测试 `printer-binding-scope` 16/0 |
| 7 跨期补录 | **已实施（后端三层 + 凭证生成闭环）** | 默认拒绝 409 + `finance.period.backfill` 特权补录 + 留痕表（迁移 258/260/261）+ 凭证引擎不再静默跳过；**补录凭证的落期已确定并端到端验证**：落**执行审批当天所属期间**（`voucherDateOverride = beijingTodayYmd()`，经 `finance_account_transactions.voucher_date_override` 透传到 `acct_vouchers.voucher_date`），资金流水的 `happened_at` **保持业务日期不变**；`finance-period-guard` 29/0、`finance-backfill-approval` 147/0（均 2026-09-27 复跑实测，原记 28/0 与 137/0；§F 正例按 `source_id` 精确定位对账 + §F2 缺映射反例与恢复重试） |

**四处必须知道的偏离与边界**（实施者/维护者请先读）：

1. **新增权限码不写迁移**。`sys_role_permissions(role_id, permission)` 是纯字符串关联表，
   无独立 permissions 表，且已有"不 seed、由产品手动开放"的先例（`PAYMENT_CONFIRM`）。
   故 `finance.period.backfill` 只加常量，**不写迁移**；迁移 258 只建留痕表。
2. **任务 7 的"放行就必须真的记账"**：业务写入与凭证生成**分两段事务，但紧紧相接**——
   业务事务提交后**立即**调 `settleVouchersFor`：跑 `generatePeriodVouchers`（全期间重算），
   再**逐笔核对**本申请产生的每条资金流水（有**有效**凭证、期间=补录当期、借贷各自等于该笔流水
   金额且分录 ≥2 条）。核对通过才置 `voucher_generated_at`；任一条不过就把原因写回
   `voucher_generate_error`、停在**待生成**，由审批页「重新生成凭证」（`regenerateVoucher`，
   同样走生成+核对）与定时 `retryPendingVoucherGeneration` 重试，**不静默**。
   两段不能合成一个事务的原因：凭证生成是独立的全量重算，读的是已落库的流水与单据；
   塞进业务事务里读不到自己未提交的写入，会把**刚补好的凭证判成缺失**
   （`finance-backfills.service.js` `execute` 注释）。
   另：**若补录当期（审批当天所属期间）本身也已结账**，`assertFinancePeriodOpen` 会在**业务事务内**
   （已持账套锁 + 期间行锁）调 `assertBackfillPostingPeriodOpen(..., { lockForUpdate: true })` 复核，
   抛 **409 `FINANCE_BACKFILL_POSTING_PERIOD_CLOSED`**——**业务分文不写**、补录单停在「已批准 · 待执行」，
   不是"钱先动了、凭证再补不上"。`resolvePostingPeriod` 另有一道不加锁的预检，二者是「预检 + 事务内复核」两道。
   **证据强度：端到端**——`tests/finance-backfill-approval.smoke.test.js` **§O** 已补上这条反例：
   申请后、批准前把**真实的当期行**临时置为已结账（连原值快照，finally 还原；原本不存在则删本轮
   新建），批准 → 409 `FINANCE_BACKFILL_POSTING_PERIOD_CLOSED`、停在「已批准 · 待执行」、
   分录/资金流水/账款零变化。两条分支（当期行原本存在 / 不存在）各实跑一次，套件 147 passed / 0 failed。
   ~~此前标注的"该错误码在 `tests/` 中零引用，无专门反例回归"~~ 已作废。
   报告 §5 第 3 位与该条已就地修正，见报告 §8.3。
3. **任务 1 第二期的会计口径**：全程**不动会计**。可取消的退货单只有状态 1/2，此时应收
   **从未冲减**、退货凭证**从未生成**，所以返货**不"恢复应收"**（加回＝客户被**多收**一次钱），
   **也不"再冲减"**（＝客户被**少收**一次钱）——**两个方向都不做**，应收保持未冲减的全额。
   报告 §3.2.1 的旧主张已就地订正。
4. **提交状态**：业务方 2026-09-26 明确要求**全部先不提交**，改动留在工作区。

---


---

## 任务 1（最高优先）：销售退货单"部分上架后被取消"导致库存已入库、应收不冲减

### 背景与已确认事实

销售退货的流程是：退货单确认(状态2) → 生成 `return_tasks` → PDA 收货 → 质检 → 上架
（容器转 ACTIVE 并计入库存）→ 待上架量归零 → 退货单推进到状态 3（已执行），
**同时**才调用 `syncSaleReturnCompleted` 冲减应收。

问题在于「部分明细已上架、部分还没有」的**中间态**：退货单仍是状态 2，
而状态 2 是允许取消的。此时取消会造成库存已增加、应收不冲减。

已确认的代码事实（请复核）：

- `backend/src/constants/documentStatusRules.js:117-125`
  `saleReturn.cancel: { from: [1, 2], to: 4 }`
- `backend/src/modules/return-tasks/return-tasks.service.js:344-354`
  `tryFinishReturnTaskPutaway` 用
  `SUM(checked_qty - rejected_qty - putaway_qty) > 0` 提前返回，
  故中间态退货单不会推进到 3。
- `backend/src/modules/returns/returns-sale.service.js:369-395` `cancelSR`
- `backend/src/modules/return-tasks/return-tasks.service.js:548-577` `cancel`，
  其中 567-571 行只作废未上架容器：
  ```sql
  UPDATE inventory_containers SET status = 3
  WHERE source_ref_type = 'sale_return' AND source_ref_id = ?
    AND status IN (PENDING_QA, PENDING_PUTAWAY)
  ```
- `backend/src/modules/returns/returns-sale.service.js:423-448` `syncSaleReturnCompleted`
  只在 `return-tasks.service.js:353` 被调用。

### 需要保留的业务规则（不要改）

- 质检不合格部分留在 REJECTED 容器、不退客户（业务决策 2026-07-28）。
- 应收冲减口径：`(checked_qty - rejected_qty) × sri.unit_price`，
  必须与 `sale.service` 的 `recomputeSaleReceivable` 口径一致。
- 退货任务取消时作废 PENDING_QA / PENDING_PUTAWAY 容器的既有行为（567-571 行）保留。

### 修复方向（**业务方已拍板：新增反向引导流程**）

> **业务方决定（2026-09-26，经澄清）**：「如果中途取消，需要和销售拣货取消一样**增加反向引导**」。
>
> **澄清经过**：第一轮答复是"引导拣货员反向操作"，据此曾写成"拒绝取消 + 提示先做反向出库"。
> 业务方随后指出 **"反向出库目前没有入口"**——该判断**经查证精确成立**（见下）。
> 因此"提示去做出库"是**无效指引**，必须把引导流程**真正做出来**。

**⚠ 先读这条：为什么不能"指向现有入口"**

业务方说的"没有入口"，查证后比表面更彻底——系统里能减少库存的 4 类入口，
**只有 1 类能指定"就是这批退货货"，而它的语义是卖给客户**：

| 入口 | 后端路径 | 能否指定"这批退货货" |
|---|---|---|
| 手动出库 | `POST /api/inventory/outbound` → `adjustContainerStock(-qty)` | **不能**，按商品+仓库 **FIFO** 扣 |
| 报废/处置 | `disposal.service.js:427` → 同样 `adjustContainerStock(-qty)` | **不能**，同样 FIFO，且语义是报废 |
| 盘点盘亏 | `stockcheck.service.js:511-558` | **不能**，改的是数量 |
| 销售出库拣货 | `warehouse-tasks.ship.js:144` ← `scan-logs.service.js:194` | **能**（按条码），但语义是卖给客户 |

> **好消息（避免误判）**：退货容器**没有被锁死**。
> `deductFromContainers`（`containerEngine.js:260-343`）的条件只有
> 商品/仓库/`status=ACTIVE`/未删除/未被任务锁定，**不筛 `source_ref_type`**——
> 退货已入库的货能正常参与拣货、出库、盘点。

**参考的销售侧模式**（`warehouse-tasks.command.js:178-229` + `warehouse-tasks.cancel-return.js`）：
已拣出未归位的容器不做批量解锁，而是设 `cancel_requested_at` 进入「拣货退回中」，
事件里带 `containersToReturn`（含区/巷道/货架/层/位坐标），
PDA 逐容器扫码确认归位，**全部归位后才真正完成取消**；
重复取消返回 409「任务已在拣货退回中，请等待逆向归还完成」。

**但退货侧不能照搬这套机制**（关键差异，实施前请自行复核）：

- 销售侧的归还依赖 `inventory_containers.locked_by_task_id`——货已离开货架、
  在拣货车/料箱里、**位置未知**，所以必须扫码确认放哪儿。
  归还动作本身（`scan-logs.service.js:466-471`）**只清锁、写回 `location_id`，
  不改数量、不改 `status`**——因为货只是"放回原位"。
- 退货已上架的容器（`return-tasks.service.js:504-509` 的 `putaway`）
  是 `status=1`(ACTIVE) + **有 `location_id`** + **无 `locked_by_task_id`**——
  货**已经在货位上、位置已知**，没有"归还"这个动作可做。
- `return-tasks.service.js:567-571` 的取消只能作废 `PENDING_QA(5)`/`PENDING_PUTAWAY(4)`，
  **明确不含 `ACTIVE(1)`**；该文件也**没有任何反向出库/下架函数**
  （函数清单：assertPdaWarehouse / genTaskNo / isValidTransition / findPdaTasks / findById /
  create / submitWithinTransaction / submit / receive / allocateQaContainers /
  fmtSqlDate / tryFinishReturnTaskPutaway / check / putaway / cancel /
  fmt / fmtItem / findPutawayTask / findPutawayContainer / findPutawayLocation）。

**因此"反向"的真正难点不是搬货，是定性质**——货已实实在在进库了，
必须先回答：**这批已入库的货，取消时要变成什么？**
四种可能，系统现状各不相同：

| 业务含义 | 对应动作 | 现状 |
|---|---|---|
| 退回给客户 | 一次真实的出库发货 | **无入口** |
| 货留下、只取消这笔退货（转普通库存） | 解绑退货单 + 不冲减应收 | 无入口；**与当前实际效果最接近** |
| 货留下、作为报废或其它处置 | 报废/处置单 | **有入口**，但 FIFO，指不到这批 |
| 货作废、不计库存（实物另行处理） | 容器置 `VOID(3)` + 同步库存 | **无入口** |

**✅ 业务方已拍板（2026-09-26）：选定「退回给客户」。**
即取消退货单时，已入库的这批货要**真的发回给客户**。

**这是四选里最重的，且落地必须做两件事，缺一不可：**

**① 把货发回客户——且不能复用原销售单。**
客户能退货，说明原销售单早已是**已出库(4)**，而 4 是终态
（`backend/src/constants/saleOrderStatus.js:52-55`，`SALE_STATUS_TERMINAL`）；
出库路径本身也会拦（`warehouse-tasks.ship.js:120-122`
→ `"关联销售单 {order_no} 已完成出库，请勿重复操作"`）。
→ **必须另起一张单**（新建销售单，或新设计一条"退货返货出库"）。

**② 把退货时冲减的应收加回去——否则等于白送。**（**历史方案，前提有误；见下方订正块**）
退货入库完成时 `syncSaleReturnCompleted`（`returns-sale.service.js:445-455`）
已把客户应收**冲减**（`returns.helpers.js:47`：`newTotal = currentTotal − amount`），
而当前 `cancelSR`（`returns-sale.service.js:357-417`）**完全不碰 `payment_records`**。
代入：买 10000、退 2000，退货入库后应收变 8000；现在取消退货、把货发回客户，
客户理应继续付这 2000。**只发货不恢复应收 = 货送了、钱也不收，比什么都不做还亏**
（现状至少货还压在自己仓库里）。
恢复可借出库路径自带的应收重算（`warehouse-tasks.ship.js:162-168`
`syncShippedByWarehouseTaskWithinTransaction`），
但须确认口径能吃回退货时冲减的那一笔
（`(checked_qty − rejected_qty) × unit_price`，见 `returns-sale.service.js:438-444`），
并同样把 `confirm_status` 打回**待确认(0)**（既有口径见 `returns.helpers.js:59-60`）。

> **实施后订正（2026-09-26 落地回填，先读这段再看下方分期待办）**：
> 两期都已完成，且第二期的方案与原文有实质差异，以设计文档
> `docs/sale-return-reverse-flow-2026-09-26.md` 为准：
> - **第一期止血已被第二期取代**：有 ACTIVE 容器时**不再返回 409**，改为生成一张独立的
>   `sale_return_out` 返货出库单，仓库出库完成后退货单才真正取消（中间态对用户可见）。
> - **岔口已选"独立返货出库流程"**，**不新建销售单**（复用 `warehouse_tasks`，
>   新增 `task_type='sale_return_out'`）。
> - **会计全程不动，且"加回"与"冲减"两个方向都不做**。原文第 2 条的前提是错的：
>   它假设"退货入库完成时 `syncSaleReturnCompleted` 已把应收冲减"，但可取消的退货单只有状态 1/2，
>   **根本没走到状态 3**，`syncSaleReturnCompleted` 从未被调用——应收**一直是未冲减的全额 10000**；
>   退货凭证也从未生成（凭证引擎取数条件是 `sr.status = 3`）。所以原文"退货入库后应收变 8000"
>   的代入不成立，也不存在"货送了、钱也不收"的窟窿（客户本应继续欠全款）。
>   由此**两个方向都是错的**：
>   · **再"加回"一次**（+2000）→ 12000，**多收客户 2000**、6001 收入虚增；
>   · **再"冲减"一次**（−2000，照抄 `adjustPaymentRecordForReturn`）→ 8000，**少收客户 2000**、收入虚减。
>   **本实现两个都不做**，应收保持未冲减的全额（账实自洽）。

> **⚠ 第二期动手前，实施方需先出方案，不要直接写代码。**（已落地，方案见上）
> 设计岔口：退回客户的这次发货，是**新建一张销售单**，
> 还是走一条**独立的"退货返货"出库流程**？这决定界面、权限与对账口径。

**分期建议（业务方需确认是否采纳）**：

**第一期（小、可立即做，且必须先做）——止血**（历史方案，实现已被第二期取代）
1. `cancelSR`（`returns-sale.service.js`）内、状态置 4 之前，
   检查该退货单是否存在 `status = ACTIVE` 且 `source_ref_type='sale_return'` 的容器。
2. 若有 → 返回 409。提示语**不得指向不存在的入口**，如实说明
   （例如 `"该退货单已有 N 件合格品入库，直接取消会使这批货与单据脱钩。反向处理流程尚未上线，请先联系仓库/管理员"`）。
3. 事件文案修正：现有 `"未执行退货入库"` 在该场景下不成立，须改为与事实一致的表述。
4. 价值：**把"静默产生的错误状态"变成"看得见的阻断"**，不是最终答案。

**第二期（大）——完整反向引导流程**，参照销售侧形态：
1. 取消退货单且有 ACTIVE 容器时 → **不直接取消**，进入"待反向处理"
   （对应销售侧 `cancel_requested_at`）。
2. 给出待办清单：这批退货的每个容器（条码 / 库位 / 数量）。
3. 员工按**已定的处理方式**逐个确认（**已拍板：退回给客户**，两个动作见上）。
4. 全部处理完 → 真正取消。

> **成本提示**：第二期需要新增"按条码精确处置容器"的能力 + 一个新状态 + 一个引导界面，
> 规模参照销售侧的 `warehouse-tasks.cancel-return.js` + PDA 扫码流程，**不是小改动**。
> ~~又因为"退回给客户"还要**另起一张单发货 + 恢复应收**，实际比销售侧那套更重。~~
> **订正**：实际复用既有 `warehouse_tasks` + PDA 出库（不新建单），并**恢复应收这件事根本不做**，
> 故成本低于当时的估计。
> **不要把第二期塞进第一期一起提交**——先止血，再建流程。

### 修改边界与非目标

- **只改**退货取消路径（`returns-sale.service.js` 的 `cancelSR`）。
- **不要**改正向的 `syncSaleReturnCompleted` 口径。
- **不要**顺手重构 `return-tasks` 的其他部分。
- **不要**写脚本修复历史数据。

### 复现用例与回归测试

**现成起点**：`tests/repro-20260926-return-cancel.js` 已把完整真实链路与 6 条断言写好
（销售出库 10 件 → 建退货单 → 收货分 2 箱 → 质检全合格 → **只上架第 1 箱 5 件**
→ 在中间态取消），**直接改造成正式测试即可**。该脚本已实测确认的现况：

| 观测点 | 实测 | 期望（修复后） |
|---|---|---|
| 取消请求 | HTTP 200 被接受 | 选项 A：409 被拒 |
| 库存 | 95.00 → 95.00（保留） | 与应收口径一致 |
| 应收 | 150.00 → 150.00（**未冲减**） | 选项 B：按已入库量冲减 |
| ACTIVE 容器 | 挂在已取消单上 | 追溯链不断裂 |
| 事件文案 | 「未执行退货入库」 | 与实际一致 |

在独立测试库上新增测试（可放 `tests/`，命名与现有风格一致）：

1. 建销售单 → 发货 → 建销售退货单 → 确认 → 任务收货质检后**只上架部分明细**
   （使待上架量 > 0，退货单仍为状态 2）→ 取消退货单。
2. 断言：
   - 选项 A：返回 409，退货单仍为状态 2，库存与应收均未变。
   - 选项 B：退货单置 4，库存保留，**应收按已入库合格量被冲减**。
3. 反向用例：退货单**完全未上架**时取消，仍应成功（不能把正常取消一起堵掉）。
4. 反向用例：退货单已完成（状态 3）时取消，仍应被拒（现有规则不变）。
5. 断言：无论选哪个方案，取消后**不得存在 `source_ref_id` 指向已取消退货单的
   ACTIVE 容器**（要么被对称处理，要么取消被拒）。

### 通过/失败标准

- 新增测试全绿；`npm run test:agents-md-guard`、`test:stock-cache-write`、
  `test:route-permission-contract` 保持 PASS。
- 中间态取消后，**库存与应收的关系有明确且可解释的结果**，且事件文案与实际一致
  （现有文案 `"未执行退货入库"` 在该场景下不成立，需一并修正）。

### 数据库 / 部署 / 回滚

- **不涉及表结构变更、不涉及迁移。**
- 纯后端逻辑改动，前端无需变更（错误消息走既有错误展示）。
- 回滚：单文件 revert 即可，无数据副作用。

---

## 任务 2：已登记付款的采购收货仍可被撤回，撤回后应付被抹成 0 并判为"已付清"

### 背景与已确认事实

撤回收货会触发应付全量重算。重算是 upsert，**保留 `paid_amount` 不变**，
但会按新的 `total_amount` 重算 `balance` 与 `status`。
撤回收货把 `total_amount` 重算为 0 时，`paid_amount` 原样留着：

- `backend/src/modules/inbound-tasks/inbound-tasks.settle.js:81-86`
  ```sql
  balance = GREATEST(0, VALUES(total_amount) - paid_amount),
  status  = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                 WHEN paid_amount > 0 THEN 2 ELSE 1 END
  ```
  代入 `paid_amount=5000, total_amount=0` → `balance=0`、`status=3`（已付清）。

- `backend/src/modules/inbound-tasks/inbound-tasks.void.js` 的守卫链（约 61/74/81/102 行）
  覆盖拣货锁定、调拨在途、单据被动过、销售预占，
  **没有任何 `paid_amount` / `confirm_status` 检查**
  （`grep -n paid_amount backend/src/modules/inbound-tasks/*.js` 只命中 `settle.js`）。

**行为复现（2026-09-26 续，`tests/repro-20260926-payable-void.js`，11/11 通过）**——
已用真实 HTTP 链路（含 PDA 会话头）在独立测试库证实，可直接复跑：

| 阶段 | 应付台账实测 |
|---|---|
| 上架自动结算后 | 总额 ¥5000.00 / 已付 ¥0.00 / 余额 ¥5000.00 / 待付款(1) / 财务确认 0 |
| 财务确认 + 全额付款后 | 总额 ¥5000.00 / 已付 ¥5000.00 / 余额 ¥0.00 / 已付清(3) / 财务确认 1 |
| **撤回收货后** | **总额 ¥0.00 / 已付 ¥5000.00 / 余额 ¥0.00 / 已付清(3) / 财务确认 0** |

撤回 HTTP 200 无拦截；`payment_entries` 付款明细不回滚（钱已出账，只有主记录被抹平）。

**两条初稿未涵盖、但实施时必须考虑的事实：**

- **【危害放大】** 撤回后按短装重收（实收 4 件 = 应付 ¥2000），已付仍 ¥5000，
  `balance` 仍算 0、状态仍"已付清"——**多付的 ¥3000 在账款上完全不可见**
  （实测 `total=2000 / paid=5000 / balance=0 / status=3`）。
- **【触发面远大于"已付款"】** 一张**从未付过一分钱**的收货单，撤回收货后应付记录
  同样变成 `总额 ¥0.00 / 余额 ¥0.00 / 状态 3(已付清)`。根因是
  `paid_amount >= VALUES(total_amount)` 在 `total_amount = 0` 时**恒真**。
  **这意味着只加"已付款才拒绝"的守卫是修不好的。**

> **【对初稿的重要更正】** 初稿的"`confirm_status` 不会因撤回而复位"**与代码不符**：
> `settle.js:82` 的 `CASE WHEN total_amount <> VALUES(total_amount) THEN 0` 会在金额变化时
> 把确认状态**重置为 0**（实测撤回后 1 → 0）。初稿"只加守卫、不改 settle.js"的边界
> 也**已被推翻**，见下方修正后的修复方向。

### 需要保留的业务规则

- 撤回时反冲容器、库存、`received_qty`/`putaway_qty`、应付重算的既有行为全部保留。
- 现有四类撤回守卫全部保留，本任务只**新增**一条。

### 修复方向（**分两层，缺一不可**）

**层 1 · 重算逻辑（纯数值 bug，必做，不依赖业务决策）**

`inbound-tasks.settle.js:85-86` 的 `status` 计算在 `total_amount = 0` 时恒判"已付清"。
应为"已付清"补上 `VALUES(total_amount) > 0` 的前置条件，例如：

```sql
status = CASE WHEN VALUES(total_amount) > 0 AND paid_amount >= VALUES(total_amount) THEN 3
              WHEN paid_amount > 0 THEN 2
              ELSE 1 END
```

**为什么必须做**：行为复现已证明，**未付款**的普通收货撤回收货也会把应付留成
`total=0 / status=3(已付清)`。层 2 的守卫拦不住这一条（它只看"有没有付过款"）。
**实施前请自行复核**：`total<=0` 时 `status` 到底应该是什么（1 待处理？还是另有语义），
以及是否有报表按 `status=3` 统计"已结清"而因此漏账。

> **⚠ 这段判式在系统里有 4 处拷贝**，本任务只要求改第 1 处，
> 但**请在提交说明里写明另外 3 处仍在**（避免下次以为是新问题）：
> `sale.service.js:371`（应收）、`logistics.freight.js:207`（运费应付）、
> `database/130_fix_sale_order_items_warehouse_after_adjust.sql:80`（历史补丁）。
> **应收侧 `sale.service.js:344-348` 另有 `total <= 0` 的处理分支，比应付侧严谨**——
> 修改第 1 处时可参照它，但**不要顺手改另外 3 处**（各自业务口径未定，超出本任务边界）。

**层 2 · 撤回守卫（业务闸门）—— 【业务方已拍板：拒绝撤回】**

> **业务方决定（2026-09-26）**：**拒绝撤回**，不做自动冲销。

在 `inbound-tasks.void.js` 的守卫链中新增一条（位置与现有守卫并列）：

- 若该收货单对应的应付记录 `paid_amount > 0` 或 `confirm_status > 0`
  → 抛 409，消息需给出下一步，例如
  `"该收货单已登记付款（已付 ¥X），请先在应付结算页冲销付款后再撤回收货"`。

提示语必须能让操作者知道**去哪里做什么**，不能只说"操作失败"
（这是业务方一贯强调的"可解释、可追溯"要求）。

> **不要**只做层 2。初稿曾写"只加守卫，不改 settle.js"——**该边界已被行为复现推翻**。

### 修改边界与非目标

- **改** `inbound-tasks.void.js`（守卫）**和** `inbound-tasks.settle.js`（`status` 计算）。
- **不要**改 upsert 的 `balance` 计算方式，也**不要**动 `total_amount` 的全量重算口径
  ——`balance = GREATEST(0, total - paid)` 本身没错，错的是 `status` 的恒真判断。
- **不要**自动冲销已有付款（那是层 2 的业务决策，不是本任务的默认行为）。
- **不要**处理历史已存在的异常应付数据。

### 复现用例与回归测试

**现成起点**：`tests/repro-20260926-payable-void.js` 已把三段场景的真实链路与 11 条断言
写好（建采购单 → 收货 → 上架自动结算 → 财务确认 → 登记付款 → 撤回；以及短装重收、
未付款撤回两个变体），**直接改造成正式测试即可，不必从零搭**。
注意：该脚本目前是"打印事实"的复现脚本，改造时把 `log.assert` 的期望值翻转成
**修复后应有的值**。

在独立测试库上应覆盖：

1. 采购单 → 收货 → 上架（自动结算生成应付）→ 财务确认 → 登记一笔付款 → 尝试撤回收货。
   断言（取决于层 2 口径）：返回 409 且收货未撤回、单据全部未变；
   或撤回成功且付款被对称冲销、账款不出现"付了钱却没有应付"的状态。
2. **未付款**时撤回收货仍应成功，**且撤回后应付记录的 `status` 不得是"已付清(3)"**
   （当前会被误标——这正是层 1 要修的）。
3. 边界：`paid_amount = 0` 但 `confirm_status > 0`（财务已确认未付）也应被拒。
4. 边界：`total_amount = 0` 且 `paid_amount = 0` 时，`status` 必须落到能表达
   "无应付/待处理"的值，不能是 3。

### 通过/失败标准

- 新增测试全绿；既有撤回相关测试不回归。
- 错误消息能让操作者知道下一步做什么，而不是只说"操作失败"。
- **撤回后重新查询 `payment_records`，任何组合下都不得出现
  「`total_amount = 0` 且 `status = 3(已付清)`」的记录。**

### 数据库 / 部署 / 回滚

- **不涉及表结构变更、不涉及迁移。**
- 若生产库已存在"已付款但应付为 0"的历史记录，
  **另开只读清点任务交业务方处理，不要在本任务里自动修**。
- 回滚：单文件 revert。

---

## 任务 3（**订正：已实施且已验证** · 原记"本轮未做 · 有条件待办"）：运费与手工应付未进入总账，且勾稽查询主动排除它们

> **订正（2026-09-26 落地回填）**：本任务**已经实施并通过验证**，原「未做/有条件待办」结论作废，
> 也不再需要等「快递自动下单排期确定」这个触发条件——实现方式不需要它：
> 非单据应付（`type=1 AND order_id IS NULL`）按其上已有的 `debit_account_code` 出账，
> **没有该列的历史数据一律跳过、不猜科目**。
> 证据：`voucher-engine.js` `generateVouchers` 里 `...await buildUnbilledPayable(conn)`（按 `is_freight`
> 分派 `SOURCE_TYPES.FREIGHT_SETTLE` / `MANUAL_PAYABLE`）；迁移 `259_payment_debit_account.sql` 加
> `payment_records.debit_account_code`；手工录入 `payments.service.js` `createManual` +
> `assertDebitAccount` 校验（拦不存在/停用/汇总/2202 本身）；运费结算 `logistics.freight.js` 写 `6601`；
> 测试 `tests/payable-posting.smoke.test.js` 覆盖录入闸门/销账红冲/差额只报未覆盖/历史未分类跳过。
>
> **下方"背景与已确认事实"是动手前的静态阅读结论，保留作为历史论证**——其中
> 「`SOURCE_TYPES` 没有运费应付」「勾稽主动排除」「没有运费应付/手工台账」等描述指的是
> **当时**的代码状态，现已不成立（`SOURCE_TYPES` 已含 `FREIGHT_SETTLE`、`MANUAL_PAYABLE`）。

### 背景与已确认事实

- `backend/src/constants/voucherSource.js` 的 `SOURCE_TYPES` 共 18 种，
  **没有运费应付、没有手工台账**；`ACCOUNT_MAPPING` 同样没有。
- `grep -iE "freight|logistics|运费|carrier" backend/src/modules/accounting/` → 零命中。
- `backend/src/modules/logistics/logistics.freight.js` 约 217 行直接
  `INSERT INTO payment_records (type=1, order_id=NULL)`，
  注释说明 `order_id` 必须为 NULL 以免与采购应付在 `UNIQUE(type, order_id)` 上冲突。
- `backend/src/modules/accounting/accounting.voucher.service.js:306/319`
  ```sql
  WHERE type=1 AND order_id IS NOT NULL   -- 应付
  WHERE type=2 AND order_id IS NOT NULL   -- 应收
  ```
  勾稽**主动排除** `order_id` 为 NULL 的台账（即运费与手工台账）。

### 前置确认（业务方已代查澄清，结论如下）

**业务方澄清（2026-09-26）：「运费对账是和快递自动下单绑定的。」**

**这句话的含义**：本功能是 06 电子面单功能包的尾端——
**不是死代码、不是孤儿功能，不要按"清理废弃功能"处理**。
但经代码核实，二者**只在数据层绑定，流程上不衔接**：

| 要点 | 事实 | 证据 |
|---|---|---|
| 自动下单时是否拿到运费 | **拿到了**，写进 `logistics_waybills.est_freight`（平台预估运费），前端可见 | `logistics.worker.js:113` |
| 这个预估运费会自动变成运费账单吗 | **不会**。`logistics_freight_bills` 唯一写入点只被手工录入接口调用 | `logistics.freight.js:112` |
| 运费账单怎么产生 | **只能逐单手工录**（承运商 + 快递单号 + 金额 + 账期），**无批量导入** | 全模块仅 4 条路由 `logistics.routes.js:42-45` |
| "绑定"体现在哪 | 仅**单号匹配**：录入的单号去运单表找 `freight_type`，决定是否计入应付 | `logistics.freight.js:97-104` |
| 是否设计如此 | **是**。文档明确"实重由快递员称重确认，不写入实际重量或运费账单" | `docs/direct-express-2026-09-06.md:56` |

**使用状态**：整条链的**头（自动下单）至今暂停、从未投产**——
最后记录 2026-09-09 仍是"已验收清单为空、自动下单仍暂停"、"当前没有顺丰运单"、
"德邦仍未配置"（`docs/direct-express-2026-09-06.md:176`、
`docs/carrier-production-setup-2026-09-08.md:14/36`），此后无启用记录。
既然生产没有运单，运费对账**没有可匹配对象**，大概率同样没在跑。

**业务方已答复（2026-09-26）**：

> ### 快递自动下单 ——「还没定 / 更远」

**因此本任务的排期**：

- **不挤当前修复窗口**，排在本轮立即修复项（任务 1、2、7）之后。
- **但"还没定"不等于"不启用"**——本任务挂上触发条件：
  **一旦自动下单的启用排期确定，本任务立即提为与它同批上线**，不得拖后。
  开闸即产生不进总账的应付，且逐月累积、事后不可逆。
- ~~本任务因此从"最高优先级待确认"降为**「有条件待办」**：
  保持在做，**不撤单、不按"死代码清理"处理**（它确实是 06 功能包的尾端）。~~
  **订正（2026-09-26）**：本任务已实施（见本节开头的订正块），上述"有条件待办"的排期结论作废。
  实际实现**不需要等自动下单排期**：非单据应付按其上的 `debit_account_code` 出账，
  自动下单将来接入时只需在写入 `payment_records` 时带上借方科目即可。

**实施注意**：不要当作"独立修总账"来做——需同步确认运费凭证方案
如何与自动下单的取号链路配合，避免自动下单上线时漏掉运费入账这一环。

**顺带发现（小，可随本任务一起改）**：运费账单列表的空状态文案写着
"暂无运费账单（点「录入账单」添加，**或对接平台回传**）"，
而"对接平台回传"这条路径**代码里不存在**（无任何导入接口）。
属于文案承诺了未实现的能力，应改掉或实现它。

### 修复方向（两部分，可分开提交）

**Part A — 勾稽口径诚实化（低风险，优先做）**
让 `accounting.voucher.service.js` 的勾稽查询**显式**区分
"已纳入总账的台账"与"未纳入总账的台账"，
在返回结构中增加一个字段（如 `excludedLedgers`）列出被排除的金额与来源，
使对账页能显示"另有 ¥X 运费/手工应付未纳入本口径"，**而不是默默显示平**。

**Part B — 运费接入凭证体系（较大，需业务确认后进行）**
1. 在 `voucherSource.js` 的 `SOURCE_TYPES` 增加运费应付来源类型。
2. 在 `ACCOUNT_MAPPING` 增加对应科目映射
   （费用科目与 2202 应付账款；**具体科目号需财务确认，不要自行选**）。
3. 在运费结算时生成凭证，保持 `assertBalanced` 借贷平衡。

### 修改边界与非目标

- **不要**改 `payment_records` 的 `UNIQUE(type, order_id)` 约束。
- **不要**动 `order_id = NULL` 这个既有约定（它是有意为之）。
- **不要**写脚本回填历史运费凭证——历史数据由财务人工处理。
- **不要**顺手改应收/应付的金额算法。

### 复现用例与回归测试

1. Part A：构造存在 `order_id IS NULL` 的应付台账，
   断言勾稽结果**报出该差异**（`excludedLedgers` 非空），而不是 `matched: true`。
2. Part B：在独立测试库上做一次运费结算，
   断言生成凭证、借贷平衡、费用科目与 2202 的金额正确。
3. 回归：采购结算的勾稽结果不受影响。

### 通过/失败标准

- Part A：勾稽在存在无凭证台账时**不再显示平**。
- Part B：运费结算产生平衡凭证；`npm run test:*` 相关守卫全绿。

### 数据库 / 部署 / 回滚

- Part A：无表结构变更。
- Part B：**可能需要迁移**新增来源类型（若来源类型存于枚举/配置表中）。
  若有迁移，必须提供回滚脚本，并说明对已有数据的影响为"无"。
- 部署顺序：先 Part A 后 Part B。
- 历史数据：单独清点，人工处理。

---

## 任务 4（顺手做，成本极低）：手动出库与退款执行补齐幂等请求键

### 背景与已确认事实

`backend/src/utils/operationRequest.js:45`：
```js
if (!key) return { enabled: false }   // 没有请求键 → 整套幂等直接放行
```
后端已实现幂等，但请求键必须由前端发送。

- 手动出库：`frontend/src/api/inventory.ts:12` `outboundApi` 无 key 参数；
  `frontend/src/hooks/useInventory.ts:17` `useOutbound` 无 `keyRef`。
  后端 `backend/src/modules/inventory/inventory.service.js:209-217` `changeStock`
  已接收 `requestKey`。
- 退款执行：`frontend/src/api/refund.ts:17` `executeRefundApi` 无 key；
  后端 `refund-orders.service.js` 用 `beginResourceOperationRequest`。

**重要**：手动出库的提交按钮已有 `disabled={isPending}`
（`frontend/src/pages/inventory/index.tsx:411`），双击路径被 UI 挡住。
本任务消除的是**超时后重新操作、多标签页并行、主动重试**这几条路径。

### 修复方向

照抄 `frontend/src/hooks/useSale.ts` 的既有模式：
用 `createRequestKey` 生成组件生命周期内稳定的 key，
在 `onSuccess` 后轮换；API 层接收可选的 `requestKey` 参数并写
`X-Request-Key` 头（参考 `frontend/src/api/sale.ts:8-9` 的 `withRequestKeyHeaders`）。

### 修改边界与非目标

- **只改前端**，后端零改动。
- 不要去改其它已经正确的入口。
- 不要引入新的请求库或拦截器机制。

### 复现用例与回归测试

1. 同一 key 重发出库请求 → 后端返回首次回执，**库存只扣一次**，
   流水只产生一条（这是后端既有行为，测试用于防回归）。
2. 出库成功后 key 轮换 → 下一次出库是新的业务操作，能正常执行。
3. 退款执行同理。

### 通过/失败标准

- 新增/补充的前端测试通过；出库与退款功能无行为回归。
- 若已有同类测试（如 `useSale` 的幂等测试），按同样风格补充。

### 数据库 / 部署 / 回滚

- 纯前端改动，无迁移。回滚为 revert。

---

## 任务 5（顺手做，成本极低）：权限守卫测试支持别名 Router

### 背景与已确认事实

`tests/route-permission-contract.test.js:73`：
```js
const re = /router\.(post|put|patch|delete)\s*\(/g
```
只扫描名为 `router` 的变量。而
`backend/src/modules/accounting/accounting.routes.js` 用 9 个别名 Router
（`accounts`/`vouchers`/`ledger`/`reports`/`invoices`/`companies`/`consolidation`/`tax`/`periods`，
行 23/56/84/89/96/122/134/140/149），这些文件中的写路由**完全不被扫描**。

当前这 19 条写路由**都挂了 `requirePermission`**，没有现实越权。
这是"守卫失守"，不是"已经出洞"。

### 修复方向

把正则扩展为匹配任意合法的 Router 变量名
（如 `/[A-Za-z_$][\w$]*\.(post|put|patch|delete)\s*\(/g`），
或改为按文件解析所有 `Router()` 实例的变量名。
**扩展后必须确认扫描到的写路由数量增加**，并确认新增扫描的路由都有权限中间件——
若发现漏挂的，**单独报告，不要顺手改权限**。

### 修改边界与非目标

- **只改测试文件**。
- 不要为了通过测试去改业务路由。

### 通过/失败标准

- 守卫扫描到的写路由数量明显增加（能从 19 条那个文件的量级上反映出来）。
- **必须做变异验证**：临时移除某条写路由的 `requirePermission`，
  确认守卫**报错**；验证后还原。（参见：本仓库已有 `test:stock-cache-write`
  与 `test:route-permission-contract` 的变异验证先例，两个守卫都能真的抓错。）

### 数据库 / 部署 / 回滚

- 纯测试改动，无迁移。

---

## 任务 6（**已实施 · 方案有变更**）：printer-bindings 缺仓库范围校验

> **实施结果（2026-09-26 续）**：事实成立，且已修复，但与本节原预设不同——
> 业务方拍板的是"**公司级绑定（`warehouse_id=0`）仅超管可设**"，
> 实现落在 **controller 的仓库范围校验**（`assertBoundWarehouseInScope`），
> **没有新增权限码**；`findAll` 对限仓用户返回"公司级 + 自己仓"（公司级必须保留，
> 否则 `defaultBindings` 为空、PDA 打印静默失效）。新增回归
> `tests/printer-binding-scope.smoke.test.js`（16 条断言，含变异验证）。
> 实施中还自查修掉一个把公司级 `0` 写成 `NULL` 的缺陷，详见报告 §8.4。

### 待核实事实

- `backend/src/modules/printer-bindings/printer-bindings.routes.js:38-40`
  的 `PUT /:type`、`DELETE /:type` 只挂 `requirePermission(PRINT_PRINTER_MANAGE)`。
- `printer-bindings.controller.js` 不读 `req.user.warehouseIds`。
- `printer-bindings.service.js` 的 `bind/unbind` 直接按传入 `warehouseId` 写/删。
- 读侧 `findAll` 返回全部仓库绑定。
- 姊妹模块 `printers.service.js` 有 `warehouseScope`。

### 要求

**先复核代码确认上述事实成立**，再决定是否修复。
若成立，修复方式对齐 `printers.service.js` 的 `warehouseScope` 做法。
**不要**把公司级单据（授信覆盖、财务账户、审批）也误加仓库范围校验——
那些是有意为之。

---

## 任务 7（**已实施：后端三层 + 凭证生成闭环 + 锁序回归** · 原记"前端入口待方案"）：会计期间结账后仍可跨期补录付款/退款，且凭证静默不生成

> **实施结果（2026-09-26 续）**：后端三层已全部落地，回归
> `tests/finance-period-guard.smoke.test.js` **29 条断言全绿**（含变异验证；2026-09-27 复跑实测，原记 28 条）：
> ① 默认拒绝 409 `FINANCE_PERIOD_CLOSED`；② `finance.period.backfill` 特权补录 +
> 留痕表 `finance_period_backfills`（迁移 258）；③ 凭证引擎两处静默 `continue` 改为逐条 `logger.warn`。
>
> **订正（2026-09-26 收尾回填）——原记的两处"必须知道"已各自有结论**：
> - **(a) 第 3 层不再只有代码审阅**：`tests/finance-backfill-approval.smoke.test.js` **147 条全绿**（2026-09-27 在独占库 `flowcube_bfappr_test` 复跑实测，原记 137 条；与业务方 Node 22 交叉证据一致），
>   §F 走真实「审批 → 生成 → 查 `acct_vouchers`」，按 `source_type='payment_out' + source_id=资金流水 id`
>   **精确定位本轮凭证**（避开同期间其它凭证），断言期间/摘要「（跨期补录）」/借贷平衡/两条分录科目；
>   §F2 用**独占库 + 可恢复夹具**软删预置科目制造"缺映射"，断言业务照动、凭证不生成、
>   失败原因留痕、停止在待生成、恢复后重试补出凭证，并用**全期间凭证指纹比对**正面验证
>   `generatePeriodVouchers` 的整体事务回滚不影响同期间其他凭证。
> - **(b) "凭证落哪一期"已定，不再未决**：落**执行审批当天所属期间**。
>   `assertFinancePeriodOpen` 的补录分支返回 `voucherDateOverride = beijingTodayYmd()`，
>   经 `finance_account_transactions.voucher_date_override` 透传到 `acct_vouchers.voucher_date`
>   （`voucher-engine.js` 用 `r.vdate_override || r.vdate`），`period` 由该日期推导；
>   资金流水的 `happened_at` **仍是业务日期不变**（银行对账依据它）。
>   即：前期差错在**当期**调整，而不是塞回已封存的期间。
> - **新增锁序回归**：`tests/finance-period-lock-order.smoke.test.js`（独占库，14/0）验证
>   「正常登记(共享锁) vs 结账(排他锁) 真实互斥」——登记持锁时结账必须等、结账持锁时登记必须等
>   且结账生效后登记被 409 拒。**反向验证**：把闸门改回排他锁，该套件 §1 精准报红
>   （`ER_LOCK_WAIT_TIMEOUT`，两笔登记在同一把排他锁上排队），其余 12 条不受影响。
> - **前端补录入口**：本轮**未接通**，仍按业务方选择另出方案（见报告 §8.3）。

### 背景与已确认事实

- `voucher-engine.js` 在业务日期落在**已结账期间**时有**两处**处理：
  - `:510-511` 主路径：**静默 `continue` 跳过**，不生成凭证；
  - `:516` 兜底：另一处。
  （`acct_periods.status = 2` 即「已结账」，见 `194_accounting_period_close.sql:4`）
- 而资金/账款侧（付款登记、退款执行、退货冲减）**没有任何期间校验**，
  照常写入 `payment_entries` / `payment_records` / `payment_receipts`。
- **结果：钱改了，账没记，界面不提示。**
- 对照证据：**同一文件**紧邻的 `:503-505` 对"缺少业务发生日期"**有逐条 `logger.warn`**，
  注释原文"不能退回静默 continue……必须计数 + 逐条告警，让漏记可被发现"
  （2026-09-18 审计修复）——**同一个"不能静默丢凭证"的原则只落实了一半**。

**影响面（测试库实测，⚠ 不代表生产）**：已结账期间 `202609` 有 **1094 笔**付款
（¥196,897.20）、464 笔收付款单（¥157,800.00），**这 1094 笔全部无对应凭证**。
报告 §3.1.2 末附三条**只读**查询，**可在生产库只读跑、不改任何数据**。

### 业务方已拍板（2026-09-26）

**「允许补录，但必须人工审批留痕」**——修复方式由此定死，**三层缺一不可**：

1. **默认拒绝**：资金/账款侧写入口（付款登记、退款执行、退货冲减）
   遇到业务日期落在已结账期间 → 返回 **409**，**不再默认放行**。
2. **特权通道 + 留痕**：另开一条"跨期补录"路径，需专门权限
   （建议新增 `finance.period.backfill`，命名风格对齐 `constants/permissions.js` 既有约定），
   写入时**必须**在事件/单据上留下**"跨期补录"**显式标记（谁 / 何时 / 哪张单）。
3. **放行就必须真的记账**：走审批放行后**凭证必须生成**——
   `voucher-engine.js:510-511` 不能再无条件静默 `continue`；
   同时把静默跳过改为**显式返回或逐条告警**（对齐 `:503-505` 的既有做法）。
   > 否则"允许补录"等于"允许钱账不符"，审批只是走个过场。

### 修改边界与非目标

- **不要**给已结账期间的历史数据写脚本补凭证（见下方"仍待定"）。
- **不要**改动 `acct_periods` 的结账 / 反结账逻辑本身。
- **不要**把期间校验加到与资金无关的模块上。
- 前端"跨期补录"入口如何呈现、审批走什么流，**先出方案再动手**。

### 复现用例与回归测试

必须覆盖三条断言（真实 HTTP 链路 + 测试库）：
1. 在已结账期间登记一笔付款 → **被拒绝（409）**，`payment_entries` 无新增。
2. 走特权通道补录同一笔 → 成功，且**凭证确实生成**、借贷平衡。
3. 事件/审计里能查到"跨期补录"标记（谁 / 何时 / 哪张单）。

### 通过/失败标准

- 默认路径拒绝；特权路径放行且凭证生成；留痕可查。
- `skippedClosed` 不再是唯一痕迹。
- **必须做变异验证**：临时去掉已结账期间的校验，确认测试**报错**；验证后还原。

### 数据库 / 部署 / 回滚

- 新权限是数据（`permissions` 表 + 角色绑定），新增权限需迁移；
  **先取迁移编号再动手**。
- 生产历史数据的处理**不在本任务范围**（见下）。

### 仍待业务方决定（不阻塞本任务开工）

生产上若也存在这类记录，**历史部分如何处理**——需要单独的人工核对方案，
**不要脚本自动补凭证**。可先用报告 §3.1.2 末的三条只读查询量出生产真实笔数再定。

---

## 附：不要做的事（负面清单）

- 不要用脚本回填/修复历史数据。
- 不要重构容器的少数直接写入点（`return-tasks.service.js` 退货质检拆分、
  `stockcheck.service.js` 盘点）——那是有意设计。
- 不要实现 `WT_ON_ENTER_ACTIONS`/`WT_ON_EXIT_ACTIONS` 表——它是显式标注的文档。
- 不要为金额尾差在全仓引入统一的高精度金额类型。
- 不要把 `refetchOnWindowFocus` 全局打开——会显著增加 PDA 端请求压力。
- 不要碰 `payment_records` 的 `UNIQUE(type, order_id)` 约束与 `order_id = NULL` 约定。
- 不要把本文件当作生产部署授权。
