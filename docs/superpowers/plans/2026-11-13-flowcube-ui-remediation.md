# 极序 Flow 界面修复实施计划 · 2026-11-13

> 实施时用 executing-plans 按批执行，每批完成后在隔离环境验收，再推进下一批。以下勾选项是实施步骤。

**目标**：以销售订单为样板，修正阻断操作或误导用户的交互，并把有效筛选、动作层级、宽表与详情呈现统一到高频 ERP 页面及 PDA 任务。

**做法**：复用 React 页面、Radix 控件、现有浅色样式、工作区与权限入口。把状态映射、用词和控件反馈放在界面层处理。涉及仓库身份、库存、账款、权限或审批规则时，先核对现有契约，需改变规则的项目单独定案。

**依据**：[合并报告与问题索引](../../ui-audit-consolidated-2026-11-13.md)、[前端与 PDA 约定](../../frontend-pda-conventions.md)、[筛选和返回约定](../../workspace-filter-return.md)、[隔离预览](../../local-preview-acceptance.md)、[验证命令](../../verification-commands.md)。

---

## 批次 0 · 保护现场并锁定复现

- [ ] 核对 `git status --short --branch`、`git worktree list`、`git rev-parse HEAD`，逐批阅读将要触及文件的现有 diff。编写计划时是 `codex/gui-remediation`，HEAD 为 `c30b5d47da46152400869e4acd4bfdc3f4805f4c`，有此前修复和报告留在工作树。按当前内容复现，已修项标为“仅回归”，不覆盖用户或前轮改动。
- [ ] 把销售列表、查询、新建、详情四个样板场景保存为验收基线，记录窗口尺寸、缩放、角色、当前过滤条件和合成单号。固定同一台电脑的 100% 和 150% 视图，再补一个窄窗口。用鼠标及键盘验证焦点、横滚和返回。
- [ ] 复用专属隔离数据前核验进程、回环地址、数据库归属、容器挂载、具名卷和外呼关闭。对已收货、已上架、已拣货的旧样本，用等价新合成单据复现，不回改原记录。备用对照样本包括两个同 SKU 的仓库任务、已抵扣和未抵扣进项发票、正常采购员和受限收货角色。只在专属环境预置夹具。
- [ ] 为每组问题记录修前表现、修后期待和证据类型。偶发错误、空状态数据不足和业务规则争议留在各自任务，不阻塞已确认的界面修正。

## 批次 1 · 先处理作业阻断、误点和受限入口

首批修复和实测见 [首批界面修复与隔离复测](../../ui-remediation-batch1-2026-11-13.md)，其中列出了浏览器已经走通的路径和仍待补测的分支。

| 任务 | 实施入口与具体动作 | GUI 验收 |
| --- | --- | --- |
| UI-02、UI-14 的 PDA 部分 | `frontend/src/flows/putawayFlow.ts`、`frontend/src/pages/pda/putaway.tsx`、`receive.tsx`。核对扫码解析、推荐目标和成功回执的支持值。若现有契约只接受库位码，统一步骤名、输入示例、错误和成功消息为库位；若确有已支持的货架映射，按真实标识说明。超收摘要用“超收 N 件”，原因仍必填。 | 输入测试货架标签 H 类、有效库位码、错误码和其他仓的合法样本。每种反馈说明当前可接受标识；失败停在当前步，成功只落一次。应收 1 填 2、取消，核对已收保持 0。 |
| UI-03 | `frontend/src/pages/pda/task.tsx`、`sort.tsx`、`frontend/src/pages/sale/form/components/SaleOrderDetailTabs.tsx`。在“去分拣”携带经验证的任务身份作为界面提示，匹配当前返回的任务；多候选时提示扫原取货码或选择明确任务，禁止用路由参数直接决定写入。宽屏错误对齐当前录码区域。 | 两个同 SKU 任务中，从任务 A 拣完进入分拣。界面显示 A 的身份，选中不符或格未分配时能识别并回到正确输入。扫码提交依服务端原校验，错误不推进。复核分拣格状态及有权限的销售详情追溯。 |
| UI-01 | `frontend/src/pages/accounting/invoices/index.tsx`，对照 `backend/src/modules/accounting/accounting.invoice.service.js` 的 `removeInvoice`。以现有管理权限且 `status === 1` 为删除入口条件，进项已认证的抵扣入口仍可用。按合法删除动作核实弹窗文案。 | 逐项查看待认证、已认证、已抵扣、已开具、已红冲和只读岗位。不可删状态无可执行删除动作。合法状态打开确认后取消，票据仍在；过期数据的失败有刷新提示。 |
| UI-04 | `frontend/src/components/shared/NotificationBell.tsx`、`frontend/src/pages/inbound-tasks/detail.tsx` 及收货列表入口、`frontend/src/pages/dashboard/index.tsx`、`frontend/src/pages/returns/index.tsx`、`frontend/src/pages/logistics/index.tsx`、`frontend/src/pages/products/form.tsx`。核对每个原请求和目标权限。无目标权限时隐藏动作或呈现明确受限状态。商品查看以只读控件呈现，禁止产生脏稿。财务通知或计数的规则尚未查明时先确认范围，依授权规则处理输出。 | 用允许与受限角色走同一正常入口，核对卡片、列表和详情。受限角色看到明确受限状态，不出现貌似真实的 0 或无权动作；允许角色的原路径仍能完成。 |

