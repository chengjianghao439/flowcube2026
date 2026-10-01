# C2：成套配件集成设计记录

2026-10-01。用户已确定要做成套配件；本文件记录针对性调用链核对和待定稿边界，不代表已经支持正式套件开单。缺件发货及组件退货金额的业务问题尚待回答；先完成不依赖答案的设计工作。

## 当前实现约束

1. `sale.service.js/assertNoDuplicateSaleItemLines` 要求同一销售单中的 `(productId, warehouseId)` 唯一。目的不是限制销售习惯，而是避免 `warehouse-tasks.ship.js/getShipContext` 的关联放大、重复扣库存。不能为展开套件删除该守卫。
2. `sale.items.js/insertSaleItems` 保存普通商品、录入量、换算率、单价和金额。当前没有套定义版本、套归属或组件分摊快照；不能只用备注维持套关系。
3. `sale.service.js/recomputeSaleReceivable` 按组件行的 `shipped_qty × unit_price` 重算已发应收。两个不同成交价的套共用一个组件时，直接合并为平均单价，会使只发其中一套的应收失真。
4. `returns-sale.service.js` 使用原 `sale_item_id`、已发可退量和原单价；`voucher-engine.js` 退货成本使用原组件 `cost_snapshot`。套内同商品不同归属需要额外来源身份，不能退任意一套的同商品份额。
5. 当前执行期改单已有多仓、部分发货、多任务限制，取消/归还仍有实物闭环。套件不能绕过这些限制，历史普通订单也不能被批量转成套件。

这些是当前代码事实；本轮没有把套件预览当成完整业务链，也没有用普通 SKU 名字推断它是虚拟套。

## 建议模型及必须验证的接口

销售组成与仓库执行分开保存：商业主行保留卖了哪一套、几套、成交价和当时版本；组件快照保留每套基本数量、价格依据及金额份额；同仓组件需求汇总后进入现有物理销售明细。套主行不造容器、不计第二份库存或收入。

从商业行到物理明细需要明确关联。派发时记录本批属于哪些套、每套发几套及其组件数量；出库时核对本批组件闭合，再按这份归属确认收入。部分退货也使用原份额与实际已发数量。不能只保存组成，事后再凭相同商品或平均价猜归属。

首版保持固定组成、单仓成套、不自动替代、不嵌套；采购净需求仍按组件汇总。独立存货的成套实物继续是普通 SKU。普通单据没有套关联时沿用原路径。下文给出最小字段和接口的建议，迁移编号与未决政策仍须在实施前定稿，不能先给库存、应收写入打补丁。

### 工程定稿所需的数据边界

- **套定义与不可变版本：** 独立维护套编码、名称、启用状态、每套组件基本数量及参考报价，不用虚拟套占普通商品容器。不为了通过普通商品正成本校验填写假进价。编辑生成新组成版本；停用阻止新选择，旧订单仍能解释旧版本。
- **订单商业快照：** 每个套主行保存套数、仓库、成交价、来源和组成版本；组件保存下单时数量、参考价/权重、分摊结果与依据。普通商品若与套共享组件，也需保留其独立商业份额。它们的金额合计才是成交总额，不能与物理汇总行相加。
- **物理汇总关联：** `(商品, 仓库)` 仍只生成一条现行物理明细，旁路关联记录每个商业份额需要其中多少组件；库存预占与采购绑定仍只操作物理明细。不要给每个套造第二份预占。
- **派发与出库归属：** 当前 `sale.service.js` 派发按物理明细 `reserved_qty - dispatched_qty` 建任务并累加已派发。套件需在同一销售单锁内确定这批商业份额及其组件向量，先验证数量闭合，再复用建任务。旧客户端只传组件量时不能自动猜套归属；正式契约必须有明确可验的套派发上下文。
- **应收与退货：** 套单的已发毛额来自已确认出库的商业份额，普通单仍用既有 `shipped_qty × unit_price`。整单折扣及税额继续走原规则。组件退货同时绑定原商业份额和物理明细，不用汇总平均价当某一套的原价；成本沿用既有原组件出库成本快照。
- **价格查询：** 普通价格表项当前关联普通商品，不把虚拟套伪装成同一个商品 ID。套价的参考/客户等级/客户特价查询需定稿明确契约；下单时组件参考价格只用于所选分摊政策，不事后回算旧套价。参考总额为零须有显式合法依据，不能静默均摊。

