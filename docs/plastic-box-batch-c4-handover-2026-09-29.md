# 批 C4 实施交接 · 2026-09-29 · 打包末尾两入口（`pack-done` / 箱贴 `print-label`）

> 状态：**已实施并实测** —— 后端 API 用例 **8/8（0 fail / 0 skip）natural exit 0**；前端组件**本轮最终 30/30**；`tsc -p tsconfig.app.json` 0、前端 eslint 0。
> **真实 GUI**：两幕的**丢响应与同页/跨任务冻结定位已实跑**（§8），但**「刷新后原 key 保留」与「切 task 5 不误完成」两条未验**（工具限制，见 §8 末）——**不把未验写成已验**。
> `test:agents-md-guard` 本轮自然通过；`deployment-resources` 本轮 **25/26**（失败项为既有子项「部署总超时穿透内层等待」的 setup 问题，不在 C4 范围，单项原样复跑 1/1 通过）。
> **未发布**（提交状态以 Git 为准）。前置：C3 已独立核对并接受本地 checkpoint `3fe5138`。
> 范围：**`pack-done`（打包完成 5→6）** 与 **箱贴 `print-label`** 两个「打包末尾入口」，以及前端对应 action。

## 0. 环境与口径

- Node **22.23.2**；MySQL 回环 **127.0.0.1:3307**；独立库 **`flowcube_plastic_box_20260929_test`**；`APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads`。
- 用例开头 `assert` 库名 / 回环 / 端口，不符即失败。
- **不调用 `prepareSmokeContext()`**：它会 upsert 共享 `SMOKE-PRN` 并 `DELETE` 该打印机下 `status=0` 的任务，与本批「不核销他人历史 job」的边界冲突。改为自建本批独立仓 / 库位 / 主数据 / 打印机 / 客户端绑定 / PDA 设备，全部走真实业务 API，收尾同样走合法 API。

## 1. 缺陷一：`pack-done` 原 key 重放拿不回原回执

**静态定位**：`warehouse-tasks.pack.js` 里 `assertWarehouseTaskAction('packDone', status)`（只允许 `PACKING(5)`）
排在 `beginResourceOperationRequest` **之前** ⇒ 状态推进到 6 之后，原 key 重放先被状态规则挡成 400，`replay` 分支到不了。

**红证据**（真实 API）：
```
首次 pack-done 200 → {"taskId":1125,"status":6}
原 key 重放      → HTTP 400 {"message":"只有\"待打包\"状态可以完成打包"}
新 key 对 status=6 → HTTP 400（**同一条文案**，与合法重放无法区分）
```

**窄修**（`warehouse-tasks.pack.js`）：把状态规则与 `isValidTransition` 移到 `begin/replay` **之后**。
锁序与既有闸门不变：`lockStatusRow` → `assertTaskScope`（范围/设备仓）→ 取消/改单闸 → `begin/replay` → 状态规则 → 打印闭环 → CAS → 业务。

**绿证据**：
```
原 key 重放 → HTTP 200 {"success":true,"message":"已标记为待出库","data":{"taskId":1131,"status":6}}
PACK_DONE 事件 1→1；直接运单 0→0        ← 重放不得再落副作用
新 key 对 status=6 → HTTP 400；该 key 的 operation_requests 残留 = 0 行   ← 被拒不留半截回执
```

## 2. 缺陷二：箱贴 `print-label` 的四处边界

### 2.1 同 requestKey 跨箱串 job（**有红证据**）

`packages.controller.printLabel` 的 `jobUniqueKey = package_label:<requestKey>` **不含 packageId**；
`print-jobs.command.js` 的 `createRecord` 对同 key + 同仓 + 同 jobType 的活跃 job **直接返回既有 job**（第 103-110 行）。

**红证据**：
```
A 箱 → job 3617 refId=399 refCode=L000399
B 箱同 key → HTTP 200 "已加入打印队列" … job:{id:3617, title:"箱贴 L000399"}   ← B 箱根本没进队，拿到的是 A 的 job
```

**修**：幂等键绑资源 —— `package_label:<packageId>:<requestKey>`，**不截断**（截断会引入隐式碰撞；
确实超长时由 `createRecord` 明确 400 `PRINT_JOB_UNIQUE_KEY_TOO_LONG`，事务整体回滚）。

**绿证据**：A→3800(L000449) / B 同 key→3801(L000450) 指向各自箱；**同 key 重放回原 job 3800 且该箱 job 数不增**；
**新 key 补打产生新 job 3802 且恰好 +1**。

### 2.2 缺箱失败残留 PENDING，把原 key 永久挡住（**有红证据**）

原实现 `begin` 走 **pool**（自动提交）、业务在另一条连接、`complete` 又在 pool；且「箱不存在」是 **return 409 而非 throw**，
`catch` 里的 `failOperationRequest` 连进都不会进 —— 回执永远停在 `PENDING(0)`，该 key 之后再怎么重试都被
`beginOperationRequest` 的 PENDING 分支挡成「上次提交结果仍待确认」。

**红证据**：
```
对不存在箱补打 → HTTP 409
回执行 = [{"id":6518,"status":0,"action":"package.print-label.99999999","error_message":null}]   ← 0 = PENDING
```

