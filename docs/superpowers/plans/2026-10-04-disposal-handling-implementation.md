# 有限处理来源与旧批准单签认实施契约

**Goal:** 把明确处理意图接到正常销售、准确采购退货或报废；持久防重、数量预算、真实执行进度与旧批准单整单签认闭合。

**Architecture:** 不建新库存/资金账。来源Q是员工确认的不可变基本量意图；关联A由正常目标创建同事务分配。真实执行E来自原业务事实；终结后的解除R只赋一次。原无来源创建沿旧路径；新来源目标限制普通、单仓、单行，一目标一来源，一来源可多目标。

**Tech Stack:** 现有Express/CommonJS、mysql2、React Query及稳定操作回执。迁移编号由根分配：277 `disposal_handling`；278预留供应商退款，不交叉修改。

本计划在当前隔离工作树实施，不执行DDL或真实业务。库存事务主题、业务语义、后端SQL/权限及前端草稿约定必须先读。来源生命周期与解除锁序已完成独立静态规格复核，下面的有限契约可分批实施；这不等于代码已完成或真实并发已验证。

## 数据结构与身份

新增幂等迁移277，全部历史不回填/重算、不删表字段；不得覆盖276：

| 结构 | 最小内容与约束 |
|---|---|
| `disposal_handling_sources` | id、不可变intent UUID、商品/仓库/基本单位快照、handling_type 1促销/2退供应商/3报废、基本量Q(两位)、创建身份/键/载荷摘要/原响应、revision、可空准确旧处置/旧行ID。intent UUID唯一，旧处置行来源唯一；两旧ID必须成对，不能另版本重开同旧行预算 |
| `disposal_handling_links` | source ID、目标类型/头ID、不可变历史line ID、商品/仓库/单位及A快照、单向解除R/最终E、原创建操作UUID/原响应与解除身份。目标类型+头ID唯一；一行目标只有一个来源；source FK不级联删，target line不设RESTRICT/CASCADE/SET NULL FK |
| `disposal_handling_operations` | 领域内全局唯一operation UUID、action、actor、原key、完整请求摘要、准确source/target/旧单身份、原成功响应、完成时间。相同UUID但不同action/载荷/原key/actor拒绝；回执TTL后仍定位原响应，不按单据状态合成success |
| `inventory_disposal_conversions` | 原处置ID唯一、原头与完整行/批准快照、签认actor/name/time/reason、原输入摘要/操作身份及原响应。保留原处置状态与批准字段，转换记录表达整单冻结 |
| 目标头窄marker | `sale_orders`、`purchase_returns`、`inventory_disposal_orders` 的nullable `disposal_handling_link_id`，只由同conn关联创建写入且之后不重绑；原无来源头为空，完全跳过新关联查询，避免在原reserve客户锁前新建RR旧view或不必要的range锁；不声称原create已有customer X死锁 |

标量ID严格正安全整数，UUID准确36字符，数量先拒绝超两位再合法换算；单价/金额保持四位。新普通意图读当前商品/仓库合法身份，数量依当前整数规则；不把参考可用量当新占库承诺。不接受客户端伪造旧单/旧行origin。

仅本轮关联目标使用marker；不为所有销售行新增stable token。原目标头软删保持关联历史。操作/来源/关联/转换均不物理删除、不级联抹去证据；字段长度/collation沿实际父表，索引/外键按名字与列序幂等补齐。

## 后端分批与接口

