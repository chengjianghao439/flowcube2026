# Assessment A 实施与复验记录

日期：2026-10-08。A 独立初评见 `assessment-a.md`；本记录不读取或引用 B 结论。工作树 `codex/impeccable-system-audit-20261008`，初评基线 `66fa87e4a0c440270189693480673c69320bce85`。本文只证明下列文件、状态与证据，不把共享组件修改自动外推到全系统。

## 1. 本轮已实现的行为

| 文件 | 改动与目的 |
| --- | --- |
| `frontend/src/pages/refunds/index.tsx` | 列表失败显示持续 `QueryErrorState` 与真实错误、同参数重试；失败不显示空表或共 0 单。新建字段 Label 与实际 Input/Select/DatePicker 关联。 |
| `frontend/src/pages/refunds/components/RefundDetailDialog.tsx` | 首次/缓存读取失败显示详情错误与重试，隐藏旧详情和写动作。读 generation 覆盖目标、刷新、错误、开关、活动视图变化；确认回调在旧读 generation 或隐藏视图后不执行业务动作。保留原提交目标、幂等键、回执恢复及四位金额。 |
| `frontend/src/pages/purchase/index.tsx`、`frontend/src/pages/returns/index.tsx` | 列表读取失败分支与成功汇总条件；采购、采购退货、销售退货同类错误行为一致。采购创建入口和事件按后端原 `PURCHASE_ORDER_CREATE` 守卫。保留 root 的备注 `expandableText: true`。 |
| `frontend/src/pages/finance/accounts/index.tsx` | 查询、新建/编辑、余额调整字段的可访问名称关联；收入、支出、差额纯文字色改用 ink；不改 create API 或载荷。 |
| `frontend/src/pages/customers/index.tsx` | 首载/缓存失败均隐藏表格和上下两处计数，保留搜索与重试。编辑、删除、绑定价格分别核对 `CUSTOMER_UPDATE`、`CUSTOMER_DELETE`、`PRICE_LIST_UPDATE`；往来查看继续单独核对 `PAYMENT_VIEW`。已读取后端 bind-customer route，未把价格绑定错误归到客户编辑权限。导入成功纯文字色改用 ink。 |
| `frontend/src/pages/finance/transactions/index.tsx` | 列表错误隐藏旧流水、期间汇总与计数；供应商退款追踪错误隐藏旧到账结果、提供重试。保留已有 owner/activity/identity 守卫和四位原单追踪；收支及汇总文字使用 ink。 |
| `frontend/src/pages/accounting/vouchers/index.tsx` | 列表错误、勾稽核对错误、凭证明细错误均有独立错误和重试；失败不显示旧列表/零计数或旧“勾稽一致”。成功的独立勾稽请求在列表请求失败时仍保留其真实结果。差额、未入账与动作悬停纯文字色使用 ink。 |
| `frontend/src/pages/payments/PaymentsView.tsx` | 应收、应付列表失败均显示持续错误和重试，隐藏空表与计数；保留来源跳转守卫、现结/月结差异和结算确认规则。按单/核销切换用具名 nav + 唯一 `aria-current`，保留两表面 KeepAlive 状态。 |

上述前端改动没有改变 hook/API 调用规则、库存/账款状态机、精度或创建载荷。后续只读 SQL 机械修复独立记于 `a-backend-read.md`。共有样式、BaseCrud、供应商退款页面及 WorkspaceTabs 由其他拥有者处理；它们可能出现在截图中，不计为 A 的实现或验收。

## 2. 先失败再修复的必要行为测试

新增 6 个测试文件、39 个用例，另在既有 retention 文件增加供应商保留用例（共新增 40），并补客户切换当前语义断言。均在实际组件和 React Query 上运行，以 API 边界夹具控制读取结果；未以源码字符串搜索代替行为。自然 red 时是下面描述的断言失败；修复后逐项 green。初次测试装置的权限角色误配及 Radix 菜单交互超时已在产品修改前纠正，不计为 red 证据。