上述为建议数据边界，下文进一步收口为候选字段；尚无执行迁移。后续实现者仍须验证外键生命周期、版本竞争、批量查询及原业务回归。实现范围应集中在套定义、组成与商业归属；现有容器引擎、PDA 扫码、会计净额和资金规则优先复用，不能复制第二套事实源。

缺件发货和退货政策会决定派发、可退量和金额契约，答案到达前不启用正式套件提交。现已提出两项业务选择：缺件时只发完整套或允许组件先发；组件退货按原分摊价、经确认的新金额或只允许整套退。未回复不视为批准推荐项。

### 不依赖未决政策的验收样例

以下是设计用的虚构报价，不是实际客户数据或已测收益：套 A、套 B 均需铰链 1 个和螺钉 4 个，成交价分别为 100、200；订单各买一套。暂以 80:20 的组件金额权重解释，A 的铰链份额 80 / 螺钉合计 20，B 为 160 / 40。即使最终选择其他分摊政策，也必须保留各套的独立归属。

物理需求合计铰链 2、螺钉 8，库存只预占这一次。若把两套合成铰链单价 120、螺钉单价 7.5，只发完整 A 套时按现行组件平均价计算就会得到 150，而 A 实际成交价是 100。因此“展开后合并商品行”还不足以接通正式套件业务，不能把只显示组件的页面当作完成。

实施验收应能明确选出本批发 A 一套，仓库拿铰链 1 / 螺钉 4，订单已发毛额按 A 的 100 计算，未发 B 仍保留 200 的归属；整单折扣税额再按原规则处理，组件成本仍取真实出库事实。改单不许把已发 A 改成 B，套定义改版不改变本单快照。套主行、物理汇总行和采购需求不得分别再加一次金额或数量。

退货部分只能在用户决定金额口径后补齐最终断言：不论选择哪种政策，都必须指向已发 A 的份额，不能误退未发 B，也不能凭平均价 120 自动当成 A 的原铰链价。缺件发货部分同样待业务口径确定后定稿，不用上述完整套样例替代其验收。

## C2a 补充一：最小建议结构与保存契约（未实施）

以下表名、字段和错误码是**技术建议**，不是当前 schema；缺件发货和组件退款政策未定，不据此启用正式套件提交。普通纯商品单不创建这些商业旁表。

| 候选结构 | 最小字段与约束 |
|---|---|
| `kit_definitions` | `id/code/name/is_active/deleted_at/revision/current_version_id`；活跃编码按 `active_unique_guard` 唯一；停用阻止新选择，删除只软删，不删除被引用版本 |
| `kit_definition_versions` | `id/kit_id/version_no/reference_unit_price/created_by/created_at`；FK `kit_id`，唯一 `(kit_id, version_no)`；发布后报价和组成不可原地改写 |
| `kit_definition_components` | `id/version_id/product_id/base_qty/amount_weight/sort_no`；FK 版本与真实 `product_items.id`，唯一 `(version_id, product_id)`；组件不得指向套定义，无替代、嵌套、跨仓或制造字段 |
| `sale_orders` 新增关联标记 | `commercial_model` 可空，套单为 `kit-v1`；`commercial_revision` 为套单写入竞争令牌。旧单保持 NULL，不按名称回填；读取响应明确返回模型与版本 |
| `sale_commercial_groups` | `id/order_id/line_key/snapshot_revision/kind/kit_version_id/warehouse_id/original_qty/target_qty/unit_price/gross_amount/price_source/kit_code/kit_name/superseded_at`；FK 订单、仓库、可空套版本；唯一 `(order_id, line_key, snapshot_revision)`；`kind=kit/product`，普通共享组件行也保留独立份额 |
| `sale_commercial_components` | `id/group_id/product_id/sale_item_id/base_qty_per_group/required_qty/reference_price/amount_weight/allocated_amount/product_code/product_name/unit/article_number/spec/color`；FK 商业行、真实商品、物理销售行；唯一 `(group_id, product_id)`。**直接关联唯一物理行，不另建同义 allocation 表** |
| 完整套派发候选 `sale_dispatch_groups` | `id/task_id/group_id/group_qty`；FK 任务与商业行，唯一 `(task_id, group_id)`；组件向量由不可变组成 × 本批套数推导，不再复制一套可变组件明细；真实已发仍由任务 status=7 与实际任务量确认 |
| 退货来源候选扩展 | `sale_return_items` 保留 `sale_item_id/sourceItemId`，另加可空 `source_commercial_component_id/source_dispatch_group_id`；FK 指向原商业组件与原派发份额，必须同订单、商品、仓库且已真实出库。具体金额字段待退款政策确定 |