- [x] H1 来源基础（本地实现/离线双门，真实迁移待验）：`disposal.handling`窄模块，纯校验/预算/身份模块可分别放置；复用原disposal路由/controller权限和范围。`POST /api/disposals/handling-sources`保存不可变普通意图，`GET /handling-sources`分页/筛选，`GET /handling-sources/:id`给数量解释。原DISPOSAL_CREATE写普通意图、DISPOSAL_VIEW查看；当前范围先于count/list。原创建UUID/key及响应持久，不用7天TTL作唯一防重。
- [x] H2 正常目标原子创建（本地实现/离线双门，真实事务待验）：现有sale create、createPR、disposal create新增可选 `disposalSource {sourceId, expectedRevision, operationUuid}`。无来源完全跳过。原目标CREATE和来源VIEW/范围→source X→持久原操作当前重放→新revision/预算→原正常创建→准确新行/link/marker/原响应→原回执→原提交。销售仍commitFulfillment一次，通知保持；PR准确PO/采购行且同conn，不调用pool原单详情。link失败所有新单/事件/回执回滚，不HTTP先建后关联。
- [x] H3 行保护与当前出库取数（本地实现/离线双门，真实事务待验）：linked普通销售的草稿update、占库改单、执行期adjust及其他删除重建/增量行路径明确409；不因“编辑金额”默许改数量/仓库/客户/行身份。关联现存link主键当前读并核type/head/product/wh；无marker原订单不读新表。原同仓reserve/release、分批dispatch/真实ship与原cancel/delete保留。跨仓reserve继续拒绝。linked报废update也拒绝行重建。实际PR没有update/delete API，不新增。
- [x] H4 独立合法解除（本地实现/离线双门，真实数据库与现场待验）：明确原目标终结和真实归还证据后，`POST /handling-sources/:id/links/:linkId/release`原子一次写R=A−E，持久原响应，revision变化。普通来源沿原CREATE管理权，旧签认来源沿原APPROVE管理权，均保留VIEW和当前范围；不借此发货/退款或授目标写权。取消头状态/软删/缺当前行/TTL缺回执不能当E=0；WT只取消不等于PR终止。未闭合时409保留额度，不能再建替代目标绕过。
- [x] H5 旧批准整单签认（本地源码/离线双门，真实迁移与现场待验）：`POST /api/disposals/:id/sign-conversion`，原VIEW+APPROVE、当前整仓范围、原creator自批限制。仅status3且完整旧行含1/2；纯3沿原报废，4已执行/空行/未知type/异常qty/已有实物执行痕迹拒绝。原头+全行锁、原显示快照fingerprint重核、整单转换唯一记录及逐行唯一来源、操作原响应同conn一次提交。原审批不更新，不扣库/收付。混合3行另建普通报废草稿重新审批，不能签认顺带执行。
- [x] H6 员工UI/恢复：处置页面增加明确保存处理意图、已保存计划与数量解释；目标入口只预填来源身份/商品与基本量选择，客户/原采购行/当前价格/仓库等沿原表单重核。原请求完整体/UUID/key/owner/server持久冻结，未知先本人结果核对，不自动POST或换key。签认显示整单含各类型、原批准与reason，确认前后复核owner/active/范围/权限/原快照；不自动承接原批准。

领域本人原结果读取使用原认证身份+operationUUID精确查已持久成功响应，并核source/目标/旧单当前范围与准确资源归属；不额外要求原写权或原详情VIEW，不能顺带读取客户价、采购价、应付或完整原单。写重试仍原权限。错UUID/action/resource/actor/载荷、pending/not_found/损坏存储保持待核对。服务端载荷摘要不含认证凭据；前端最多容量拒绝新增不淘汰未知草稿。

## 数量及可见性

可再分配量 `Q − Σ(A − R)`，A包含已执行和未执行；执行后不能再以当前未发量忽略E。最低例：Q10/A6/E2，在目标取消并归还闭合后R4，来源仍消耗2，可再分8。销售退货/供应商退款不恢复E；改价生效不消耗数量、不算完成。

所有Q/A/E/R须满足非负、E≤A、R≤A−E及来源总消耗≤Q；缺失或身份/数量不一致拒绝，不能夹到0当已解除。解除一次终结，原响应重放不增量累加、不重新开放同link。目标缺行保留历史line快照；仅首版单商品单仓普通模型才允许准确任务事实取E，不能在套件/多来源行猜分摊。

来源进度与原审批状态分别呈现：待关联、已关联待执行、部分执行、完成、目标终止待解除、待核对；不能把保存/审批/预占/退货退款当实物完成。来源VIEW可看自己的处理数量；目标单号/跳转/客户/供应商价款只在原目标VIEW+完整范围成立后批量返回，不新增N+1或通过count泄露越权目标。

## 解除锁序技术门（独立静态收窄接受）

撤掉原候选source→target→allWT锁。实际普通ready-to-ship持WT后会锁SO，可能与解除target→WT反向；当前cancel-return.finalize没有SO回调，不能引用不存在的反向路径。原ready/cancel的既有静态面记录为隔离并发验收，不借本轮重构全销售。

解除自己的下一事务RC：source X→target head X→现存link X，之后事实查询不锁WT/WTI/container/package。PR目标在其头前先沿E1准确PO共享门，并重核来源；来源及关联marker均不重绑。一个聚合事实读取包含全部软删历史WT，不放大JOIN，要求所有任务7/8、无取消/调整挂起，准确商品仓库/qty及归还闭合。目标头锁阻止新派发和实发，WT-only晚提交归还只会让本次保守拒绝。所有正常目标写不反锁source。

- 普通销售实际E取全部历史status7销售WT的准确单SKU/仓picked_qty并要求shipped_at；linked销售在SO/WT锁后用同conn当前重建出库上下文，核真实固定行/仓/量，不用controller pool旧items扣库。本域E同时与准确TASK_OUT实扣证据核对，缺失/不等待核对，不认当前SOI缺行=0。
- SO status5只允许已证明E0且全部归还闭合；未派发取消可无WT，但须证明本域新建目标及准确原行身份，不能对未知历史推零。SO status4可为全实发或部分取消结案，其余WT全部8、标记清空、锁定容器零、取消任务无未作废箱。部分关闭的reserved_qty=E不等于活跃预占，不要求投影机械归零。
- linked普通单删除前补当前pending归还门，先完成原任务实物归还再软删；原无来源默认规则不动。归还、扫码、装箱不新增source锁。
- PR仅头4真正取消终结可解除未执行量；WT取消不足。头3已执行仅在当前准确PRI数量仍等于A、全集真实E=A且全部历史WT终结/实物闭合时认完成并冻结R0，不恢复额度；头3欠量、缺证或脏关联待核对，无WT的E0分支不放宽。实发用准确purchase_return_item_id及出库事实。报废沿自身执行事实核量；不凭销售或PR状态猜。
- TASK_OUT核对必须同时绑定准确WT.task_type、头来源和历史行；采购退货的log_source_type也使用sale_task，不能仅据该值当普通销售。现scheduler默认清理180天前inventory_logs/scan_logs，实扣日志缺失保持待核对，不推E=0、不拿通用回执或当前容器替代。解除成功时link冻结完整终结证据与最终E/R；本轮不扩全局日志保留策略。
- 原return-out ready分支确实跳过原状态规则，最小补法：原范围/归属与原键成功回放之后，新操作仅允许2→6，7/8及其他状态拒绝。不得把静态发现写成已复现终态回退。