- [ ] 用现有 `putaway.test.tsx`、`receive.test.tsx`、`task.test.tsx`、`sort.scan-ui.test.tsx`、`sort.recovery-handoff.test.tsx` 复测受影响入口，重点断言步骤停留、任务不串单、原请求回执恢复。发票补各已知状态下的动作可见性。涉及权限边界时补 `NotificationBell.test.tsx`、现有只读动作回归及 `npm run test:permissions`。路由有改动时补 `npm run test:route-permission-contract`。相关检查通过后做上述隔离 GUI 验收。

## 批次 2 · 先收敛销售样板，再扩展宽表和查询

实施范围、浏览器路径和剩余验收项见 [第二批修复与隔离复测](../../ui-remediation-batch2-2026-11-13.md)。

- [x] **UI-05、UI-13 的布局部分。** 样板先改 `frontend/src/pages/sale/index.tsx`、`frontend/src/pages/sale/form/components/SaleOrderDetailTabs.tsx` 和实际详情入口，沿用 `PageHeader.tsx`、`DataTable.tsx`、`WorkspaceTabs.tsx`、`desktop-page-samples.css`。在常用窗口确保单号、状态、主要动作和总额能辨认；过宽时优先压缩低优先级列，必要时固定主要动作并提供清晰横滚。动作按状态与权限收纳，危险动作单独呈现。相同结构逐项推广到采购、收货、库存、采购计划、报销，优先露出各页主要数量或金额；日期不在数字中间断行。
- [x] **UI-06、UI-07。** 先改 `frontend/src/pages/sale/SaleQueryDialog.tsx`、`frontend/src/pages/products/ProductQueryDialog.tsx` 和 `frontend/src/components/shared/QueryDialog.tsx` 的实际调用。规则为两端均有效且起值大于止值时留在弹窗、标出字段并禁止应用；合法单端保持原语义。销售、采购、库存流水、报销、物流、月结和批次明确显示已应用日期或“未限日期”。重置回本页默认，清除只移除相应限制。批次效率、账户流水按已应用范围或真实统计口径显示，禁止写死“近 30 天”。补货、供应商、批次及退货区分无记录、无匹配、读取失败和无权限。
- [x] **UI-17 的打印查询。** 改 `frontend/src/pages/settings/barcode-print-query/index.tsx`、`PrintRequestDetails.tsx`。摘要保持单行可定位，历史用全宽展开区或侧栏；标明“打印任务状态”，并同时区分业务状态。确认查询、轮询、展开关闭、退回焦点、已排队与打印失败状态仍可辨认，已有记录更新不会把操作焦点拉走。
- [x] **验证。** 在 100%、150% 和窄窗口走销售→采购、收货、库存及采购计划。仅靠键盘可找到查询、表格关键列、当前标签与常用操作。查询填写倒置日期和价格、清除后重查、打开详情再返回，核对条件标签、结果数和同范围导出。对照 `DataTable.fluid.test.tsx`、`DataTable.virtual.test.tsx`、`WorkspaceTabs.keyboard.test.tsx`、`QueryDialog.consistency.test.tsx` 及打印记录现有专项。运行 `npm run test:frontend-conventions` 和 `npm run test:frontend-date-source`。涉及打印状态映射时跑 `npm run test:print`。

## 批次 3 · 统一输入、取消和单据交接

- [x] **UI-08、UI-09。** 在 `frontend/src/pages/returns/purchase/form/index.tsx`、`frontend/src/pages/returns/sale/form/index.tsx`、`frontend/src/pages/transfer/form/index.tsx` 中先选择成功再加有效行。未选取消时不增加行、不标脏、不修改统计；换选取消保留原行。通过现有 `frontend/src/hooks/useDirtyGuard.ts` 核查报销、分类、超额申请、调拨草稿以及销售编辑。脏稿显示“继续编辑 / 放弃本次修改”；未改直接关闭，成功保存清除脏标记。验证 X、返回、取消、切换标签及 ESC。
- [x] **UI-10、UI-14。** 采购计划 `frontend/src/pages/procurement/detail.tsx` 对勾选且缺供应商的行显示原因，按钮名说明“生成采购草稿”，选定项的可读值同步。残值率字段明确 0.05 对应 5%，保留当前数值契约；承运商、部门、账套必填状态提前标记。库存出库让无效数量及限制在字段旁持续可见。报销提交与撤回是否二次确认、采购退货默认量及零价采购门槛按待决项处理。
- [x] **UI-11、UI-12。** 入口包括 `frontend/src/hooks/useWarehouseHandoffQuery.ts`、`frontend/src/pages/inbound-tasks/detail.tsx`、`frontend/src/pages/inventory/ReservationDetailsDialog.tsx`、`frontend/src/pages/finance/expenses/index.tsx`、`frontend/src/components/shared/GlobalSearch.tsx`、`frontend/src/utils/operationLogFormatters.ts`。采购/收货关联状态在目标页激活后局部重读，保留筛选和表单。预占失败重试沿用原条件，独立记录偶发 503；报销同单搜索用稳定的开关和结果提示，先重复关闭、重开及迟到响应复现。销售修改入口直接走已有编辑路径，若必须先查看则改名准确说明。采购退货原单号只按原查看权限链接。操作人仅取可追溯的现有记录，来源缺失时明确表示。
- [x] **验证。** 用采购与销售退货、调拨三页各走新加取消、换选取消、选择成功和汇总。用报销及调拨已保存草稿改值、取消再选继续，确认内容仍在；确认放弃后核原单。双窗口验证新状态回读，重复打开同一报销搜索结果，模拟受控的读取失败后重试并核对原单号。运行相关 `cancel.test.tsx`、`warehouseHandoffReads.test.tsx`、`ReservationDetailsDialog.test.tsx`、`GlobalSearch.test.tsx`。数量校验或收货契约若受影响，补 `npm run test:qty-precision` 或 `npm run test:inbound-edit`。

