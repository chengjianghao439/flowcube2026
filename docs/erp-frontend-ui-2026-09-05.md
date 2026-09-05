# ERP 前端统一样式与覆盖记录 · 2026-09-05

最新 PC 辅助界面收口与源码清单见 [最终收口报告](pc-ui-final-audit-2026-09-05.md)。以下保留对应轮次的实现与验收证据。

本文件记录第一轮共享样式覆盖；后续 PC 专项结构重构及全导航实页检查已完成，最新交付范围与验证见 [PC 页面专项重构](erp-pc-page-completion-2026-09-05.md)。以下“未单独验收”仅表示第一轮历史记录。

## 范围和实现

本轮将已确认的紧凑业务界面扩展至 ERP 桌面页面；不改变后端业务、权限与提交接口。沿用 Impeccable 设计指导，通过本地开发服务和浏览器工具检查实际页面。PDA 专用页面及窄屏专项排版不在本轮范围；共享基础组件有间接影响，因此执行 PDA 构建。

- PageHeader、ActionBar、SectionCard：统一标题密度、间距、操作换行及长标题处理。
- FilterCard：筛选工具条独立轻边框，折叠按钮标注展开状态与内容关系。
- DataTable：复合内容允许换行，固定操作列使用不透明底色，补选择行名称与加载状态；保留原有排序、选择、列宽和列顺序逻辑。
- Pagination：有记录的单页也展示总数和禁用的翻页按钮，空结果由列表空态承接。
- BaseCrudPage：加载失败显示错误重试，不再误作空列表；表单限制内部高度。
- Dialog：长内容限制在窗口内滚动，中文关闭标签，标题及底部按钮布局统一。
- QueryFormLayout：收口 21 个已有查询弹窗的顶部对齐、双列网格与滚动；筛选字段、重置与提交保持原调用。
- 采购、采购退货、调拨的新建及详情：将商品名称、编码、供应商型号、型号和颜色集中为商品身份列，保留数量、单位与金额列。商品管理、补货建议采用相同身份展示；供应商、用户、仓库和发票表单调整宽度，商品档案基本信息三列、售价四列、库存策略两列。
- 打印机管理接入标准页头；财务、会计、报表、审批和设置主要通过其现有共享组件接收样式。

## 验证边界

本轮路由盘点包含 routeRegistry 的 66 个分组主入口（不含仪表盘、动态详情及独立子页）。所有入口直接或通过包装页使用上述共享组件，但这不等于每个页面的全部工作流都已手工验收。下表“共享样式”仅表示代码依赖覆盖；“本轮实页检查”列只记实际打开的页面。前轮销售验收详见 sales-group-ui-2026-09-05.md，不冒充本轮重测。

浏览器使用本机 5173 开发服务、已有有效会话，1600 × 1000 桌面窗口。只读或未保存草稿操作；采购和调拨查找回填测试行已删除，未保存订单、用户、供应商、发票，也未触发审批、库存动作或打印。