**修**：`printLabel` 下沉到 service（`printPackageLabel`），与 `finish` 同口径压在一处事务里：
- 缺箱在 `begin` **之前**明确 **404**（`PACKAGE_NOT_FOUND`）：不留回执行、不留队列行；
- 范围 / 设备仓校验**先于** `begin/replay`；锁序 task → package，并在 `begin` 前**复核箱归属**；
- 幂等回执、入队、`dispatchHint`、`complete` **同一 conn 同一事务**；任何一环抛错整体 rollback。

**绿证据**：缺箱 → 404 + 回执行 **0 行** + 原 key 重试仍 404（未被挡住）。

### 2.3 范围 / 设备仓未校验（**修复后验，无前置红证据**）

原路由只挂 `requirePermission(PRINT_JOB_REPRINT)`，controller 也不传 `scopeWarehouseIds`/`pdaWarehouseId`
⇒ 拿 A 仓的 PDA、或只被授权 A 仓的账号，都能给 B 仓的箱补打。

**修**：路由加 `pdaSessionOptional()`（纯 PC 请求走权限 + 数据范围；**带** `X-Client: pda` 或 `X-PDA-Session`
即按 PDA 口径完整校验设备）；controller 透传 `scopeWarehouseIds`/`pdaWarehouseId`；service 用 `assertTaskScope` 校验。

**绿证据**：
```
异仓设备补打本仓箱        → 403 PDA_WAREHOUSE_MISMATCH
带 PDA 标记但缺票         → 403 PDA_SESSION_REQUIRED
无 PDA 标记（ERP）补打    → 200（补打是打印动作，ERP 端仍可发起）
限仓用户范围=作业仓 → 200（**证明该账号确有打印权限，不是靠权限不足挡的**）
改范围到异仓后：原 key 重放 403 / 新 key 首次 403，均 WAREHOUSE_SCOPE_DENIED
```

### 2.4 失败回执不回填（**修复后验，无前置红证据**）

原 `catch` 用 **base** action 调 `failOperationRequest`（UPDATE 按 action 精确匹配），而 `begin` 写的是
scoped `package.print-label.<箱id>` ⇒ 打不中。新实现整体回滚，不再需要补失败回执。

### 2.5 历史错误回执：写重放与**查询**两个入口都要拦（查询入口**有红证据**）

本批修复**之前**跑 2.1 红测时，真实落库过「B 箱的 scoped 成功回执里塞着 A 箱的 job」的行。
这类历史行**不改写、不删除**，但两个入口都不能再把它们放出去：

- **写重放**（`printPackageLabel` 的 replay 分支）
- **查询回执**（`GET /api/system/request-status/:key`）—— 前端恢复正是靠它：公共 hook 一看到
  `status === 'success'` 就会清 pending 并当作本次成功，`resolveServerState` 之后再无校验点。

**红证据（查询入口）**：
```
GET request-status ?action=package.print-label.400 → HTTP 200 status=success resourceId=400 dataJobRefId=399
                    ↑ 资源是 400（B 箱），job 却指向 399（A 箱）
```

**修**：抽出**领域纯校验** `packages/packages.receipt-guard.js` 的 `assertPrintLabelReceiptConsistent(action, receipt)`，
只对 `package.print-label` 的 `SUCCESS` 生效，校验 `data.job` 的 `refType/refId` 与 `receipt.resourceId` 一致；
不一致 → **409 `PACKAGE_LABEL_RECEIPT_MISMATCH`**（要求人工核对原打印）；`queued=true` 却无 job → 409 `PACKAGE_LABEL_RECEIPT_UNVERIFIED`。
写重放与 `system.controller.requestStatus` **共用同一把闸**（后者不改 `operationRequest` 的查询匹配语义，也不改写历史行）。

**绿证据**（用真实历史行原 key：`plabel-ogvo8q6b` / `package.print-label.400`，job #3617 → 箱 399）：
```
原 key 重放              → 409 PACKAGE_LABEL_RECEIPT_MISMATCH
GET request-status(scoped) → 409 PACKAGE_LABEL_RECEIPT_MISMATCH
GET request-status(base)   → 200 status=not_found（非 success）
```

## 3. 前端（`frontend/src/pages/pda/pack.tsx`）

与 C3 修 `finishAction` 同源的三个问题，本批一并处理：

1. **action 绑 `taskId`**：`printAction` 原 `package.print.<taskId>`、`finalizeAction` 原 `warehouse.pack-done.<taskId>`
   ⇒ 换任务重挂后按 action 名匹配不到原 pending。改为 **base**（`package.print-label` / `warehouse.pack-done`），
   **旧版 scoped 记录沿用原 action**（继续阻断、不静默消失）。