Q/A/E/R校验后link单向TERMINATED、R=A−E绝对写一次，保存完整终结证据及原响应，commit。独立审计已允许实施此有限收窄；仍须离线反例和真实MySQL并发验证。

原子创建保持原公开wrapper及自己取得的事务conn，在其原创建流程内增加可选来源接点；不从外层来源事务调用另一个自begin/commit服务。无需为源关联强行抽全新通用创建内核，无source行为不变，目标/link/持久响应由原同conn一次提交。

H2无来源请求的原创建载荷指纹必须逐字段保持，不补`disposalSource:null/undefined`改变旧action作用域；仅有来源时条件加入该字段。持久完整业务载荷先按真实JSON语义移除undefined，再稳定排序摘要，不能把`undefined`拼成不可解析JSON，也不包含权限对象或认证信息。原generic回执重放不能绕过来源永久身份、link/marker及当前范围核对。

H2创建接点补充（只读核对原wrapper后收窄）：

- 仅POST创建接收严格disposalSource；销售PUT/adjust须在原body被schema strip前明确拒绝该字段（含null），商业模型也先拒绝。共享createSaleSchema不能使未关联单编辑静默丢弃来源。首版显式拒绝`repeatCreate && disposalSource`组合；从关联单再开沿R9白名单，不继承来源或预算。
- 三个原POST已由CREATE中间件加载请求权限，有来源时沿原hasPermission条件核DISPOSAL_VIEW，并只传服务内部授权结果，不纳入请求摘要；无来源不多查权限或新表。operator虽有roleId，不含permissions，不能凭来源字段或调用者随带对象授予权限。
- source当前范围、source锁、永久原操作完整身份及现存link/marker/目标归属重核先于generic begin和revision/预算拒绝。原永久ACK可在revision改变后回放；无永久结果而generic已有成功则拒绝核对，不能据其目标事后补关联。H1 SOURCE_CREATE回执形状保留，目标创建另加窄分支，准确填写target_type/id/line_id。
- A以hydrate/fold后唯一明细的基本量为准；linked PR/报废补当前商品active及实际基本单位核对，不能用客户端unit替换基准。单行插入后在同conn按新头读准确明细并验证取得真实id，不推算自增ID。报废仅linked创建接稳定原键与持久ACK，原无源创建行为保留。

## H3/H4事实读取蓝图（2026-10-05只读核对）

以下是有限契约的准确代码接点，不是SQL运行或并发结果：

- 任务全集：SO按`warehouse_tasks.sale_order_id`，PR按`task_type='purchase_return' AND return_id`；均包含软删任务，SO.task_id不能代替全集（`sale.service.js`派发）。WTI、库存流水、锁容器、箱先分别按任务聚合，再一对一关联，不直接多表JOIN放大SUM。
- 普通销售真实E只取准确`sale_out`、关联仓库、status7且shipped_at非空的唯一商品/基本单位WTI.picked_qty。WT8保留picked_qty不计E；空明细、重复/异商品异仓或未知任务类型待核对。
- 每条TASK_OUT须核`move_type=8,type=2,ref_type='warehouse_task',ref_id=WT.id,ref_no=WT.task_no,log_source_type='sale_task',log_source_ref_id=WT.id`及商品/仓/正合法量；按任一任务来源标识定位候选后核全字段，不能先过滤正确仓/商品藏掉脏行。多容器多流水合法，合计须等实发WTI；WT8存在实扣或shipped_at拒绝（`warehouse-tasks.ship.js`、`inventoryEngine.js`）。
- PR行须准确`WT.return_id→PRI.return_id`、`WTI.purchase_return_item_id=PRI.id`、`PRI.purchase_item_id=POI.id AND POI.order_id=PR.purchase_order_id`，另核商品/单位/仓；新关联不借历史NULL行的唯一SKU回退。
- 所有历史WT7/8且取消/改单标记清空；取消任务全部箱status3。锁容器按全部`locked_by_task_id`查询，不过滤ACTIVE或未删；合法已发箱status2不是待归还箱（`warehouse-tasks.cancel-return.js`）。
- finalize只在锁容器与status2箱清零后WT→8并清取消、sorted/checked，不清picked_qty，不回调SO/PR。归还扫码qty是整容器余量，不能拿PICK减归还量推闭合（`scan-logs.service.js`）。
- SO4部分结案可缩量/删当前SOI，冻结历史link line仍保留；reserved_qty可等实发E。无WT的E0仅限本域新建身份和准确原行已证明的未派发取消。PR释放未执行量须头4，WT8不代替PR最终取消；头3只在准确全集E=A及闭合时完成/冻结R0（`sale.service.js`部分结案、`returns-purchase.service.js.cancelPR`）。
- 单SKU报废须对照state4/disposed_at、`disposal_scrapped`准确头/商品/仓/单位/量与库存流水`move_type=13,type=2,ref_type/log_source_type='disposal'`、准确ID/单号。取消6/驳回5须无执行时间、台账及出库证据才能E0；这些表缺item ID，不扩大多行分摊。
- linked普通ship：原wrapper BEGIN前pool上下文仅预检；SO/WT锁后核marker/准确归属，仅linked分支同conn当前读固定SOI和WTI并重建原出库上下文，沿原moveStock/应收/回执/commitFulfillment，不锁source。无marker跳过新表。
- return-out ready：`warehouse-tasks.pick.js.readyToShipWithinTransaction`在原范围/归属与成功key回放后，新操作仅2→6；保留原`{taskId,status}`回执，当前7/8不能挡原成功回放。

