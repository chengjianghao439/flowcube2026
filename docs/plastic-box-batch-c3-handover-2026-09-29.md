# 批 C3 实施交接 · 2026-09-29 · 后台成功丢响应与重挂恢复

> 状态：**已完成并实测** —— 前端两处缺陷已窄修、组件用例 **15 项全绿**、**真实 GUI 丢响应 / 换目标 / 整页刷新（真 reload）闭环已实跑通过**（§5）；seed 资源**已全部合法收尾**（§6）。**未发布**（提交状态以 Git 为准）。
> 关联：C2（finish 回执事务）见 `docs/plastic-box-batch-c2-handover-2026-09-29.md`；C1（移出 / 作废）见 `docs/plastic-box-batch-c1-handover-2026-09-29.md`。

## 1. 两处真实缺陷（已定位）

**缺陷 1 —— 用列表状态猜「本次完成」**（`pack.tsx` 的 `finishAction.resolveServerState`）：
原实现取 `getPackagesApi` 后**只要该箱 `status === 2` 就判本次成功**。但 `status=2` 只说明「这个箱现在是已完成」，
**完全可能来自上一次**（工人重复点击、或该箱本来就早完成）—— 等于把「本次意图」的回执猜成了别的操作的结果。

**缺陷 2 —— finish 的 action 绑 `taskId`**：原为 `package.finish.<taskId>`。
`usePendingRequests` 是**按 action 名**存 / 找 pending 的，换到别的任务再重挂后 action 名随之改变，
**原 pending 匹配不上** ⇒ 冻结定位与「确认上次结果」入口一起消失。

**兼容风险（改 base 本身会引入）**：直接把 action 改成 base，会让**旧版本已经落盘**的 scoped 记录
永久不可见 —— 等于把原问题换个形式。故必须**页面层兼容**（见 §3）。

## 2. 红证据（组件）

`frontend/src/pages/pda/pack.test.tsx` 首轮（1 failed）：

- `C3 完成箱子恢复：列表 status=2 不能当本次成功` → `expected true to be false`（原实现返回 `effective: true`）
- `C3 …注册的 action 不绑 taskId` → 失败（实际注册的是 `package.finish.42`）

## 3. 窄修

- **只认原键回执**：`resolveServerState` 改为
  `getOperationRequestStatusApi(record.requestKey, 'package.finish.<箱id>')`，非 `success` 一律 `effective: false`，
  且校验 `resourceId` = 原箱；**旧版 scoped 记录**还要求 `action` 后缀 === `metadata.taskId`，`unverifiedOwner` 一律不据以恢复。
- **`finishAction.action` 改为 base `package.finish`**（不绑 `taskId`），服务端幂等 action 仍是 scoped。
- **兼容旧记录（页面层，不改公共框架）**：`usePendingRequests()` 里只要有 `package.finish.<数字>` 的旧记录，
  就**沿用它的 action**（因而沿用原 key / 原 metadata），使旧记录**继续阻断、不静默消失**；
  **新操作**才用 base。是否**据以恢复内容**另有三道严格校验（后缀 === `taskId`、`packageId` 正整数、owner 可信），
  不满足时**不展示原内容**（只提示「归属无法确认，请人工核对」）+ 保留阻断 + 由用户显式清除。
- **冻结定位补全 / 文案**：`finishMut` 的 metadata 补 `taskNo` / `packageBarcode`；成功文案不再说「当前箱」
  （恢复 / 换目标后「当前」可能已不是原箱，成功与否是**回执里那个箱**的事）。

**未修（同类问题，如实记录）**：`printAction`（`package.print.<taskId>`）、`finalizeAction`（`warehouse.pack-done.<taskId>`）
也带 `taskId`，换任务重挂同样会失联。**本批只按 C3 范围窄修 finish。**

## 4. 测试

`frontend/src/pages/pda/pack.test.tsx` **13/13 natural exit 0**；`tsc -p tsconfig.app.json` **0**；前端 eslint **0**。

覆盖：列表 `status=2` 不判成功 · 原键 `success` 才判成功 · 注册 action 不绑 `taskId` ·
**旧 scoped 记录沿用原 action 且归属一致时展示原内容** · **残缺记录仍阻断但不展示原内容** ·
**后缀与 `metadata.taskId` 不一致时不据以恢复** · **回执绑定别的资源时拒绝**。