2. **恢复不许猜**：
   - `finalizeAction.resolveServerState` 改为**只认原键回执**（`warehouse.pack-done.<原任务>` + `resourceId` 校验），
     不再用 `getTaskByIdApi(taskId)` 判「当前任务已是待出库」；
   - **旧版 scoped 记录的后缀都是 `taskId`**（HEAD 原实现 `package.print.<taskId>` / `warehouse.pack-done.<taskId>`，
     `taskId` 缺失时后缀是 `none`）：finish / finalize 要求后缀 === `metadata.taskId`，**print 亦然**。
     **不能拿后缀去比 `packageId`** —— `task 41 / pkg 700` 这类记录是合法的，比错会把它判死；
     print 另外要求 `metadata.packageId` 为正整数（拼 `package.print-label.<箱id>` 查回执用）。
     残缺或对不上一律**只阻断、不恢复**；后缀 `none` 的记录同样只阻断（沿用原 action，不静默消失）。
   - `printAction` 新增 `resolveServerState`：`package.print-label.<原箱>` + `resourceId` + 回执内 `job.refId` 三重校验。
   > **覆盖范围（证据校准，2026-09-29）**：上述 metadata 归属校验**只在两条分支上生效** ——
   > ① `frozenRecordTrusted`（决定冻结卡片**展不展示**原内容）；② `resolveServerState`（hook 仅在
   > **`not_found` / `pending` / `failed` 或抛错** 时才调用它）。
   > `useCriticalPdaAction.confirmPending` 的**主成功路径**（查询直接返回 `status === 'success'`）**不经过**
   > `resolveServerState`，会直接 `removePending` + 回调 `onConfirmed` —— 本批的组件用例**没有覆盖那条路径**。
   > 合法原键回执的归属由**服务端**按 `(request_key, action, user_id)` + `resource` 保证，成功提示用的是**后端原数据**；
   > 目前**没有**「错目标 A」的真实缺陷证据，故**不动公共 hook**。详见 §11 的 B 待查。
3. **提前 return 藏掉恢复入口**：`taskDetail.status !== PACKING` 的整页替换分支加了 `&& !noticePendingAction` ——
   「完成打包」后台成功、响应丢失后任务已是 6，重挂时 `allDone`（本地 state）为 false，旧写法会把
   「确认上次结果 / 原目标定位」整个藏掉。
4. **本页冻结**扩到 print / finalize（含 `phase === 'submitting'`）。
5. **成功反馈全部收敛到 `onConfirmed`**：hook 的三种成功路径（正常提交 / **查回执恢复** / 兜底确认）都走它，
   所以 `triggerPrintPoll` / `refetch` / 离线 `dispatchHint` 警告 / `queued=false` 警告**都放在这一处** ——
   只放 mutation 会让**恢复那条路静默**（恢复不经过 `mutation.onSuccess`）。提示用**回执里的原快照**
   （原箱条码）并点明「**仅表示已排队，不代表已出纸**」；`queued=false` 泛指「本次打印记录」，
   **不**拿当前界面上的箱去补旧 payload 缺的信息。mutation `onSuccess` 只处理 `pending`。

## 4. 测试清单（红证据 / 防回归 如实标注）

| # | 用例 | 证据性质 |
|---|---|---|
| P1 | `pack-done` 原 key 重放回原回执（含事件/运单不增） | **有前置红** |
| P2 | 新 key 对已推进状态仍拒绝 + 无残留回执行 | **有前置红**（同一红测的输出） |
| PL1 | 箱贴同 key 跨箱不串 job + 同 key 回原 job / 新 key 新 job | **有前置红** |
| PL3 | 缺箱在 begin 之前 404（回执 0 行、原 key 可重试） | **有前置红** |
| PL6 | 历史错误回执经 `request-status` 查询被拦（409） | **有前置红** |
| PL2 | 设备仓不匹配 / 缺票 / ERP 合法路径 | **防回归已验**（同批实现一并落地，未在旧实现上单独取红） |
| PL4 | 限仓用户范围外 403（含范围内成功对照） | **防回归已验**（同上） |
| PL5 | 历史错误回执行**写重放** 409 | **防回归已验**（窄校验与用例同时落地；查询入口那条 PL6 才是先红后修） |
| PF1 | 故障注入 `UPDATE operation_requests` 抛错 ⇒ 整体回滚、原 key 可重试 | **防回归已验**；**只覆盖「回执写入失败」这一种故障**，不代表已覆盖全部故障面 |

- 历史行查找限定：`JOIN packages → warehouse_tasks → inventory_warehouses` 且 `w.name LIKE 'PB-C4-%'` + `user_id`（只读本批、本人）。
- 找不到历史行时计 **SKIP**（独立计数，**不计入 PASS**）；顶部汇总打印 `N 通过 / N 失败 / N 跳过`。
- 收尾失败（含设备 / 打印机 / 用户 / 仓的终态断言）一律计 `failed` 并让进程非 0；收尾整体包在 `try/finally` 里，保证 server / pool 一定关闭。

## 5. 资源收尾

用例收尾全部走合法 API，并在结束时**断言终态**（失败即计 `failed`）：

- **任务 / 销售**：销售 `cancel` → 容器 `cancel-return` → 已完成箱 `cancel-return/box` 受控拆箱 ⇒ 断言 `status=8` 且自锁 0。
- **PDA 设备**：解绑（`warehouseId=null`）+ 停用 ⇒ 断言 `warehouse_id IS NULL` + `status='disabled'` + 有效票据 0。
- **打印机**：**不 DELETE**（当前 DELETE 会物理删打印机并牵连其 job 历史），改为**解绑 `package_label` 用途 + 停用**，断言 `status=0`、该仓绑定 0 条；打印机 / client / job / 回执历史全部保留。
- **限仓用户**：停用（`is_active=0`），不物理删除历史账号。
- **自建仓**：被库位/库存引用时 API 明确 409「禁止删除，请改为停用」⇒ 按设计**停用**（`is_active=0`）。
- **残留容器**：归还后仍有自建库存容器时，**保留并登记**（不为「收尾全 0」手改或删除）；主数据（分类/供应商/客户/商品）登记 `ledger` 保留。