任务/明细在执行前可变，当前容器和SOI不是永久执行证据；库存/扫码/事件流水有TTL。事实缺失保持待核对，成功解除保存完整终结证据。实现仍须逐批规格/质量门和离线反例，实际MySQL另验。

### H4共享事实及解除身份的有限接点

`disposal.handling.facts.js`只接调用方conn，批量输入来源/关联，返回按link ID索引的执行量、终结/归还判定、待核对理由与证据；不自取连接、不启事务，不锁WT/WTI/容器/箱。列表/详情的原RR只读快照与解除的自有next RC都调用它；保留纯Q/A/R预算，另组合执行解释。关联、三类头/当前行/永久创建操作分别按类型批读，任务及各事实分别聚合再关联，不逐link调用原详情或回执服务。

控制器沿已加载的真实目标VIEW权限传可见性。来源数量可解释，目标ID/单号/跳转及客户供应商字段仅在对应目标VIEW和头、当前行、全部历史任务仓范围成立后批量附加；无目标权限不暴露目标元数据或额外count/filter。任务流水候选按准确业务类型+ref ID、log来源类型+来源ID及准确任务单号定位，按日志ID去重后验证全字段；不用裸数字ID跨领域匹配，也不先筛掉异仓/错SKU/错move等脏候选。

无WT的已取消新销售目标仅在永久创建操作status1、canonical请求/摘要、准确source/type/head/历史line、原响应及marker全部一致，并且当前唯一SOI仍为冻结line、商品/仓/单位/A准确、实发/派发零且无异常任务指针时证明E0。缺当前行允许原创建ACK恢复，不能因此证明E0；软删头仍沿同一证明，证据不全保持待核对。

解除body严格只收`operationUuid、expectedRevision、reason`，reason为员工填写的1–500字符说明；路由的source/link ID一并纳入完整canonical载荷。持久action固定为`disposal.handling.link.release.<linkId>`，resource_type=`disposal_handling_link`、resource_id=准确link ID，同时保存原source/target/历史line身份。原成功DTO固定为`{sourceId,linkId,executedQuantity,releasedQuantity,revision}`，数量两位、revision为本次提交后值；不附目标价款/单号，不从当前状态重造响应。本人查询扩窄分支核同UUID/action/key/actor/来源intent及准确资源当前范围。

新解除在完整身份和原成功重放之后才核revision、全来源预算和闭合事实；绝对写R=A−E，CAS限定ACTIVE/尚未解除，source revision同时CAS，任一affectedRows不为1整体回滚。`release_evidence_json`使用canonical版本1结构，保留准确创建身份、冻结link A、目标终结状态、各历史任务/出库/归还核对证据及最终E/R；严格校验其版本、身份与数量。TERMINATED进度与原ACK沿冻结证据解释，不因后续日志TTL消失再开放额度。此处固定接口/证据结构，尚未实现H4或运行MySQL。


H4正常无任务的只读进度：永久创建身份、当前唯一冻结行/A/商品仓单位、shipped/dispatched零且无异常task指针成立时，SO合法未派发1/2/6及PR草稿1可解释E0，仍terminal=false/returnClosed=false，正常显示已关联待执行，不据此解除。SO3/PR2无任务违背当前创建链须待核对；SO取消5仍额外核reserved0和取消强证明，PR3仍须全集E=A，PR4沿真取消证明。普通非终结有预占不等于实发，不机械要求reserved0。最终H4实现需覆盖此读/写门区分。