> **口径**：这些都是**组件级**证据（**mock 了 hook**），证明的是**页面用法与注册的 action 名**，
> **不等于**真实持久化重挂、也不等于真实丢响应已验。

## 5. 真实 GUI 闭环（**已执行并通过**）

**环境事实（实测，非据注释）**：`agent-browser` 0.36.0；`/tmp/fc-pb-server.cjs` 用 **Node 22.23.2** 起在 `127.0.0.1:3399`，进程 env 实测 `DB_HOST=127.0.0.1 / DB_PORT=3307 / DB_NAME=flowcube_plastic_box_20260929_test`；`/tmp/fc-pb-vite.sh` 起 PDA 前端 **5173**；`/tmp/fc-pb-proxy.cjs` `3400→3399`（**本批已补** `packages/:id/(finish|remove-item|void)` 目标）。浏览器会话 **`flow-plastic-box-20260929`**。
**页面是 HashRouter**：正确地址形如 `http://127.0.0.1:5173/#/pda/pack?taskId=<id>`（query 在 hash 内）。
**PDA 设备凭据只在内存（`secureStorage` 非原生回退为内存 Map）**：整页刷新/重新 open 后必须重新绑定 —— **这是既定设计，不是缺陷**（本批实测到该行为，另记录范围）。

**动作与证据（真实浏览器 + 真实代理，未手造 pending）**：

1. **触发丢响应**：代理置 `drop`（扣住 2xx 且**挡住** `GET /api/system/request-status/…`）→ 在任务 **1120** 打包页点「完成此箱」。
   结果：上游 `PUT /api/packages/383/finish` **upstream 200**（root 独立核实为 DROP-HELD），页面进入
   「**有 1 个操作待确认**」+「结果待确认 / 网络波动…」；`确认上次结果` / `结果未生效，清除记录` 出现；
   **本页冻结生效**（`处理中…`、`作废中…`、`手动输入`、`＋ 新建箱子` 均 disabled；移出/扫码 handler 另有守卫）。
2. **冻结定位（本批新增字段）**：卡片显示 `上次完成箱子（结果待确认） / 任务 WT202609291120 / 箱子 L000383 / 数量 整份`。
3. **真实持久化**：`localStorage` = `pda_pending_request_confirmations`，
   `{version:2,userId:1,records:[{requestKey:"package-finish-…", action:"package.finish", requestAction:"package.finish", label:"完成箱子", metadata:{taskId:1120,taskNo:"WT202609291120",packageId:383,packageBarcode:"L000383"}}]}` ——
   **action 是 base**（本批修复），非旧版 scoped。
4. **第二笔真实丢响应（1121 / 箱 384）之后才换目标**：步骤 1–3 是**第一笔（1120 / 箱 383）**；本步**先**在**另一个真实待打包任务 1121** 上重复了一次丢响应（箱 **L000384**，形成本步要用的 pending），随后离页（返回 → 打包作业）进**第三个真实待打包任务 1122**，
   页面**仍然**显示「有 1 个操作待确认」，卡片仍是 **`任务 WT202609291121 / 箱子 L000384`** ——
   即**换了任务页仍能找到并展示原任务的冻结定位**（这正是本批修掉的失效场景）。
5. **放开代理 + 原 key 确认**：代理置 `off` → 点「确认上次结果」→ 页面复位（1122 恢复 0/1），
   `records: []`（pending 清空）。只读 DB 核对：`packages.384 status=2`、`print_jobs` 该箱 **=1**（未重复入队）、
   `operation_requests` 两笔 finish 回执分别为 `package.finish.383/SUCCESS/资源383`、`package.finish.384/SUCCESS/资源384`（**各绑原箱**）。

**日志**：代理 `/tmp/fc-pb-proxy.log`、后端 `/tmp/fc-pb-server.log`；造数与绑定凭据只落 `/tmp/fc-pb-c3-cred.json`（**mode 600**），**未**在任何输出/文档中回显设备密钥或票据。