建议字段含义须固定：`original_qty/gross_amount/required_qty/allocated_amount` 保存原快照，`target_qty` 是合法减量或关闭剩余后的当前履约目标；当前物理需求按 `base_qty_per_group × target_qty` 推导，不能继续相加原 `required_qty`。派发、已发和可退量按关联的真实任务/退货来源推导，不再维护第二套可独立写入的计数。组件金额以原分摊份额和累计目标比例投影，分批金额用累计应得额相减，不能每次从平均物理单价回算。候选表中这些字段的具体名称仍可调整，语义与守恒不可省略。

数量字段用 `DECIMAL(14,2)`，套数额外要求整数；组件原始量及展开乘积先校验两位精度，再检查商品 `allow_decimal_qty`，最后归一化。金额/权重用 `DECIMAL(14,4)`，套单价用四位；候选金额按现行行金额两位计算后存四位列。**核对事实：** 现行 `foldEntryItem` 的基本单价为八位、金额 `round2`；会计读取单价八位、成本四位，不能把旧单价列顺手降精度。

定义编辑锁主档并比较 `revision`，生成新版本后更新指针；版本与历史订单快照只读。新选择携带 `kitVersionId`，保存锁内重读当前版本，不匹配返回建议码 `KIT_VERSION_CHANGED`，保留草稿并要求显式重新选择。旧订单继续解释原版本；未改动的既有商业行不因今日改版或价格变化刷新快照。合法改价/改组成生成新商业快照，不原地覆盖原组成、单价与分摊依据；`target_qty` 的减少和原量差额须留订单事件。

**已核对的保存陷阱：** `sale.service.js/update`、`requestAdjustment`、`adjustReservedWithinTransaction` 会删除重建物理行。套单分支须按 `(product_id, warehouse_id)` 保留被派发/退货引用的物理 ID，仅更新合法目标量；禁止级联删除来源。无执行引用的草稿重新物化时，旧未执行快照可标 superseded，并将其物理关联显式置空后删无引用物理行；当前有效组件必须有非空关联。是否采用此生命周期及其 FK DDL仍须专项验证，不用 `ON DELETE CASCADE` 消除历史证据。

物理行数量 = 当前有效商业组件按 `target_qty` 展开的需求之和，金额 = 当前目标比例投影后的组件分摊金额之和，不直接 `SUM` 原快照 `allocated_amount`；基本单价至多是展示投影，不能再用于套单部分收入。保留 `assertNoDuplicateSaleItemLines`；一个商品同仓只有一条物理明细、一次预占、一次预计绑定、一次出库成本。套主行不造 `productId`、容器或假进价。首版须限制商业行与展开后物理行均 ≤200、单套组件有界（建议 ≤50），空批次跳过 SQL，批量写使用 `VALUES ?`。

建议 `/api/kits` 独立 routes→controller→service：GET 列表/详情用 `product.view`，POST 用 `product.create`，PUT `/:id` 用 `product.update`，DELETE 用 `product.delete`；不另造套价格授权体系。写入带稳定请求键与 `revision`，首次创建返回定义 ID/版本 ID，编辑返回新版本和 revision。GET `/finder` 注册在 `/:id` 前，用 `product.view` 并校验 `warehouseId` 范围，批量核对套及所有组件启用/未删；停用组件显示不可选原因，不给它虚构可用量。此权限复用方案尚待实现权限回归。

