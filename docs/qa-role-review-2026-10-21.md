# 正式13角色改前 / 改后对照表（用户已认可v2）

**用户已认可b7df530中的本表v2，明确7个角色整项撤回report.view、不拆分。** 逐项集合保持该认可版本；新增296迁移只在本地合成测试库验证，未在正式系统执行、未合并或发版。2026-10-21经用户授权，在Grok Bot私聊“极序运维”取得附件 `jixu-roles-20261021.json`。运维声明它来自当日10:53（北京时间）的正式系统只读导出，线上版本 `8db3e40f`；本任务未直接查询生产数据库。附件仅含角色元数据和权限码，源文件SHA-256：`578e8524e4778cb32e9fb41ad5e180323015fc97ac27489bec793a7dbd20b1cb`。

已逐项核对13个唯一ID/编码、每个完整权限数组与声明数量一致、无重复权限。此前用户转交的warehouse摘要确实截断；**现在已取得完整85项**，下方逐项表替代之前的6角色摘要及7个占位。不以旧测试夹具代替正式事实。

## 逐角色总表

“改后”为用户已认可目标，非正式系统执行结果。未列为变更的权限全部保留；每项精确前后状态在后文。ID、code、name、remark、is_system全部保持导出值，不为凑数量重置角色。

| ID | 角色及编码 | 改前存储项数 | 建议改后项数 | 撤回 / 新增 | 建议及影响 |
|---|---|---:|---:|---|---|
| 1 | 系统管理员 `admin` | 2 | 2 | -0 / +0 | 保持2项；实际普通权限由ID1豁免，见下文。 |
| 2 | 仓库管理员 `warehouse` | 85 | 81 | -5 / +1 | 撤回资金账户/收付款4项及通用报表；补商品查看。保留本人报销和现有仓库作业。 |
| 3 | 采购员 `purchaser` | 46 | 40 | -6 / +0 | 撤回收付款查看、通用报表、物流管理及3项销售授信放行/申请权限。保留采购、物流查看、本人报销。 |
| 4 | 销售员 `sales` | 49 | 35 | -16 / +2 | 撤回14项会计/资金/发票/运费对账、通用报表及旧直放码；增加独立授信申请/申请查看，不授审批。保留本人报销及销售经营权限。 |
| 5 | 只读查看 `viewer` | 40 | 35 | -5 / +0 | 撤回资金账户、报销、收付款、审计日志及通用报表5项；其余业务读取保留，不授写权限。 |
| 6 | Smoke受限 `smoke_limited` | 2 | 2 | -0 / +0 | 原样保留；自定义标记不改，不因名称自动删除或授予权限。 |
| 7 | 仓库作业员 `preset_warehouse_operator` | 22 | 22 | -0 / +0 | 原样保留，已有warehouse.task.ship，无需重复补发货权。 |
| 8 | 库存专员 `preset_stock_controller` | 15 | 14 | -1 / +0 | 仅撤回通用报表；库存查询/盘点保留，暂时不能查看库存报表。 |
| 9 | 采购主管 `preset_purchase_manager` | 23 | 22 | -1 / +0 | 仅撤回通用报表；采购审批与主档权限保留，暂时不能查看采购报表。 |
| 10 | 销售主管 `preset_sales_manager` | 23 | 22 | -1 / +0 | 仅撤回通用报表；销售经营与授信申请查看保留，不自动增加申请或审批权。 |
| 11 | 财务专员 `preset_finance_specialist` | 16 | 16 | -0 / +0 | 原样保留全部16项：收付款、发票、全员报销查看、财务报表和授信独立审批符合财务职责。 |
| 12 | 会计 `preset_accountant` | 13 | 13 | -0 / +0 | 原样保留全部13项：会计、发票及财务读取符合职责；不增加收付款执行或期间管理。 |
| 13 | 客服专员 `preset_customer_service` | 15 | 15 | -0 / +0 | 原样保留；没有上述资金/会计/通用报表权限，客户与销售经营权限保留。 |