实际验收和新发现见 [第三批复测报告](../../ui-remediation-batch3-2026-11-13.md)。

## 批次 4 · 按页面收尾，处理业务待决项

实施结果和逐项复测见 [第四批与整体收尾报告](../../ui-remediation-final-2026-11-13.md)。

- [x] **UI-13、UI-15、UI-16。** 采购建议及组合报表突出当前子视图，保留工作区返回和已应用条件；仪表盘入口明确进入布局预览。用 `frontend/src/lib/dateTime.ts` 区分时间戳与业务日期，核对 UTC 到北京时间跨日显示。凭证、报废、小满和退款卡片用现行业务词汇，保留原值、金额精度和业务口径。月结选择器沿用现有供应商选择器和匹配契约；无待核销及客户往来文案先核范围。改价参照仅展示现有已授权数据。入口见 `frontend/src/pages/reports/ReconciliationView.tsx`、`frontend/src/pages/payments/party-ledger.tsx`、`frontend/src/pages/price-change/index.tsx`。
- [x] **UI-17 的模板编辑、UI-18。** 模板每次完成的数值编辑只形成一次撤销，屏幕预览显示完整商品编码；关闭改过的新模板时可继续编辑或放弃修改。PDA 分开命名二维码原文和设备码加密钥两个入口，登记页说明仓库范围。纸张与 PDA 真机保留独立验收。
- [x] **UI-19。** 只读核对异常旧盘点和正常新样本，修正自动化夹具参数并补入库后断言；ABC 单商品按现行算法核对，滞销显示区分从未出库和已超阈值。批次页停留在本次切换中未复现。
- [x] **第三批发现的采购日期错误。** 旧时间戳用业务日回填预计到货日；仅改商品单价仍提交合法日期。无法解析的旧值保持可见，用户修正后方可保存。

| 待决项 | 需要核对或决定 | 独立可推进的修复 |
| --- | --- | --- |
| 采购退货默认可退量、报销提交撤回、采购草稿零价 | 是否默认空、是否需要二次确认、零价何时拦截 | 明示本次数量与金额、动作后果、供应商必填与错误反馈 |
| 财务通知与格号、设备默认仓范围 | 哪些岗位可以看计数或格号，设备是否必须显式选仓 | 移除已确认无法到达的动作，明确受限状态、输入和范围文案 |
| 核销资格、往来统计、当前价格展示 | 确认状态和范围，价格可见权限 | 解释当前筛选，保留受限状态与精确匹配提示 |
| ABC 单商品、未出库滞销与通知 | 确认统计指标、日期起算和业务规则 | 分开显示从未出库与超过阈值，复核数据后再决定算法 |

## 每批验收与交付

- [ ] 按修改范围选现有组件测试，关键行为要有能区分修前修后的用例。运行示例：`npm --prefix frontend run test:unit -- src/pages/pda/putaway.test.tsx src/pages/pda/receive.test.tsx src/pages/pda/sort.scan-ui.test.tsx`。涉及共用组件的最终改动集中做前端单测、lint、`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit` 和受影响构建；代码改动后重跑受影响部分。
- [ ] 在正常浏览器窗口按问题编号实操，分别记录正常、空、加载、失败重试、返回、150% 和键盘状态；权限相关再切正常与受限角色，覆盖同款多任务、待打印/失败、已抵扣与可删除、部分读失败等样本。记录窗口、动作、结果及可复核截图或记录。改共享组件后至少回看销售、采购、收货、库存、报销和打印关键页面。
- [ ] PDA 真机扫码、Windows 和实际打印为独立验收。无法现场操作的项目保留未验证状态；报告中记录样本、版本和验收边界。每批核对 diff，保留原工作区、容器、卷及合成单据；计划完成后的实施和正式环境操作各按当时授权执行。
