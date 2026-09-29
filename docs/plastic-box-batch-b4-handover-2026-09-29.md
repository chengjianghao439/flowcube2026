# 批 B4 实施交接 · 2026-09-29

> 状态：**B4（取货码的取消 / 减量归还闭环）已本地实施，套件 5 项（+ 取货标签补打补充项 3 项）全绿，且已经独立审查接受；未发布。**本地提交状态以 Git 与最终交接为准（本批与 A/B1–B3 的成果按上下文合并为一条本地 checkpoint，见 §5）。
> **B1/B2、B3a、B3b 与 B4 均已独立审查接受。**
> 本批覆盖范围仅 **API / service**，**不代表 GUI、物理打印或实际出纸**。

## 1. 范围与结论

- **取消整份**与**减量归还**先走**真实业务 API 取证**，**只修证实的问题**；能不改的**不改**。
- 结论：**取消链本身无需改代码**（既有行为已正确）；**减量后补拣**与**取消后补打**两处**确有缺陷**，已按最小口径修复。

## 2. 取证与修复（逐条）

### 2.1 取消整份 150 —— **既有行为正确，未改代码**
真实链：`POST /sale/:id/cancel` → `GET /warehouse-tasks/:id/cancel-return-detail` → `POST /scan-logs/cancel-return`。
实测：新 `I(150)` 解锁并保持 ACTIVE、**货留在该 `I` 上不回盒**（盒余量不涨）、`inventory_stock` 与取消前一致、`inventory_logs` 留痕、任务转 `status=8`。

### 2.2 减量 150 → 100 后补拣 50 —— **确有缺陷，已修**
真实链：`PUT /sale/:id/adjust`（整单替换为 100）→ `GET /warehouse-tasks/adjustments/pending` → `GET /warehouse-tasks/adjustments/:adjustmentId` → `POST /warehouse-tasks/adjustments/container-returns/:returnId/confirm`。

**实测事实（修复前）**：
- 改单确认后系统把 `required/picked/sorted` **都下调到 100**；
- `sorting_bin_items`（作业记录）仍是 150，**这是设计如此、不该被改写**——问题**不在**它；
- **真正的根因**：B3a 的 `confirmedPickLabelQty` 原口径是 `SUM(sbi.qty)` + `EXISTS(有效 PICK)`，**有效聚合没有受「当前任务的当前有效 PICK」约束**，于是把**历史**作业量当成有效份额读回 150（实测打印 `C=150`，而实际 PICK 只有 100）。

**缺陷复现**：增量回 150（任务回退到拣货中）→ 补拣新盒 50 ⇒ `picked=150` → `ready` → 真实 `PUT /sort-done`：

```
409 PICK_CODE_EXCEEDS_PICKED
「该取货码分拣后将超过已拣数量（已拣 150，已确认取货标签 150，本次 50）」
```

即 `legacy(0) + C(150) + 本次(50) = 200 > picked(150)` ⇒ **补拣的货被历史份额挤掉、无法分拣**。

**修复**（`warehouse-tasks.sort.js` 的 `confirmedPickLabelQty`，**只让有效聚合受当前 PICK 约束**、**不改任何库存或作业记录**、也不收缩 `sbi`）：

```sql
SUM(LEAST(sbi.qty, pc.pick_qty))          -- 取「历史作业量」与「当前有效取货量」的较小者
INNER JOIN (                              -- 有效取货量**先按容器聚合**再 JOIN，
  SELECT container_id, SUM(qty) AS pick_qty  -- 否则同一容器多条 PICK 会让 sbi 被重复累计
  FROM scan_logs ... GROUP BY container_id
) pc ON pc.container_id = sbi.container_id
```

- 减量后：`LEAST(150, 100) = 100` ⇒ C 回到实际值，**不再吞掉补拣**；
- 正常场景两者相等 ⇒ **与旧口径一致，不回归**；
- 有效取货量的口径与 A 一致：`scan_purpose=1` 且 `source_container_id` **非空**。

