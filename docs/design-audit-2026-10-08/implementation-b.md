# Assessment B 实施与证据边界

日期：2026-10-08。工作树基线 `66fa87e`。独立审查结论见 `assessment-b.md`；B 未读取 Assessment A。本文仅记 B 自己实施、实际观察和未覆盖项，不代表全系统验收、合并或上线。

## 实施范围

- `hooks/usePdaScanner.ts`：无完整扫码缓冲时保留按钮 Enter，人工输入/内容编辑不进入扫描流；PDA 弹窗的同步 DOM 标记同时暂停键盘、原生广播及延迟 flush。保留稳定监听、双来源去重和有意重复扫码规则。
- 新增 `components/pda/PdaDialog.tsx`，超收与更新弹窗接入 Radix 的标题、描述、焦点和背景边界；短屏正文内部滚动，底部动作固定。超收仍默认不选原因，确认仍禁用；回调和原因码未变。
- Header/Section/Stat/Card/Scanner/Flash/网络条/恢复提示改用语义色与可读 `-ink`；主标题为 h1，PdaLayout 为 main。错误反馈默认保持到明确清除或下一次反馈，status/alert 提供公告语义。运动效果尊重减少运动偏好。
- receive、transfer-in/out、return receive/putaway、stockcheck、sort、task、pack 增加首次/次级读取失败与重试。缓存收货数据保留输入并暂停登记；调拨、打包读取失败保留原请求核对入口；包裹读取失败显示未知统计而非零箱，隐藏依赖该读取的完成入口。没有增加写请求自动重试。
- 数量展示统一使用已有 `lib/format.qty`，保留合法两位小数；百分比和真实箱数不变。出库身份信息改为可完整换行的标签和值。长格口码、库存标识和长商品名称保留完整内容。
- PDA 局部按钮/数量/手动输入基准为 44px，主确认 48px；绑定凭据、收货批次日期、拆分、盘点和退货数量补可访问名称。扫描条区分处理中的 busy 与等待处理的暂停提示。320px 首页两列，360px 起三列。

公共 tokens、index.css、ERP AppDialog/DataTable 与 WorkspaceTabs 由其他实施者负责。B 未修改后端、鉴权、路由权限、设备存储策略、采购整数规则、库存事务、请求键、恢复判据、业务载荷或打印契约。绑定成功仍清空手动凭据。

`docs/frontend-pda-conventions.md` 已追加 PDA 呈现/键盘基准。B 产品源码于约 08:43 收束；后续主 agent 的公共颜色更新须由其统一验证。

## 源码和回归

新增回归先对基线观测失败，再实现：按钮 Enter/人工输入、错误默认保持、分数进度、超收 dialog/必选原因、九个详情的真实 Axios 读取拒绝。补充覆盖原生暂停后恢复、包裹次级读取失败、打包/调拨原请求保留、缓存收货数量保留与登记暂停。原生测试模拟桥接回调，不能代替真机。

最后统一 PDA 范围命令：

```sh
# frontend，加载仓库声明的 dev-env 后
npx vitest run src/pages/pda src/components/pda src/hooks/usePdaScanner.native.test.tsx src/hooks/usePdaFeedback.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/components/pda src/pages/pda src/hooks/usePdaScanner.ts src/hooks/usePdaScanner.native.test.tsx src/hooks/usePdaFeedback.ts src/hooks/usePdaFeedback.test.tsx src/layouts/PdaLayout.tsx
```

TypeScript 最终检查退出 0。PDA lint 0 error、1 个 `react-refresh/only-export-components` warning；超收组件基线已导出原因常量，该 warning 不是新增。受影响路径 `git diff --check` 无空白错误。最终 PDA 范围单测为 30 文件、193 用例全部通过（08:44:04，退出0）。不把静态/单测当作业务操作或设备验证。全前端构建与全系统回归由主 agent 在本批末统一执行，B 不重复声明其结果。

## 实际浏览器观察

会话 `flowcube-impeccable-b`，仅专属临时实例、合成员工与合成设备；ERP/PDA 独立标签页。初始 PDA 19 路由的 390/320 自动捕获仅为导航、DOM 和溢出记录，不能算逐页人工视觉通过。后续代表页人工看图和交互如下。