合计：存储权限351→319，撤回35条角色授权、新增3条角色授权。此数量仅用于复核，不能代替完整集合比较。

## 已认可的职责取舍与保留边界

1. **7个非财务角色撤回 `report.view`**：warehouse、purchaser、sales、viewer、库存专员、采购主管、销售主管。当前 `reports.routes.js` 用同一权限保护普通销售/采购/库存/PDA报表，也保护利润、成本、月结对账等财务报表。用户已认可撤回整项，代价是这些角色同时失去普通报表；本次不拆分报表权限，不假装现有单项权限可按财务字段区分。
2. **保留销售、采购、仓管的本人报销3项**：`finance.expense.create/update/view`。完整导出确认三者均无 `finance.expense.view.all`。当前 `finance.controller.js` 在非ID1、无view.all时强制把列表与详情限定为当前申请人；service修改另查本人及状态。财务专员继续保留view.all，普通viewer撤回报销查看。
3. **销售申请与财务审批分权**：sales撤回旧 `sale.credit.override`，补已有审批链所需的apply/view两项；不补approve。purchaser撤回旧码及误配apply/view；物流管理一并按既有岗位职责纠偏建议撤回，物流查看保留。旧码本身当前不能直接放行，不写成尚可绕过审批。
4. **仓管补 `product.view`**：完整85项只有旧 `page:products`，没有当前商品接口要求的product.view。建议补1项，允许完整商品主档读取；它可能包含价格信息，不能把它称为仅名称/数量查询。
5. **保留经营金额与现有客户授信读取，尚不实现“仅本人客户”**：此表针对资金/会计工作区、宽财务报表及审计入口收权。sales、warehouse、purchaser及销售主管等现有 `sale.credit.view` 仍保留，会读取客户已用/可用授信；授信申请查看也沿现有单据范围。客户、商品、销售/采购单等原业务权限仍可返回额度、价格或单据金额。当前无客户负责人/协作关系，不能靠角色集合实现本人客户隔离。
6. **仍有共享金额入口，不能据本表承诺全面遮蔽财务金额**：各角色保留的 `dashboard.view` 后端summary/top-stock会返回库存价值、incoming-purchases会返回采购总额；相应代码尚无独立财务字段权限。若“不能看到财务数据”也包含库存价值、采购金额及全局授信用量，需要后续明确字段职责并收紧接口投影/拆分权限，296迁移只执行本表差量，不更改这些接口。这项与前一项是本次授权收紧的明确限制。
7. **财务专员16项、会计13项全部保留**：前者有正常收付款/全员报销/发票及独立授信审批，后者有会计/发票/资金读取；不按销售撤权清单处理，不自动扩大到收付款执行、资金调整或结账。smoke_limited的2项原样保留，是否删除测试角色不在本次授权范围。

`audit.log.view` 返回经敏感字段清洗的requestBody，但仍可能包含业务金额；普通viewer不再具备该宽审计能力。viewer的原remark“全部模块只读”是导出事实，本提案不改名称/备注；认可范围应以此表完整权限集为准。

## admin为什么只存2项仍可管理

完整导出确认系统管理员为 **ID=1、code=admin**。`backend/src/middleware/auth.js` 的hasPermission默认对roleId=1返回true，`frontend/src/lib/permissions.ts`亦对roleId===1返回true，因此确实由代码放行普通权限检查，存储2项不代表仅有2项有效能力。判断依据是ID，其他角色改名为admin不会获得此能力。

豁免不跳过有效登录、设备/仓库、业务状态、期间或审批节点规则。本表保留 `approval.task.view` 与 `print:client`，不向admin填入所有权限，不扩大豁免条件。

## 完整逐项对照

“有→保留”为不变，“有→撤回”为删除，“无→新增”为增加。每个角色的完整改前集合取所有“有”行，完整目标集合取所有“保留/新增”行。权限逐字匹配，旧权限码也列出，不能因已弃用就从基线省略。角色元数据均列在每节，建议改后保持不变。

### 1 系统管理员（admin）