> 独立只读核对（root）：仓 **47** 已 soft_deleted、**48–73** 均 `inactive`；设备 **197–217** 全部解绑 + disabled + 有效票据 0；打印机 **150–164** 全部停用、`bindings` 0。

## 6. 各执行者与日志（2026-09-29）

| 项 | 执行者 | 结果 | 日志 |
|---|---|---|---|
| 后端 API 全组 | root 独立 | **8/8、0 fail / 0 skip、natural exit 0** | `/tmp/flow-plastic-box-c4-api-codex-20260929.log` |
| 前端组件（旧轮） | root 独立 | 28/28 | `/tmp/flow-plastic-box-c4-ui-codex-20260929.log` |
| 前端组件（**本批最终**，含 `taskNo` 冻结 + 只读事实呈现） | root 独立 | **30/30、natural exit 0** | `/tmp/flow-plastic-box-c4-ui-final-codex-20260929.log` |
| `test:agents-md-guard` | root 独立 | 自然通过 | `/tmp/flow-plastic-box-c4-doc-codex-20260929.log` |
| `deployment-resources`（全组） | root 独立 | **25/26**（保留该次失败记录） | `/tmp/flow-plastic-box-c4-ci-codex-20260929.log` |
| 上述失败子项**单项原样复跑** | root 独立 | **1/1 自然 exit 0**（既有子项「部署总超时穿透内层等待」的 setup 问题，**不归因 C4**） | `/tmp/flow-plastic-box-c4-ci-retry-codex-20260929.log` |

> 记法说明：**28 是 root 的旧轮数**；本批最终组件数为 **30/30**。`deployment-resources` **不写 26/26**（本轮确实有一次 25/26）。
- **资源只读核对**：任务 **1199–1205** 状态 8 / 自锁 0；设备 **220 / 221** 解绑 + disabled + 有效票据 0；打印机 **166** 停用 + `bindings` 0；用户 **306** inactive；仓 **77–79** inactive。
  **WH77**：商品 35、库存缓存 440.00 / ACTIVE 容器 440.00 / 预占 0。历史与库存、ledger 全部保留。

## 7. API 夹具的范围与口径（避免误读）

- 本批 API 用例**多次全组运行**，每次都自建一整套独立夹具（自建仓 / 库位 / 分类 / 供应商 / 客户 / 商品 / 分拣格 / 打印机 + 客户端 / PDA 设备 / 销售与任务），收尾走合法 API 并断言终态。库中因此累积了多套 `PB-C4-*` 仓与打印机（均已停用 / inactive），**属反复验证的正常产物，不是缺陷**。
- **早期 setup 错误不得作为产品红测**：夹具搭建阶段出现过「库位编码全库唯一冲突」「商品 code 未显式指定导致下单 400」等**夹具自身**问题，已就地修正；这些**不是**产品缺陷证据，也没有被写成红测。
- 历史错误回执行（`package.print-label.400` / key `plabel-ogvo8q6b`，job #3617 → 箱 399）是**本批 PL1 红测真实产生**的残留数据，**保留未删**；PL5/PL6 正是用它做的真实复现。

## 8. 真实 GUI 实测（2026-09-29，真实浏览器 + 真实代理，非组件 mock）

> **分轮说明（避免误读）** —— 本节含**两轮**，证据**不互相替代**：
> - **第一轮（共享仓 WH1，只读事实窄修之前）**：实测的是「丢响应 + 同页冻结原任务/原箱 + **切到另一任务仍显示原定位**」，见下。这部分是**当时的真实命令输出**，**不因第二轮的未验项而被否定**。
>   其中那次「整页 reload」的读数同样来自当时命令输出，但该标签随后被替换为 `about:blank`、`localStorage` 不可访问，**不可复核** —— 故**只作线索、不记为已验**。
> - **第二轮（自建仓 81，窄修之后）**：实测「修后箱件按**只读事实**呈现」（§8.1）。其中「刷新后原 key 保留」与「切 task 5 不误完成」**未验**（§8.2）。
> - 两轮的箱件呈现意图不同：**第一轮不涉及、也不代表窄修后的界面**；窄修后的界面只在 §8.1 观察。

**环境（实测非据注释）**：`agent-browser` 0.36.0；后端 `/tmp/fc-pb-server.cjs` 用 **Node 22.23.2** 起在 `127.0.0.1:3399`，进程 env 实测 `DB_HOST=127.0.0.1 / DB_PORT=3307 / DB_NAME=flowcube_plastic_box_20260929_test`；PDA 前端 **5173**；代理 **3400→3399**（本批新补 `packages/:id/print-label` 与 `warehouse-tasks/:id/pack-done` 两个扣留目标）。会话名 `flow-plastic-box-20260929`。页面是 HashRouter，地址形如 `http://127.0.0.1:5173/#/pda/pack?taskId=<id>`。

**seed**（`/tmp/fc-pb-c4-seed.cjs`）：造任务 **1206**（箱 L000468）、**1207**（箱 L000469），两箱均**先 finish 再由本批独立客户端真实核销箱贴**（`claim-client` → `ackToken` → `complete-client`），否则 `pack-done` 会被打印闭环挡下。