| 路径/状态 | 实际观察与安全交互 | 证据 |
| --- | --- | --- |
| `/pda`，320、390 已绑定工作台 | 320 两列完整标签；更多展开后两入口和设备入口可达。390 三列、待办、长合成员工名完整换行。 | `b-pda-home-320/390`、`b-pda-home-more-320` |
| `/pda/receive/2`，真实待收详情，320 | 实际 task2/SKU2/剩余2。滚到表单，箱1数量输入1，箱数/本次/剩余同步为1；输入44px、清空有效；展开批次/日期，正文与底部动作可达。未点打印登记。 | `b-pda-receive-form-filled-320`、`b-pda-receive-batch-320` |
| `/pda/picking`，320 | 实际成功空态为0个SKU/暂无待拣商品，人工看图；商品/订单切换按钮44px。没有任务明细，不能算拣货详情。 | `b-pda-picking-320` |
| `/pda/sort`，320 | API 实际1个空闲格口；长格口码完整换行，底部扫码可达。未扫商品或确认格口。 | `b-pda-sort-320` |
| `/pda/plastic-box`，320 | 三个作业入口可读；未创建或改盒。 | `b-pda-plastic-box-320` |
| `/pda/split`，320 | 手动输入 `I000002` 只读 GET，显示真实余量12、长商品名和44px数量输入；填2后重新扫码取消，没有确认拆分。 | `b-pda-split-form-320` |
| `/pda/split` 手动扫描栏，320 | 明确点击手动输入后才聚焦；填 `AUDIT-ONLY-NO-SUBMIT`，确认/取消可达；取消清空。未 Enter 提交此虚构码。 | `b-pda-scanner-filled-320` |
| `/pda/split-recovery`，320 | 本人原请求记录成功空态，实际看图。没有 pending/legacy 真实恢复记录，不能算恢复过程验证。 | `b-pda-split-recovery-320` |
| `/pda/fill`，320 | 初始扫码等待态和操作方向可读；未扫码进入来源/目标盒阶段。 | `b-pda-fill-320` |
| `/pda/inventory-query`，320 | 正常手动 Enter 查询 `I000001`，只读 GET 返回余量12；完整长商品名、仓库和库位可读，页面无横向溢出。 | `b-pda-inventory-result-320` |
| `/pda/bind`，320 | 正常 UI 绑定合成设备成功，密钥清空；Enter 可展开手动区，持久标签/密码类型可读。模拟 dark 后等待背景过渡完成再捕获，Header/卡片/扫码栏可读，随后恢复 light。 | `b-pda-bind-manual-320`、`b-pda-bind-dark-simulated-320` |
| 超收组件预览，320×600 | 显式在浏览器临时挂载当前组件的合成 props，回调没有业务 API；默认确认禁用，Tab 留在 dialog，pause marker 存在，原因区内部滚动、底部48px动作可达；选原因再取消，未确认。 | `b-pda-overreceive-preview-320`、`b-pda-overreceive-selected-preview-320` |

超收预览使用浏览器模块缓存，实际原因按钮测得42px；源码随后/当前已有 `min-h-11`，该样本不作为最终44px视觉通过。后续 B 复用同名会话正常重绑，在最终 main/public ink 下重跑绑定手动区 axe：35 passes、0 violations、0 incomplete。该结果仅支持此代表状态。

ERP 的独立 before 代表仅库存查询、仓库结构/库位新建、设置编辑取消、`/sale/new` 的“添加商品”Finder。Finder 没有选品或提交销售。详见 `assessment-b.md`，没有将其静态证据算为全部 ERP 页面通过。

## 13 个动态 PDA 详情的覆盖

