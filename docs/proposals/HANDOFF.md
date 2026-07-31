# Flowcube 功能扩展实施 · 交接词

> 用途：把这批功能扩展的实施工作交接给下一个会话（新的 Claude 实例或本人）。
> 接手第一件事：读 `docs/proposals/README.md`（12 份设计文档索引）+ 两条记忆 `erp-wms-feature-design-docs`（进度详情）、`user-hands-off-full-autonomy`（工作方式）。

## 背景

为 flowcube（单租户 ERP/WMS，Node+Express+mysql2 无 ORM + React18+PDA）实施一批功能扩展。设计阶段已产出 12 份定稿设计文档在 `docs/proposals/`（01-12 + README 索引），现在处于**逐个实现**阶段。

## 工作方式（用户明确要求，务必遵守）

- **全自主**：设计、执行、**验收**全由你做，用户不做任何操作（不起服务、不登录、不点击验收）。
- **验收自己做**：需要浏览器验收时自己 `preview_start` 起前后端 dev server + navigate + 截图。本地 dev 的 localStorage 有 admin 登录态（`USE_PERSISTENT_DEV_SESSION`，JWT 7天），能直接看登录后页面，**无需代输密码**。preview 会话间隔久会自停，重新 `preview_start` 即可。截图坐标系是 800×450。
- **核心逻辑用端到端脚本自验**：放 `backend/scripts/xxx-tmp.js`，`require('dotenv').config({ path: path.join(__dirname, '../.env') })`，跑完删除；造数据务必清理干净（占库要 `release` 反冲 + `syncStockFromContainers` 兜底）。
- **持续自主推进**，不频繁停下等确认——除非遇真正需用户拍板的业务决策或高危不可逆动作。
- **硬边界**：只本地实现，**不 push / 不发版 / 不碰生产 / 不跑删数据 SQL**。

## 进度总览（截至 2026-08-01）

**已发布上线生产**（不再是"本地未提交"）：

| # | 功能 | 状态 | 版本 |
|---|---|---|---|
| 01 | 安全库存与补货建议 | 完整 | v0.4.38 |
| 02 | 采购请购与审批流 | 完整 | v0.4.38 |
| 05 | 客户信用额度 | 完整 | v0.4.38 |
| 06 | 电子面单与快递对接 | 完整（真实快递平台需配 env 凭据+联网，kdniao 骨架已备） | v0.4.38 |
| 08 | 循环盘点与 ABC | 核心完整 | v0.4.38 |
| 09 | 库龄与呆滞报表 | 完整 | v0.4.38 |
| 04 | 序列号管理 | 完整（A–E + F PDA 现场扫 SN + G 验证；serial_managed 灰度默认关） | v0.4.38 + v0.4.39 |

**本地已完成、未提交、已验证**（2026-08-01 本会话新增）：

| # | 功能 | 状态 | 验证 |
|---|---|---|---|
| 08 增强 | ABC 结果详情页 + 循环盘规则维护页（后端补 `GET/PUT /stockcheck/cycle/rules`；前端 `/stockcheck/abc` 双 Tab） | 端到端8断言 + 浏览器截图 + 回归全绿 |
| 11 单据化 | 采购计划 MVP 报表 → 单据（`procurement_plans`+`_items` 迁移172-174、状态机、生成/编辑/**转采购草稿**、2权限码、前端列表+详情页） | 端到端15断言(含转出草稿status=1不自动确认) + 浏览器截图 + 回归全绿 |

**仍未做**：

| # | 功能 | 为什么留着 |
|---|---|---|
| 07 危险核心批 | 改收货结算 `tryFinishTask`(扣拒收量) + `voidReceipt` 反冲 QA/REJECTED 容器 + `check` 接口(照搬 return-tasks `allocateQaContainers`) + PDA 质检页。用户此前选"分步做，危险批留后、在场时做"——**需在场确认再动** |
| 03 多计量单位 | **全链路改造 + 最高风险**，必须灰度。核心红线：库存事实源永远按基本单位存，换算只在录入/展示层。**是否上马需用户拍板** |
| 10 会计总账 | **巨型**。文档 10 建议先定"自建轻量总账 vs 只做凭证导出对接金蝶/用友"——**方向本身需用户先拍板** |

- 07 安全增量（商品/供应商质检开关 + 建单固化 qa_required 快照）已随 v0.4.38 上线但**默认关、不激活质检**（收货仍走原路径），危险核心批做完才真正生效。
- **当前迁移号到 174**（06=164-167、04=168-171、11单据化=172-174）。新迁移取当前最大 +1（`ls backend/src/database/*.sql | sort | tail -1`），不写死。
- 全量回归基线：mainline 49 / p0 41 / p1 44 / concurrency 83 / finance 103 / integration 96 / warehouse-scope 24 / serial 40 / 权限 161 一致。

## 每个功能的实现纪律

- 动库存/账款/占库/结算/状态机前，**读透调用链**（对应 engine/常量文件的注释记录了历史事故根因）。
- 改后跑齐对应 smoke：`mainline`(必)、涉库存加 `p0-regression`/`p1-regression`/`test:integration`、涉并发加 `concurrency-guards`、涉财务加 `finance`、涉数据权限加 `warehouse-scope`。
- 新权限码要**三处同步**（后端 permissions.js + 前端 permission-codes.ts + seed 迁移），跑 `test:permissions`（当前前后端各 154 个一致）。
- 前端全 camelCase；状态徽章用 `SoftStatusLabel`；数字列右对齐 + `tabular-nums`；不复制后端业务规则。
- 迁移只新增、不改已执行的；编号取当前最大 +1，不写死。

## 发版注意（若用户明确要发版才做）

工作区有**大量未提交改动**，`git add .` 会把别的 WIP 也误上线。发版要**精确列文件** git add（见记忆 `release-dirty-worktree-technique`）。三端版本号同步递增，用 `/release-flowcube` 技能。

## 接手怎么继续

读上述两条记忆 + `docs/proposals/README.md`。**剩下的三项（07 危险核心批 / 03 多计量单位 / 10 会计总账）都触到"需用户拍板或在场"的边界**，不宜直接开工：07 用户要在场、03 要确认是否上马且必须灰度、10 要先定自建 vs 对接方向。等用户给方向再做。低风险纯增量（如仪表盘小组件、08 覆盖率看板 Phase2）可自主推进。保持全自主：自己实现、自己验收、不让用户操作。
