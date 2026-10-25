# 点名偏离页面归编计划

基线：`83241d10fde1f43543f9e17d4b305b679e17bed2`；分支：`codex/desktop-ibm-style`。不 rebase、不合 main、不打 tag、不发版。

本轮产品 TSX 只涉及用户点名页面及新增 InvoiceQueryDialog。任务六允许新增前端筛选状态和交互，不能把这一项笼统描述为“所有逻辑零变化”；原业务 mutation、表单计算、权限、版本/恢复规则、后端与请求接口保持。相关回归测试只验证这些合同。

## 执行清单

- [x] 核对干净工作区、完整 HEAD、工作树、前端/财务/预览/筛选规范与现有组件。
- [x] 核实发票接口仅已有 invoiceType/status/keyword/page/pageSize；状态名称读取现有类型常量。
- [x] 识别已抵扣发票不可编辑的前后端一致限制；询问可选呈现后采用保留原单一删除入口的保守默认，不新增编辑资格。
- [x] 启动独立合成 transport，实际打开点名页面；保存塑料盒两表改前/后样式。早期通用表头采集有前 16 格上限，定向补测四个目标表头；重建基线方式在报告中单列说明。
- [x] 为发票筛选、草稿与既有动作/权限写有效回归，先观察新增交互测试失败。
- [x] 发票、补录、凭证去除 DataTable 外重复卡；计数收束在标准 ListSummary。
- [x] 发票类型段控、行菜单、必填星号和金额带归编；保持每个回调、条件和权限。
- [x] 新增发票状态页签、查询弹窗、应用/取消/重置和 chips；无日期参数，分页原值不变。
- [x] 四张候选表实际已由 ReportTable 标准化，不重复改表头；逐表提供改前/改后样式并保留 sticky。图证复核发现补货确认弹窗 grid 撑宽，诊断后只增加显式单列工具类，补拍与复测通过。
- [x] 运费两表补张/单汇总；批次效率按实际返回列表补个数，不借用独立的近30天汇总。
- [x] 添加显式 fc-table-compact 正式变体，仅迁移塑料盒详情两表，清除密度冲突工具类。
- [x] 集中执行发票回归、lint、正确 tsconfig 类型检查、pnpm 前端构建及受影响契约；结果见 checks.json。
- [x] 逐页实际操作并保存 10 路由、79 份画面/DOM、12 张图版及表头对照，区分合成响应与真实业务证据。
- [x] 关闭本任务命名浏览器会话并核实退出，停止本任务 5201/58359 临时服务；保留原 5197。
- [x] 同步主题规范和本轮报告，逐文件/行号范围解释表现归编及任务六的授权差异。

## 文件边界

产品候选：`frontend/src/pages/accounting/{invoices/index,backfills/index,vouchers/index}.tsx`、新增 `invoices/InvoiceQueryDialog.tsx`、`pages/logistics/freight-reconciliation.tsx`、`pages/reports/wave-performance.tsx`、`pages/plastic-boxes/index.tsx`、`styles/desktop-page-samples.css`。

四张表头候选先验证：`pages/reports/replenishment.tsx`、`pages/accounting/ledger/index.tsx`、`pages/procurement/detail.tsx`、`pages/stockcheck/abc.tsx`。当前四者都已使用 ReportTable，不能仅据 thead 工具类判定需要迁移。

不改共享组件 props、后端/API 类型、权限、TemplateRenderer、PDA 或官网。样例服务、夹具与临时自动化脚本放仓库外。

## 外部交付

审阅明确路径后追加提交并推送原分支。提交/推送的事实以最终回复与远端完整 SHA 为准，不在提交内自证同一提交已推送。