**第一幕 · 箱贴补打丢响应**：
1. 代理置 `drop` → 点「打印箱贴」。代理日志：`[DROP-HELD] POST /api/packages/468/print-label upstream=200`（**后台已成功**）+ `GET /api/system/request-status/…?action=package.print-label` 同时被扣住。
2. 同页进待确认：`有 1 个操作待确认`，冻结卡片 **`任务 WT202609291206 / 箱子 L000468`**，本页扫码与打印入口冻结。
3. **切到另一任务 1207**：页面头变成 `WT202609291207`，但冻结卡片**仍是 `WT202609291206 / L000468`** —— 原定位未被当前任务覆盖（这正是本批修掉的失效场景）。
4. 放开代理 → 点「确认上次结果」→ 页面复位、扫码入口恢复；`localStorage` 的 `records` 变回 `[]`。
5. **只读核对：箱 468 的 `print_jobs` 数 `2 → 2`**（基线 3874 + 本次 3878），**确认不再新增**。

**第二幕 · 完成打包丢响应 + 原任务已 6**：
1. 在 1207 点「完成打包并进入待出库」。代理日志：`[DROP-HELD] PUT /api/warehouse-tasks/1207/pack-done upstream=200`。
2. 同页进待确认，冻结卡片 `上次完成打包（结果待确认） / 任务 1207`（**当时 metadata 只有 `taskId`，故卡片只显示任务号**；`taskNo` 是本轮之后才补的字段，见 §9）。
3. **只读核对：任务 1207 已是 6**（后台真的成功了）。
4. **离页 → 重挂回 1207**：仍显示 `有 1 个操作待确认` 与**恢复入口** —— **没有**被「当前任务不能打包」的整页替换顶掉（本批给该分支加了 `&& !noticePendingAction`）。
5. 放开代理 → **切到任务 1206（仍为 5）** → 冻结卡片仍显示 `任务 1207`（原任务）→ 点确认 →
   页面出现 **`原任务 #1207 的「完成打包」已确认；当前任务以本页状态为准。`**，并且**当前页 1206 仍是正常打包视图**（**没有**被标成「打包完成！」）。

**整页 reload 用例（真 `reload`，非 hash 导航）**：

| | reload 前 | reload 后 |
|---|---|---|
| `performance.timeOrigin` | `1790687239016.5` | **`1790687416731.2`**（新文档） |
| `navigation.type` | `navigate` | **`reload`** |
| localStorage | `package-print-label-1790687407648-i092va6q`（`action: package.print-label`，metadata 含 `taskId/taskNo/packageId/packageBarcode`） | **同一 key 不变**，且 reload 后页面**仍显示**「有 1 个操作待确认」 |
| 设备 | 已绑定 | **「当前 PDA 未绑定设备」** ⇒ 凭据确在内存（`secureStorage` 浏览器回退为内存 Map，**实测**） |

重绑后回到 1206：**原 key / 原任务 `WT202609291206` / 原箱 `L000468` 全部保留**。

> **可复核性说明（第一轮）**：上表读数来自**当时执行的命令输出**（`eval` 返回值已如实粘贴）。但该标签随后被替换为 `about:blank`、其 `localStorage` 不可访问，**root 无法独立复核**。因此这一条**只作线索**：既**不记为「已验」**，也**不用来否定**第一轮其余已实测的界面证据（丢响应、同页冻结、切到另一任务仍显示原定位）。

**GUI 资源收尾**（`/tmp/fc-pb-c4-gui-cleanup.cjs`，全部合法 API + 终态断言，无 `[FAIL]`）：任务 **1206 / 1207 → status=8 / 自锁 0**；设备 **222 / 223 → 解绑 + disabled + 票据 0**；打印机 **167 → 解绑 + 停用 + bindings 0**。凭据只落 `/tmp/fc-pb-c4-cred.json`（mode 600），**未回显**。共享 3307 保留。

### 8.1 第二轮 GUI：**独立自建仓**（不复用共享 WH1）+ 只读事实窄修

按「只用本批独立资源」的口径重做一轮：`/tmp/fc-pb-c4b-seed.cjs` 在**自建仓 81** 内建库位 / 分拣格 / 打印机 169（`package_label` **只绑仓 81**）+ 客户端 / 设备 225（绑仓 81），业务链全在该仓；任务 **1208 / 1209**（后补 **1210 / 1211**）。代理 stdout 为 **`/tmp/fc-pb-proxy3.log`**（旧 `/tmp/fc-pb-proxy.log` 是第一次 GUI 的），其中 **`[DROP-HELD] … upstream=200` 保留**。

**本轮窄修 · 只读事实加载不绑状态**（本批内完成，未另开批次）
- **现象（修前实测，任务 1208）**：`pack-done` 后台成功（任务已 6）后页面显示 **`0/0 箱`、`箱子数 0`、`总件数 0`**，并提示「点击下方『新建箱子』开始打包」；而**数据库事实是 1 个箱（`L000470`，status=2）+ 30 件**。截图 `/tmp/fc-pb-c4b-1208-pending.png`。
- **根因**：`packages` 查询 `enabled: … taskDetail?.status === WT_STATUS.PACKING` —— 状态一变查询就不发，`packages` 退化成 `[]`，页面把**没查**画成「0 箱 0 件」。
- **修**：`enabled` 放开状态条件（`taskId > 0 && !taskLoading`），只读事实照常加载；**写操作仍各自校验 `status === PACKING`**（建箱/装箱/移出/作废/完成/完成打包），本页冻结（`anySubmitBloced`）在此状态下照旧生效。
- **修后实测（任务 1210，独立仓 81）**：重绑后页面显示 **`1/1 箱`、`箱子数 1`、`已完成 1`、`总件数 45`、`L000472 1 种，45 件`**，与后台（1 箱 / 45 件）**一致**。
- **组件级红/绿**：临时回退 `enabled` → 新用例失败，报错文本为 **`WT0420/0 箱`**（与 GUI 同形）；恢复后通过。