- id：`1`；code：`admin`；name：系统管理员；is_system：`1`。
- remark：拥有全部权限。
- 权限数量：2→2，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `approval.task.view` | 有 | 保留 |
| `print:client` | 有 | 保留 |

### 2 仓库管理员（warehouse）

- id：`2`；code：`warehouse`；name：仓库管理员；is_system：`1`。
- remark：仓库/库存/盘点/商品。
- 权限数量：85→81，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `action:inventory:adjust` | 有 | 保留 |
| `action:inventory:inbound` | 有 | 保留 |
| `action:inventory:outbound` | 有 | 保留 |
| `action:stockcheck:create` | 有 | 保留 |
| `action:stockcheck:submit` | 有 | 保留 |
| `approval.task.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.account.view` | 有 | 撤回 |
| `finance.expense.create` | 有 | 保留 |
| `finance.expense.update` | 有 | 保留 |
| `finance.expense.view` | 有 | 保留 |
| `import.stock.execute` | 有 | 保留 |
| `inbound.order.view` | 有 | 保留 |
| `inbound.print.reprint` | 有 | 保留 |
| `inbound.putaway.execute` | 有 | 保留 |
| `inbound.receive.execute` | 有 | 保留 |
| `inventory.adjust` | 有 | 保留 |
| `inventory.container.move` | 有 | 保留 |
| `inventory.container.split` | 有 | 保留 |
| `inventory.view` | 有 | 保留 |
| `location.view` | 有 | 保留 |
| `logistics.manage` | 有 | 保留 |
| `logistics.view` | 有 | 保留 |
| `page:dashboard` | 有 | 保留 |
| `page:inbound` | 有 | 保留 |
| `page:inventory` | 有 | 保留 |
| `page:products` | 有 | 保留 |
| `page:stockcheck` | 有 | 保留 |
| `page:warehouses` | 有 | 保留 |
| `payment.create` | 有 | 撤回 |
| `payment.execute` | 有 | 撤回 |
| `payment.view` | 有 | 撤回 |
| `picking.wave.manage` | 有 | 保留 |
| `picking.wave.view` | 有 | 保留 |
| `print.client.consume` | 有 | 保留 |
| `print.job.create` | 有 | 保留 |
| `print.job.reprint` | 有 | 保留 |
| `print.job.view` | 有 | 保留 |
| `print.printer.manage` | 有 | 保留 |
| `print.printer.view` | 有 | 保留 |
| `print.template.manage` | 有 | 保留 |
| `print.template.view` | 有 | 保留 |
| `procurement.plan.view` | 有 | 保留 |
| `product.view` | 无 | 新增 |
| `purchase.requisition.create` | 有 | 保留 |
| `purchase.requisition.view` | 有 | 保留 |
| `rack.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `return.order.cancel` | 有 | 保留 |
| `return.order.confirm` | 有 | 保留 |
| `return.order.create` | 有 | 保留 |
| `return.order.execute` | 有 | 保留 |
| `return.order.view` | 有 | 保留 |
| `sale.credit.view` | 有 | 保留 |
| `scan.log.create` | 有 | 保留 |
| `scan.log.view` | 有 | 保留 |
| `sorting.bin.manage` | 有 | 保留 |
| `sorting.bin.view` | 有 | 保留 |
| `stockcheck.abc.manage` | 有 | 保留 |
| `stockcheck.abc.view` | 有 | 保留 |
| `stockcheck.cancel` | 有 | 保留 |
| `stockcheck.create` | 有 | 保留 |
| `stockcheck.submit` | 有 | 保留 |
| `stockcheck.update` | 有 | 保留 |
| `stockcheck.view` | 有 | 保留 |
| `transfer.order.cancel` | 有 | 保留 |
| `transfer.order.confirm` | 有 | 保留 |
| `transfer.order.create` | 有 | 保留 |
| `transfer.order.execute` | 有 | 保留 |
| `transfer.order.view` | 有 | 保留 |
| `warehouse.task.adjust` | 有 | 保留 |
| `warehouse.task.adjust.view` | 有 | 保留 |
| `warehouse.task.assign` | 有 | 保留 |
| `warehouse.task.cancel` | 有 | 保留 |
| `warehouse.task.cancel_return` | 有 | 保留 |
| `warehouse.task.cancel_return.view` | 有 | 保留 |
| `warehouse.task.check` | 有 | 保留 |
| `warehouse.task.check_done` | 有 | 保留 |
| `warehouse.task.pack` | 有 | 保留 |
| `warehouse.task.pack_done` | 有 | 保留 |
| `warehouse.task.pick` | 有 | 保留 |
| `warehouse.task.priority` | 有 | 保留 |
| `warehouse.task.ship` | 有 | 保留 |
| `warehouse.task.sort` | 有 | 保留 |
| `warehouse.task.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 3 采购员（purchaser）