| 路由 | B 实际覆盖 | 未覆盖原因/保留验收 |
| --- | --- | --- |
| `receive/:id` | task2 实际待收详情与人工输入/清空；before 320、after 320 实看 | 未登记/超收/打印；小数展示有组件回归，实际采购 fixture 是整数规则，不伪造小数采购 |
| `putaway/:id` | final 正常绑定后真实 GET 确认 inbound1已完成、inbound2待收货；两种阶段320/390均实看 | 没有待上架执行 fixture；实际完成/尚未收货提示不算上架作业验收 |
| `task/:id` | final真实 GET确认task1/sale5/status2拣货中；320/390长商品/型号、0/1.25与推荐容器实看 | 未扫码拣货；后续正常重绑320补查，手输入按钮y763/h44/bottom807首屏完整可达，打开后44px输入获焦→空取消；无业务提交 |
| `check/:id` | final task1/status2，320/390实际“当前任务不能复核”，明确仅允许待复核 | 没有待复核执行 fixture；阶段禁止状态不算复核作业验收 |
| `pack/:id` | final task1/status2，320/390实际“当前任务不能打包”；另有查询/次级包裹失败/恢复回归 | 没有待打包/已装箱 fixture；阶段禁止状态不算打包作业验收 |
| `stockcheck/:id` | 源码、读取失败与既有盘点回归 | 没有进行中盘点及合法小数商品明细 fixture |
| `ship/:id` | final320/390实际出库扫码初态；源码`ship.tsx:7,67,332`不消费route ID，info由扫码加载 | `/ship/1`不能算task1原单详情/阶段拒绝。没有已打包/箱贴成功待出库fixture；未扫码/出库 |
| `cancel-return/:id` | 源码和既有原请求恢复回归 | 没有待退回明细及解锁归还阶段 fixture |
| `adjustments/:id` | 源码和既有可见性/原请求回归 | 没有挂起改单详情 fixture |
| `transfer-out/:id` | 源码、首次失败/原请求核对回归 | 没有已派发待调出单；没有整容器调出 |
| `transfer-in/:id` | 源码、首次失败/原请求核对与现有回归 | 没有在途待调入单；没有扫码入库 |
| `sale-return/:id/receive` | 源码、首次失败与既有收货回归 | 没有可接收销售退货 fixture |
| `sale-return/:id/putaway` | 源码、首次失败与既有上架回归 | 没有退货质检完成/待上架容器 fixture |

登录页因既有认证被 GuestRoute 跳回工作台，未做真实登录屏幕验收；仅源码调整和既有回归。相机、APK 原生广播/双输出、软键盘弹出、安全存储、实体返回键、戴手套触控、离线真实网络恢复、打印、更新下载/安装、超收财务登记均未验证。

## 开发环境 reload 与鉴权边界

浏览器设备凭据与票据按已有策略仅在内存中保存。B 记录到正常 UI `/pda/sessions` 200 → SPA 工作台 → todo-counts 200，bound/ticket 均为 true；userId2、sessionGeneration0、baseURL `/api` 与同一 document.timeOrigin 不变。安全 trace 不包含请求头、票据或密钥。

随后未绑定门出现伴随 document.timeOrigin 改变，不能推断为同 document 的 SPA 丢绑定。主 agent 核对 Vite 日志确认 08:32:39 测试文件 `src/lib/textWrapping.test.ts`、`racks/index.test.tsx` 和 08:34:31 `plastic-boxes/index.test.tsx` 写入触发 page reload；写入未被页面导入的测试也可能令开发服务器全页重载。停止 frontend 文件写入后，合法重绑的390工作台/320绑定页再次正常。此事记为开发环境内存边界，未改鉴权、未列产品绑定缺陷。

此前 `/warehouse-tasks/my-tasks` 的500诊断不是源码使用的有效 API。当前源码使用 `/warehouse-tasks/my` 与 `/my-sku-summary`。B 前后 picking 截图及同刻 DOM 均为成功空态（0 SKU/暂无待拣商品）。此前报告误把协作中的500诊断挂在该图上，已按真实图片/DOM纠正；没有 B 可验证的历史读取失败样本，不保留为已观察事实。

## 残留证据与资源收尾

关闭前 bound 手动区 axe 原始结果包含 color-contrast1（有效 badge 嵌套背景4.31）、main1、region7。主 agent 已收到具体颜色/背景并追加公共 token 回归；B 补 main 语义。该 JSON 是修整前/中间结果，不能作为最终无缺陷声明。