### 8.2 工具限制与**第二轮未验范围**（不伪造记录）

- **多轮读取之间发生了浏览器上下文重建**（同一 daemon 下 Chrome 进程被换掉），原标签及其 `localStorage` 随之不可访问 —— **原因未证实**；属**浏览器工具 / 资源状态**问题，**不是产品缺陷**。
- 更具体的线索（root 提供，已核对）：两边的 `HTTP_PROXY` / `HTTPS_PROXY` **都是** `http://127.0.0.1:7897`；差异**只在** `NO_PROXY` —— 我这边设了 `localhost,127.0.0.1,::1,.local`，**root 环境未设置**。
  两边的 Chrome launch 参数因此不一致 —— 这**疑似导致**浏览器上下文重建（**强线索，未做控制变量验证**），但**未见有控制变量的对照**，故不写成「`reload` 命令本身有问题」，也不写成「已证实链路」。
- 改用**页面内 `location.reload()`** 后标签保持 `t1`，实测（任务 1210）：`performance.timeOrigin` `1790688467263.8 → 1790688498861.2`、`navigation.type` `navigate → reload`、localStorage **原 key 不变**、URL 不变。
- **未验（第二轮 GUI）**：
  - **「刷新后原 key / 原任务定位保留」**——上述 `location.reload()` 的读数来自当时的命令输出，但随后该标签被替换成 `about:blank`、`localStorage` 不可访问，**root 无法独立复核，故不记为已验**；
  - **「切到另一 status=5 的任务确认原回执、不误完成当前任务」**——GUI 未做（`1210` 的 pending 记录随上下文丢失）。该行为**在组件层已有用例覆盖**（`C4 完成打包在别的任务页确认原任务回执：只说原任务，不改当前页为「打包完成」`）。
  - ⇒ **上面两条已于 2026-09-30 在本机真实 GUI 补验**（v0.11.4 发布之后的补验），证据见 §12。本节为历史记录，**原样保留、不因补验而改写**。
  - 已保留的真实证据：代理 `[DROP-HELD] … upstream=200` 日志、DB 事实（1208：1 箱 30 件；1210：1 箱 45 件）、修前截图、以及上述 `location.reload()` 的前后读数（**标注为「当时命令输出，现场不可复核」**）。

## 9. 隔离偏差与恢复（如实记录）

**偏差**：本批 GUI seed **复用了共享作业仓 WH1**，并用 `PUT /printer-bindings/package_label` 把自有打印机 **167** 绑到 WH1 —— 这**静默改动了共享打印路由**；随后收尾又 `DELETE` 了该绑定。这不符合「只用本批独立资源」的口径。

**取证**：`print_jobs` 中 `warehouse_id=1 AND job_type='package_label'` 在 seed 之前（12:11–12:32Z）的记录全部 `printer_id=1` 且 **`dispatch_reason='binding'`**（**非 fallback**）。
> 措辞边界：这是「**seed 之前最近一批真实箱贴任务的路由证据**」，**不是 seed 前的即时绑定快照** —— seed 发生在 **13:08Z 附近**，与该批任务（最晚 12:32Z）之间约有 **36 分钟空档**，期间是否有过改动无法从这条证据断言。

**恢复**：依上述**历史路由证据**走真实 API `PUT /printer-bindings/package_label { printerId: 1, warehouseId: 1 }` → 200；核对 `printer_bindings` 现值
`WH1 / container_label → 1`、`WH1 / rack_label → 1`、`WH1 / package_label → 1`（另两条**原本就在**，未被本批触碰；恢复后经 root 独立复核予以确认）。
> 记为「**依历史路由证据恢复到 printer 1；未取得改前快照**」，**不**主张「精确还原原值已实测」。无其它候选值，不再反复更改。

**后续**：新的 GUI / 补充用例**改用独立新仓 + 库位 + 自有打印机 + 自有设备**（与 API 脚本口径一致），不再复用 WH1。

## 10. 契约变更记录（需下游知情）

| 变更 | 说明 |
|---|---|
| `POST /api/packages/:id/print-label` 缺箱 | 由「现算 409 且留 PENDING 回执行」改为 **`404 PACKAGE_NOT_FOUND`，且不留回执行 / 不留队列行**（原 key 可重试） |
| `print-label` 路由 | 加 **`pdaSessionOptional()`**：纯 PC 请求走权限 + 数据范围；带 `X-Client: pda` 或 `X-PDA-Session` 则按 PDA 口径完整校验设备（缺票 403 `PDA_SESSION_REQUIRED`，设备仓不符 403 `PDA_WAREHOUSE_MISMATCH`） |
| 箱贴幂等键 | `package_label:<requestKey>` → **`package_label:<packageId>:<requestKey>`**（不截断；超长由 createRecord 明确 400 并整体回滚） |
| `GET /api/system/request-status` | 对 **`package.print-label` 的成功回执**增加**领域自洽校验**：`data.job` 的 `ref/refId` 必须与 `receipt.resourceId` 一致，否则 **409 `PACKAGE_LABEL_RECEIPT_MISMATCH`**；`queued=true` 但无 job → 409 `PACKAGE_LABEL_RECEIPT_UNVERIFIED`。**不改** `operationRequest` 的查询匹配语义 |
| `PUT /api/warehouse-tasks/:id/pack-done` | 状态规则移到幂等 `begin/replay` **之后**：原 key 重放回原回执（200）；**新 key 对已推进状态仍 400** |