H4质量审阅收窄：实际cancelPR拒绝任何已发WT7/shipped_at和PR任务的销售指针，故PR4闭合必须E0且全部任务sale_order_id显式NULL；PR4夹带准确实发不是可按A−E释放的合法部分取消。PR3仍只在准确满量E=A及实物闭合时冻结R0。provider与冻结证据共用evaluate，须补真实读/解除反例；此处是源码异常组合的静态/离线发现，不宣称正常UI或MySQL复现。

### H5签认预览与完整历史快照的有限接点

原详情INNER JOIN商品主档，软删仍显示但物理缺失会漏行；签认新增 `GET /api/disposals/:id/conversion-snapshot`，原VIEW及当前仓范围，在同一只读RR快照内读取旧头和完整 `inventory_disposal_items`（不JOIN主档、不过滤旧行）。预览与POST锁后共用版本1 canonical serializer，头含原199全部历史字段及277 marker、行含原199全部字段并按ID排序；数量两位、金额四位采用准确DECIMAL文本，不舍入异常数量或覆盖历史估值，时间采用统一JSON序列化。返回整头、全部行、原批准快照、snapshotFingerprint及已有转换的最小摘要；不借预览授予签认权。

POST body严格为 `operationUuid,snapshotFingerprint,reason`，路径旧单ID进入完整canonical操作载荷。原VIEW+APPROVE、当前整仓范围，旧头X及全原行X后重核原creator自批；当前同conn读取actor的allow_self_approve，仅1豁免，不从role1臆造豁免。仅status3且至少含1/2，全行身份/单位/正基本量合法、原批准证据完整。status4/纯3/空/异常typeqty/已dispose时间及准确disposal来源或单号命中的实物执行痕迹拒绝。无日志不推定从未执行；原状态和批准完整性共同约束，缺证据人工核对。

同277的原头唯一转换和原行唯一来源结构一事务保存全部旧行，包括混合3行。每源intentUUID独立、created_operation_uuid共享本次签认UUID，Q/type/商品编码名称/单位/仓名沿准确旧快照；仅补读当前仓代码及父行存在性。历史父商品/仓库仍存在的停用或软删不阻止保存转换意图；物理缺失整单拒绝，不能漏行或造父。后续新目标仍按原表单与H2当前有效主档/单位规则重核，不能凭旧来源强行开新单。涉及277父FK的准确主档/actor在INSERT前同conn有限S读，不修改旧父或历史单。

签认永久action采用 `disposal.handling.legacy.convert.<旧单ID>`；路径ID纳入canonical载荷。版本1快照容器固定 `{version:1,head,items,approval}`，fingerprint为该canonical JSON的SHA256，items按旧行ID升序；预览、锁后重核及永久响应共用同一形状。全来源批量INSERT后按准确legacy行/operation读回真实ID，不猜连续自增ID。

不逐行调用自提交createSource；增加 `completeConversion/readConversionReceipt` 独立分支，operation准确legacy_disposal_id、resource_type=inventory_disposal_conversion/resource_id=转换ID，intent/source/target字段不冒指任一来源。固定原DTO `{id,originalDisposalId,disposalNo,operationUuid,snapshotFingerprint,sources:[{sourceId,intentUuid,legacyItemId,handlingType,productId,warehouseId,unit,quantity,revision:1}]}` 按旧行ID排序，同一canonical DTO存转换、各来源和永久operation。本人查询仅精确UUID/action/key/actor/旧头/转换/全来源原身份及当前准确范围，不返回原价或以后预算，不因来源后来revision变化重签或改变ACK。

新POST原成功重放先核当前写权限/整范围和永久操作/转换完整身份，不因当前主档停用、来源后续关联或revision变化变成新签认；新请求再核快照指纹和未转换唯一性。原头/全行/批准字段/updated_at都不UPDATE。当前没有撤批、删除、软删API，不凭空加路径守卫；仅实际dispose的新执行分支在扣库前核已转换存在门，原合法已成功回执沿原语义。混合3来源以后另建普通报废草稿并重新审批。本节是有限静态实施契约，尚未实现H5、执行277或验证数据库。


### H6原表单及完整请求恢复的静态接点

沿原处置页保留建议、历史与报废操作，补保存处理意图及独立分页来源列表。只展示服务端Q/A/E/R、progress、pendingReason、originKind及link.state，不前端重算库存或完成；普通/旧来源分类不带越权旧单元数据，TERMINATED即使R0也不能重复解除。

普通销售沿现CreateView与serializeSaleItems/原createSaleApi，仅加入与R9再开互斥的handling上下文。有限初始化只带来源商品/基本单位/单仓及员工选量，客户由员工选、当前报价沿原机制。原initializeIdentities要求客户，不能伪造客户或旧订单；有非空输入先保护草稿，关联模式不增第二SKU、不换仓/商品，不承接原套模型。来源引用只在最终完整POST体条件加入，普通无源提交不变。