| 新测试文件 | 用例与自然 red → green |
| --- | --- |
| `listReadFailure.test.tsx` | 采购/采购退货/销售退货/客户退款各 2 项，共 8：①首载失败不得暂无/零数、重试保持筛选并恢复真实空结果；②缓存刷新失败隐藏旧表和旧汇总。8 项自然 red → 8 green。 |
| `refunds/components/RefundDetailDialog.read-state.test.tsx` | 8 项：①详情首载失败与恢复；确认打开后依次发生 ②error、③fetching、④recovered、⑤switched、⑥switched-back、⑦hidden、⑧section-hidden，均不得按旧详情执行。初轮 5 red，补充 generation 反例后整组 8 red → 8 green。 |
| `refunds/formLabels.test.tsx` | 3 项：退款新建、账户新建、账户查询每个可见标签关联实际控件。3 red → 3 green。 |
| `financeListReadFailure.test.tsx` | 13 项：客户/流水/凭证/应收/应付分别首载失败重试与缓存刷新失败（10）；勾稽缓存失败（1）、凭证明细首载失败重试（1）、供应商退款追踪缓存失败（1）。13 red → 13 green。 |
| `customers/permissions.test.tsx` | 5 项：只读无行写操作；仅 update/delete/price-list-update/payment-view 四种单独动作权限分别只开放对应动作。5 red → 5 green。 |
| `purchase/permissions.test.tsx` | 2 项：无 create 权限不能看到/进入新建；有权限能注册新标签并导航。前者自然 red、后者已有 green → 2 green。清理装置最初误用不存在的 workspace.reset，已修正后重跑纯行为 red，不计装置错误。 |
| `payments/PaymentsView.retention.test.tsx`（扩展既有） | 3 项：现结客户/供应商具名导航、唯一当前方式及切换更新；核销筛选切走再回保留，隐藏时不读取、关闭重开重置；月结既有保留回归。现结两侧自然 red（缺 nav），月结原 green → 3 green。 |

原有 16 个相关回归一并保留通过：退款跨目标回执 2、退货金额显示 2、资金流水供应商退款 9、凭证供应商退款 1、现结/月结核销状态保留 2。

日志：`a-tests-red.log`（16 red）、`a-tests-red-generation.log`（详情整组 8 red，其中 3 是补充反例）、`a-tests-red-finance.log`（18 red）、`a-permission-navigation-red.log`（3 red / 2 pass）。最终同批命令及完整输出在 `a-tests-green-final.log`：**11 文件 / 56 用例通过，退出 0**。测试命令：

```sh
cd frontend
npm run test:unit -- src/pages/listReadFailure.test.tsx src/pages/refunds/components/RefundDetailDialog.read-state.test.tsx src/pages/refunds/components/RefundDetailDialog.crossTarget.test.tsx src/pages/refunds/formLabels.test.tsx src/pages/returns/index.amount.test.tsx src/pages/financeListReadFailure.test.tsx src/pages/customers/permissions.test.tsx src/pages/finance/transactions/supplierRefund.test.tsx src/pages/accounting/vouchers/supplierRefund.test.tsx src/pages/purchase/permissions.test.tsx src/pages/payments/PaymentsView.retention.test.tsx
```

Node 使用本地 dev-env 加载的 Node 22。拥有页面及新增/扩展测试共 16 路径的 targeted ESLint 退出 0（`a-lint-final.log`）；拥有产品路径 `git diff --check` 退出 0。`test:permissions`（187 前后码一致、7 行为通过）与 `test:route-permission-contract`（311 写路由 / 65 文件）通过，日志 `a-permissions-contract.log` / `a-route-permission.log`。全量类型检查/构建/全套由 root 统一执行，本文不提前声称通过。

## 3. 实际 GUI 与截图索引

独立会话 `flowcube-impeccable-a`，1440×900，真实本批专属临时数据库和服务器认证。预览 `http://127.0.0.1:5186`；最初代理 55391，后由 root 切换到同库同账号的当前源码 API 62091。后续统一加载 A 的只读 SQL 修复后，API 为 50060，Vite 仍 5186。截图数据均是本批合成资料。A 未提交创建/登记/删除/退款等业务写动作；查询、打开未提交弹窗与取消操作用于观察。

`screens/after/a-*.png` 首批 **46 张**，后续补 **21 张**，当前共 **67 张**，均已逐张实际查看。深色是临时设置 `document.documentElement.classList.add('dark')` 后等待颜色动画结束的 token 呈现检查；产品当前没有主题切换入口，故不能将深色截图称为主题切换功能验收。