- id：`3`；code：`purchaser`；name：采购员；is_system：`1`。
- remark：采购/供应商/商品/库存查看。
- 权限数量：46→40，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `action:purchase:confirm` | 有 | 保留 |
| `action:purchase:create` | 有 | 保留 |
| `action:purchase:receive` | 有 | 保留 |
| `approval.task.view` | 有 | 保留 |
| `category.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.expense.create` | 有 | 保留 |
| `finance.expense.update` | 有 | 保留 |
| `finance.expense.view` | 有 | 保留 |
| `import.product.execute` | 有 | 保留 |
| `inbound.order.create` | 有 | 保留 |
| `inbound.order.submit` | 有 | 保留 |
| `inbound.order.view` | 有 | 保留 |
| `inbound.print.reprint` | 有 | 保留 |
| `logistics.manage` | 有 | 撤回 |
| `logistics.view` | 有 | 保留 |
| `page:dashboard` | 有 | 保留 |
| `page:inbound` | 有 | 保留 |
| `page:inventory` | 有 | 保留 |
| `page:products` | 有 | 保留 |
| `page:purchase` | 有 | 保留 |
| `page:suppliers` | 有 | 保留 |
| `payment.view` | 有 | 撤回 |
| `print.client.consume` | 有 | 保留 |
| `procurement.plan.manage` | 有 | 保留 |
| `procurement.plan.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `purchase.order.cancel` | 有 | 保留 |
| `purchase.order.confirm` | 有 | 保留 |
| `purchase.order.create` | 有 | 保留 |
| `purchase.order.view` | 有 | 保留 |
| `purchase.requisition.convert` | 有 | 保留 |
| `purchase.requisition.create` | 有 | 保留 |
| `purchase.requisition.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `return.order.cancel` | 有 | 保留 |
| `return.order.confirm` | 有 | 保留 |
| `return.order.create` | 有 | 保留 |
| `return.order.view` | 有 | 保留 |
| `sale.credit.override` | 有 | 撤回 |
| `sale.credit.override.apply` | 有 | 撤回 |
| `sale.credit.override.view` | 有 | 撤回 |
| `sale.credit.view` | 有 | 保留 |
| `stockcheck.abc.view` | 有 | 保留 |
| `supplier.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 4 销售员（sales）

- id：`4`；code：`sales`；name：销售员；is_system：`1`。
- remark：销售/客户/商品/库存查看。
- 权限数量：49→35，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `accounting.account.manage` | 有 | 撤回 |
| `accounting.account.view` | 有 | 撤回 |
| `accounting.ledger.view` | 有 | 撤回 |
| `accounting.period.manage` | 有 | 撤回 |
| `accounting.voucher.export` | 有 | 撤回 |
| `accounting.voucher.manage` | 有 | 撤回 |
| `accounting.voucher.view` | 有 | 撤回 |
| `action:sale:confirm` | 有 | 保留 |
| `action:sale:create` | 有 | 保留 |
| `action:sale:ship` | 有 | 保留 |
| `approval.task.view` | 有 | 保留 |
| `carrier.view` | 有 | 保留 |
| `customer.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.account.view` | 有 | 撤回 |
| `finance.expense.create` | 有 | 保留 |
| `finance.expense.update` | 有 | 保留 |
| `finance.expense.view` | 有 | 保留 |
| `invoice.manage` | 有 | 撤回 |
| `invoice.view` | 有 | 撤回 |
| `logistics.freight.reconcile` | 有 | 撤回 |
| `logistics.view` | 有 | 保留 |
| `page:customers` | 有 | 保留 |
| `page:dashboard` | 有 | 保留 |
| `page:inventory` | 有 | 保留 |
| `page:products` | 有 | 保留 |
| `page:sale` | 有 | 保留 |
| `payment.create` | 有 | 撤回 |
| `payment.execute` | 有 | 撤回 |
| `payment.view` | 有 | 撤回 |
| `price.list.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `return.order.cancel` | 有 | 保留 |
| `return.order.confirm` | 有 | 保留 |
| `return.order.create` | 有 | 保留 |
| `return.order.execute` | 有 | 保留 |
| `return.order.view` | 有 | 保留 |
| `sale.credit.override` | 有 | 撤回 |
| `sale.credit.override.apply` | 无 | 新增 |
| `sale.credit.override.view` | 无 | 新增 |
| `sale.credit.view` | 有 | 保留 |
| `sale.order.cancel` | 有 | 保留 |
| `sale.order.create` | 有 | 保留 |
| `sale.order.release` | 有 | 保留 |
| `sale.order.reserve` | 有 | 保留 |
| `sale.order.ship` | 有 | 保留 |
| `sale.order.update` | 有 | 保留 |
| `sale.order.view` | 有 | 保留 |
| `warehouse.task.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 5 只读查看（viewer）

- id：`5`；code：`viewer`；name：只读查看；is_system：`1`。
- remark：全部模块只读。
- 权限数量：40→35，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `approval.task.view` | 有 | 保留 |
| `audit.log.view` | 有 | 撤回 |
| `carrier.view` | 有 | 保留 |
| `category.view` | 有 | 保留 |
| `customer.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.account.view` | 有 | 撤回 |
| `finance.expense.view` | 有 | 撤回 |
| `inbound.order.view` | 有 | 保留 |
| `inventory.view` | 有 | 保留 |
| `location.view` | 有 | 保留 |
| `page:customers` | 有 | 保留 |
| `page:dashboard` | 有 | 保留 |
| `page:inbound` | 有 | 保留 |
| `page:inventory` | 有 | 保留 |
| `page:products` | 有 | 保留 |
| `page:purchase` | 有 | 保留 |
| `page:sale` | 有 | 保留 |
| `page:suppliers` | 有 | 保留 |
| `page:warehouses` | 有 | 保留 |
| `payment.view` | 有 | 撤回 |
| `picking.wave.view` | 有 | 保留 |
| `price.list.view` | 有 | 保留 |
| `print.job.view` | 有 | 保留 |
| `print.printer.view` | 有 | 保留 |
| `print.template.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `purchase.order.view` | 有 | 保留 |
| `purchase.requisition.view` | 有 | 保留 |
| `rack.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `return.order.view` | 有 | 保留 |
| `sale.order.view` | 有 | 保留 |
| `scan.log.view` | 有 | 保留 |
| `sorting.bin.view` | 有 | 保留 |
| `stockcheck.view` | 有 | 保留 |
| `supplier.view` | 有 | 保留 |
| `transfer.order.view` | 有 | 保留 |
| `warehouse.task.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 6 Smoke受限（smoke_limited）