PR沿原FormView及source-order读取准确PO。员工明确选匹配商品/仓/基本单位的准确POI sourceItemId，重复SKU不自动择一；只该原行进入关联草稿，本次量按来源可分及原可退量选择，原价保持服务端权威。当前原单绑定模式默认全行和禁数量，需仅handling模式加单行选择/选量，不把整个旧入口改成新的万能退货；不能清PO降为无源。报废沿实际CreateDisposalDialog加可选source上下文/单行基本量，只建新草稿重新审批，有圈选/备注/仓输入不覆写，普通多行圈选仍保留。

采用独立handlingSourceId URL与tabIdentity/queryKeys，不复用R9 sourceId或PR原PO sourceId；严格拒重复/空/非法及R9+handling混合。已有同身份标签只激活，空白/R9/handling不共用组件实例；沿MAX30前置拒绝，不靠store的LRU驱逐未保存输入。来源报废草稿按准确身份保留。

R9仅磁盘查询身份且完整体在内存，R10只接受报废执行空body及固定action/path，两者不能直接承担H6完整体恢复。新有限version记录在POST前读回核验持久：原user/baseURL、草稿身份、精确action/method/path/intent/source/link/legacy身份、operationUUID/requestKey、完整canonical JSON业务body、创建时间、pending/confirmed及原ACK，不存认证信息。storage失败/损坏/不一致/容量满拒POST，不驱逐未知记录；目标disposalSource随真实body冻结，不能随revision、报价或表单刷新改体/换键。PR/报废API补向后兼容config参数，所有关联写沿原端点、固定server/session，关闭客户端自动重放/fallback。

未知或超时先本人领域GET handling-operations核精确action/UUID/key/intent和原资源DTO；pending/not_found/5xx/身份不符继续保留，不自动POST、另建键或按七天TTL猜失败。成功先持久confirmed，清理失败仍阻断再次保存。认证恢复页沿原disposals/recovery模式加有限记录，不挂原表单或查客户报价/PO详情；查询捕获点击时当前本人合法session，旧挂载epoch不封死本人核对。H5 conversion无单一intent，沿其独立实际ACK查询形状，不伪造intentUUID。

读取前后、Finder确认、真正提交、确认弹窗、成功清理/关闭/跳转都核owner/user/server/session/epoch/active及当前权；失效保留原输入/记录。目标要求原CREATE+source VIEW，来源创建UI要求CREATE+VIEW，解除普通CREATE/旧APPROVE+VIEW，原签认VIEW+APPROVE和自批仍服务器权威。签认读取H5完整conversion-snapshot整头全行与fingerprint，显示混合整单及reason，不拿JOIN旧详情当完整证据。解除只冻结原路径和UUID/revision/reason，不在UI取消或写R。

必要离线覆盖：非空草稿保护、独立tab身份/容量、重复SKU准确原行选择、禁第二行/换仓、真实完整body冻结、storage失败无POST/满容量保留未知、服务器及权限ABA晚响应、撤写权本人GET、TERMINATED R0不重复解除、完整签认与fingerprint漂移。实际localStorage/GUI/设备及MySQL仍另验；此为只读实现蓝图，H6尚未编写。

## 验证

高风险业务批先窄离线VM/真实组件反例→红→实现→绿，require默认拒绝不读config/db/app/env，全部网络/listen受根离线runner阻断。测试须涵盖：同UUID变action/键/体拒绝、TTL后原响应、不同来源抢相同操作UUID、一次提交与link失败全回滚、源范围先于重放、旧混合整单冻结/原批准保留/重新审批、原无来源不碰新表、现存marker准确核对、修改/换仓拒绝、部分实发+归还后只解除A−E、缺行/未决实物/终态复活拒绝、撤写权本人核对不自动重试、账号/服务器ABA和确认晚到、存储失败无POST。

每个H批规格Accept后质量Accept再续；最终统一受影响检查。真实277迁移、MySQL当前读与并发、隔离完整主链、GUI/员工/打印/PDA现场全部未执行，另列验收，不称上线可用。

## 静态计划门记录

H1–H6及解除收窄已由独立规格审阅接受：持久操作身份、原创建同conn可选接点、Q/A/E/R、准确出库/归还事实、整单旧批准签认及权限/恢复边界无Missing/Extra。该记录只允许后续分批实施，不代表任何H批代码已完成或MySQL并发已验证。

2026-10-05 H1来源基础经两次窄修后独立Spec Accept→Quality Accept：目标头FK全库唯一且元数据所属表准确；12项CHECK保留语义，按有限已核MySQL8打印原文BINARY精确核对。最终51/51自然exit0/signalnull/audit0，弱约束先红与恢复旧核对方法的反向失败均已保存并还原。精准15文件增量`/tmp/go-live-h1-increment.diff`，两窄修另存FK/CHECK diff；原ACK、本人查询、主档/范围、预算及无库存资金写边界受本段验收。277未执行、SQL打印未在MySQL实际核对，全批检查/目标创建/进度/解除/旧转换/员工UI均待各自批次。