**修复后实测**：补拣的新标签 `sort-done = 200 allSorted` ⇒ 真实 **CHECK 闭合**（扫全部锁定容器）进入待打包(5) ⇒ 真实**装箱**：**补拣标签整份入箱 50** **且旧码按其当前有效量整份入箱 100**，**两来源合计 150**；此时旧 SKU（商品码）路径**装 1 件也被拒**（标签已占满 checked，不能被吞）。**减量后旧码补打**的 `readLabelVariables(11)` 读到的 `qty = 100`（取当前有效 PICK，不是历史 150）——补打记录入队成功，**仍不代表实际出纸**。

### 2.3 取消归还后的码被下一任务当普通整件再拣 —— **既有行为正确，未改代码**
实测：同一只 `I` 在任务 B 走**整件**拣货 ⇒ 该 PICK 行 `source_container_id` **为空**；此时用**取货码形态**分拣被拒（`PICK_CODE_NO_PICK_RECORD`）。即归属判定确实按「当前任务的有效盒取货 PICK」，**没有**被容器历史的 `source_ref_type` 误导。
**且复用闭环继续走完**（只验「被拒」不算完成）：同一只码在任务 B 走**普通整件全链** —— **商品码分拣** → **真实复核闭合到待打包(5)** → **商品码整份装箱 150**（回执 `labelContainerId` 为 null，即旧 SKU 份额）。

### 2.4 取消后补打该码 —— **确有缺陷，已修**
**实测（修复前）**：任务已取消、`I` 已归还（`locked_by_task_id` 为空），`POST /print-jobs/barcodes/reprint {category:'inbound'}` 仍**打出「取货标签」**（`queued:true`）——因为原实现只按 `container_id` 找 PICK 行，**不看当前任务锁**。

**修复**（`print-jobs.label-command.js` 的 `reprintInboundBarcode`）：
- 先看容器**当前** `locked_by_task_id`：为空 ⇒ **明确拒绝**（`PICK_LABEL_NOT_IN_TASK`，「不属于任何进行中的任务」）；
- 再在**该任务**下找 `source_container_id` **非空**的 PICK 行，找不到 ⇒ 原有 `PICK_LABEL_SOURCE_MISSING`。
- 修复后实测：取消归还有明确拒绝；正常场景（未取消）补打**不回归**（B1 套件 17/0 仍绿）。

**补充项订正（同日，B4 后审发现并修）——初版 guard 收得过紧，误伤了既有能力**：
上面那条把判据写成「当前锁为空 ⇒ 一概拒绝」，但**已出库**的取货码恰恰是「锁为空」：出库时容器被扣空转 `EMPTY(2)`、`unlockContainersByTask` 释放任务锁，而**取货标签的变量本就取自真实 PICK 行**（`enqueuePickLabelJob` 注释明写「发货/减量后容器余量会归 0，按余量取会把标签打成 0 个」）——**已出库后补打原本是被支持的场景**。
真实链取证（新专项 `tests/pick-label-reprint-lifecycle.smoke.test.js`，S6-A）：采购→收货→上架→建盒放货→销售占库发货→扫盒取货→`ready`→`sort-done`→复核→装箱→`finish`（箱贴入队）→收口箱贴→`pack-done`→**任务出库(7)**；只读读到取货码 `status=2`、`remaining=0`、`locked=null`、任务 `status=7`，此时补打**实测被拒** `409 PICK_LABEL_NOT_IN_TASK`——**回归证实**（红日志 `/tmp/fc-pb-reprint-red.log`，`EXIT=1`）。
> **方法注记（不追溯）**：这次**红**取证时，箱贴收口用的是 `complete-local`——只是借它把任务推到**真实出库(7)** 这个**前置**；**红的证据是「`EMPTY` + 任务 7 时补打被拒」，与用哪种收口方式无关**。后来的绿跑（`/tmp/fc-pb-reprint-green2.log`）与本轮 Codex 独立复跑才改用**真实打印客户端姿势** `claim-client` + `complete-client`（详见 §3）。**不得**把红的方法追溯改写成后来的方法。
**窄修**：判据改为「**确定的盒取货归属**」，分两条路——① 容器锁定于某任务 ⇒ 只认该任务下的盒取货行（原逻辑，不变）；② 容器未锁定 ⇒ 必须**同时**满足「容器已被扣空（`EMPTY(2)` **且余量 0**）」+「该容器**唯一一条**盒取货行、其任务为**已出库终态(7)**、且未请求取消」；**取消 / 进行中 / 容器未扣空 / 多条候选 / 任务缺失**一律拒绝，绝不从其它后续任务猜。容器未扣空时不进入该分支（不是「已出库的取货码」，不拿它去覆盖别的状态）。当前任务锁与容器状态改在**同一条 `FOR UPDATE`** 里读出（判据单一来源、少一次查询），不改 `readLabelVariables`、不动公共 PDA。
**修复后实测**：上述真实链补打 **200 `queued:true`**，渲染变量 `qty=150`（**原取货量，不是余量的 0**）；取消后仍拒、整件复用仍拒（3/3 绿，`/tmp/fc-pb-reprint-green2.log`，`EXIT=0`）。直接受影响的既有回归复跑：**B4 5/5**、**B1 17/17** 均绿；`test:sql-identifier` / `test:sql-placeholder` / 改动文件 eslint 均 exit 0。

