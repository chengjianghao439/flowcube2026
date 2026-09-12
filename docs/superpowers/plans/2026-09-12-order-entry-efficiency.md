# 销售与采购开单提效 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent price lookup repair and reviews; keep validation, keyboard entry and integration in the primary task. Execute continuously within the approved local implementation scope.

**Goal:** 第一阶段交付销售/采购集中校验定位、明细键盘连续录入，并修复销售快速切换客户/商品的过期查价覆盖。

**Architecture:** 沿用现有表单、选品器、价格表和后端校验。纯函数收集填写问题，共享组件在表单内导航到控件；键盘事件仅作用于明细数量/单价。销售表单状态提取为独立 hook，异步结果绑定客户、商品和行请求版本，不扩大权限或自动创建订单。

**Tech Stack:** React、TypeScript、Vitest、现有 Query/REST API。

## 已确认边界
用户同意从高频开单提效开始，允许本地电脑操作；真实业务/设备/承运商验收暂缓。采购建议深化与经营分析是后续独立阶段，未在本阶段引入新决策规则。历史订单复用、常购和历史成交价需进一步核对数据来源与权限，本阶段不新增未经定义的价格来源。保留销售正小数/正单价、采购正整数/允许零单价、后端权威单位换算和请求幂等。

## 1. 可定位的集中校验
- [x] 新建 `frontend/src/lib/orderEntry.ts`，定义 `EntryIssue { target: string; message: string }`、`collectOrderIssues(input)`。销售空占位行继续忽略，采购未选商品行必须提示；一次收集往来方、仓库、行数量/价格、电话及折扣问题，拒绝非有限值。
- [x] 新建 `OrderEntryIssues.tsx`，在第一次提交后显示实时问题列表，点击仅在当前表单内查找 `data-entry-field` 并聚焦，避免 KeepAlive 多标签串页。修正后项目自动消失，首次进入不展示错误。
- [x] 用 `orderEntry.test.ts` 验证同时遗漏、明细真实行号、销售/采购差别、NaN/Infinity、折扣和电话；用组件测试验证同名字段不同表单隔离及错误后刷新。
- [x] 接入销售新建/编辑/改单、采购新建/草稿编辑，统一提交判断与可见问题；商品/数量/单价有明确可访问标签和错误状态。保留原服务端 payload。

## 2. 连续录入
- [x] `handleEntryKeyDown` 仅处理数量/单价 Enter 和 Shift+Enter，数量到本行单价，再到下一行数量；末行到“添加商品”按钮但不自动新增。跳过 disabled，IME/修饰键不拦截，不抢原有 Tab。
- [x] 销售/采购表格使用稳定行 key 标记，末尾添加按钮 `data-entry-add`。采购选品关闭后聚焦数量并选中原值，销售保持已有行为。
- [x] 测试真实 DOM 事件顺序、逆向、禁用字段、末行、输入法以及两表单隔离；浏览器确认数量/单价焦点、集中问题点击定位，填表不保存。

## 3. 销售查价保护与职责拆分
- [x] 独立代理提取 `useSaleOrderForm.ts`（仅原状态/事件），修复客户/商品请求响应乱序、删除行/卸载后返回、手动改价被旧响应覆盖。
- [x] 先用受控 Promise 编写失败回归，再以请求版本和实际客户/商品身份守卫；loading 只由当前请求结束。保留明确切换客户时已有重新定价规则，查询失败不得悄悄套用另一客户价格。
- [x] 需求覆盖及代码质量独立复核，修复后再验证。

## 4. 集成与交付
- [x] Node 22：针对性测试先红后绿，完整前端 `npm run test:unit -- --maxWorkers=1`、app TypeScript、前端 lint、ERP/PDA 构建。
- [x] 本地开发界面检查，不跑真实订单/设备验收；关闭任务专属浏览器并确认退出。
- [x] 同步 AGENTS 第 9 节及 `docs/order-entry-efficiency-2026-09-12.md`；核对提交路径、diff-check，仅提交本任务，不推送、不发版。

## 执行时发现并完成的 UI 修复

可见电脑控制在 1005×734 窗口复现商品选择弹窗 1200px 超出视口，确认按钮不可见。补充公共 AppDialog 呈现尺寸约束、窗口变化重新居中及实际拖拽起点/边界，3 项回归和专项质量复核通过；实测缩到 800×600 后确认/关闭仍可达。完整集成结果：63 个测试文件、330 项通过，TypeScript、lint（0 错误/5 条既有警告）及 ERP/PDA 构建通过。见 `docs/order-entry-efficiency-2026-09-12.md`。
