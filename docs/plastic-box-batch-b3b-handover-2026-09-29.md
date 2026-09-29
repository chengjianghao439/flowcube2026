# 批 B3b 实施交接 · 2026-09-29

> 状态：**B3b（装箱配额按来源取货标签分行 + remove/void 回收）已本地实施，套件 8 项全绿；未提交、未发布。**
> **B1/B2、B3a 与 B3b 均已独立审查接受**；**B4（取货码取消 / 减量归还）待独立审查**（见 `docs/plastic-box-batch-b4-handover-2026-09-29.md`）。
> **B4（取消 / 减量归还闭环）本短批未做**——`sale_order_adjustment_container_returns` 的**完整减量真实验收仍属 B4，不得据本文宣称通过**。
> 本批覆盖范围仅 **API / service / 组件**，**不代表 GUI 与物理出纸**。

## 1. 范围（本轮已授权）

- **装箱配额**：`package_items` 增加 `label_container_id`（NULL = 按商品码的旧 SKU 份额），配额**按来源分行**统计，新旧互不吞份额。
- **回收**：`remove-item` 删除/扣减、`void` 作废后配额自动释放（统计口径带 `p.status != 3`）。
- **不做**：B4 的取消与减量归还闭环；**已完成箱的作废沿用既有改单受控流程**（未改）。

## 2. 代码改动

**后端**
- `backend/src/database/268_package_items_label_container_id.sql`（新，幂等）：`package_items.label_container_id BIGINT UNSIGNED NULL` + 索引按 AGENTS 用**独立幂等 DDL** 补（`idx_pi_label`）。
- `backend/src/modules/packages/packages.service.js`：
  - `addItem` 支持两种形态：`{ productCode, qty }`（旧 SKU）与 **`{ labelBarcode, qty? }`**（取货标签）。
    - **入参用条码而不是容器 id**：`I` 码的条码是**独立序号**（实测 `id=3076` ↔ `barcode=I002053`），与 `inventory_containers.id` **不相等**，PDA 只能拿到扫到的字符串。响应里同时回 `labelContainerId` + `labelBarcode`。
    - **`qty` 省略即整份**：装入该标签的「未装余量」，不是 1；显式给量则不得超（`PACK_LABEL_OVER_REMAINING`）。
    - 标签校验链：`container_type=1`（塑料盒条码明确拒绝）→ 当前任务锁定 → 仓库一致 → **真实盒取货 PICK**（`scan_purpose=1` 且 `source_container_id` 非空，**不认容器历史 `source_ref_type`**）→ 唯一明细 → 商品一致 → **真实 CHECK 量**（`PACK_LABEL_NOT_CHECKED`）。
    - **旧 SKU 上限 = `checked − Σ标签的真实复核量`**（`PACKAGE_LEGACY_OVER_LIMIT`）：依据是标签**占住的份额**而非「已装的标签量」，所以**尚未装的标签货也不会被旧 SKU 吞掉**。
    - 合计仍守 `<= min(required, checked)`（既有 `PACKAGE_ITEM_OVERPACKED` 不动）。
    - 落库匹配键 `(package_id, product_id, label_container_id)`，NULL 与 NULL 视为同一行 ⇒ **旧 SKU 与各标签各自成行**。
    - **幂等**：`beginResourceOperationRequest` 传的是 **base action `package.add`**（helper 会**无条件**再拼 `.resourceId`，传 `package.add.<id>` 会变成 `package.add.<id>.<id>`）；落库的 scopedAction 即 `package.add.<packageId>`。同键重放返回原结果、不二次加量；**范围 / PDA 设备仓校验先于 `begin`**（覆盖重放）。
    - **数量精度**：旧 SKU 分支对**原始入参**校验；标签分支在**最终数量定下来之后**（含「不传数量 ⇒ 整份」这条路径）同样 `assertQtyPrecision`——整数商品不能靠扫标签整份装进小数。
  - **锁序统一**（`addItem` / `removeItem` / `voidPackage` / `markPackageFinishedWithinTransaction`）：**无锁 peek 所属任务 → 锁任务 → 锁 pkg → 复查归属**。
    - 理由：取消流程是 `task → UPDATE packages WHERE warehouse_task_id=?`（锁箱行），原先 pkg→task 的写法与之交叉**会死锁**。**已核对**：`warehouse-tasks/` 下**不存在** `packages ... FOR UPDATE`，即没有现成的 task→pkg 路径，但 cancel 的范围 UPDATE 同样会锁箱行。
    - **未改** `voidCompletedPackage`（既有改单受控流程，属 B4 范畴）。
  - `listByTask` 带出 `label_container_id` + `labelBarcode`（LEFT JOIN 容器），`removeItem` 回执也带 `labelContainerId` —— 新字段**贯穿 add / list / getByBarcode / 移除回执**。