- id：`6`；code：`smoke_limited`；name：Smoke受限；is_system：`0`。
- remark：smoke test limited role。
- 权限数量：2→2，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `dashboard.view` | 有 | 保留 |
| `inbound.order.view` | 有 | 保留 |

### 7 仓库作业员（preset_warehouse_operator）

- id：`7`；code：`preset_warehouse_operator`；name：仓库作业员；is_system：`1`。
- remark：系统预置岗位：收货、上架、拣货、复核与打包。
- 权限数量：22→22，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `dashboard.view` | 有 | 保留 |
| `inbound.order.view` | 有 | 保留 |
| `inbound.putaway.execute` | 有 | 保留 |
| `inbound.receive.execute` | 有 | 保留 |
| `inventory.view` | 有 | 保留 |
| `location.view` | 有 | 保留 |
| `print.job.create` | 有 | 保留 |
| `print.job.reprint` | 有 | 保留 |
| `print.job.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `rack.view` | 有 | 保留 |
| `scan.log.create` | 有 | 保留 |
| `scan.log.view` | 有 | 保留 |
| `warehouse.task.check` | 有 | 保留 |
| `warehouse.task.check_done` | 有 | 保留 |
| `warehouse.task.pack` | 有 | 保留 |
| `warehouse.task.pack_done` | 有 | 保留 |
| `warehouse.task.pick` | 有 | 保留 |
| `warehouse.task.ship` | 有 | 保留 |
| `warehouse.task.sort` | 有 | 保留 |
| `warehouse.task.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 8 库存专员（preset_stock_controller）

