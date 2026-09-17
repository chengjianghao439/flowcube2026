# 账款/对账页大功能弹窗重构为专用弹窗（2026-09-18）

对应 2026-09-18 用户要求：“把现结/月结 × 客户/供应商 页面的大功能弹窗重构为专用弹窗，小功能例如查询不动”，并在追问中确认范围为这 4 个页面、形态为“独立组件 + AppDialog 工作区外壳（可拖拽、尺寸记忆）”。修改在本地开发模式验证，未发布、未做桌面端与 PDA 验收。

## 重构前的问题

4 个页面（`/payments/payable`、`/payments/receivable`、`/reports/reconciliation/payable`、`/reports/reconciliation/receivable`）里的大功能弹窗都是轻量 `ui/DialogContent`，只用 `max-w-2xl/4xl/5xl/6xl` 拉宽度：

- 不能调整大小，宽明细在窄窗口里只能整窗滚动；
- 没有尺寸记忆，每次打开都是同一个刚性尺寸；
- 实现散落在 `usePaymentActions.tsx`、`ReceiptFormDialog.tsx`、`ReceiptPanel.tsx`、`StatementPanel.tsx` 里（其中两个只是文件名级的内联函数）。

## 现行行为

六类**大功能**弹窗改为独立专用组件，外壳统一 `AppDialog`（可拖拽调整、`dialogId` 记忆尺寸、Header/Body/Footer 固定、正文区自滚动）：

| 弹窗 | 文件 | dialogId | 默认尺寸 | 出现位置 |
|---|---|---|---|---|
| 登记付款 / 登记收款 | `components/shared/payments/RegisterPaymentDialog.tsx` | `payment-register` | 640×560 | 现结两页操作列 |
| 应付结算确认 | `components/shared/payments/SettlementConfirmDialog.tsx` | `payment-settlement-confirm` | 960×640 | 现结供应商账款操作列 |
| 登记收付款并核销 / 继续核销 | `components/shared/payments/SettleReceiptDialog.tsx` | `payment-receipt-settle` | 1120×680 | 4 页的收款核销 tab |
| 核销明细 | `components/shared/payments/ReceiptDetailDialog.tsx` | `payment-receipt-detail` | 1000×620 | 4 页的收款核销 tab |
| 新建对账单 | `components/shared/payments/CreateStatementDialog.tsx` | `payment-statement-create` | 1120×700 | 月结两页的汇总对账 tab |
| 对账单详情 | `components/shared/payments/StatementDetailDialog.tsx` | `payment-statement-detail` | 1000×620 | 月结两页的汇总对账 tab |

小功能保持轻量弹窗不变：三个 tab 的「查询」（`PaymentQueryDialog`，自适应高度、无拖拽把手）、收/付款流水（`max-w-lg` 只读）、客户绑定、删除确认。

业务一律未改：接口与参数、权限判定（`can(...)`）、请求键（`createRequestKey`）、表单校验、提交后的 query 失效口径（`payments` / `reconciliation` / `payment-receipts` / `finance-accounts` / `finance-dashboard` / `payment-statements` / `payment-statement-detail`）、账户余额不足的二次确认、核销分配与自动分配算法、对账单候选与移出逻辑都按原实现搬迁。唯一新增的外壳能力是 `AppDialog` 的 `onOpenAutoFocus` 透传：继续核销打开时仍拒绝默认聚焦（原先聚焦标题、避免自动展开日历遮挡明细），改为把焦点落在弹窗正文容器上。

`usePaymentViewInvalidation()`（新增）承载登记收付款与结算确认共用的失效口径，避免拆组件后两处口径漂移。

## 本次验证（本地开发模式 1280×633/1280×800）

- 六个弹窗逐个打开确认：标题、默认尺寸、右下角拖拽把手、页脚按钮、正文区独立滚动与窗口居中；`querySelector('[role="dialog"]')` 的 `className` 已不含 `max-w-2xl/4xl/5xl/6xl` 的旧外壳。
- 拖拽与尺寸记忆：在 `登记收款` 上从右下角拖到 866×569，`localStorage['flowcube-dialog-size-payment-register'] = {"width":866,"height":569}`；关闭后重开仍是 866×569 并重新居中。
- 数据路径：填供应商/客户名后候选行正常渲染（`待核销应收（1 笔）` + 全额按钮）；`核销明细` 空态行正常；`对账单详情` 逐笔行与草稿态「移出」按钮正常；月结页的核销弹窗显示「待核销对账单」而非「待核销应收/应付」。
- 小功能未变：`查询` 弹窗仍是 `fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)]`、无拖拽把手。
- 代码级：`tsc -p frontend/tsconfig.app.json --noEmit`、修改路径 ESLint、`vitest run` 81 个文件 393 项全部通过；`docs/pc-ui-source-inventory.md` 已用 `node scripts/pc-ui-inventory.cjs` 重新生成（该次重扫同时带入此前其他改动的漂移：233→257 个候选文件、路由标题对齐现状）。
- 验收夹具：本地开发库原本只有 1 条月结应付，为点开全部弹窗临时插入 3 条 `payment_records`（2 条现结应付、1 条现结应收）、1 张 `payment_receipts`、1 张 `reconciliation_statements` 及其明细；验证后按 `remark='dialog-refactor-fixture'` 精确删除，复查 `payment_records` 仍为 1 条（id 2340）、`payment_receipts`/`reconciliation_statements`/`reconciliation_statement_items` 均为 0 行。

## 未验证与限制

- 未发布；Electron 桌面端窗口、PDA、深色主题、Safari/WebView 未验收。
- 本地验收账号是只读角色，点「生成对账单」返回 `无操作权限`，因此“新建对账单”只验证了打开、候选查询与选择交互，未实际提交生成；对账单详情弹窗改用直插夹具验证。真实提交路径仍依赖既有接口，本次未改动。
- `AppDialog` 的 `onOpenAutoFocus` 是新增透传属性，其他既有弹窗不传时行为不变。