H2原创建接点已独立Spec Accept→Quality Accept：精准24路径`/tmp/go-live-h2-increment.diff`，作者及规格审阅分别取得六文件108/108自然exit0/signalnull/audit0；根与质量审阅核固定证据、真实调用链及reverse apply --check。顺序和生产撤修反例均已还原，首红1项schema夹具错误不算业务反例。三条原wrapper同conn创建、准确fold/原价/余量、link/marker/永久最小原响应及无来源兼容受本批覆盖；没有真实277、MySQL事务/FK等锁、应用或现场结果。H3现在实施行/仓身份保护和linked实际ship当前取数，实际执行数量的全集事实汇总与解除在H4共用一套读取，避免重复聚合；H3–H6及全批检查仍未完成。

H4共享provider及解除接口的窄小节已独立Plan Spec Accept→Plan Quality Accept，无新增Missing/Extra或Critical/Important：版本1冻结证据、link action/resource、固定数量DTO、无WT的E0强证明及批量权限边界与277兼容，无须改迁移。此为后续实施契约；H3仍在实现，H4代码、DDL、数据库及并发未执行。

H3在派发全行窄修后独立Spec Accept→Quality Accept：整体13路径`/tmp/go-live-h3-increment.diff`、修补6路径`/tmp/go-live-h3-dispatch-fix-increment.diff`，作者与独立规格最终四文件75/75自然0/signalnull/audit0。首72绿未覆盖被eligible SQL隐藏的额外行，补真实谓词反例后先红及单撤fullrow反向均72绿3红，finally恢复；另行精确A及编辑/删除/实发生产撤修证据保留。根与质量核固定证据、真实链、两份reverse apply及diff，未发现剩余Critical/Important。仅H3子项完成，H4现在接共享实际执行事实和一次解除；H5/H6/F/E7、277执行/真实锁并发/应用及现场仍未验。

H4采购退货完成的窄澄清（静态只读核对）：实际ship逐行required=picked=PRI.quantity且覆盖全部PR行，实扣、PR2→3与WT7同事务；头3无修改/撤批/删除合法入口。只凭头3仍不足，provider须核全事实E=A和准确PRI/A后才完成/冻结R0，头4才可释放未执行量。该澄清等待独立窄计划门，不宣称真实数据库或新接口已验证。

H5完整签认预览/serializer/FK接点与转换最小原DTO已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或Critical/Important。历史父停用/软删存在允许保存转换意图、物理缺失整单拒绝，后续目标仍当前主档重核；旧头/全行/批准/updated_at不写，277不改。仅H5有限计划可执行，H5代码/DDL/真实事务仍未实施，H4在写不属于此门。

H4采购退货头3满量完成窄澄清已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或Critical/Important；只允许全集E=A和实物闭合后冻结R0，不恢复额度，头4仍是释放未执行量的必要取消状态。正常无WT只读进度补充与写解除强证明分离，最终实现仍等待H4双门。无数据库/现场通过结论。

H6有限原表单、完整请求持久冻结与本人核对接点已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或Critical/Important。保留普通/R9/handling独立草稿、准确原采购行和MAX30前置保护；H5转换核对不伪造单一intent，服务端仍为权限与范围权威。仅计划门接受，H6代码、GUI/真实存储、数据库均未实施或验证。

H4首轮独立Code Spec尚Missing两项Important：SO4缺正量准确WT7实扣证据时不能把剩余WT8当完整E0并释放全部A；legacy转换回执须核既定完整DTO及转换/旧头/operation/逐行来源映射，canonical JSON本身不足。指定七文件183/183自然exit0/signalnull/audit0仅证明已覆盖用例，未覆盖上述缺口；已交单一作者窄修，未进入Code Quality，H4保持未完成。

H4两轮窄修后独立Code Spec Accept→Code Quality Accept，原三处Important关闭，无剩余Missing/Extra或Critical/Important。整体21路径 /tmp/go-live-h4-increment.diff，最终作者及独立规格230/230自然exit0/signalnull/audit0；最后两PR守卫生产单撤反向215绿15业务红，finally字节精确还原。原SO4/完整legacy证明的32反向业务红及首版9setup分列保留；本轮9只读commit计数夹具误报单列，不作生产修复证明。根核整体与7路径补丁reverse apply及diff均0。H4仅源码/严格离线事务模型完成，无277执行、MySQL/GUI/现场或全批检查结论；H5整单签认现在开始，H6/F/E7仍待后续。

H5整单签认独立Code Spec Accept→Code Quality Accept，无Missing/Extra或Critical/Important。精确16路径 `/tmp/go-live-h5-increment.diff`，作者及独立规格八文件277/277自然exit0/signalnull/audit0；单撤自批/实物痕迹/已转换新执行三门后273绿4业务红，finally两生产文件字节精确恢复，五项VM参数夹具误报单列。根核reverse apply和diff通过。完整原快照、同conn全行保存/真实ID、永久原响应与auth-only本人查询受本批覆盖；H6页面尚未实施，277/真实MySQL/GUI/现场及全批检查未验。