建议 POST `/api/kits/preview` 用 `sale.order.create` + `product.view`，只读接收 `{customerId, warehouseId, groups}`，返回版本、组成、报价来源、组件汇总及库存/预计来源解释；不写预占或持久化订单。仓库数量沿 `products.service.js/findForFinder` 的库存投影与范围原则；保存仍经 `hydrateSaleInput` 权威核对客户/仓库/组件，不能信任预览名称和余量。

套单 POST `/sale`、PUT `/sale/:id` 与 `/adjust` 建议显式载荷 `{commercialModel:'kit-v1', expectedRevision, commercialGroups:[{lineKey, kind:'kit', kitVersionId, quantity, unitPrice, priceSource:'kit_default'|'manual', warehouseId}|{kind:'product', ...普通商品输入}]}`；服务端生成组件和物理 `items`，禁止同时接收客户端展开 `items`。创建无需 expectedRevision；编辑/改单锁订单后核对版本，过期返回建议码 `SALE_COMMERCIAL_REVISION_CHANGED`，不覆盖旧草稿。

现行无标记 `items` 输入保持普通单原路径；**对已经是套单的资源**，缺标记的旧客户端写入（含保存、占库、释放、派发、退货）必须明确拒绝，不能 flatten 后返回200。读取提供商业组与物理行两个命名视图，旧客户端不得获可编辑的伪普通单。套单 `/ship` 的完整套候选载荷为 `{commercialModel:'kit-v1', expectedRevision, groups:[{groupId,qty}]}`，服务端推导物理向量；缺件先发若获批准，必须另定实际组件份额持久化及 payload，不能沿此接口猜归属。

## C2a 补充二：已核对金额接点与最小价格取舍

**已核对事实：** `price-lists.service.js/findCustomerPrice` 先查客户绑定价格表，未命中回退 A/B/C/D 商品等级价；`price_list_items.product_id` 与唯一 `(list_id, product_id)` 是普通商品契约。`010_create_price_lists.sql` 没有物理 FK 声明，本轮未查 DB，不能称数据库外键已验证。`useSaleOrderForm.ts/lookupPrice` 拒绝过期客户/商品响应，手动改价取消在途查价。

**建议最小套价：** 套版本只有每套默认报价，销售可显式手动确认成交价，快照保存 `kit_default/manual`；不把套 ID塞进普通商品查价。客户专属套价、套等级价及扩展价格表首版延后。组件参考价/显式非负权重仅用作分摊依据，保存依据与结果；全零参考价必须有显式有效权重，否则拒绝预览/保存，不静默均分。组件参考价不是套成交价，不在客户切换或套改版后回算已保存快照。

建议新增窄职责 `sale.commercial-money.js`（尚不存在）：批量读取当前商业份额、已确认任务份额与退货合格量，向现有调用者提供订单毛额/已发毛额/组件归属额。这个金额适配层只决定**从哪份事实取毛额**，折扣、税、资金期间和成本继续复用原函数；关联缺失或物理向量不守恒明确拒绝，不回退平均价。无 `commercial_model` 时直接使用原查询。

