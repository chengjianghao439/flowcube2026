# 商品身份统一展示覆盖台账（2026-10-30）

范围依据：当前用户截图及批准计划 `docs/superpowers/plans/2026-10-30-product-identity.md`。本台账记录源码迁移、受控组件验证和局部实际浏览器验收。未提交、未推送、未合并、未发布。

## 统一输出及事实边界

- 原生表头、DataTable、ResizableTable统一一列“商品”：第一行灰色等宽编码+较醒目名称；第二行型号、颜色、供应商型号按此顺序以点分隔。
- ProductIdentitySummary是共同输出；InboundProductIdentity、PurchaseProductIdentity、CommercialItemIdentity、PdaProductIdentity都委托共同摘要。缺失元数据整项省略，长文完整自然换行，无截断/展开依赖。
- 只展示当前行/原单/原快照已有事实，不新增接口，不用当前主数据补历史快照。PDA扫码本来已返回的商品字段保留在本地展示投影；容器条码独立显示，不能冒充商品编码。
- 编辑表格的选品点击、双击、键盘、锁定身份、数量输入、单位、金额、仓库、操作仍保留。真正编辑商品属性的输入以及筛选条件值继续各自语义。
- 显式布局存储使用新productIdentity键；旧五列首位置替换为组合列，保留其余业务列顺序和宽度。ReportTable依然按ProductIdentityHeaders函数引用展开表头。原生空行/备注跨度、选品/库存虚拟列数已随合列修正。
- VirtualTableBody既有measureElement测量可变行高，未改成固定裁切。选品虚拟末条、焦点与确认行为保留原回归；普通/商业选品底部已选商品核对也共用摘要，分类、供应商和条码保留。

## 例外

- 本轮按应用页面展示处理，导出、实体打印/标签模板及打印预览保持原输出结构。
- 图表坐标轴/图例需要简短分类标签；库存价值Top10 tooltip改为已有源行商品摘要。不会为图表缺失规格补查数据。
- 搜索/筛选表单、确认动作短文案、提示/错误/作业成功反馈、按钮可访问名称是操作文本，不强行嵌入身份组件；相应实际商品内容区域使用统一摘要。
- 物流“发货产品”表示承运商服务产品，不是库存商品。
- 旧快照只记录名称或编码时显示它已有的身份字段；没有型号等字段不编造。金额、幂等正文、权限、后端、数据库均不改。

## 系统迁移清单

下表将原85候选路径、共享调用方与候选外独立渲染合并分类。列表入口可能依赖共享组件生效而无需本文件diff。