- `backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js`：`candidatePackages` 的 `(SELECT qty FROM package_items WHERE package_id=p.id AND product_id=?)` 是**标量子查询**，新契约下同箱同商品多行会**直接报错** ⇒ 窄改为 `COALESCE(SUM(qty), 0)`。其余 consumer 已 rg 核对（`EXISTS`/`LIMIT 1`/按 `id` 取行/列其它商品），无同类单行假设。
- `backend/src/modules/packages/packages.routes.js` / `.controller.js`：`add-item` schema 改为 `productCode` / `labelBarcode` **二选一**（`refine`），`qty` 可选；controller 透传 `requestKey` 与 `pdaWarehouseId`（原先都没传——幂等与设备仓校验都缺）。

**前端**
- `frontend/src/api/packages.ts`：`AddPackageItemPayload` 联合类型；`addPackageItemApi` 支持请求键；`PackageItem` 加 `labelContainerId` / `labelBarcode`。
- `frontend/src/pages/pda/pack.tsx`：
  - 扫到 `container` 类型（整件 `I` 码）走 **`{ labelBarcode }`**（不传 qty ⇒ 服务端整份）；商品码路径保持 `{ productCode, qty: 1 }`。
  - **装箱接入 `useCriticalPdaAction`**（原先是普通 mutation，没有稳定键、没有冻结、重挂后无从恢复）：
    - `action: 'package.add'`（base，与服务端幂等 action 对齐）；**冻结原目标** `{ taskId, packageId, labelBarcode, productCode, qty }`。
    - **回执定位**走真实 `request-status`：`requestAction='package.add'`（base）——服务端 `getScopedOperationRequestStatus` 支持 base **LIKE 匹配唯一 scoped 行**；`resolveServerState` 里再用**冻结的箱 id** 组 `package.add.<箱id>` 兜底，服务端按 `resource_id` 过滤 ⇒ **只接受原箱**的回执。
    - **不得**用「列表里已有该取货码的行」判本次成功——那可能是先前的部分装入。
    - 恢复成功按回执区分「**本次增量** `addedQty`」与该来源「**累计量** `qty`」，两处提示都写明。
  - **未确认期间冻结**：扫码入口（scanner `disabled`）、`handleScan` 入口、**换箱**、**移出**、**作废**、**完成**、**新建箱子**、**完成整单** 全部受 `addAction.submitBlocked` 约束；页面显示**冻结记录**里的原提交定位（任务 / 箱 / 条码 / 数量），重挂后不让当前界面状态替代原目标。
  - **种数按商品去重**：原先 `pkg.items.length` 显示"N 种"，分行后同商品 50+60+90 会是 **1 种 3 行**，不能显示成 3 种；合计件数不变。
  - 列表每行显示**来源**（`取货码 Ixxxxxx` / `按商品码装箱`），便于移出正确份额。
- `frontend/src/api/packages.ts`：`PackageItem` 加 `addedQty`；`addPackageItemApi` 支持请求键。

## 3. 测试（`tests/pack-quota.smoke.test.js`，**8 项**）

命令（显式回环专库 + Node 22 + 可写下载目录）：