| 已核对调用者 | 当前读取与套单建议接法 |
|---|---|
| `sale.service.js/create/update/requestAdjustment` | 当前 `foldEntryItems` 后汇总物理行 `amount`；套单汇总商业组成交额，组件金额物化到唯一物理行只是相同合计的投影，不再加一次父行 |
| `sale.service.js/recomputeSaleReceivable` | 当前 `SUM(shipped_qty * unit_price)`，退货用合格量 × `sri.unit_price`；套单读已出库商业份额毛额及政策确定后的实际退货额，仍调用 `calculateDiscountApplied`，仍保持已付款与结算历史 |
| `sale.service.js/cancel` 的 `partial_ship_closed` 分支 | 当前有实发时修剪/删除未发物理行、按 `shipped_qty × unit_price` 重算金额和折扣；套单关闭全部剩余时，以已确认商业份额求当前毛额、保留原快照和派发来源，再同步物理数量/分摊投影与原折扣函数。不能让 A已发/B未发的共享组件平均价把关闭金额变成150，也不新增任意单套取消能力 |
| `warehouse-tasks.ship.js/getShipContext`、`shipWithinTransaction`、`sale.service.js/syncShippedByWarehouseTaskWithinTransaction` | 前者按商品+任务仓 JOIN物理单价，回调累加真实 picked量；套单在同 SO→WT锁序与事务核对派发份额组成和任务实发向量，再确认该批商业毛额。扫码/容器/实发量仍走原闭合，不以套数替代库存扣减 |
| `accounting/voucher-sale-periods.js/loadSaleShipmentFacts/projectSaleShipments` → `voucher-engine.js/buildSaleRevenue/buildSaleCogs` | 当前每个真实出库 taskItem 的 qty×物理单价投影收入；套单仅将该任务毛额来源换为商业份额，保留 shipped_at期间、累计差分折扣/税尾差与物理成本计算。物理 taskItem唯一关联/累计实发守恒仍检查，不按商业组件JOIN放大成本 |
| `returns-sale.service.js/loadSaleSourceOrderByNo/validateSaleReturnItems/createSR/syncSaleReturnCompleted` | 当前按 sourceItemId锁物理行、限制已发减未取消退货量并强制原单价；套单还必须锁并核对原商业组件+原已发派发份额。原物理可退上限与商业份额上限均成立；合格入库后的金额读取待退款政策，不提前用平均价 |
| `voucher-engine.js/buildSaleReturn` | 当前收入冲回按合格量×退货价，成本按合格量×原 `soi.cost_snapshot`；套单退款毛额与应收采用同一适配来源，成本仍原组件快照，不改成套价或今日进价 |
| `reports.query.js/fetchSaleStatsRows`、`fetchProfitAnalysisRows`、`kpiSalesQuery` | 月/客户与已完成订单总额读订单头，商品统计读物理 `amount`，商品毛利按其金额占比摊净额；套单组件金额由快照投影，可继续按组件统计。若增加套榜，单独读商业组，不能把套榜再叠加到组件汇总；不把当前 status=4订单统计说成部分实发会计报表 |
| `export.service.js/getSaleExportPayload/getSaleReturnsExportPayload/getProfitAnalysisExportPayload` | 前两者读订单头总额，利润导出复用 reportsService.profitAnalysis；套单头额/退货头额必须与上述来源一致，组件与套的解释列明确单位。不得新增父子双计或另写一份利润算法 |

库存与供应接点同样已核对：`reservationEngine.js/reserve` 及 `expectedStock.js` 按真实商品/仓库记录预计依赖；`inventory.procurement.js` 的确认需求读物理 `quantity-shipped_qty`，`procurement.planning.js/calculateSupply` 以需求与预占取较大基数。套定义/商业旁表不加入这些需求 SUM，采购量只来自物理聚合。可成套预览是同仓组件约束的解释；组件共享时要同时分配候选组向量，不把各套独立可用套数相加。完整交期只有各组件足量来源日期均已知时才能取最晚日期；具体交期投影接点尚待专项核对。

## C2a 补充三：下一实现者的有界任务与验收

可先完成：审阅上述最小结构、定义版本竞争/启停及预览契约、金额适配纯计算样例、普通单兼容与来源守恒检查。套定义维护/选择预览可作为后续集成的一部分，但本文件没有授权将预览接到正式订单；不要交付一个对员工宣称已可开单的孤立入口。实施时才分配最大迁移编号+1，新增幂等DDL并核对名字/列序/FK；本轮不创建迁移。

须业务答案后完成：实际派发 payload及其持久化粒度、出库商业金额确认、组件可退量/退货金额/质检合格分摊，以及正式套单保存开关。两项原问题仍是：**缺件只发完整套，还是组件可先发；组件退款按原分摊、经确认其他金额，还是只整套退。** 没有回答不代表整套派发/原分摊退款建议获准。若准许组件先发，`task→group_qty`不能表达事实，必须补真实组件数量/金额归属后再定C2c–e；本轮不提前设计该路线。