| 页面/控件 | 实际交互和结果 | 截图 |
| --- | --- | --- |
| 退货退款单 | 新建未提交弹窗各字段名称已能读取；真实 list 500 持续显示“服务器内部错误”，无空数据/共 0。点击重试并等待请求完结后仍为错误，浅/深均核图。未获得真实客户退款详情记录。 | `a-refunds-error.png`、`a-refunds-create-labels.png`；`a-refunds-error-{light,dark}.png`、`a-refunds-retry-still-error-{light,dark}.png` |
| 资金账户新建 | 打开未提交弹窗，字段名称可读取，取消；未改余额、未新建账户。 | `a-finance-account-labels.png` |
| 客户管理 | 正常 1 条；关键词 GL76c9c150 查询中断后错误；计数和旧客户行隐藏；撤销中断并点击重试恢复 1 条，筛选保留。 | `a-customers-normal.png`；`a-customers-{error,retry}-{light,dark}.png` |
| 资金流水 | 正常 1 笔（合成付款 4.00）；关键词 GL76c9c150 和发生日期保持；请求中断后隐藏旧流水与三项汇总；恢复后重试 1 笔/支出 4.00。 | `a-transactions-normal.png`；`a-transactions-{error,retry}-{light,dark}.png` |
| 记账凭证 | 正常真实空列表；关键词“验收”中断只针对凭证列表，请求失败时零数/空表隐藏，独立成功勾稽结果继续显示；重试真实 0 张。没有点击“生成凭证”。 | `a-vouchers-normal.png`；`a-vouchers-{error,retry}-{light,dark}.png` |
| 现结供应商账款 | 默认和单号 PC20261008001 查询真实空；错误不继续暂无/0；重试真实 0 笔，未结清筛选保留。 | `a-payable-normal.png`；`a-payable-{error,retry}-{light,dark}.png` |
| 现结客户账款 | 默认和单号 SL20261008001 查询真实空；错误与成功空结果区别明确；重试真实 0 笔、筛选保留。 | `a-receivable-normal.png`；`a-receivable-{error,retry}-{light,dark}.png` |
| 采购订单 | 正常 1 单；单号 PC20261008001 查询中断后旧单/共 1 隐藏，重试恢复 1 单。 | `a-purchase-normal.png`；`a-purchase-{error,retry}-{light,dark}.png` |
| 采购退货 | 正常 1 单；单号 PR20261008001 中断后旧单/共 1 隐藏，重试恢复 1 单。 | `a-purchase-returns-normal.png`；`a-returns-purchase-{error,retry}-{light,dark}.png` |
| 销售退货 | 单号 SR 中断后为错误；重试真实空结果 0 单，筛选保留。 | `a-returns-sale-{error,retry}-{light,dark}.png` |

错误模拟是本会话拦截对应 **`http://127.0.0.1:5186/api/...`** 请求后 abort，未替换响应数据、未改权限。恢复时撤销对应拦截后真实重试。早先宽泛通配符误中 Vite 源模块，产生动态模块加载错误；该次是验收装置错误，已撤销、重载并覆盖无效截图，未计为产品缺陷。HMR 和服务切换时的过期引用/动画未结束截图也被稳定窗口内的最终结果替换。重试截图等待最终错误/正常状态，不把请求刚开始的骨架图称为最终结果。

## 4. 边界与未验证项

- 初批退款 list 的真实 500 已由后续机械 SQL 修复解除，见第 7 节和 `a-backend-read.md`。成功列表当前为合成库真实空结果；未获得客户退款记录，真实退款详情 GUI、正向有退款行的现场范围回归及业务退款执行仍未验证。
- 详情 generation、缓存失败、独立动作权限是上述行为测试证据；本轮 GUI 使用全权合成账号，未冒充已完成低权限账号或延迟确认现场验收。
- 勾稽、凭证明细、供应商退款追踪的独立错误分支已做 red/green，未在真实 GUI 强造有记录明细以取得截图。
- 默认成功空结果与失败已实际区分；真实 GUI 的“已有相同 query key 缓存→刷新错误”并非每页均单独驱动，缓存反例由所有相应组件测试覆盖。
- 1440×900 代表页与弹窗可读；未证明窄屏、PDA 真机、Electron、打印、CI、生产或全部路由。深色仅 token 检查。
- 未扩展修改退款新建的提交期间关闭行为，未将确认前 generation 守卫说成所有已发出 mutation 的迟到完成回调都已覆盖。原有跨目标回执测试继续通过。