```
set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
export DB_NAME=flowcube_plastic_box_20260929_test NODE_ENV=test APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads
export DB_HOST=127.0.0.1 DB_PORT=3307
node tests/pack-quota.smoke.test.js
```

结果：**8 passed / 0 failed，natural exit 0**（`/tmp/fc-pb-b3b-green.log`）。夹具走**真实链**：采购→收货→上架 → 销售→占库→发货 → 扫盒取货 → ready → `sort-done` → **逐容器真实复核** ⇒ 任务进入待打包(5) → 建箱 → 装箱。用例：

1. **默认整份**：两张标签（60 / 90）不传数量即各装各自整份，且**各成一行**
2. **真 150 标签**：不传数量即装 150（不是默认 1）
3. **幂等 + 回执定位**：同键重放返回原结果且不二次加量；**真实走 `GET /api/system/request-status/:key`**，**base（`package.add`）与 scoped（`package.add.<箱id>`）两种定位都能查到**原成功回执（`status=success`、`data.qty` 与原一致、`resourceId` 为本箱）；**问别的箱子必须 `not_found`**（只接受原箱）；**换新键**重复装同一标签被拒（未装余量为 0）
4. **同 SKU 混合**：装了标签 60（另一张 90 尚未装）时，旧 SKU 报 140 被拒、报 50 放行 ⇒ 上限确为 `checked − Σ标签CHECK = 50`
5. **部分装箱 + 回收不串份额**：标签装 20 → 余量补到 60 → 移出 10 → 超余量被拒、按余量装回、旧 SKU 50 仍可装
6. **作废回收**：作废箱子后同一标签可在**新箱**重新整份装入
7. **越权与阶段闸分开**：他任务标签被拒（底层归属闸）；任务停在待复核(4) 时**建箱本身即拒**（阶段闸）
8. **取消后不得装箱**（既有保护不弱化）

**红测证据（如实标注强度）**

- **已取得的证据是源码层面对比**（`git show HEAD:`）：HEAD 的 `add-item` schema 只接受 `productCode`+`qty` **双必填**、`packages.service.js` 中 `label_container_id` 出现 **0 次**、`addItem` 签名仅为 `{ productCode, qty }` ⇒ **旧契约无法按取货标签装箱**。
- **未取得的**：一次干净的「实现前先跑套件」红灯。首轮运行确实 **S1–S8 全失败**，但当时失败含**迁移 SQL 语法错误**（`--（` 裸注释）与**测试自身的 client 调用签名错误**，**不能**单独当作装箱业务缺陷的红证据。
- **尝试过但不可行**：用 HEAD 基线 worktree 复跑该套件——**批 A/B 的全部改动都未提交**，基线缺 `fill` 等端点，红灯落在夹具前置上，不能作为干净证据。

**受影响的既有回归（本批自跑）**：`sale-adjustment` **72/0**、`concurrency-guards` **121/0**、`pda-device-session` **28/0**、`pick-code-downstream`（B3a）**19/0**。
**静态检查**：前端 `tsc -p tsconfig.app.json` exit 0；`pack.tsx` / `pack.test.tsx` / `api/packages.ts` eslint exit 0；后端 4 个改动文件 eslint exit 0。

**前端组件用例**（`frontend/src/pages/pda/pack.test.tsx`，**3 passed**；独立复跑同为 3/3）：待确认期间**扫码入口冻结**、显示**冻结记录**里的原提交定位（任务号 `WT041` / 箱码 `L000007` / 条码 / 数量为空 ⇒ 整份）——**冻结值与当前界面刻意不同**（当前是 `WT042` / `L000008`），否则「拿当前值替代」也会变绿；恢复成功区分「本次装箱 20」与「累计 60」；**成功反馈收敛到单一 `onConfirmed`**（正常提交路径不再重复发第二条 ok）。与 B3a 的 `sort.test.tsx`（4 例）同一套 mock 方式，**不扩公共 hook**。
> **局限（重要）**：组件用例**只 mock 了 `useCriticalPdaAction`**，因此**不代表**真实的 **localStorage 持久化重挂恢复**、也不代表**真实网络中断→恢复**链路；这些仍属**未验**。