## 11. 仍未验 / 待办

- **真 PDA 真机、物理打印**未验；用例与 GUI 里的打印核销都是**真实 API 闭环**（`claim-client` + `ackToken` + `complete-client`），**不代表实际出纸**。
- `PF1` 只覆盖「回执写入失败」**一种**故障注入。
- 本批新增/改动的**全量相关套件**（`smoke:mainline`、`smoke:concurrency-guards`、`smoke:print-queue`、`test:label`、`test:print` 等）按 AGENTS §3 留到**发版前**统一跑；本批只跑了受影响的专项与静态守卫。
- **`taskNo` 的 GUI 证据范围（勿夸大也勿抹掉）**：**「提交后待确认卡片显示原单号」已验** —— root 独立读过任务 1208 提交后的 pending 记录
  （`metadata.taskNo = WT202609291208`），并查看了当时的冻结卡片截图 `/tmp/fc-pb-c4b-1208-pending.png`（卡片显示该原 WT 号）。
  **未验的部分**：**刷新 / 重绑之后的定位**（见 §8.2）。GUI 第二幕当时卡片只有 `taskId`（`taskNo` 为本轮后补字段）。
- **B 待查 · hook 主成功路径的 metadata 校验缺口**：`useCriticalPdaAction.confirmPending` 的主成功路径
  （查询直接返回 `status === 'success'`）**直接清 pending 并 `onConfirmed`**，不经 `resolveServerState` ⇒
  前端层的「旧 scoped 记录 / 残留 metadata 归属校验」**不覆盖**这条路径。是否需要在该路径上补校验、
  以及怎样补才不破坏公共 hook 语义，**尚未定**；因**无真实错目标缺陷证据**，本批**不改公共 hook**。
  **此错配分支仍缺全链路证据**：本批组件证据只证明 `frozenRecordTrusted` 与 `resolveServerState` 两条分支
  （§12 记录的合法成功路径 GUI 另有独立证据，**不因此项而被否定**）。
  · **2026-09-30 独立复核**：旧版保存的 scoped action 为 `package.finish` / `package.print` /
  `warehouse.pack-done`（`package.print-label` 是 `requestAction`），其**目标与提交 `metadata` 同源**；
  现版在**存在旧 pending 记录时会阻断新提交**（`useCriticalPdaAction.run` 的 `pendingRecord` 守卫），
  未归属记录又不保留 `metadata` ⇒ **本次未找到产品自身可达的错配记录**。因此**未做此分支的真实错配 GUI 证据**；
  「`success` 不调用 resolver」**仍是防御性观察**，**本轮不改公共 hook**，也**不主张**该路径绝无风险。
- **第二轮 GUI** 的「刷新后原 key 保留」与「切 task 5 不误完成」**未验**（见 §8.2 工具限制）。
  · **不得**据这两个未验项宣称 GUI 闭环已验；
  · 也**不得**用它们否定**第一轮**已实测的界面证据（丢响应、同页冻结原任务/原箱、切到另一任务仍显示原定位）；
  · 反之，**第一轮的界面证据也不能充作窄修后的界面** —— 窄修后的箱件呈现只在 §8.1（第二轮）观察。
- 第二轮 GUI 资源收尾（`/tmp/fc-pb-c4b-cleanup.cjs`，全部合法 API + 终态断言，无 `[FAIL]`）：任务 **1208 / 1209 / 1210 / 1211 → status=8 / 自锁 0**；设备 **225 / 226 → 解绑 + disabled + 票据 0**；打印机 **169 → 停用 + bindings 0**；仓 **81 → `is_active=0`**（残留容器 `s1:4 s2:8` 登记保留）；上一轮半成品仓 **80 / 设备 224 / 打印机 168** 独立只读复核：解绑 + disabled + 停用。共享 3307 保留。

## 12. 2026-09-30 补验（v0.11.4 发布之后的真实 GUI）

> 本节为**发布后补验**，补齐 §8.2 登记的两个未验项。§8 / §8.1 / §8.2 的历史记录（含当时的失败与工具限制）
> **原样保留**，不因本节而改写。本轮**未改动任何产品代码**。

**环境**：有效取证阶段固定参数、不变（首轮曾误用系统 Node 26 启动，随即用 Node 22.23.2 重启并保留更正记录，见文末）。`agent-browser` 0.36.0，会话 `flow-plastic-box-c4r2-20260930`；
后端 `/tmp/fc-pb-server.cjs` 用 **Node 22.23.2** 起在 `127.0.0.1:3399`（`DB_HOST=127.0.0.1` / `DB_PORT=3307` /
`DB_NAME=flowcube_plastic_box_20260929_test`）；PDA 前端 **5173**；代理 **3400→3399**；`NO_PROXY=localhost,127.0.0.1,::1,.local`。