`observations-pda-before.json` 与 `observations-pda-after.json` 显式区分自动捕获、人工看图、实际交互和后续源码变更。截图没有被作为整条流程通过的替代品。最终绑定手动区已由 B 复查当前 main 与嵌套 badge，axe0；其它 ERP/PDA 样本与所有动态执行阶段仍按各自覆盖边界。

B 执行 named session close 后，首次 session list 尚有退出竞态；再次列表仅有主 agent 的会话，B session info 为 active=false、pid=null。`evidence-b/browser-cleanup-b.json` 保存退出后列表。未关闭其他任务会话。

## 后续真实资源补看

见 `observations-pda-final.json`。首次协作推断 task1 实际未创建：GET返回404/NOT_FOUND“仓库任务不存在”，仓库任务列表为空；此探测不算真实原任务详情。主 agent 随后通过合法 API 独立创建 sale5、预占1.25并派发，B 再 GET 确认 task1→sale5、sale_out、status2拣货中、requiredQty1.25，再逐页只读进入任务/复核/打包/出库路由。B 没有执行库存或任务写入。

最终12张阶段图（inbound1/2与task/check/pack/ship，每页320/390）均人工看图。复核与打包的禁止状态明确描述原单当前拣货阶段；ship动态路径未被组件消费，只能验证实际扫码初态。绑定手动区最终axe为35 passes/0 violations/0 incomplete，且字段仍为空。最后一次关闭后用全局 session list 复查仅见其他任务会话，B 已退出，见 `browser-cleanup-b-final.json`。关闭后不再调用 session info。

320px 可达性补查见 `evidence-b/pda-320-reachability.json`。真实task1/sale5的 manual 按钮在844px视口内（y763、高44、底807）；实际 scroll500前后 documentHeight844/scrollY0，说明无需纵滚即可点击。正常打开后44px输入自动聚焦，空取消；没有扫码或POST。长身份/真实1.25任务页与inbound2尚未收货页均无横向溢出，三张补充图已人工查看。此前中间图的折叠疑点已证伪，不列产品问题。


## 销售分配弹窗增量（09:10）

按主 agent 的明确分工，B 独占 `sale/components/ReserveAllocationDialog.tsx`、`ReleaseAllocationDialog.tsx`、`ShipSelectDialog.tsx` 与新增 `AllocationDialogs.pending.test.tsx`。原组件已按两位验证数量，却仍显示四位提示；三处现与两位合同一致，不改变金额、商品整数策略或 API 校验。

同步 ref 在 React Query / 父组件尚未渲染 pending 前拦截同帧二次确认；pending 期间数量、checkbox、占库仓库和取消被冻结，Escape/X/外部关闭经过同一关闭守卫。库存预览或出库明细变化不在提交中重建所显示的 rows；失败清交互锁并保留原输入，允许按原数量再次确认。原 hook、幂等键、shortage/授信处理、API、成功关闭和事务全部保留。占库原说明文字添加真实 DialogDescription，保持原布局。

新测试先观察到9个预期失败（连点实际2次、pending关闭3次、四位文案），再最小修整为绿。09:10:52 `vitest run src/pages/sale/components` 为2文件/12用例通过；新增9用例用真实 Radix/Input 与 React Query Mutation，冻结本次载荷1.25和仓库，模拟失败后仍可再次确认。四文件 scoped ESLint 为0错误/0警告；diff check通过。同期全 `tsc.app` 仅报另一代理新 `independentDialogs.draft.test.tsx` 合成customer缺creditLimit、user缺allowSelfApprove，已通知 owner，未把该次类型检查写成通过。

真实临时API中 sale2 已占库、sale3 为草稿。B 在1024×768分别正常打开出库/释放/占库弹窗，输入0/0/4（4大于该单需求3），确认按钮均禁用、两位文案可读；全部正常取消，没有点击确认、没有出库/释放/预占业务写入。三图已人工看：`b-sale-ship-select-1024.png`、`b-sale-release-allocation-1024.png`、`b-sale-reserve-allocation-1024.png`。表格横向滚动到右侧数量列，此代表没有宣称整张宽表同时可见。pending仅有组件测试，没有注入实际库存操作中的pending。