| 分组 | 主入口 | 页面 | 共享样式 | 本轮实页检查 |
|---|---|---|---|---|
| 采购 | `/purchase` | 采购订单 | PageHeader, DataTable, DialogContent | 列表、新建、商品查找与未保存回填 |
| 采购 | `/purchase-requisitions` | 采购申请 | PageHeader, DataTable | 未单独验收 |
| 采购 | `/procurement` | 采购计划 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 采购 | `/inbound-tasks` | 收货订单 | PageHeader, DataTable | 未单独验收 |
| 采购 | `/suppliers` | 供应商管理 | BaseCrudPage, FilterCard | 列表、新建弹窗、单页总数 |
| 销售 | `/sale` | 销售管理 | PageHeader, DataTable | 未单独验收 |
| 销售 | `/returns/sale` | 销售退货 | PageHeader, DataTable | 未单独验收 |
| 销售 | `/credit-overrides` | 超额放行申请 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 销售 | `/logistics` | 物流运单 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 销售 | `/customers` | 客户管理 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 销售 | `/portal/statements` | 客户对账门户 | PageHeader, DataTable, FilterCard | 未单独验收 |
| 采购 | `/portal/purchase-status` | 供应商到货门户 | PageHeader, DataTable, FilterCard | 未单独验收 |
| 销售 | `/carriers` | 承运商管理 | BaseCrudPage, FilterCard | 未单独验收 |
| 库存 | `/inventory` | 库存管理 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 库存 | `/plastic-boxes` | 塑料盒管理 | BaseCrudPage, FilterCard, DialogContent | 未单独验收 |
| 库存 | `/inventory/trace` | 批次追溯 | PageHeader | 未单独验收 |
| 库存 | `/stockcheck` | 库存盘点 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 库存 | `/stockcheck/abc` | 商品分档与分批盘规则 | PageHeader, DataTable, FilterCard | 未单独验收 |
| 库存 | `/disposals` | 滞销库存处理 | PageHeader, DataTable | 未单独验收 |
| 库存 | `/transfer` | 库存调拨 | PageHeader, DataTable | 未单独验收 |
| 库存 | `/products` | 商品管理 | PageHeader, DataTable, DialogContent | 列表复合商品列、新建表单 |
| 库存 | `/categories` | 商品分类 | PageHeader, DialogContent | 未单独验收 |
| 库存 | `/price-change` | 商品改价申请 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 仓储 | `/picking-waves` | 批次拣货 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 仓储 | `/warehouses` | 仓库管理 | 经包装页引用共享组件 | 仓库页签列表 |
| 财务 | `/payments/payable` | 应付账款 | 经包装页引用共享组件 | 未单独验收 |
| 财务 | `/payments/receivable` | 应收账款 | 经包装页引用共享组件 | 未单独验收 |
| 财务 | `/reports/reconciliation/payable` | 供应商对账 | 经包装页引用共享组件 | 未单独验收 |
| 财务 | `/reports/reconciliation/receivable` | 客户对账 | 经包装页引用共享组件 | 未单独验收 |
| 财务 | `/logistics/freight-reconciliation` | 运费对账 | PageHeader, SectionCard, DataTable, DialogContent | 未单独验收 |
| 财务 | `/finance/dashboard` | 资金看板 | PageHeader, FilterCard | 首屏筛选、指标与账龄图 |
| 财务 | `/finance/accounts` | 账户管理 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 财务 | `/finance/transactions` | 资金流水 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 财务 | `/finance/expenses` | 费用报销 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 财务 | `/finance/expense-categories` | 费用类别 | BaseCrudPage | 未单独验收 |
| 会计 | `/accounting/accounts` | 会计科目表 | PageHeader, DialogContent | 未单独验收 |
| 会计 | `/accounting/vouchers` | 记账凭证 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 会计 | `/accounting/ledger` | 总账 / 试算平衡 | PageHeader, DialogContent | 未单独验收 |
| 会计 | `/accounting/reports` | 会计报表 | PageHeader | 未单独验收 |
| 会计 | `/accounting/invoices` | 发票管理 | PageHeader, DataTable, DialogContent | 空列表、录入弹窗 |
| 财务 | `/refunds` | 退货退款单 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 会计 | `/accounting/periods` | 会计期间 / 期末结转 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 会计 | `/accounting/fixed-assets` | 固定资产 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 会计 | `/accounting/consolidation` | 合并报表 / 账套 | PageHeader, DataTable | 未单独验收 |
| 会计 | `/accounting/tax` | 报税数据 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports` | 报表中心 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/profit-analysis` | 利润 / 库存分析 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/avg-cost-reconciliation` | 成本对账 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/kpi` | 经营 KPI | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/replenishment` | 补货建议 | PageHeader, DataTable, DialogContent | 空列表、查询弹窗 |
| 报表 | `/reports/inventory-aging` | 存放时长与滞销 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/warehouse-ops` | 仓库运营看板 | PageHeader | 未单独验收 |
| 报表 | `/reports/wave-performance` | 批次效率 | PageHeader, DataTable | 未单独验收 |
| 报表 | `/reports/pda-anomaly` | PDA 异常分析 | PageHeader | 未单独验收 |
| 报表 | `/reports/role-workbench` | 岗位工作台 | PageHeader | 未单独验收 |
| 系统 | `/settings/print-templates` | 打印模板 | PageHeader, DataTable | 未单独验收 |
| 系统 | `/settings/printers` | 打印机管理 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 系统 | `/settings/barcode-print-query` | 条码打印查询 | PageHeader, DataTable | 未单独验收 |
| 审批中心 | `/approvals/pending` | 待我审批 | PageHeader, DataTable | 空列表 |
| 审批中心 | `/approvals/flows` | 审批流配置 | PageHeader, DataTable, DialogContent | 未单独验收 |
| 系统 | `/departments` | 部门管理 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 系统 | `/users` | 用户管理 | PageHeader, DataTable, FilterCard | 列表、双列新建弹窗 |
| 系统 | `/permissions` | 权限管理 | PageHeader, DialogContent | 未单独验收 |
| 系统 | `/settings/pda-devices` | PDA 设备 | PageHeader, DataTable, FilterCard, DialogContent | 未单独验收 |
| 系统 | `/settings` | 系统设置 | PageHeader | 未单独验收 |
| 系统 | `/oplogs` | 操作日志 | PageHeader, DataTable, DialogContent | 未单独验收 |

补充子页验收：`/transfer/new` 的商品查找、未保存回填、表头与明细列对齐已检查；测试行已移除。商品列表读取浏览器错误日志为空。

## 验证结果

- 前端类型检查：`tsc -p frontend/tsconfig.app.json --noEmit`。
- 前端 lint：0 错误，5 条既有 Fast Refresh 警告。
- 单元测试：17 个测试文件、90 项通过（新增分页单页总数、空列表和前后翻页边界回归）。
- ERP 构建与 PDA 构建通过；PDA 构建提示 Browserslist 数据过期，未改动依赖。
- 最终代码调整后重新执行上述检查；`git diff --check` 通过。不运行涉及业务数据库写入的回归。

本轮为全部 ERP 的公共视觉结构统一和代表性页面专项重排，未承诺全部动态详情、全部状态及真实提交链路均已逐项视觉验收。未提交、未推送、未发布。