| 路径 | 状态 | 处理/保留依据 |
|---|---|---|
| `frontend/src/components/agent/TaskPreview.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/dashboard/widgets/ChartWidgets.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/dashboard/widgets/ListWidgets.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/dashboard/widgets/RiskDetails.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/pda/PdaOverReceiveDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/pda/PdaProductIdentity.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/print/TemplateRenderer.tsx` | 范围例外 | 实体单据/标签布局与输出字段，本轮按应用页面展示范围保留原输出。 |
| `frontend/src/components/shared/ContainerDrawer.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/GlobalSearch.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/OrderActivityDialog.tsx` | 已核对 | 商品身份由相邻共享摘要入口覆盖，剩余标识符用于数据投影、选择/编辑或操作反馈，不增加接口读取。 |
| `frontend/src/components/shared/OrderChangeDetails.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/OrderFulfillmentPanel.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/ProcurementSupplyDetails.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/ProductFinderModal.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/ProductIdentityCells.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/ProductIdentitySummary.tsx` | 已核对 | 商品身份由相邻共享摘要入口覆盖，剩余标识符用于数据投影、选择/编辑或操作反馈，不增加接口读取。 |
| `frontend/src/components/shared/ReportTable.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/payments/SettlementConfirmDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/productIdentityColumns.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/components/shared/useTableColumns.ts` | 已迁移 | 旧五列布局首位置替换为新productIdentity；其他列宽与顺序保留，新商品列不复用旧窄名称宽度。 |
| `frontend/src/pages/disposal/ConversionDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/disposal/HandlingIntentDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/disposal/HandlingSourcesPanel.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/InboundProductIdentity.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/InboundQuantitySummary.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/inbound-tasks/PurchaseItemPickerDialog.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/create.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/detail.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/edit.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inbound-tasks/index.tsx` | 语义例外 | 列表仅持有商品筛选参数/筛选标签；身份显示在对应单据详情或共享选品中。 |
| `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/inventory/ReservationDetailsDialog.tsx` | 已核对 | 商品身份由相邻共享摘要入口覆盖，剩余标识符用于数据投影、选择/编辑或操作反馈，不增加接口读取。 |
| `frontend/src/pages/inventory/ReservationSnapshotRead.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inventory/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/inventory/trace.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/kits/KitEditor.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/kits/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/logistics/DirectShipmentDialog.tsx` | 语义例外 | 承运商发货产品是物流服务产品代码，不是ERP商品身份。 |
| `frontend/src/pages/logistics/detail.tsx` | 语义例外 | 承运商发货产品是物流服务产品代码，不是ERP商品身份。 |
| `frontend/src/pages/pda/adjustment.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/cancel-return.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/check.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/fill.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/inventory-query.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/pack.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/picking.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/receive.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/sale-return-putaway.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/sale-return-receive.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/ship.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/sort.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/split.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/stockcheck.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/task.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/transfer-in.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/pda/transfer-out.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/picking-waves/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/plastic-boxes/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/price-change/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/procurement/detail.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/products/form.tsx` | 语义例外 | 主数据属性编辑输入独立保留；不将真正编辑字段合并成只读摘要。 |
| `frontend/src/pages/products/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/purchase-requisitions/form.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/purchase/PurchaseQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/purchase/form/PurchaseProductIdentity.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/purchase/form/PurchaseQuantitySummary.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/purchase/form/index.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/purchase/index.tsx` | 语义例外 | 列表仅持有商品筛选参数/筛选标签；身份显示在对应单据详情或共享选品中。 |
| `frontend/src/pages/reports/CurrentValuationCost.tsx` | 语义例外 | 商品名称用于估值来源按钮和浮层的可访问名称；行身份由父列表统一摘要呈现。 |
| `frontend/src/pages/reports/avg-cost-reconciliation.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/reports/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/reports/inventory-aging.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/reports/profit-analysis.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/reports/replenishment.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/returns/ReturnQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/returns/index.tsx` | 语义例外 | 列表仅持有商品筛选参数/筛选标签；身份显示在对应单据详情或共享选品中。 |
| `frontend/src/pages/returns/purchase/form/index.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/returns/sale/form/SourceComponents.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/returns/sale/form/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/SaleQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/sale/commercial/CommercialEditor.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/commercial/CommercialItemIdentity.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/commercial/CommercialOrderItems.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/commercial/CommercialPicker.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/commercial/CommercialSalePage.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/commercial/CommercialShipDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/components/SaleOrderPreview.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/components/ShipSelectDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/components/StockShortageDialog.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/form/components/SaleOrderItemsTable.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/form/components/SaleOrderWarehouseViews.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/form/index.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/sale/index.tsx` | 语义例外 | 列表仅持有商品筛选参数/筛选标签；身份显示在对应单据详情或共享选品中。 |
| `frontend/src/pages/stockcheck/abc.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx` | 已迁移 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/transfer/TransferQueryDialog.tsx` | 语义例外 | 商品筛选条件的PickerField单行选择值、清空/查询状态；实际查找列表由共享选品摘要呈现。 |
| `frontend/src/pages/transfer/form/index.tsx` | 共享生效 | 使用统一商品摘要或统一商品单列；保留业务数量、单位、价格、仓库和原事件。 |
| `frontend/src/pages/transfer/index.tsx` | 语义例外 | 列表仅持有商品筛选参数/筛选标签；身份显示在对应单据详情或共享选品中。 |

## 本子任务验证

- `identity-before.log`：新结构/旧别名两项先失败；`identity-after.log`：3项通过。
- `layout-before.log`：旧saved.order把商品列放末尾的回归先失败；`layout-after.log`：布局迁移+DataTable/ResizableTable合计3文件23项通过。
- `affected-first.log`：首批6文件56项通过（共享结构、ReportTable、PDA、采购身份、通用与商业选品）。
- `affected-final.log`：扩展11文件115项中114通过、1项PDA旧冒号文本断言失败；对应断言已更新，后续下项完整通过。
- `full-failures-rerun.log`：首轮全量发现的本批结构影响10文件105项全部通过，保留退款原价精度、终态权限、虚拟焦点、连续读取、未知数量等业务断言。
- `picker-final.log`：普通/商业选品表格及底部核对最终5文件62项通过，覆盖刷新身份、远端查询、虚拟末行、来源变化、确认与焦点。
- `tsc-final.log`：应用类型检查无输出且退出0（Node22，显式tsconfig.app.json）；最终父任务仍统一检查最新树。
- 全量前端、lint、构建、约定/style、浏览器由父任务统一执行并单独给证据，不用上述组件结果代替。

## 保留既有修改

任务开始已存在的AgentWorkspace/xiaoman、KeepAliveOutlet/WorkspaceTabs、categories、ReserveAllocationDialog及其读取回归、SaleOrderHeaderFields、print-templates编辑器及回归、printers、stockcheck等修改未撤回。ProductIdentityCells/表头与ReportTable.test原有列宽增强在当前截图要求下升级为单列对应行为；保留用户调宽与入口独立默认宽回归。


## 集中验证与实际页面

- 前端最终全量：433 文件、4037 用例通过。首轮 36 项旧列数/文本结构断言随本次合列更新，原业务、数量精度、授权和未知结果断言保留；发票日期首轮并发失败单独6/6及最终全量均通过，未修改其业务代码。
- 前端 lint、应用 `tsconfig.app.json` 类型检查、build、前端约定与样式兼容通过。最后两个选品底部摘要补充后，5文件62项专项、应用类型检查、lint与build再次通过；具体日志在本机 `output/product-identity-20261030/`，不以旧 PR CI 代表本批新代码。
- 浏览器复用原 PR 工作树 5173/3000 与既有回环合成预览库。商品管理1280/1093、库存1093、销售普通选品1280/1093已实际查看；商品管理完整样本显示型号/颜色/供应商型号，缺字段样本只显示已有身份。选品表头与行均为商品、单位、库存、价格四列。没有保存商品或订单，没有确认库存动作。
- 截图：本机 `products-1280.png`、`products-1093.png`、`inventory-1093.png`、`picker-1280.png`、`picker-1093.png`，位于上述输出目录。截图为本地页面，不等于所有105路径逐页GUI或真机通过。
- PDA采用真实组件回归覆盖完整/长字段；PDA真机、全部业务角色、生产、实际纸张与导出文件未做本轮验收。UI只显示原对象拥有的字段，不补查或变更历史事实。

本轮代码、测试和说明仍在原PR103工作树，未提交、推送、合并或发布；上一批修复保留，main未修改。

最终复核确认退货容器、图表tooltip和选品底部摘要均已统一，未发现确定性源码遗漏；本任务浏览器关闭后 session list 为空。


2026-10-30 后续交付：用户明确授权所有对话改动提交并推送 GitHub，本文件以上“未提交/未推送”为实施阶段状态。本批纳入 `codex/ui-audit-remediation-20261027` 的提交推送范围；不合并 main，不执行发布。新提交的云端 CI 结果另核。