见 `evidence-b/sale-allocation-after.json`。一次旧ref因页面重载无法定位时立即退出；fresh同名ERP会话重开真实sale3后完成读/取消。最终执行 named close，全局列表确认 B absent，见 `evidence-b/browser-cleanup-b-sale.json`；没有访问关闭后的 session info 或触及其它会话。


主 agent 随后授权继续补占库读取场景与仓库具名。`ReserveAllocationDialog` 现在消费原 query 的 error/refetch，首次 loading/error 的指标显示“—”，错误时不渲染空分配表、缓存分配表或授信预览；确认在读取/校核失败或 refetch 中阻断。仓库说明由 label/useId 关联真实选择器。同单源码刷新保留已有数量与仓库选择，成功重试用最新可用量校验；没有自动夹量，来源降低时原输入仍在、确认仍禁用。关闭再打开恢复原默认初始化，原 hook/API/shortage/credit/request-key 未改。

新增 `ReserveAllocationDialog.read.test.tsx` 使用真实 `useSaleReservePreview`/Axios adapter；所有请求断言为原 `/sale/7/reserve-preview` GET，没有Mutation/业务写入。四个自然red对应初始失败冒充空表、缓存失败仍可编辑、仓库无label和加载显示0行；实现后绿。缓存反例编辑1.25/仓库2，失败后retry来源available变1，原草稿保留且确认禁用。网络错误沿当前 API client 标准化为“无法连接服务器”，共享QueryErrorState保留错误详情入口，不改全局错误转换。

09:18:49 `vitest run src/pages/sale/components` 为3文件/16用例通过；5文件scoped ESLint 0错误/0警告。之后完整 `tsc --noEmit -p tsconfig.app.json` exit0（其他owner补齐新夹具后），B受影响diff check通过。浏览器abort/retry将在源冻结后追加；此前3张数量样本不证明此新增读取错误状态。


最终稳定GUI窗口已完成真实预览错误→重试：仅拦截 owned `/api/sale/3/reserve-preview` GET 并 abort，没有伪造成功响应。实际失败图显示持续“加载失败/无法连接服务器”、指标“—”、tableCount0、editableSourceCount0、确认禁用。移除限定拦截并正常点击“重试”，请求日志保留原同URL GET200；真实sale3数量3、可用量20.75、完整仓库来源恢复，label指向role=combobox，确认可用后仍正常取消。两张1024图均人工看：`b-sale-reserve-read-error-1024.png` / `b-sale-reserve-read-retry-1024.png`。原API错误toast可能短时残留于成功图，不把该toast当成重试失败，也没有新增API toast或业务动作。

见 `evidence-b/sale-reserve-read-after.json`（仅保存安全GET方法/URL/状态，没有请求头、认证或凭据）。失败后草稿与可用量改变的反例仍仅组件证明；GUI未执行reserve/release/ship，更没有制造真实库存mutation pending。此次完成unroute/close后用全局session list确认B absent，`evidence-b/browser-cleanup-b-sale.json`为最后退出证据。B全部源码/测试已冻结，后续仅文档收尾。

## 百分比表格窄屏增量（09:48）

主 agent 在真实768px销售列表发现7权重经办人长身份压成逐字竖排，随后明确将 `DataTable.tsx` / `useTableColumns.ts` / `types/index.ts` 及相关测试分配给B。只读核对全仓实际 `fluid` 调用方为销售10列（权重总104）、采购9列、收货订单9列、PDA设备7列；其他商品/库存/盘点/收付款宽表已有像素或显式最小宽模式。本次未改这四个页面、数据、调用 API 或业务逻辑。