### 2.5 同箱同 SKU 多标签 + `finish` 打印链 + 受控减量 —— **全链走通，未改代码**
真实链：同一盒取 `60 + 90`（**同 SKU 两张标签**）→ ready → 逐张分拣 → 逐容器真实复核 ⇒ 待打包(5) → **同一个箱**装两张标签（**两行**、合计 150）→ **`finish` 走既有打印链**（`printQueued:true`，箱贴入队；`requireClientOnline:false`，**无需模拟客户端**）→ **合法减量 150→100** ⇒ 产生 **`packageVoids`（受控作废已完成箱腾容量）** + `containerReturns`（归还 50）→ **逐条确认**后：箱 `status=3`、需求降为 100、任务回到待复核(4) → **重新真实复核**回到待打包(5) → **重新装箱**（按标签的**当前**有效量整份装入；注意减量按 **FIFO** 从最早的拣货行扣，第一张标签的剩余量不一定是原值，断言必须取实际值）。
> **打印链的边界**：`finish` 与箱贴只到**入队**（`print_job` 记录）；**实际出纸未验**。

## 3. 测试（`tests/pick-cancel-return.smoke.test.js`，**5 项**）

命令（显式回环专库 + Node 22 + 可写下载目录）：

```
set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
export DB_NAME=flowcube_plastic_box_20260929_test NODE_ENV=test APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads
export DB_HOST=127.0.0.1 DB_PORT=3307
node tests/pick-cancel-return.smoke.test.js
```

结果：**5 passed / 0 failed，natural exit 0**（`/tmp/fc-b4-all.log`）。全部夹具走**真实业务链**（采购→收货→上架 → 销售→占库→发货 → 扫盒取货 → ready → `sort-done` → 复核 → 装箱 → `finish`；改单走 `adjust` + 拆箱/归还受控确认），**未用 SQL 直接改库存/任务/打印状态**：

1. **取消整份 150**：新 `I` 解锁、货不回盒、库存不变、留痕、任务取消
2. **减量 + 补拣全链**：分拣 150 → 改单减到 100（PICK 下调、`sbi` 保留 150）→ 增量回 150 → 补拣盒 50 → **真实 `sort-done` 通过** → **真实 CHECK 闭合到 5** → **真实装箱**（补拣标签 50 + **旧码当前有效 100** ⇒ 合计 150；旧 SKU 装 1 件被拒）→ **旧码补打**读出 `qty=100`
3. **取消归还后的码在下一任务**：整件拣货 `source_container_id` 为空 ⇒ 取货码形态分拣被拒；**随后走完普通整件链**（商品码分拣 → 真实复核到 5 → 商品码装箱 150）
4. **取消后补打**：按当前有效归属**明确拒绝**，不认历史 `source_ref_type`
5. **同箱同 SKU 多标签 + `finish` + 受控减量**：60+90 同箱两行 → `finish` 打印链入队（**只入队，未要求客户端完成、未出纸**）→ 减量 150→100 → `package-void` 受控拆箱 + 归还确认 → 箱作废、需求 100 → 重新复核 → **把两张可重装标签分别装新箱装完 100**
   - **完整闭合断言**（不只装第一张）：非作废箱 `SUM(package_items.qty) = 100`、旧箱 `status=3`、`PICK` 合计 100、**历史 `sbi` 仍为 `[60,90]` 未被改写**、**ACTIVE 容器余量合计 == `inventory_stock` 缓存**（实测 135278 == 135278，守恒）。

