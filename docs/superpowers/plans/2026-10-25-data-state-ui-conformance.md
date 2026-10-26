# 有数据页面表现归编 Implementation Plan

> **For agentic workers:** Use the executing-plans workflow in this task. Preserve the existing worktree, branch, state, data, API and permission contracts; user authorization overrides generic merge/approval checkpoints.

**Goal:** 按增补六项统一销售/采购详情、页脚、审批选择框、短列、汇总及危险入口，并只登记价格等级配色。

**Architecture:** 先采真实 React 路由、完整 DOM 与计算样式。抽出仅呈现的摘要/事实/页签基础件，保留原状态、回调和 KeepAlive；其余采用窄化样式、已有数据的 ListSummary 和既有 Select。

**Tech Stack:** React/TypeScript、Radix、Tailwind、Vite、Vitest、agent-browser；本任务使用独立合成 HTTP 响应，不改共享数据库。

## 1. 基线与证据
- [x] 核对 `3e1fdd8`、干净分支与服务归属；使用自有稳定浏览器会话并准备退出清理。
- [x] 销售/采购详情各 3 行，采摘要、页签、信息、明细；首三行分别在移开指针和 hover 下采样，不把 hover 当静态底色。
- [x] 采资金账户查询页脚、审批配置所有分支、启停状态 chip、五字姓名、补货/模板/部门/设备和日志页。
- [x] 登记 A/B/C/D 的源码类、实际颜色及使用页面，保持价格表单文件不改。

## 2. 实施（仅呈现）
- [x] 新建共享 OrderOverviewStrip / OrderFacts；原 SaleOrderOverview / InfoCard 保留 props 与计算，采购使用同样基础件并去页头重复数量。
- [x] 新建 DetailViewTabs 的 List / Trigger，供 SaleOrderDetailTabs 与 ContentTabs 共用；保留原 Radix 焦点、点击回调和 KeepAlive，采购只改宽版呈现。
- [x] 对实际复现的行色问题修复或给出完整状态证据；不禁用合法 hover/selected，也不固定首行白色。
- [x] 将 fc-form-dialog 页脚规则推广为 ERP 的 fc-dialog-footer 家族，保持 app-dialog、页头、正文及特殊页脚布局。
- [x] approvals/flows 的业务、审批人类型、角色及部门/用户条件下拉换为既有 Select；空值仅作 UI sentinel 映射，原 draft、验证、提交体与锁定不变。
- [x] 源码全列审计；状态标记不折行，窄状态默认宽度调整；人员列按明确 data-column-key 不折行，不影响长商品/单位名称或手动列宽。
- [x] 补货计数移表下；模板用返回数组长度；部门使用已算出的可见 rows.length 并明确单位；设备搜索移 FilterCard，保留即时筛选，计数沿原分页 total。
- [x] 日志页头清理按钮改 outline 危险色，保留权限、确认、回调；其余实心危险入口逐项登记。

## 3. 验证和交付
- [x] 有必要的共享焦点/选择/提交值契约使用回归测试，先确认旧实现的失败证据；纯值修改以真实浏览器计算证据为主。
- [x] 统一执行 tsc -b、VITE_ELECTRON=1 vite build、受影响文件 ESLint、相关测试；共享组件影响广时执行前端全量。
- [x] 实测前后详情同构、三行颜色、资金查询页脚背景/按钮规格、审批各选项、nowrap/列宽、折叠/搜索计数与危险按钮。
- [x] 逐 TSX 路径/行号、文件清单、前后证据、改判及未覆盖范围写入报告和主题规范。
- [x] 核对提交路径与分支推送目标；当前分支追加提交并推送的最终哈希以交付回复及 Git 回读为准，不 rebase、合 main、打 tag 或发布。
- [x] 关闭本任务浏览器并回读会话清单；停止本任务预览/API，保留 5197。