- id：`8`；code：`preset_stock_controller`；name：库存专员；is_system：`1`。
- remark：系统预置岗位：库存查询与盘点管理。
- 权限数量：15→14，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `dashboard.view` | 有 | 保留 |
| `inventory.trace.view` | 有 | 保留 |
| `inventory.view` | 有 | 保留 |
| `location.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `rack.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `stockcheck.abc.view` | 有 | 保留 |
| `stockcheck.cancel` | 有 | 保留 |
| `stockcheck.create` | 有 | 保留 |
| `stockcheck.submit` | 有 | 保留 |
| `stockcheck.update` | 有 | 保留 |
| `stockcheck.view` | 有 | 保留 |
| `transfer.order.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 9 采购主管（preset_purchase_manager）

- id：`9`；code：`preset_purchase_manager`；name：采购主管；is_system：`1`。
- remark：系统预置岗位：采购计划、请购与采购审批。
- 权限数量：23→22，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `approval.task.view` | 有 | 保留 |
| `category.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `inbound.order.cancel` | 有 | 保留 |
| `inbound.order.create` | 有 | 保留 |
| `inbound.order.submit` | 有 | 保留 |
| `inbound.order.view` | 有 | 保留 |
| `procurement.plan.manage` | 有 | 保留 |
| `procurement.plan.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `purchase.order.approve` | 有 | 保留 |
| `purchase.order.cancel` | 有 | 保留 |
| `purchase.order.confirm` | 有 | 保留 |
| `purchase.order.create` | 有 | 保留 |
| `purchase.order.view` | 有 | 保留 |
| `purchase.requisition.approve` | 有 | 保留 |
| `purchase.requisition.convert` | 有 | 保留 |
| `purchase.requisition.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `supplier.create` | 有 | 保留 |
| `supplier.update` | 有 | 保留 |
| `supplier.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 10 销售主管（preset_sales_manager）

- id：`10`；code：`preset_sales_manager`；name：销售主管；is_system：`1`。
- remark：系统预置岗位：销售单、客户与销售退货管理。
- 权限数量：23→22，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `approval.task.view` | 有 | 保留 |
| `carrier.view` | 有 | 保留 |
| `customer.create` | 有 | 保留 |
| `customer.update` | 有 | 保留 |
| `customer.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `price.list.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `report.view` | 有 | 撤回 |
| `return.order.cancel` | 有 | 保留 |
| `return.order.confirm` | 有 | 保留 |
| `return.order.create` | 有 | 保留 |
| `return.order.view` | 有 | 保留 |
| `sale.credit.override.view` | 有 | 保留 |
| `sale.credit.view` | 有 | 保留 |
| `sale.order.cancel` | 有 | 保留 |
| `sale.order.create` | 有 | 保留 |
| `sale.order.release` | 有 | 保留 |
| `sale.order.reserve` | 有 | 保留 |
| `sale.order.ship` | 有 | 保留 |
| `sale.order.update` | 有 | 保留 |
| `sale.order.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

### 11 财务专员（preset_finance_specialist）