**行为对照（修复前后）**：2 与 4 在修复前分别实测为 `409 PICK_CODE_EXCEEDS_PICKED`（补拣被挤掉）与 `200 queued`（照旧出标签），修复后转为绿 —— 这是本批**唯一两处**代码改动的原因。

**受影响的既有回归（本批自跑）**：`plastic-box-pick`（B1，含补打）**17/0**、`pick-code-downstream`（B3a）**19/0**、`pack-quota`（B3b）**8/0**、`sale-adjustment` **72/0**。
**静态检查**：改动的 3 个后端文件 eslint exit 0。

**夹具**：`finally` 按自建 ID 逐笔合法取消 + 归还并只读核对 `task=8 且自身锁 0`（本轮 **6 笔全通过**），自建分拣格逐格 `try/catch` 删除。

**B4 补充项专项**（`tests/pick-label-reprint-lifecycle.smoke.test.js`，**3 项**，`npm run smoke:pick-label-reprint-lifecycle`）

结果：**3 passed / 0 failed，natural exit 0**（绿日志 `/tmp/fc-pb-reprint-green2.log`；红证据 `/tmp/fc-pb-reprint-red.log`，`EXIT=1`）。全真实链，未用 SQL 改库存/任务/打印状态；箱贴收口走**真实打印客户端姿势**（`POST /print-jobs/claim-client` → 按 job id 取本任务那条的 `ackToken` → `POST /print-jobs/:id/complete-client`），只使用本轮 fixture 的打印机/工作站与**自身** job，未领取他人任务。

1. **已出库后（`EMPTY` + 余量 0 + 解锁）补打取货标签**：真实链走到任务出库(7) → 补打 **200 `queued:true`**，渲染变量 `qty=150`（原取货量，非余量的 0）。修复前同链路实测被拒 `409 PICK_LABEL_NOT_IN_TASK`。
2. **已取消归还后的 free `ACTIVE` 取货码**：补打仍**明确拒绝**（`PICK_LABEL_NOT_IN_TASK`）——B4 修复保留。
3. **取消归还后的 free `ACTIVE` 码被下一任务按普通整件复用**（`source_container_id` 为空）：补打仍**明确拒绝**（`PICK_LABEL_SOURCE_MISSING`），不认旧任务标签。

直接受影响的既有回归复跑（本会话）：`pick-cancel-return`（B4）**5/5**、`plastic-box-pick`（B1，含补打）**17/17**，均 natural exit 0；`test:sql-identifier` / `test:sql-placeholder`、改动的 1 个后端源文件 eslint 均 exit 0。
夹具：`finally` 对**业务终态**（已出库 7 / 已取消 8）只登记「终态 + 自身锁 0」、**不强行取消**（已完成发货的单据/库存/账款/打印历史保留），进行中的合法取消 + 归还；本轮自建 4 笔（保留终态 3、合法收尾 1）。测试未新建打印资源——复用 `smokeTestKit` 既有的 `SMOKE-PRN` 打印机与工作站。

**Codex 独立复跑（2026-09-29，非本会话自证）——结论：B4 独立验收通过**

- Node 22 实跑本套件 **5/5，natural exit 0**，日志 `/tmp/flow-plastic-box-lifecycle-codex-20260929.log`；本轮 **6 笔销售夹具清理核对 6/6**。
- **C 聚合改变后复跑上游**：`pick-code-downstream` **19/19，natural exit 0**（日志 `/tmp/flow-plastic-box-sort-after-lifecycle-codex-20260929.log`），自建 **24 笔收尾 24/24**。
- 受影响的 **3 个后端文件 eslint exit 0**；`git diff --check` 为 0。
- **接受本轮 B4 的 5 条 API / service 范围**；**未验边界保持**（GUI、实际出纸、真实并发）。

**取货标签补打补充项的独立复跑（同日，非本会话自证）——结论：通过**