6. **整页刷新（真 `reload`，非 hash 导航）**：在任务 **1123**（箱 L000386）重复 1 的丢响应 → 用 `agent-browser reload`：

   | | reload 前 | reload 后 |
   |---|---|---|
   | `performance.timeOrigin` | `1790685077928` | **`1790685163732`**（新文档） |
   | `navigation.type` | `navigate` | **`reload`** |
   | localStorage | 原 key `package-finish-1790685123664-c3gqhhqd` | **同一 key 不变** |
   | 设备 | 已绑定 | **「当前 PDA 未绑定设备」** ⇒ 凭据确在内存（`secureStorage` 浏览器回退为内存 Map，**实测**非套用旧结论） |

   合法重绑后回到 1123：**原 key / 原 task `WT202609291123` / 原箱 `L000386` 全部保留**；放开代理点确认后复位，只读 DB：`packages.386 status=2`、该箱 `print_jobs` **=1**、回执 `package.finish.386/SUCCESS/资源386`（唯一、绑原箱）。

   > **方法纠正（自查）**：先前我用 `open` 到**仅 hash 不同**的 URL，那是**同文档导航**（`navigation.type` 仍为 `navigate`、`timeOrigin` 不变），**不能**叫整页刷新。上面这一版才是真 reload。

## 6. 资源收尾（已完成）

**全部 seed 资源已合法收尾**（脚本 `/tmp/fc-pb-c3-cleanup.cjs`，走真实接口，不物理删历史）：

- **销售 / 任务 7/7**：`remark LIKE 'pb-c3-%'`（含 GUI 用过的 1120 / 1121 / 1122 / 1123 与更早失败的 1118 / 1119）逐笔 `cancel` → 容器 `cancel-return` → **已完成箱 `cancel-return/box` 受控拆箱** → 只读核对 **`status=8` 且自锁 0** 全通过（1124 无已完成箱，同样 8/锁 0）。
- **PDA 设备（本批前缀 `PB-C3-*` 共 9 台，全部终态 `warehouseId=null` + `status=disabled` + 有效票据 0）**：
  **188 / 189 / 190 / 191 / 192 / 193 / 194 / 195 / 196**。
  其中 **193 / 194** 是收尾脚本自身建的临时设备（脚本第一次运行时**只打印了 id 未登记进收尾数组**，属脚本疏漏 → **独立复核时发现并单独补齐**：先只读确认 `deviceName=PB-C3-CLEANUP-*` 属本批，再用 ERP API 解绑 + 停用，有效票据核为 0）。
  自建仓 **45 / 46** 已软删。
- **未物理删除**任何库存 / 销售 / 打印历史。

## 7. 独立复核（root，2026-09-29，非本会话自证）—— 结论：本批接受

- **组件** `frontend/src/pages/pda/pack.test.tsx` **15/15，natural exit 0**（`/tmp/flow-plastic-box-c3-final-codex-20260929.log`）。
- **AGENTS 注入守卫**：`npm run test:agents-md-guard` **natural exit 0**（`/tmp/flow-plastic-box-c3-doc-codex-20260929.log`）。
  > **订正**：此前所谓「26 CI + 文档守卫」中的 **26 是 `deployment-resources` 脚本本身**，AGENTS 守卫当时**用了错误的文件名、实际未跑**；本轮已按正确脚本名补跑。
- **资源只读复核**：9 台设备 **188 / 189 / 190 / 191 / 192 / 193 / 194 / 195 / 196** 全部**解绑 + disabled + 有效票据 0**；7 个任务（1118–1124）**`status=8` + 自锁 0**；自建仓 **45 / 46 软删**；**4 个 GUI 箱（383–386）合法作废、各自历史 `print_jobs` = 1、成功回执 = 1**。
- **环境**：`agent-browser` 会话列表为空；**3399 / 3400 / 5173 无监听**；`git diff --check` = **0**；共享 3307 保留。

## 8. 仍未验 / 待办

- `printAction` / `finalizeAction` 的 `taskId` 失联**未修**（本批只修 finish）—— 已列入下一小批 C4 的取证范围。
- 真 PDA、物理打印未验。
- 组件用例（15 例）仍是 **mock hook** 的页面用法证据；真实持久化 / 丢响应已由 §5 的 GUI 证据覆盖，但**旧记录兼容**这一条**仍只有组件证据**（GUI 未构造旧版 scoped 记录）。