## 5. 资源收尾

全部网络拦截撤销、临时 `.dark` 移除后执行 `agent-browser --session flowcube-impeccable-a close`，输出 `Browser closed`。立即 list 仍短暂显示退出中的 a；延迟 1 秒后 `agent-browser session list --json` 仅返回 root、b，会话 a 确认不再存在。未关闭其他任务的浏览器或服务。未 git commit、未 push。

## 6. 后续新授权

root 在本 GUI 收尾后授权 A 独立诊断上述真实退款 500、仓库 my-tasks 和代表报表只读 500，可修复机械 SQL/投影错误。该后端工作另记证据，不追改本段前端完成边界；不改变业务/权限规则、不加迁移、不写业务数据。

## 7. 最终源码加载后的补充 GUI（21 张）

root 统一重载同一专属库 API 至 50060，Vite 5186；仍使用本批服务器认证和原授权，不制造客户退款、凭证、收付款等业务记录。安全 HTTP 摘要 `a-api-read-green.json`：退款正常/组合筛选两次 200，仓库任务 `/my`、`/my-sku-summary` 200，成本对账/KPI/利润三代表读取 200。报表仅计 API 读取证据。

| 代表表面 | 真实操作与已核结果 | 新截图 |
| --- | --- | --- |
| 退款列表 | 正常成功空集合“共 0 单”；关键词 RF-not-present 真实空结果；只中断 refunds 请求，以 RF-retry-keep 查询，失败隐藏表格/零数，撤销拦截点击重试后恢复真实空，关键词仍保留。 | `a-refunds-sql-normal-light.png`、`a-refunds-sql-filter-{light,dark}.png`、`a-refunds-sql-{error,retry}-{light,dark}.png`（7） |
| 现结客户账款 | 按单登记→收款核销；具名“现结客户账款登记方式” nav，当前按钮唯一 aria-current=true；核销查询 RC-A-KEEP，切按单再回核销后筛选保留，真实空集合。未点登记收款。 | `a-receivable-nav-records-light.png`、`a-receivable-nav-receipts-light.png`、`a-receivable-nav-retained-{light,dark}.png`（4） |
| 现结供应商账款 | 按单登记→付款核销；同一明确当前语义；PC-A-KEEP 核销查询切走再回保留，真实空集合。按单页仍有结算确认列与原新建手工应付差异。未点付款/创建。 | `a-payable-nav-records-light.png`、`a-payable-nav-receipts-light.png`、`a-payable-nav-retained-{light,dark}.png`（4） |
| 资金流水 | 当前期间真实 1 笔合成支出 4.00；收入 0、支出/净额与行文字 ink 浅深可读。未登记新款。 | `a-transactions-ink-{light,dark}.png`（2） |
| 记账凭证 | 真实空列表，原真实勾稽资金/应付差额警告和应收一致；差额 ink 浅深可读。未生成凭证，未将差额说成正常入账。 | `a-vouchers-ink-{light,dark}.png`（2） |
| 资金账户流水弹窗 | 打开合成付款账户流水；收入 0、支出 4.00 与余额 9,996.00 浅深可读；关闭。账户与金额均是测试资料，不涉及真实银行。 | `a-accounts-transactions-ink-{light,dark}.png`（2） |

本轮所有新增最终截图已逐张查看，没有空错误误作成功，失败截图不显示零数或旧表。深色仍仅临时 `.dark` 的 token 检查。导航 ARIA DOM 读取仅在自身 nav 判定当前按钮；隐藏的其他 KeepAlive 大页面各自保留自己的当前方式，不用整个文档的总 current 数代替活动表面。

末次关闭只读弹窗、撤销网络拦截并移除 `.dark`，执行本会话 close；首次 list 短暂含退出中的 a，后续 list 仅 `flowcube-impeccable-root`，确认 a 已退出。补充操作日志 `a-gui-followup.md`。未操作其他浏览器或服务，未 commit/push。