- Node 22 实跑 `pick-label-reprint-lifecycle` **3/3，natural exit 0**，日志 `/tmp/flow-plastic-box-reprint-codex-20260929.log`。
- 本轮 **4 笔**销售夹具：**1 笔合法 `cancel`/`return` 收尾**，**3 笔核对「业务终态 + 自身锁 0」后保留**（其中已发货的 `task 895` 保持 `status=7`、**不回退**；其余为取消终态）。
- `test:sql-identifier` 与 `test:agents-md-guard` 本轮 root 实跑 **exit 0**；cached / unstaged `git diff --check` 为 **0**。
- **70 个暂存路径**经独立核对**均属本任务**，未纳入生产 env / 版本文件 / 其它任务文件。

## 4. 证据边界与仍未验（如实）

- 走 **HTTP 全链**：全部 **5 项**（含改单、拆箱/归还受控确认、`sort-done`、复核、装箱、`finish`）。
- **1. GUI 全程未跑**；**物理打印 / 实际出纸未验**——第 4 与第 5 项只证明**入队结果**（拒绝 / 成功 / `printQueued`），**不代表**真实打印。
- **2. `finish` 只走到「箱贴入队」**：第 5 项确实走了既有 `finish`（`printQueued:true`、`printJobId` 有值，`requireClientOnline:false` 故**未要求客户端完成**）；但**未推进出库 / 待出库**，也**未验证实际出纸**。不得据此称 `finish` 全链已验。
- **3. 补打的「生命周期」边界（订正后）**：本批证实的是「**取消后 free ACTIVE 的取货码不得再被原任务认回**」（`PICK_LABEL_NOT_IN_TASK`），以及**补充项**证实的「**已出库（`EMPTY` + 余量 0、已解锁）后可依唯一一条已出库任务的盒取货行补打原取货量**」与「被下一任务当普通整件复用的码不得认回旧标签」（`smoke:pick-label-reprint-lifecycle` 3 项）。注意这与既有边界「**只收紧 VOID**、EMPTY 仍可补打」并不冲突：那条说的是**通用库存标**；本批的 guard 是**取货标签分支**的收紧（取货标签脱离「确定任务归属」即失去语义）；**并非**「普通标签规则整体改变」。**仍未验**：同一容器跨多任务候选（本批按「不猜」拒绝，未设计取舍）、并发补打、以及补偿性的历史留档标签需求。
- **3.1 `remove` / `void` 无幂等键**：仍是「重放即重复执行」语义，**未改、未验**（B3b 遗留）。
- **4. `finish` 的 scope-先于-replay 与历史回执事务**：**已由批 C2 覆盖**（见 `docs/plastic-box-batch-c2-handover-2026-09-29.md`）。本行为 B3b/B4 时的**历史状态**，保留原样以存痕迹。
- **5. 真实并发未验**：减量 / 归还链只在顺序场景验证。
- **6. 减量路径**：已实跑 **`packageVoids`（作废已完成箱腾容量）+ `containerReturns` 受控确认 + 重新复核 + 全 100 重新装箱**（第 5 项）。**未穷尽**的是：多箱、部分箱作废、`packageVoids` 与 `containerReturns` 并存的混合场景、以及多次连续改单。
- **7. 5 项仅为本阶段证据**，不等于批 B 全部验收。

## 5. 资源

- 本轮未启动常驻服务与浏览器；测试进程自起自停。共享 **3307** MySQL 保留，未触碰其它任务资源。
- **未打 tag、未发布。**提交状态以 Git 与最终交接为准；本批实施与验证期间**当时未提交**，收口按上下文把 A/B1–B4 的已验证成果**合并为一条本地 checkpoint**（`containerEngine`、打印链、主题文档、CI 在批间相互依赖，按文件无法拆成各自可用的提交），便于保留可用快照——这不是发布。

## 6. 续接要点

- **本批代码定稿，不重做**：`confirmedPickLabelQty` 的 `LEAST(...) + 按容器聚合`、补打的「当前任务锁 + 当前有效 PICK」定位。
- **仍未关闭的既有事项**（沿用 B3b §4）：`finish` 的 scope-先于-replay 与历史回执事务 —— **已由批 C2 覆盖**；`remove` / `void` 无幂等键 —— **已由批 C1 覆盖**。
- **边界**：**仅本地**；禁止发布、禁止连接/迁移生产；不 push、不打 tag；共享 **3307** 与其它任务资源不得触碰。
