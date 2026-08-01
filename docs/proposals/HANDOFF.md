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
| 08 增强 | ABC 结果详情/循环盘规则维护页（`/stockcheck/abc` 双 Tab + 后端 `GET/PUT /stockcheck/cycle/rules`） | v0.4.40 |
| 11 单据化 | 采购计划 MVP 报表→单据（`procurement_plans` 迁移172-174、状态机、生成/编辑/转采购草稿、2权限码） | v0.4.40 |
| 03 Phase0+1 | 商品多计量单位主数据+表单维护+只读展示（迁移175 `product_units`；库存事实层零改动；方案A、采购/销售录入 Phase2/3 留后） | v0.4.40 |
| 07 危险核心批 | 收货质检先检后入（分流 PENDING_QA/check/扣拒收完成判定/void 反冲 + PDA `/pda/inbound-qa`）；serial_managed 式灰度默认关 | v0.4.40 |

**仍未做**：

| # | 功能 | 状态 |
|---|---|---|
| 10 会计总账 | **自建轻量总账，分阶段推进中**。**Phase 0 科目地基 + Phase 1 凭证映射与导出 已随 v0.4.41 发布上线生产**（三端同步、6条CI全绿、生产 latest.json/app-update/pda 均验证到 0.4.41）。**Phase 2 自建总账+报表 + Phase 3 发票管理与价税分离 均已完成+全验证、本地未提交未发版**。Phase2：试算平衡/明细账/利润表/资产负债表/现金流量表(实时汇总法) + ledger service + 5接口 + `accounting.ledger.view`(迁移181) + 前端 `/accounting/ledger` `/accounting/reports` + reconciliation status口径修正 + CI接入会计测试；真实数据验证试算平衡三栏平衡/资产负债表会计等式成立/明细账逐笔余额闭合+交叉勾稽。Phase3：`fin_invoices`发票池(迁移182)+进项/销项录入认证抵扣红冲+`invoice.view/manage`(183) + 前端 `/accounting/invoices` + **凭证税额拆分**(采购借1405不含税+借进项税额222101/贷2202含税；销售贷6001不含税+贷销项税额222102/借1122含税，应付应收侧恒毛额勾稽不变，无发票不拆税靠幂等重算后补) + 价税自动计算；19项后端验证(税拆分/状态流转/勾稽保持)+浏览器E2E(录入201/认证200/删除200)全过。**功能10会计总账全部实现完毕**（Phase0科目+1凭证+2总账报表+3发票税务）。<br>**Phase 0**：`acct_accounts`（迁移176）+13预置科目seed(177)+权限seed(178) + `modules/accounting/`科目树CRUD(预置锁定/硬删避免编码占用/有子不可删/层级派生) + `constants/voucherSource.js`事件枚举+借贷映射+PRESET_ACCOUNTS + 前端`/accounting/accounts`树形页 + 顶栏「会计」组 + `accounting.account.view/manage`。<br>**Phase 1**：迁移179 `acct_vouchers`+`acct_voucher_entries`、180权限seed；`voucher-engine.js`（7事件全量重算生成借贷凭证：采购结算/销售收入/销售成本/收付款/报销/退货/盘点，**只读业务表只写acct_***，UNIQUE(source_type,source_id)幂等+source_hash跳过未变+借贷平衡assert）；`accounting.voucher.service.js`（列表/详情/生成/手工录入/**红字冲销**/删除守卫/**勾稽对账**）；`accounting.export.js`（通用记账凭证+金蝶KIS，可扩展模板层）；前端`/accounting/vouchers`（列表筛选分页+详情弹窗+生成本期+导出下拉+手工录入+冲销+勾稽卡片）；`accounting.voucher.view/manage/export`三码。**关键设计（已实数据验证）**：采购结算/销售收入用**毛额**(未扣退货)、退货单独出凭证冲减，两者净额=payment_records，避免退货双减；收付款/报销驱动源=`finance_account_transactions`(资金唯一事实源,1:1精确勾稽);现金账户type=2→1001其余→1002;往来aux_name取party快照(aux_id留Phase2)。**验证**：825真实凭证全部借贷平衡+资金勾稽精确一致+逐单应付/应收勾稽精确+幂等+8类来源全覆盖；`smoke:accounting`(11项)+浏览器E2E(生成825/详情往来/导出200/手工/冲销)全过。**已知**：`reconciliation()`在dev库应付/应收显示"有差异"是**累积smoke孤儿数据**(订单被清库删、退货单残留)非bug,生产干净数据一致。**功能10已全部完成，下一步 = 发布 Phase2+3（v0.4.42）**。可选远期增强：多级科目汇总/科目余额跨期结转、业务单据内嵌价税(设计§4.5口径2,动核心链路金额口径,需单独立项)、凭证导出模板扩展(用友T+/畅捷通)。详见 `docs/proposals/10-会计总账与凭证.md`。 |
| 03 Phase2/3 | 采购/销售**按辅助单位录入**（明细加 entry_unit/entry_qty/conversion_rate 快照列 + `unit_price` 提精度方案A）；分阶段：先采购、再销售、最后退货/PDA。需灰度。 |
| 07 Phase2 | 拒收→一键生成采购退货/报废单联动；ERP 收货详情质检进度显示（纯展示，Phase1 未做，数据已由 types 暴露 qaRequired/checkedQty/rejectedQty/qaStatus）。 |
| 04 Phase2 | 历史序列号导入（才能给**有存量商品**开 serial_managed）。 |

- **当前迁移号到 183**（06=164-167、04=168-171、11=172-174、03=175、10 Phase0=176-178、10 Phase1=179-180、10 Phase2=181、10 Phase3=182-183）。新迁移取当前最大 +1（`ls backend/src/database/*.sql | sort | tail -1`），不写死。
- 全量回归基线：mainline 49 / p0 41 / p1 44 / concurrency 83 / finance 103 / integration 96 / warehouse-scope 24 / serial 40 / 权限 169 / test:accounting 7 / smoke:accounting 11 一致（10 Phase3 后权限 167→169）。**v0.4.41 已发布**（Phase0+1）；Phase2+3 本地未提交待发版。test.yml 已接入 test:accounting + smoke:accounting 门禁。

## 每个功能的实现纪律

- 动库存/账款/占库/结算/状态机前，**读透调用链**（对应 engine/常量文件的注释记录了历史事故根因）。
- 改后跑齐对应 smoke：`mainline`(必)、涉库存加 `p0-regression`/`p1-regression`/`test:integration`、涉并发加 `concurrency-guards`、涉财务加 `finance`、涉数据权限加 `warehouse-scope`。
- 新权限码要**三处同步**（后端 permissions.js + 前端 permission-codes.ts + seed 迁移），跑 `test:permissions`（当前前后端各 169 个一致）。
- 前端全 camelCase；状态徽章用 `SoftStatusLabel`；数字列右对齐 + `tabular-nums`；不复制后端业务规则。
- 迁移只新增、不改已执行的；编号取当前最大 +1，不写死。

## 发版注意（若用户明确要发版才做）

工作区有**大量未提交改动**，`git add .` 会把别的 WIP 也误上线。发版要**精确列文件** git add（见记忆 `release-dirty-worktree-technique`）。三端版本号同步递增，用 `/release-flowcube` 技能。

## 接手怎么继续

读上述两条记忆 + `docs/proposals/README.md`。**下一步是 10 会计总账（用户已定自建轻量总账，巨型）**：先读透 `10-会计总账与凭证.md`，按「科目表 → 凭证内核 → 各结算点映射 → 总账/试算平衡 → 前端」分阶段落地，每阶段跑齐 `smoke:finance` + 端到端 + 截图。它接所有结算点（`inbound-tasks.settle.js` 应付、`warehouse-tasks.ship.js` 应收、收付款、成本），改前务必读透这些调用链。其余（03 Phase2/3 按箱录入、07 Phase2 退货联动、04 Phase2 历史SN导入）按需推进。保持全自主：自己实现、自己验收、自己发版（用户授权后），不让用户操作。
