# 采购建议解释优化 Implementation Plan

> **For agentic workers:** Use executing-plans / subagent-driven-development for scoped implementation and independent final review. Continue in the existing isolated worktree; no production mutations.

**Goal:** 让采购人员直接看清需求、已有覆盖、需补数量、包装多购及交期风险，并对照计划生成时与当前数据。

**Architecture:** 只使用既有 ProcurementSupply 与 supplySnapshot/currentSupply。后端 calculateSupply、roundPurchase、权限与生成/转换请求不变。增加纯展示组件，将需求解释从规则编辑器中分离，计划明细支持对照历史快照，补货列表及计划行显示日期核对提示。

**Tech Stack:** React、TypeScript、Vitest、现有 Radix/Dialog 与主题样式。

## 范围
用户“继续”承接采购建议下一阶段。需求/供给算式按已核对后端实现解释，不新增采购优先级、日期分配或自动决策。没有来源 ID 的汇总数据不虚构单据链接；当前已转采购链接保留并明确名称。实际业务验收继续暂缓。

## 任务
- [x] 创建 `frontend/src/components/shared/ProcurementSupplyExplanation.tsx` 与测试，提供 `ProcurementSupplyExplanation({supply, snapshot, mode})` 和 `ProcurementArrivalStatus({supply})`。以 73 净需求、12 包装、100 起订、108 建议测试单位及多购；对无日期、晚于需求、缺可选字段、不同 snapshot/current 进行断言。先运行失败，再实现。
- [x] `ProcurementSupplyDetails.tsx` 复用解释组件，接收 snapshot；分开需求与库存缓冲、实物/在途、计划/申请/采购草稿。所有数量有基本单位，零包装显示不限。保留规则编辑、调拨导航及权限。
- [x] 计划详情传入 `snapshot={it.supplySnapshot}`，保留供应商与数量编辑，已转单据链接文字改为 `采购单 #${it.purchaseOrderId}`。补货与计划表格增加 `ProcurementArrivalStatus` 提示。计划列表/详情补 QueryErrorState、手动刷新与最近读取时间，失败不冒充空数据，刷新失败仍明确提示旧数据。
- [x] Node22 运行 `npm --prefix frontend run test:unit -- --maxWorkers=1`、`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit`、lint、ERP/PDA build；电脑 UI 对照修改前后，查看列表/弹窗/可选计划，不生成或转换业务单据。
- [x] 独立核查展示没有重算采购决策、日期缺失没有假定按期；同步 AGENTS 第9节、`docs/procurement-planning-2026-09-06.md` 及本轮记录。关闭本任务标签页并重置窗口尺寸，仅本地提交本轮文件。

## 完成记录

64 个前端测试文件、335 项通过；类型检查、lint（0错误、5条既有警告）与 ERP/PDA 构建通过。独立代码复核通过；本地补货页实测折叠/展开和交期列，计划列表为空，使用明确标注且无API的临时夹具验证历史对照和日期风险，完成后删除夹具并关闭任务标签页。完整证据与限制见 `docs/procurement-explanation-2026-09-12.md`。