| 虚构固定夹具 | 必须证明的结果（均未执行） |
|---|---|
| A价100、B价200，各1套；均铰链1+螺钉4，80:20权重 | 物理铰链2/螺钉8，组件份额A为80/20、B为160/40；总毛额300，库存与成本只一次。仅派发并真实出库A时毛额100，不能按平均价得到150；这是完整套候选正向例，不替代未决缺件政策 |
| 再加普通铰链1、价30 | 铰链物理量3、金额270，螺钉8、金额60，订单毛额330；普通商业份额30独立。先发普通行只认30，不吞A/B份额；采购净需求仍只有铰链3/螺钉8 |
| A已发，关闭整单剩余未发B；或未发的A数量由2减到1 | 已发A快照保留；按原关闭剩余路径取消未发B，只释放其剩余物理需求，关闭后的商业目标额100，原300留快照/事件。减量差额铰链1/螺钉4；已拣/装箱差额经原改单/归还确认后再释放，不能仅改商业数量。部分已发订单仍沿现有禁止改单边界 |
| A已发、B未发，退A铰链1 | 来源必须A的已出库份额，不能退B；若批准原分摊退款，候选额80，后续A螺钉全退候选额20；若其他政策，替换金额/资格断言。退货草稿取消或未执行返货不冲应收，实际合格量与原成本仍守恒；这条逆向仅作待政策夹具 |
| 两人同时改定义/保存同套草稿；两单争最后一套组件 | 旧revision拒绝且输入保留；保存确认新版本而旧快照不变；占库在原客户/采购/库存锁内重读，只一单取得实际可用量，不用预览缓存决定成功 |
| 创建/派发/取消后台成功丢响应 | 原键、原商业组/版本/物理向量和endpoint冻结；回执和业务同事务，重放返回原关联，不新增组、任务、预占或退款。结果未知先查原回执，不按当前列表状态猜成功，不换键自动重试 |
| 套价100.01按三份等权、分三批；全零参考价 | 分摊用整数金额单位按固定组件顺序分配尾差，最终合计100.01；累计确认额相减避免每批重舍入多分钱。明确权重缺失时拒绝，显式权重合法时记录其来源 |
| 套数1.5、组件0.25且允许小数；组件0.333或整数商品0.25 | 套数1.5拒绝；整数套数展开0.25可合法，0.333原量拒绝且不先舍入；整数商品0.25拒绝。包装单位先用权威换算，展开后再次校验 |

下一实现者须先证实未核对边界：商业关联在草稿/执行期改单重建及受控归还中的生命周期、金额适配的批量读取与无N+1、部分取消的折扣分摊、实际质检退货尾差、交期投影与旧客户端失败反馈。启停定义不阻断已保存单据读取和合法履约；组件停用对既有改单沿现行主数据闸门处理，不借此追改旧快照。回退方案为关闭新套选择/新建开关，保留已有套草稿读取、受控处理、履约和退货能力；不得降级到不识别套关联的旧服务、丢旁表或删数据来回退。

上述仍是 **C2a经过针对性只读核对、仍待业务政策与完整集成定稿的建议设计**；C2b—C2f未实现，数据库/API/GUI/真机/物理打印/生产均未以本文件证明。

## 定稿与实施顺序

1. 用脱敏固定套样例明确组成与报价；补充两个套共用组件、套与普通行共用组件、不同套价以及部分退货样例。
2. 定稿定义版本、商业快照、物理需求关联、本批派发归属和退货来源；核对金额、成本、采购、报表各只计一次。
3. 套定义维护及选择/展开预览可以单独验收，但未接通执行前不得保存正式套件订单。
4. 接通整条事务链后验证完整套分批、并发需求、响应丢失重放、原组成改版、组件退货及普通订单兼容；分段审查，不在一次大改中放开全部路径。
5. 员工页面及真实 PDA 样例验收另记；本地通过不称作真机、物理打印或生产验证。

本记录对应主计划 C2a 的前期核对。C2a 尚未定稿，C2b—C2f 尚未实现；不得将本文件的存在作为套件功能完成依据。