**夹具**：全部由真实业务链建立，**未手改库存/状态/锁**；`finally` 按自建 ID 逐笔合法取消 + 归还并只读核对 `task=8 且自身锁 0`（本轮 **10 笔全通过**），自建分拣格逐格 `try/catch` 删除。

## 4. 证据边界与仍未验（如实）

- 走 **HTTP 全链**：全部 8 项。
- **1. GUI 全程未跑**：本轮未启浏览器。打包页扫取货码的提示、**按来源分行的列表**、"种数按商品去重"的显示均**代码已改但未在真实界面验证**。
- **2. `PACK_LABEL_NOT_CHECKED` 在完整链下不可达**：任务进入待打包(5) 的前提就是 `assertTaskCheckScanClosure`（锁定集合 == 扫码集合全部复核完），所以「已锁定但未复核」的容器**构造不出来**，该分支属**防御性兜底**，**未实跑**。用例 7 只证明**阶段闸**，未证明该底层闸。
- **3. 真实并发未验**：`uk`/锁序只在顺序场景验证；pkg 与 task 的交叉死锁**只做了锁序统一与代码核对**，无并发夹具。
- **4. B4 未做**：取消 / 减量的归还闭环；`warehouse-tasks.adjust.js` 的减量路径只做了 **SUM 窄改**，**完整减量真实验收仍属 B4**，本批**不宣称通过**。
- **5. 物理打印 / 待出库**：`finish` 与箱贴打印链本批**未走**（不强行推进凑验收）；打印客户端模拟**不代表实际出纸**。
- **5.1 `finish` 的两处既有行为本批未覆盖（明确列出，未改）**：
  - **历史回执事务**：`finish` 的幂等 `beginResourceOperationRequest` 在 **controller 层**用 `pool`（不是 pkg 事务连接）执行，replay 时直接返回 `requestState.responseData`；它与 `finishPackage` 的库存/打印/运单事务**不是同一个事务**。本批**未审计**该边界。
  - **scope-before-replay**：`finish` 的**范围 / 设备仓校验发生在 replay 之后**（replay 命中就直接返回回执，不再校验归属）。本批**只在 `addItem` 上做了「先于 begin」**，**未**改 `finish`。
- **5.2 `remove` / `void` 无幂等键**：两者按请求体直接执行（无 `beginResourceOperationRequest`），所以「丢响应重放」对它们仍是**重复执行**语义——本批未引入幂等，**未验**。
- **6. 8 项仅为本阶段证据**，不等于批 B 全部验收。

## 5. 资源

- 本轮未启动常驻服务与浏览器；测试进程自起自停。共享 **3307** MySQL 保留，未触碰其它任务资源。
- 取证用的临时 worktree（`/tmp/fc-b3b-baseline`）已 `git worktree remove --force` 清理。
- **未提交、未打 tag、未发布。**

## 6. 续接要点（B4）

- **本批代码定稿，不重做**：`labelBarcode` 契约、两层配额口径（标签未装余量 / 旧 SKU `checked − Σ标签CHECK`）、按 `label_container_id` 分行、锁序 `peek → task → pkg`、`package.add.<id>` 幂等。
- **B4（取消 / 减量归还）**：`warehouse-tasks.cancel-return.js`、`warehouse-tasks.adjust.js`；注意 `reducePickScanLogForContainer` 会**减少或 DELETE 原 PICK 行**，届时取货标签的补打恢复（B2 现为 409 `PICK_LABEL_SOURCE_MISSING`）与**装箱配额**都会受影响，需一并设计。
- **边界**：**仅本地**；禁止发布、禁止连接/迁移生产；不 push、不打 tag；共享 **3307** 与其它任务资源不得触碰。
- **不要把 §4 的未验项当作已通过**（GUI、未复核兜底闸、并发死锁、B4 减量、物理打印）。