默认每个业务列96px、操作列128px（均含当前32px横向内边距）；调用方可选 `TableColumn.minWidth` 明确覆盖。比例只用于呈现：用现有 `getColumnWidth` 读取包含旧存储的有效权重，归一为占比 `p`，表格下限为 `选择列56 + ceil(max(列下限/p))`；勾选列固定56px，业务 `<col>` 最终只输出归一纯百分比，由 fixed-table 在扣除固定列后分配余宽（初版calc在实际Chrome反例后移除，见下）。四个默认实际调用方下限分别1427/1280/1515/960px，按权重决定，无全局固定1200px。外容器 `min-w-0/max-w-full` 保持内部横向滚动。原列 API、getColumnWidth、像素存储、独立拖动/80px下限、适应内容、排序、虚拟行、选择和固定右侧操作语义均保留；已保存80/90/128px不会被比例下限改写。

新 `DataTable.fluid.test.tsx` 首跑13项：12项自然失败、旧像素记忆项基线通过；09:48:35实现后与既有 `DataTable.test.tsx` 共2文件/30项通过。覆盖8/10/15列、真实104总权重、固定选择列、单列/空列、旧比例记忆、像素记忆、调用方下限覆盖和拖动取消/提交。此为 jsdom 组件/布局契约证据，不能代替浏览器排版。五文件 scoped ESLint 为0错误/0警告、完整 `tsc --noEmit -p tsconfig.app.json` exit0、受影响diff check通过；主 agent 将实际检查四个调用方768/1024/1440的横向滚动、身份可读性与固定操作列，B未开启新浏览器，也未把本轮组件通过写成真实四页视觉通过。

09:52:34拖动取消回归进一步执行真实mousemove→RAF预览，先断言比例440px下限被临时置0px、目标变80px且其余列140/160px不变，再按Escape断言440px比例下限与原比例列宽完整恢复、存储未写入；随后正常提交验证固定56px选择列和真实像素载荷。两文件30项再次通过，新测试lint0/0，产品布局源当时未再改。

## 选择列与固定操作列的实际Chrome补验（10:12）

真实组件夹具由主agent提供，内联合成1行、权重60/20/20、multiple选择，只有本地React状态与列记忆，不含业务API。首次 `scripts/design-audit/fluid-preview.html` 的@fs地址被既有服务范围拒绝403；移到owned临时 `frontend/.design-audit-fluid.html` 后直接导入预编译React DOM的named createRoot仍失败，主agent改默认导入后才实际渲染。两次加载阻碍截图已看，仅为harness记录，不算组件/业务读取失败或视觉通过。

实际Chrome发现初版 `<col>` 的混合百分比/像素calc被fixed-table忽略，选择列虽56px，但三业务列均213.33px而非384/128/128。仅在夹具DOM试验归一纯60/20/20%后，Chrome从余640px准确分配384/127.984/128.016px，表仍696px，无额外撑宽。同时真实check鼠标悬在行上时，既有sticky操作背景 `group-hover:bg-muted/30` 为0.3透明，操作文字与底层身份叠在一起；此反例并非theme缺失。主agent授权B只移除select calc、固定操作hover改为不透明。10:06:19两个选择比例/取消用例自然red，10:06:49两文件30项green、三文件lint0/0；floor、存储、拖宽、业务调用未改。

最终正常reload当前组件，未覆写任何列DOM样式，再检查768×768与320×844：选择列56，业务列384/127.984375/128.015625，min/table696；320文档宽320、内部scroller286，实际scrollLeft0→410→0，操作列right始终303。正常点击行checkbox后，header/row均true，滚动前后保留；回左后正常header取消均false。真实hover背景rgb(241,245,249)不透明，截图没有底层透字。身份DOM文本完整，但宽表在窄视口分段横向阅读，没有宣称所有列同时可见。

五张最终验收图、两张辅助最终图均逐张人工看，八个原始DOM状态见 `evidence-b/fluid-selection-final-dom.json`，精确图索引与失败边界见 `evidence-b/fluid-selection-preview.json`。CLI横轮命令本次未观察到wheel事件、未移动scroller；实际末轮滚动只设置原生scrollLeft验证排版，不能当物理横轮输入验收。初版DOM覆写试验图也不算最终源码通过。该组件夹具不代表主agent正在验收的四个真实业务页。B没有业务API写入；最终named close后全局session list为[]，未结束他人会话。主agent负责删除owned临时HTML、不提交，B源码/测试保持冻结。