**本批夹具（全新自建仓 82，未复用 WH1）**：库位 27、分拣格 822–825、打印机 **170** + 自有 client（`package_label` 只绑仓 82）、
PDA 设备 **227**（绑仓 82）；任务 **1212**（`WT20260930001`，箱 `L000474`）与 **1213**（`WT20260930002`，箱 `L000475`）。
两箱贴均先 finish，再由本批 client 真实核销（`claim-client` → `ackToken` → `complete-client`）。

**入口一 · 箱贴 `print-label` 丢响应**
1. 代理（**只扣本批目标**：`POST /api/packages/474/print-label`、`PUT /api/warehouse-tasks/<1212|1213>/pack-done`；回执查询只扣**已被本批写入捕获的原 requestKey**）置 `drop` → 点「打印箱贴」→ `[DROP-HELD] POST /api/packages/474/print-label upstream=200`（后台真实成功）。
2. pending 记录：原 key `package-print-label-1790697953107-yx6h9jh3`、`taskNo=WT20260930001`、`packageId=474` / `packageBarcode=L000474`。
3. **完整 reload**（非 hash 导航）：`performance.timeOrigin 1790697780720.8 → 1790697970732.4`、`navigation.type navigate → reload`；localStorage 原 key **逐字不变**；页面显示「当前 PDA 未绑定设备」。
4. **合法重绑设备**后：仍为同 key / 同 WT 单号 / 同箱；页面「有 1 个操作待确认」+ 冻结卡片 `任务 WT20260930001 / 箱子 L000474`。
5. 放开代理 → GUI 确认 → pending 清空、页面复位；**按 `printer_id=170 + ref_type=package + job_type=package_label + ref_id=474` 核对：确认前 2 条（3894 status2 + 3898 status0）→ 确认后仍 2 条**（避免 `ref_id` 跨 `ref_type` 碰撞）。
6. 用本批 client 真实核销 3898（`claim-client → complete-client` 200，status→2），任务 1212 恢复为可正常完成的 status=5。

**入口二 · `pack-done` 丢响应**
1. 代理置 `drop` → 在 1213 点「完成打包并进入待出库」→ `[DROP-HELD] PUT /api/warehouse-tasks/1213/pack-done upstream=200`；action 为 **`warehouse.pack-done`**（订正：代理首版误写 `warehouse_task.pack-done`）。
2. **完整 reload**：`timeOrigin 1790697970732.4 → 1790698219769.5`、`navType=reload`；pending 原 key `warehouse-pack-done-1790698209181-rjbzr1fj`（`WT20260930002`）保留；重绑后仍保留。
3. **切到当前任务 1212**：页头 `WT20260930001`，冻结卡片仍为 **`上次完成打包（结果待确认）／任务 WT20260930002`（原 1213）**，当前页仍是正常打包视图、**未被标成「打包完成」**。
4. 放开代理 → 在 **1212 页面**真实点「确认上次结果」→ 页面提示 **`原任务 #1213 的「完成打包」已确认；当前任务以本页状态为准。`**；当前页 1212 仍为正常打包视图，`完成打包并进入待出库` 与 `＋ 新建箱子` 按钮均可用；pending 清空。

**DB 独立读数（本轮结束时）**：任务 **1212 status=5**、**1213 status=6**；箱 474 的 package_label jobs **2 条均 status=2**；
1213 `warehouse_task_events` 的 `PACK_DONE` **仍 1 条**；本批回执行 `package.print-label.474` 与 `warehouse.pack-done.1213` 各成功 1 条。

**证据文件**：`/tmp/fc-pb-c4r2-printlabel-pending-reload-rebind.png`、`/tmp/fc-pb-c4r2-packdone-1212-with-1213-pending.png`、
`/tmp/fc-pb-c4r2-cross-target-confirm-after.png`、代理日志 `/tmp/fc-pb-c4r2-proxy2.log`、夹具 ledger `/tmp/fc-pb-c4r2-ledger.json`。

**方法订正与边界（如实记录）**
- 代理首版误把 action 写成 `warehouse_task.pack-done`，**实际前后端均为 `warehouse.pack-done`**（`pack.tsx:366/367`、`warehouse-tasks.pack.js:35`）；回执扣留原先按 action 泛化，已改为**只扣本批写入捕获过的 requestKey**。属方法错误，**非产品缺陷**。
- 服务首轮误用系统 Node 26 启动，已用 **Node 22.23.2** 重启并保持三个服务一致；属**环境问题**。
- 两入口全程**未重造业务响应、未改产品代码**；打印核销为**真实 API 闭环**（`claim-client` + `ackToken` + `complete-client`），**仍不代表实际出纸**；真机与物理打印仍属未验（见 §11）。

**收尾（全部合法 API + 终态断言；下面读数经 root 在同会话独立核对）**：任务 **1212 / 1213 → status=8 / 自锁 0**；
设备 **227 / 228 → 解绑 + disabled + 票据 0**；打印机 **170 → status=0**，仓 **82 的 `package_label` 绑定数 0**；
**仓 82 → 停用**（残留容器登记保留，**不物理删**）。两个原请求键（`package-print-label-…`、`warehouse-pack-done-…`）
的**成功回执仍保留**。浏览器 `session list` 为空、本批三个端口（3399 / 3400 / 5173）已释放；
共享 3307 与旧测试历史未动。
