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

## 已完成（本会话，全部本地未提交，均已验证通过）

| # | 功能 | 状态 | 验证方式 |
|---|---|---|---|
| 01 | 安全库存与补货建议 | 完整 | 端到端脚本 + 浏览器截图 |
| 02 | 采购请购与审批流 | 完整 | 端到端(转单幂等/拒自批) + 浏览器 |
| 09 | 库龄与呆滞报表 | 完整 | SQL 验证 + 浏览器 |
| 05 | 客户信用额度 | 完整 | 端到端(并发恰好一单防双算) + 浏览器 |
| 08 | 循环盘点与 ABC | 完整 | 端到端 + 回归 |
| 07 | 采购收货质检 | **仅安全增量**（商品/供应商质检开关 + 建单固化 qa_required 快照；默认关、不激活质检，收货仍走原路径）；**危险核心批未做** | lint/mainline |
| 11 | 需求预测采购计划 | **MVP 只读报表**（单据化留 Phase2） | 端到端脚本 |

- **全量回归全绿**（最近一次）：mainline 49 / p0 41 / p1 44 / concurrency 83 / finance 103 / integration 96 / warehouse-scope 24 / 权限 154 一致。
- **顺手修了 3 行 reserved 漂移**（product 1/384/385，是本会话跑大量 smoke 在开发库累积的测试残留，非功能 bug），已对齐 active 预占合计恢复不变量。可考虑加个 `resync-reserved` 运维脚本固化。
- **当前迁移号到 163**。新迁移取当前最大 +1（`ls backend/src/database/*.sql | sort | tail -1`）。

## 剩余待办（按风险/依赖排序）

1. **06 电子面单** — 核心是对接**真实快递平台 API**。本地开发库无快递平台，**无法端到端验收**，只能写框架 + mock + 说明验证边界。事务内禁 HTTP（取号走异步 worker），面单只走 ZPL。
2. **04 序列号** — 动收货/出库核心 + 新 **PDA 扫码流程**，中高风险。容器仍是事实源，序列号是叠加其上的个体制从属账（`remaining_qty == 在库SN数`）。
3. **03 多计量单位** — **全链路改造**（数量单位贯穿采购/收货/库存/销售/出库/盘点/退货/结算），这批**最高风险**，必须灰度。核心红线：库存事实源永远按基本单位存，换算只在录入/展示层。
4. **10 会计总账** — **巨型**。设计文档 10 建议先定"自建轻量总账 vs 只做凭证导出对接金蝶/用友"——**这个方向本身需用户先拍板**。
5. **07 危险核心批** — 改收货结算 `tryFinishTask`(扣拒收量) + `voidReceipt` 反冲 QA/REJECTED 容器 + `check` 接口(照搬 return-tasks `allocateQaContainers`) + PDA 质检页。用户此前选"分步做，危险批留后、在场时做"。
6. **增强**：11 单据化 Phase2（procurement_plans 落表 + 转采购）、08 ABC 结果详情页/规则维护页。

## 每个功能的实现纪律

- 动库存/账款/占库/结算/状态机前，**读透调用链**（对应 engine/常量文件的注释记录了历史事故根因）。
- 改后跑齐对应 smoke：`mainline`(必)、涉库存加 `p0-regression`/`p1-regression`/`test:integration`、涉并发加 `concurrency-guards`、涉财务加 `finance`、涉数据权限加 `warehouse-scope`。
- 新权限码要**三处同步**（后端 permissions.js + 前端 permission-codes.ts + seed 迁移），跑 `test:permissions`（当前前后端各 154 个一致）。
- 前端全 camelCase；状态徽章用 `SoftStatusLabel`；数字列右对齐 + `tabular-nums`；不复制后端业务规则。
- 迁移只新增、不改已执行的；编号取当前最大 +1，不写死。

## 发版注意（若用户明确要发版才做）

工作区有**大量未提交改动**，`git add .` 会把别的 WIP 也误上线。发版要**精确列文件** git add（见记忆 `release-dirty-worktree-technique`）。三端版本号同步递增，用 `/release-flowcube` 技能。

## 接手怎么继续

读上述两条记忆 + `docs/proposals/README.md`。用户回"继续"就按剩余顺序做下一个（**06 电子面单**），或按用户指定的功能做。保持全自主：自己实现、自己验收、不让用户操作。