- id：`11`；code：`preset_finance_specialist`；name：财务专员；is_system：`1`。
- remark：系统预置岗位：收付款、费用与发票日常处理。
- 权限数量：16→16，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `approval.task.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.account.view` | 有 | 保留 |
| `finance.expense.create` | 有 | 保留 |
| `finance.expense.update` | 有 | 保留 |
| `finance.expense.view` | 有 | 保留 |
| `finance.expense.view.all` | 有 | 保留 |
| `invoice.manage` | 有 | 保留 |
| `invoice.view` | 有 | 保留 |
| `payment.create` | 有 | 保留 |
| `payment.execute` | 有 | 保留 |
| `payment.view` | 有 | 保留 |
| `report.view` | 有 | 保留 |
| `sale.credit.override.approve` | 有 | 保留 |
| `sale.credit.override.view` | 有 | 保留 |
| `sale.credit.view` | 有 | 保留 |

### 12 会计（preset_accountant）

- id：`12`；code：`preset_accountant`；name：会计；is_system：`1`。
- remark：系统预置岗位：会计科目、凭证与账簿。
- 权限数量：13→13，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `accounting.account.manage` | 有 | 保留 |
| `accounting.account.view` | 有 | 保留 |
| `accounting.ledger.view` | 有 | 保留 |
| `accounting.voucher.export` | 有 | 保留 |
| `accounting.voucher.manage` | 有 | 保留 |
| `accounting.voucher.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `finance.account.view` | 有 | 保留 |
| `finance.expense.view` | 有 | 保留 |
| `invoice.manage` | 有 | 保留 |
| `invoice.view` | 有 | 保留 |
| `payment.view` | 有 | 保留 |
| `report.view` | 有 | 保留 |

### 13 客服专员（preset_customer_service）

- id：`13`；code：`preset_customer_service`；name：客服专员；is_system：`1`。
- remark：系统预置岗位：客户、订单与物流查询。
- 权限数量：15→15，均为存储集合。

| 权限码 | 改前 | 建议改后 |
|---|---|---|
| `customer.create` | 有 | 保留 |
| `customer.update` | 有 | 保留 |
| `customer.view` | 有 | 保留 |
| `dashboard.view` | 有 | 保留 |
| `inventory.view` | 有 | 保留 |
| `logistics.view` | 有 | 保留 |
| `price.list.view` | 有 | 保留 |
| `product.view` | 有 | 保留 |
| `return.order.create` | 有 | 保留 |
| `return.order.view` | 有 | 保留 |
| `sale.order.create` | 有 | 保留 |
| `sale.order.update` | 有 | 保留 |
| `sale.order.view` | 有 | 保留 |
| `warehouse.task.view` | 有 | 保留 |
| `warehouse.view` | 有 | 保留 |

## 已认可的补丁合同

1. 认可版本锁定上述13角色的精确身份、元数据、完整改前及完整改后集合；不能按code别名猜角色，不能只核数量，不改历史295，新编号取届时最大+1。
2. 全部13角色先预检，再按稳定ID顺序加锁并在同一事务当前重读；缺失、多重匹配、新增未认可角色、元数据或任意权限不符，都须在任何权限写入前整体停止。未改角色也参加基线校验。
3. 报错逐角色列ID/code/name、预期与实际数量、元数据差异、缺少及多出的全部权限码；区分大小写，列表不截断，不静默跳过。数量相同而内容不同也必须失败。
4. 首次只接受认可的完整改前状态；重跑只接受同一认可版本的应用回执及全体完整改后状态。人工后改、混合半应用或未知状态均明确失败，不自行修平。
5. 所有授权变更和修订回执同事务，任一错误全部回滚。测试覆盖等数量换权、大小写/元数据漂移、未改角色漂移、并发改权、失败零写入、重放、半应用及回滚；只能用任务专属合成测试库。
6. 本表已由用户明确认可，运维提供事实不代表批准方案；296实现须与本表集合完全一致。正式执行、独立测试环境验收与发布分别记录，合并/发版仍等待用户明确回复“发”。
