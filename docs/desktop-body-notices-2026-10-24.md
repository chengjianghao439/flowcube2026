# 电脑端原 42 处提示清单（2026-10-24）

本清单记录上一轮迁移的 42 处页头提示位置，不是 42 种风险警告，也不是全系统提示总量。包含业务约束、统计口径、请求恢复规则与操作指导。下表按原文列出；条件提示仍按原条件出现，共用页面仍按当前业务类型取原文。原本已在正文中的会计期间、设备范围及基础资料说明不计入这 42 处。

最新呈现规则：以下原文直接替代标题下的用途小字，同一页面只保留这一处说明；条件提示不成立时显示用途说明。上一轮移入正文的位置已撤除，没有修改业务判断。表中的规则是界面已有文案，不代表本轮对后台业务实现做了重新验收。

| 序号 | 页面与源码 | 保留的原提示及显示条件 |
| --- | --- | --- |
| 1 | [跨期补录审批](../frontend/src/pages/accounting/backfills/index.tsx) | 已结账期间被拦下的付款/核销/退款在这里申请与审批：申请只留单不动账，批准后才真正记账，调整凭证落在补录当期 |
| 2 | [合并报表与账套](../frontend/src/pages/accounting/consolidation/index.tsx) | 多账套管理：选择集团账套查看合并资产负债表与利润表（Σ子账套）。切换账套后会计各页随之过滤。 |
| 3 | [发票管理](../frontend/src/pages/accounting/invoices/index.tsx) | 进项/销项发票池与认证抵扣台账；税额在生成凭证时按发票自动拆分为进项/销项税额 |
| 4 | [总账与试算平衡](../frontend/src/pages/accounting/ledger/index.tsx) | 查看科目期初、本期发生与期末余额；借贷发生额和期末余额应各自平衡 |
| 5 | [会计报表](../frontend/src/pages/accounting/reports/index.tsx) | 利润表 / 资产负债表 / 现金流量表（简版，取数以凭证与资金流水为准） |
| 6 | [报税数据](../frontend/src/pages/accounting/tax/index.tsx) | 从会计科目发生额实时投影增值税/所得税申报表要素（税会差异，即税法与会计口径的差异，用调整项手工维护），供报税参考。 |
| 7 | [记账凭证](../frontend/src/pages/accounting/vouchers/index.tsx) | 由业务事实自动生成的借贷凭证，可导出通用记账凭证或金蝶 KIS 格式 |
| 8 | [审批流配置](../frontend/src/pages/approvals/flows.tsx) | 按业务类型 + 金额区间配置多级审批节点（指定角色 / 部门负责人 / 指定用户） |
| 9 | [仪表盘](../frontend/src/pages/dashboard/index.tsx) | 仅编辑态：拖拽调整卡片顺序 · 调整宽度 · 隐藏或添加卡片，完成后保存 |
| 10 | [部门管理](../frontend/src/pages/departments/index.tsx) | 审批流可按部门负责人匹配审批人 |
| 11 | [报废结果核对](../frontend/src/pages/disposal/DisposalRecoveryPage.tsx) | 这里只核对本人在原服务器发出的报废请求。查看或执行权限撤回后仍可查询；重试须有当前执行权限和仓库范围。 |
| 12 | [来源报废草稿](../frontend/src/pages/disposal/HandlingScrapPage.tsx) | 保留本来源输入，报废草稿重新提交原审批。 |
| 13 | [滞销库存处理](../frontend/src/pages/disposal/index.tsx) | 促销走正常销售，退供应商走采购退货；新独立单只报废，沿原审批后执行。历史处理单保留追溯，旧已批准单待签认。 |
| 14 | [账户管理](../frontend/src/pages/finance/accounts/index.tsx) | 余额由流水实时汇总，不可直接修改。 |
| 15 | [费用报销](../frontend/src/pages/finance/expenses/index.tsx) | 登记日常经营费用，审批通过后从资金账户付款。付款会自动记入账户流水。 |
| 16 | [资金流水](../frontend/src/pages/finance/transactions/index.tsx) | 所有资金账户的收支明细。账户余额以流水为准；如需对平账实差异，请到账户管理页做「余额调整」。 |
| 17 | [固定资产](../frontend/src/pages/fixed-assets/index.tsx) | 固定资产卡片、按月计提折旧（直线法）、处置/报废。折旧凭证自动生成并进入总账。 |
| 18 | [库存管理](../frontend/src/pages/inventory/index.tsx) | 库存总览与出入库记录；采购入库请走「收货订单」上架后计入库存 |
| 19 | [成套配件](../frontend/src/pages/kits/index.tsx) | 已保存的销售单保留原成交资料，库存按真实组件管理。 |
| 20 | [运费对账](../frontend/src/pages/logistics/freight-reconciliation.tsx) | 录入承运商回传的运费账单，按「承运商 + 账期」汇总生成对承运商的应付（仅寄付计入，月结，需财务确认后付款）。 |
| 21 | [往来账款](../frontend/src/pages/payments/PaymentsView.tsx) | 供应商：现结与月结欠款分别展示；查询、导出及按单登记用于现结，月结仍通过对账单核销付款。<br>客户：现结客户：出库即结，出库后逐笔登记收款；月结客户见「月结客户对账」 |
| 22 | [客户 / 供应商往来明细](../frontend/src/pages/payments/party-ledger.tsx) | 覆盖全部结算方式，按记账时间查看往来余额的每次变化。核销不重复计入收付款。 |
| 23 | [客户对账单查询](../frontend/src/pages/portal/statements.tsx) | 选择客户后查看每期对账单：金额、已结算与未结算金额。本页仅供查看。 |
| 24 | [商品改价申请](../frontend/src/pages/price-change/index.tsx) | 改价走审批流，审批通过后自动生效并留变更历史 |
| 25 | [采购计划](../frontend/src/pages/procurement/index.tsx) | 按未发销售、历史预测与现有供给生成采购计划，核对包装、交期和覆盖后转为采购单草稿。 |
| 26 | [退货退款单](../frontend/src/pages/refunds/index.tsx) | 已收款的销售退货需先完成退款，否则无法继续退货；退款从资金账户出账并冲减已收金额 |
| 27 | [月结对账](../frontend/src/pages/reports/ReconciliationView.tsx) | 供应商：月结供应商的应付账单：按账期核对、登记付款、导出 Excel，可从对账单直接打开采购单与收货单。现结供应商见「现结供应商账款」。<br>客户：月结客户的应收账单：按账期核对、登记收款、导出 Excel，可从对账单直接打开销售单。现结客户见「现结客户账款」。 |
| 28 | [成本对账](../frontend/src/pages/reports/avg-cost-reconciliation.tsx) | 对比实际库存与账面数量的差异，发现差异后可执行校正。 |
| 29 | [存放时长与滞销](../frontend/src/pages/reports/inventory-aging.tsx) | 存放时长自入库本仓起算（调拨、拆分会重置）；金额按移动加权平均成本估值，仅供参考、不作账。滞销：仍有库存且超过设定天数没有出库。 |
| 30 | [利润 / 库存分析](../frontend/src/pages/reports/profit-analysis.tsx) | 查看已完成销售单的估算毛利与当前库存；销售明细可打开原单，库存明细可进入库存总览。 |
| 31 | [补货建议](../frontend/src/pages/reports/replenishment.tsx) | 按未发销售、实物与预计采购计算缺口；已有计划、采购申请和采购草稿分别覆盖。起订与整包装规则决定最终采购量。 |
| 32 | [采购退货 / 销售退货](../frontend/src/pages/returns/index.tsx) | 采购：退回供应商，出库减少库存<br>销售：查看退货单、收货与质检进度；上架完成后更新库存和应收。 |
| 33 | [开单结果核对](../frontend/src/pages/sale/RepeatSaleRecoveryPage.tsx) | 这里只核对当前账号在原服务器发出的创建请求。重开页面没有原完整表单，不能再次提交；查询失败或未找到结果时请继续核对，勿另发保存。 |
| 34 | [系统设置](../frontend/src/pages/settings/index.tsx) | 仅编辑态：正在编辑全局配置，保存后立即生效并回到查看状态。 |
| 35 | [新建 / 编辑打印模板](../frontend/src/pages/settings/print-templates/editor.tsx) | 从左侧拖入字段，在画布上点选/拖动/缩放调整版式（毫米坐标）；画布下方显示真实纸张尺寸，保存后打印以预览为准。 |
| 36 | [分档与盘点规则](../frontend/src/pages/stockcheck/abc.tsx) | 按出库消耗金额分档（A 卖得多盘得频繁 / B 中等 / C 卖得少盘得少）；分批盘点规则决定各档位多久盘一次、单次盘多少。 |
| 37 | [库存盘点](../frontend/src/pages/stockcheck/index.tsx) | 创建盘点单并填写实盘数量，提交后自动调整库存 |
| 38 | [供应商退款](../frontend/src/pages/supplier-refunds/CreateRefundPage.tsx) | 退款草稿来自准确采购退货，确认仅冻结退款；实际收款另行登记。 |
| 39 | [退款结果核对](../frontend/src/pages/supplier-refunds/RefundRecoveryPage.tsx) | 保留原请求、金额与真实日期，主动查询本人在原服务器发出的退款或补录结果。查看与写入权限撤回后仍可核原结果，不自动重发。 |
| 40 | [供应商退款](../frontend/src/pages/supplier-refunds/index.tsx) | 确认冻结退款单后，另行登记银行实际回款；退款与实物退货分别处理。 |
| 41 | [用户管理](../frontend/src/pages/users/index.tsx) | 仅原管理员条件成立时：可编辑登录账号；原密码无法查看，需要更换时请使用“重置密码” |
| 42 | [仓库发货](../frontend/src/pages/warehouse-shipping/index.tsx) | 使用已绑定仓库的 PDA 扫描物流条码，核对任务后确认出库。 |

后续补充：第 35 项模板编辑指导已与画布上方重复说明合并，补齐右侧属性、Delete 删除和 ZPL 毫米坐标提示，并随预览状态更新；仍只在页头呈现，不影响模板数据或打印实现。以上表格保留此前原文作为迁移记录。
