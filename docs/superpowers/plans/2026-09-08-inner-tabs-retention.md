# 功能页内 Tab 状态保留实施计划

> 本会话实施；保留现有工作区改动，不提交、不发布。使用按任务实施与复核流程，核心边界由根代理集成。

**Goal:** 功能页内切换 Tab 后保留已访问子页的筛选、输入、选择、展开与滚动状态，关闭大页面才销毁；不新增跨刷新存储。

**Architecture:** 共享 `KeepAliveSection` 首次激活后保留实例，隐藏时提供非活动上下文；工作区与合并页传播可见性，`useActiveWorkspaceTab` 兼容子页状态。Dialog 仅在所属页面可见时显示；后台提交正常完成，隐藏子页不抢焦点。账套切换、退出与权限收回保留现有隔离重置。

**Tech Stack:** React 18、TypeScript、React Query、Radix Dialog、Vitest/jsdom。

- [x] 公共层：新增 `frontend/src/components/shared/KeepAliveSection.tsx`、`frontend/src/components/layout/SectionVisibilityContext.ts`。用 `active` 与父上下文合成可见性，首次可见后保留 children；卸载父级即重置。先写 `KeepAliveSection.test.tsx`，验证惰性挂载、切回保持输入/DOM、嵌套隐藏、父卸载重开重置、弹窗隐藏不回调清草稿。
- [x] 接入 `KeepAliveOutlet.tsx`、`MergedPage.tsx` 和 `useActiveWorkspaceTab.ts`，使工作区、组内页、页内 Tab 三层共同决定活动状态；保持原路由与公司 key。
- [x] 财务：`PaymentsView.tsx`、`ReconciliationView.tsx` 的独立子面板改用 `<KeepAliveSection active={tab === 'receipts'}>` 等稳定节点；查询状态仍各属原面板。ReceiptPanel/StatementPanel 使用活动状态限制查询。新增页面集成测试，验证核销查询切走回来保持，关闭大页后重置。
- [x] 单据：`OrderDetailSections.tsx` 为各活动视图分配稳定 section；销售详情各 `detailTab` 内容同样保留，DocumentActivityPanel 隐藏时不轮询。原单据 ID 变化仍重置。
- [x] 列表与报表：盘点 ABC、库存总览/流水、基础统计、利润分析、库龄/效期、会计报表、税务分别使用稳定 section；保留共用筛选的既有语义。税务调整草稿按税种隔离；ABC 未保存规则不得因切换子页/后台刷新被覆盖或失去脏保护。
- [x] 只读确认仓库结构四页已有独立工作区身份，保留现有路由缓存；PDA 作业步骤与显示模式不纳入 ERP 大页面缓存。
- [x] 验证：`npm --prefix frontend run test:unit -- src/components/shared/KeepAliveSection.test.tsx`，相关财务/合并页面回归，`tsc -p frontend/tsconfig.app.json --noEmit`、相关 lint、ERP build；本地 Chrome 检查核销查询切换/关闭重开和有输入的子页。结束关闭自建浏览器并核实。
- [x] 文档：同步 AGENTS.md 当前规则和 `docs/inner-tabs-retention-2026-09-08.md` 的覆盖清单、测试与未发布边界。

完成证据：前端 42 文件 / 211 测试、类型检查、相关 lint、ERP 构建、打印策略/状态 33 项均通过；本地浏览器核销与税务切换/关闭重开实测通过。公共打印预览追加隐藏副作用隔离，详见覆盖文档。