- 2026-10-05 H6作者已冻结42路径（15新增、27修改），精准 `/tmp/go-live-h6-increment.diff`，handoff/manifest/before齐。恢复后五文件51/51及受影响邻接三文件35/35均自然exit0/signalnull，worker5/3、audit0；最终production撤三门51项48绿3业务红，finally三生产文件按原字节恢复且根现场SHA复核一致。根核reverse apply及tracked diffcheck均0；首红占位能力与setup/fixture已分列，旧neighbor不充新strict恢复证明。现在独立Code Spec审阅中，H6/E5尚未完成；F1–F6/E7、真实存储/GUI/277/MySQL/现场仍未验。


- 2026-10-05 H6首轮独立Code Spec未Accept，集中三项Important：错误模型销售退货忽略handling参数降空白单、销售/来源报废canonical删空sourceNo/sourceType导致mixed变合法、确认持久后清理前缺owner复核。独立五文件51/51自然exit0/signalnull/5guards/audit0仅证明原覆盖，不能关闭这三项静态Missing；固定 `/tmp/go-live-h6-independent-spec.*`。原单一作者开始窄修及真实负例，H6/E5不勾，Quality/F/E7未提前开始；无GUI/DB结论。

- 2026-10-05 H6三Important作者窄补已冻结：整体44路径（15新增）、修补9路径，根核两精确reverse apply和tracked diffcheck均0、44/9当前SHA与3恢复SHA全部一致。五文件最终63/63、四邻接80/80 natural0/signalnull、guard5/4/audit0；撤三生产门同最终63项51绿12业务红，finally字节恢复。既有sourceHandoff缺纯mock订阅导出0test为SETUP，单列修夹具不充业务反证。原独立Spec复验中，H6/E5不勾完成，Quality/F/E7不提前；真实GUI/存储故障/数据库/277/现场仍未验。

- 2026-10-05 H6窄修后独立Code Spec Accept，原三Important关闭，未发现新Missing/Extra；独立五文件63/63 naturalexit0/signalnull/5guards/audit0，固定 `/tmp/go-live-h6-spec-fix-independent.*`。现在独立Code Quality审阅44路径整体及9路径修补，尚未勾H6/E5，不进入F；只限源码/离线组件，GUI/真实存储/MySQL/现场未验。

- 2026-10-05 H6首轮Code Quality未Accept：一个Important，来源对外isCurrent未绑定读取活动代次，隐藏→恢复会使旧报价/原PO/数量策略guard重新true，旧慢响应可回填。现63/80绿色不覆盖该active ABA；此为真实调用链静态确认，未运行新探针。单一作者开始现strict adapter真实负例及H6 opt-in窄活动generation修补，普通默认调用、原草稿/键不改；H6/E5继续未完成，F/E7不提前。

- H6活动代次质量修补首红已固定：真实五文件68项63绿5业务红（报价成功/错误、PO成功/错误、数量策略），四邻接81项80绿1业务红（R9同钩子晚报价）；naturalexit1/signalnull、guard5/4/audit0，无unknown/import/setup红。固定 `/tmp/go-live-h6-quality-fix-red.*` 与 `-neighbors-red.*`。真实页保持实例隐藏→恢复后旧99报价、旧PO/错误或数量策略被接受，员工原量/原单号及fresh读取断言保留。作者开始11路径窄修；H6仍未完成，不把源码模型当GUI复现。

- H6活动ABA窄修作者DONE/STOP，整体45路径（15新）、本轮11路径已冻结，root核两reverse apply0、45/11当前SHA一致、tracked diff0和4恢复SHA一致。最终五文件68/68与四邻接81/81 natural0/signalnull/guard5/4/audit0；联合仅撤本轮4门分别63绿5业务红/80绿1业务红，finally精确恢复，明确不是四门逐个独立mutation。67/68的PO共享reads二次deferred夹具失败已单列，起点固定后最终红/绿同文本，不能算生产反证。固定 `/tmp/go-live-h6-quality-fix-final-green.*`、`-neighbors-final-green.*`、`-final-reverse*`。原Spec独立复验中，H6/E5继续未勾；F/E7未提前，真实GUI/存储/MySQL未验。

- H6活动ABA窄修后独立Code Spec Accept，无新增Missing/Extra，45/11 SHA未漂移；独立五文件68/68与四邻接81/81 naturalexit0/signalnull/guards5/4/audit0，固定 `/tmp/go-live-h6-quality-fix-independent.*` 与 `-independent-neighbors.*`。原1Important已在规格门关闭、普通默认与R9同族/原3Spec修保留；现在原独立Quality复验，H6/E5仍不勾，不提前F。证据仍不代表真实GUI/存储/数据库。

- H6独立Code Spec Accept→Code Quality Accept，原3项规格与1项活动ABA质量Important全部关闭；原Quality只读复核45/11精确SHA、实际反例/联合撤修/finally、独立68/68与81/81 naturalexit0/signalnull/audit0，未重复套件。H1–H6仅本地源码/离线双门完成，277/真实MySQL、GUI/存储/设备/现场待验；未提交推送部署。F1供应商退款基础现开始，本计划不据此声称整个E/F完成。
