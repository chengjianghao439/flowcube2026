# 剩余项自主实施计划与记录

> 用户已授权“未开发的和待我决定的（按你的建议）全部开始，自主多轮执行”。本计划承接首批与续批成果；不把旧静态建议或新规则决定写成已实现。

> 2026-10-05当前结论：本轮授权的未开发项及待决定项已按推荐规则完成本地代码或职责方案，E0–E7均已完成本轮范围；原R/H/F成果保留。独立规格、质量及整批复审接受，最终离线证据和仍待执行的启用工作见文末。没有连接数据库、执行迁移、启动应用/浏览器、提交/推送/合并/部署。


**Goal:** 完成剩余滞销正常业务来源、旧批准单签认转换、供应商实际退款及准确原付款分配，并收拢高级会计入口、落实旧系统并行职责。

**Architecture:** 继续使用 `codex/go-live-batch-one` 隔离工作树。保留原销售、采购退货、库存、资金、审批与凭证事实源。来源仅管理不可变处理意图与分配预算；原业务实际执行仍是完成依据。每批单一实施者，规格与质量顺序独立审阅。

**Tech Stack:** React/TypeScript、Express/CommonJS、MySQL 8 手写 SQL；新增迁移从当前最大编号276之后连续分配，迁移只保存源码。

## 已采纳的产品规则

1. 完整保留现有基础账务、凭证、期间锁、结转、跨期补录、固定资产与折旧关系。合并报表、报税参考及固定资产入口收进系统管理的高级会计分段；功能、旧地址及原授权不变，停止新增高级扩展。
2. 旧已批准含促销/退供应商或混合类型的处置单：原查看、审批权限和仓库范围下签认，并继续执行原自批限制。保留原批准快照；签认仅冻结原整单直接执行、保存逐行不可变来源，不扣库不收付款。转出的正常业务单重新走原审核流程，不继承旧审批。
3. 供应商退款先登记实际回款并准确关联原付款分配；采购退货仍保留原已付保护、原价和准确来源可退量。退货和退款分别执行，不使用负数付款、客户退款改名或余额调整绕过保护。
4. 普通、单仓、单行目标先落地。一目标接一来源，一来源可分给多目标。成套、多来源合并、关联后数量/仓库/行重建与任意重绑不扩展。
5. 正式启用后的新实物、新资金以极序为唯一执行系统；旧系统只对照记录。并行职责按业务角色制定，不改真实账号、生产配置或旧系统。
6. 未知结果保留原身份、完整载荷、原请求键并查询本人回执；长期防重不能依赖7天回执表。权限/范围撤回后可核自己的原结果，写重试仍需原业务权限与范围。

## 分批待办

- [x] E0 高级会计导航收拢：`frontend/src/router/routeDefinitions.ts` 的固定资产、合并报表与账套、报税数据移至系统/高级会计。保持 component、permission、keepAlive、tabIdentity、path 与页面标题；不改会计服务。静态核对原链接和权限过滤即可，不为低影响元数据另写镜像测试。仅静态本地完成，GUI待验。
- [x] E1 采购退货技术门：完整复核 PR、WT、上架/原PO和账款锁链及RR可退预算，窄接点实现及独立规格/质量门完成，定向后端27/27、前端2/2离线证据保留。仅本地代码完成；真实MySQL锁、RC与并发仍待隔离验证，不把外层锁称子查询当前读证明。
- [x] E2 有限处理来源（H1–H4本地代码/离线双门完成，数据库与员工UI待验）：新增不可变来源、持久创建/关联身份与预算；正常销售、准确采购退货和报废在原事务内原子关联。无来源请求沿原行为。关联后阻止明细重建；解除依据准确实发/终止及实物归还，不从草稿或软删推断未执行。
- [x] E3 旧批准单签认（本地源码/离线双门，真实迁移与现场待验）：锁头及完整原行、校验全部权限/范围/自批；原审批与历史不改；整单冻结后逐行准确来源，旧已执行不补单。混合单的报废另转正常报废草稿并重新审批。
- [x] E4 供应商实际退款（F1–F6及E7本地代码/离线复审完成，真实资金与DB未验）：准确原付款分配、回款账户和业务日期、期间闸门与共享/排他锁、原应付已付净额、对账/往来与资金事实、凭证来源、审核/自批/取消边界；新增域权限不得默认授给员工。历史无分配来源保持人工核对。
- [x] E5 员工页面与恢复（H6、F5/F6及整批E7本地代码/离线复审完成，GUI/设备/现场未验）：来源保存/目标创建/进度/解除、旧单签认和退款入口；保存未提交草稿与未知结果，按身份和服务器冻结，不自动POST、换键或补执行。原采购退货入口保留无原单历史衔接。
- [x] E6 账务及并行职责：明确存货报废参考值与真实成本证据，保留历史并避免冒用固定资产处置凭证；形成角色职责、历史余额/实物切点核对和双系统对照方案。无业务来源证据不自动改账。仅政策文档与代码依据静态审阅完成，现场未验。
- [x] E7 本地收尾：各批规格→质量接受，最终E7窄修及整批源码复审接受；九门离线检查、360路径diff/冻结与文档核对完成。隔离数据库、GUI、现场、打印和发布仍另列，本勾选不表示可正式上线。

E1/E4的具体数据结构、接口、锁序、回款和凭证规则由当前静态审计结果补充后才进入实施。根代理分配迁移编号，任何实施者不得自行撞号。

## E1 技术门的窄实施契约

当前候选经静态完整调用链复核后再给单一实施者；仅此技术门，不同时建设退款或来源表。

- `returns-purchase.service.js` 的创建预算使用 `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`，仅作用下一次事务，不改SESSION/global。准确原PO排他锁协调创建；锁后重核原PO供应商/仓库/原单号，折算基本量后按准确原采购行强制原价、可退数量读取采用语句级当前数据。不能给带子查询的外层SELECT加锁就称子查询已当前读。
- 采购退货确认、取消及仓库出库统一准确原PO共享门→PR头→WT→库存。锁前查询只定位身份，锁后重核真实PR/PO/WT关联、原状态与范围。无原单历史保持原入口，但含来源行却无准确PO或不一致的脏单拒绝、待人工核对。确认/取消没有创建事务的隔离需求，不随意改其他事务。
- 实际 `warehouse-tasks.shipWithinTransaction` 仅由 `ship()` 调用；PO/PR门须位于首个WT锁前，不能等到末端 `syncPurchaseReturnShipped` 才拿。其他销售与返货出库分支不变。
- 出库顶层同conn在begin前只读定位task/PR/PO身份并早核范围；begin后至WT权威锁前仅当前头锁/回执当前读，不用普通peek创建RR旧view。锁后重核全部真实来源，WT锁后才首次普通读取闭合事实。controller的pool上下文仅预检，不能作出库金额或身份的权威数据。
- 保留收货原IT→PO→库存方向。实际函数在 `inbound-tasks.command.js.closeReceiving`，在IT后、2→3及tryFinish/settle前按准确来源PO排序补X门并重核来源。`purchase.service.closeRemaining` 自身下一事务RC并在已授权准确PO X下重算，仅此调用给结算一个窄opt-in：来源完整断言仍同conn先执行，收货与退货数量采用语句级当前读、不再反向等IT/旧PR锁；原金额/确认状态/结算快照/CAS/提交保持。其余结算默认行为不改。
- 共享 `returns.helpers.adjustPaymentRecordForReturn` 先定位准确账款身份/所属对账单，按对账单ID升序锁，再锁账款当前重读；成员变化拒绝，不在账款锁后追锁新对账单。原负余额保护、总额冲减、重新待确认、事件和原提交不变。刷新对账单时使用仅此调用的当前读opt-in，避免等待后RR旧快照；默认其他刷新路径不变。
- 必须核 `closeReceiving` 的来源集合和范围、预算取消释放及准确源价、出库真实关联、无来源历史及脏来源、收货settle默认路径、对账成员漂移和聚合当前读等负例。离线只能证明代码/调用顺序与错误出口，实际MySQL锁、RC与并发仍待隔离环境验证。

预计相关文件：returns-purchase、returns.helpers、warehouse-tasks.ship及其controller、inbound-tasks.command、inbound-tasks.settle、purchase.service、reconciliation-statements.service；准确PO门可放窄helper，WT command仅必要内部原参数/归属核对时动。不新建原本不存在的PR更新/删除能力。取消核全部当前关联WT与真实已发，不能信最新一条旧状态；原物理归还未闭合只能显示待终止，直接取消WT不等于PR或来源解除。

必要纯离线VM回归使用 `tests/purchase-return-lock-budget.test.js`、`tests/return-payment-lock-order.test.js`，严格require白名单不加载config/db或app。最低反例：等PO后首笔已提交占量、相同SKU不同原行价格、PO/POI/PR/WT身份漂移、出库/取消同序、closeReceiving不能绕门、连接复用不残留RC、statement成员漂移不晚锁、刷新当前聚合、已付80/应付100/退30仍拒绝。新增专项命令接CI静态job，源码守卫必须有反向失败证据；不修改既有守卫到只匹配新实现。原confirm/cancel尚无资源回执，不声称本技术批已补成功重放。

E1候选已由完整调用链独立静态审阅接受，允许按以上契约实施与离线证伪；这不是实际MySQL锁/RC或并发通过结论。

## E4 专用退款已选择的有限规则

- 新表 `supplier_refund_orders` 与 `supplier_refund_allocations`；保留201客户退款历史语义。单头绑定准确PR/PO/AP/供应商/账套，金额正数；四态草稿、已确认、已收回登记、已取消。确认后冻结来源/分配/金额/账户/日期。取消只未执行；已收回不得通过取消、删流水或手工红字凭证恢复AP。
- 新建/确认仅正常准确来源PR草稿；先建PR草稿可行，原已付保护在confirm/实物出库，退款先收回不构成循环。服务端从原PR价量派生金额预算，不用处置估值。PR确认/取消遇已确认未收回退款先完成或明确取消退款；实际退款后可取消PR但资金/AP已付不回退，显示来源取消待核对。
- 原正额payment_entry必须准确同AP。直付receipt=NULL必须唯一定位真实OUT/PAYMENT资金流水，核分录ID及原单号；汇款核销必须核准确receipt ID、type1、供应商ID、账户、汇款单号及真实资金流水。未分配预付、同名猜测、手工应付、无原单/缺账户/缺唯一流水保持人工核对。
- 每分配可退额=原正额分配−已收回−其他已确认占用；每PR同时按准确原价金额扣已收回/确认占用。正额分配总和=单头，且不超原应付paid，四位定点金额，共同锁后当前读预算。取消释放、执行改为已使用；不靠草稿预检承诺并发额度。
- 执行同conn落正额退款分配、AP paid减少/balance/status、账户正额IN/biz6、对账刷新、供应商往来正delta唯一退款来源、事件与原回执。原receipt.amount/settled/balance与正额原付款分录均不改；迁移241只对总额变化记往来，不能省略本域明确退款事件，也不能重复记账。
- `/api/supplier-refunds` 提供准确source、分页列表/详情、create/confirm/receive/cancel及本人持久结果核对。专用view/create/confirm/receive权限不默认授员工，确认继续原自批门；源读取保护采购/PR范围及资金查看权限。本人原结果查询不代发创建/执行，原写重试仍需原权限与范围。
- 新资金来源 `biz6 / SUPPLIER_REFUND_IN` 沿原资金流水ID与原voucher引擎：借1001/1002、贷2202，核已执行专用退款及金额/账户/方向/供应商/账套一致，脏来源fail-loud。原函数为 `buildFundVouchers`，可窄提取单笔投影，纳入原generateVouchers，不另建金额事实。新6按其准确账套过滤，不改变原1/2/3/5默认行为。
- 新6凭证生成与逐笔核对在业务提交后独立事务，失败如实“回款已登记、凭证待生成”；凭证重试不再写资金。新6本期缺失/陈旧/错误凭证在现closePeriod账套排他锁下拒结账，原closePeriod目前只有销售门不能称全来源门。原应付勾稽比较total_amount，不能直接把新2202退款贷方加旧总额白名单；另核净付款与实际paid。
- 本轮含专用闭期补录：默认409、不自动改日期；特权申请→他人审批→原申请身份/键/快照重核→同conn业务与补录痕迹→审批当期凭证与逐笔核对。扩原executor专用mode/资金来源CASE，不复用硬绑定客户退款kind。原补录自批硬拒绝保留。

进一步分批、schema278与金额/批准日期收窄见[专用供应商退款实施契约](2026-10-04-supplier-refund-implementation.md)，已通过独立静态规格计划门，全部F批仍待实施。仅新kind采用服务器首次批准日，旧kind当前执行日行为保留并明确差异；零分凭证投影仍核真实资金与来源，不改变四位现金/AP。

供应商退款执行锁序为账套/期间→当前执行人及角色授权→准确PO共享门→PR→退款头→收入账户→原receipt升序→对账单升序→AP→准确entry/分配当前预算；初步身份预读不作授权/执行依据，锁后漂移拒绝。这样与补录company排他锁后重放同向；不采用PR/退款头→company与补录相反的版本。非资金create/confirm/cancel先取公司S仅核身份及新增FK，不取期间门；本次actor、收入账户、receipt、AP/entry按序预锁后才插新头/分配。确认取消只改白名单状态/本次actor/自有预算，不重写来源FK，不随后调用期间闸门或凭证。收入账户停用/行仍在的软删阻止新建/确认/实际收到，但不能阻止未执行退款的合法取消释量；已收到仍不可取消。凭证/结账在company排他门后不反向锁PR/退款头，已执行新资金只能在该门之前提交后被稳定读取。

独立静态窄挑战已条件接受，实施必须补齐：

- 原补录执行器在replay前没有已经持有company X；新receive进入任何PO/PR/退款锁前，自行沿guard取得正常S/补录X，并共享原conn不嵌套begin/commit/rollback。补录申请创建/查找在业务事务前完成，不能持业务锁反等补录申请头。
- allocation含准确AP/PR与自己的budget_state（draft/reserved/received/released），同退款头在同conn转态；所有占量写/释放在共同AP门之后。预算当前锁读只锁allocation，不JOIN其他退款头/receipt/account，避免“本退款头→AP→另退款头”等反锁环。原receipt若需锁必须在statement/AP之前，历史分配及退款行不删、不级联清理。
- 写beginResourceOperationRequest在company门后。已成功原键可先独立只读核原回执及当前资源/范围返回，避免原期间后来关闭导致成功回执丢失；缺回执不能根据state3猜成功，长期原结果依赖本域持久身份和原响应。
- 业务日期固定原实际收回日，补录凭证日期必须与实际锁定验证的postingPeriod相符；覆盖等待跨月后“今天”变化，不验证旧月却落新月。
- 必要离线反例：同AP不同PR确认/执行/取消交错，预算不反锁另一头；普通/补录同源交错；预读后公司/日期/PO/PR/账户漂移；补录跨月等待；同键等待后重放；公司锁等待后的新退款来源可见；另一账套新6排除，本域坏来源fail-loud。真实数据库锁与并发仍未验证。

## 验证边界

当前基线为 `14e97aa9dc9df0700b394d59cafbc53dba0c5e69`，三端版本0.12.0。此前续批最终离线结果保留在[续批记录](2026-10-04-go-live-continuation-execution.md)，只覆盖当时源码；本计划改动须另验。

本轮不连接数据库/生产、不启动应用/浏览器、不执行真实业务测试，不提交、推送、合并、部署或执行迁移。离线结果只能说明对应纯代码/组件/适配器契约；不能证明MySQL并发、数据库金额、真实实物或资金结果。

## 执行记录

- 新授权下已复核工作树、分支、未提交改动和最大迁移编号。原成果与主工作区均保留。
- 采购退货、供应商退款及来源解除的静态技术审计已完成；必要前提分别落实到本计划和两个详细实施契约。上架原PO→库存→PR与解除WT→SO方向均纳入窄接点，不声称数据库死锁或超退已复现。
- E0增量仅3行nav和主题小节，排序70/80/90接在既有系统末尾65之后。独立规格Accept后独立质量Accept，未发现新增Critical/Important/Minor，指定文件diff检查通过；没有套件、DB或GUI结果。增量记录 `/tmp/go-live-e0-increment.diff`。
- E6政策确定文档完成独立规格Accept后独立质量Accept，必要代码依据与diff检查通过；没有现场、数据库或业务测试结果。真实负责人、切点未结单和首月对账仍需现场执行，文档完成不代表已经切换。
- 2026-10-05 E1实现已冻结：精确26文件增量`/tmp/go-live-e1-increment.diff`，作者窄离线后端25/25、前端2/2自然exit0/audit0；独立规格已Accept且再次取得25/25+2/2、前端worker1/audit0，质量门待完成。RC/member反向断言3失败已还原，旧准确ID缺可选单号合法性与取消处理中提示分别有先红后绿证据。详情和隔离验收边界见主题验证文档；尚未统一全批检查，不称E1真实MySQL或现场通过。
- E1首轮质量门暂不Accept：共享退货helper的普通identity快照无行不能直接当作当前账款不存在。普通销售退货调用链不具备PR的准确PO门；仅该空身份分支补同conn当前存在探测，发现账款则409回滚而不反追statement，确实无账款仍原null。已交单一作者窄修与两个离线反例；此为静态源码缺口，没有真实MySQL竞态复现。H批暂等修后规格、质量复核。
- E1空identity窄修完成后独立Spec Accept→Quality Accept，先红/撤修反向均2失败25通过，恢复后27/27自然exit0/signalnull/audit0，独立规格复跑同结果。FE原2/2未受仅后端修补影响，未重复；精准修补`/tmp/go-live-e1-quality-fix.diff`、5文件及整体26文件均diff检查通过。未执行全批lint/type/build、DB、应用/GUI；H1来源基础现在开始，H2–H6仍待对应批次。
- E4/F1–F6详细退款契约已独立Plan Spec Accept→Plan Quality Accept，无新增Critical/Important；可以有限分批实施，全部F代码仍未实现。主账套1、原付款分配不变、新6资金与凭证、批准日补录及当前申请人授权均保留静态前提，不能写成真实资金或MySQL通过。
- H1来源基础作者冻结15文件，新24+原报废邻接12共36/36自然exit0/signalnull/audit0，固定`/tmp/go-live-h1-final-green.*`。首轮规格发现277三个目标头复用外键symbol会撞名；稳定全库唯一名称及对应元数据核对已窄修，修后独立Spec Accept，新增守卫后的37/37自然exit0/signalnull/audit0。原撞名和错误元数据所属表两个反向改动均各导致1失败，已恢复。
- H1首轮质量门暂不Accept：CHECK元数据核对删除所有括号，可能将弱化的AND/OR约束视为一致。先修成保留语义的有限MySQL8打印形式核对，并补真实迁移表达式的弱约束反例，再重复规格→质量。外键静态守卫不证明实际DDL已运行；277始终未执行，H2–H6/F仍待实施。
- CHECK窄修冻结4文件，12项改为保留全部语义的BINARY精确打印形式核对；两弱式先红49通过/2失败，撤回生产修补反向37通过/14失败，finally还原51/51自然exit0/signalnull/audit0。独立修后Spec Accept并取得同51/51结果，质量复核待完成。精准`/tmp/go-live-h1-check-fix.diff`及整体增量反向apply检查通过；此处依官方打印源码推导与实际SET条件有限模型，未执行MySQL/DDL。
- H1修后质量门已Accept，无新增Critical/Important；来源基础本地完成，仅H1打勾。H2原目标创建现在开始，H3–H6及全部F仍待实施，E2/E3父任务未完成。没有真实迁移/数据库/全批检查/现场结论。
- 供应商退款的原来源只读核对确认：现有付款分配和本金流水没有减量/撤销/删除接口，旧付款及采购重算也不按原分配SUM覆盖当前paid。保留原写链；278新增allocation不得在AP之后因原FAT外键父校验隐式反锁。准确ID/冻结快照及服务证据核对与预算门分别保留，实际锁行为待隔离验证。
- F1新增FK/INSERT时序完成独立Plan Spec Accept→Quality Accept，取消账户状态误伤的Important已窄澄清并重新双门接受。supplier/warehouse等派生快照不增直连FK/主档锁，原OUT不FK，自有新IN可FK；现有父门与预算后才插RF头/分配，pending资源FK为空。该记录仅使后续F1可执行，全部F仍未实现，未执行278或真实资金测试。
- H2原创建接点作者已冻结精准24路径`/tmp/go-live-h2-increment.diff`，六文件108/108自然exit0/signalnull/audit0；根已读固定绿/反向证据和增量，reverse apply --check为0。首红15失败中1原schema头缺失为夹具错误，仅14计业务反例；顺序窄红105/3后移动一次当前基础预算到generic之前，领域/预算/合法POST/编辑生产撤修分别4/1/1/1失败，finally还原最终108绿。新增查询按准确ID模拟绑定、CAS及事件事务状态，仍仅SQL边界模型。独立规格审阅正在进行，未勾H2；H3–H6/F/E7及真实迁移/DB/GUI尚未执行。
- H2随后独立Spec Accept→Quality Accept，规格审阅禁网复跑六文件108/108自然0/signalnull/audit0，质量只读核增量/固定证据未新增Critical/Important。仅H2子项打勾，E2/E3父项仍未完成。开始H3行/仓身份保护及linked实发当前取数；全集实物进度与终结解除的事实读取在H4共用实现，H4–H6/F/E7、DDL/真实MySQL/现场仍待验。
- H4共享事实/解除身份窄契约已独立Plan Spec Accept→Plan Quality Accept：同conn批量provider、目标权限与完整范围、无WT的E0强证明、link绑定操作与固定DTO、双CAS及版本1冻结证据保持原数量事实，不改277。仅计划接受；H3仍在实现，H4–H6/F/E7和真实数据库验证尚未完成。
- H3作者冻结13路径，定向72/72自然0/signalnull/audit0；独立规格复跑同结果但发现一项Important Missing：派发只核筛后的已占未发行，未证明全单唯一冻结行。作者正在补真实SQL谓词过滤的额外零预占/全派发行反例及linked新操作的全行当前核对，原无marker和ACK路径保留；未勾H3，也未进入H4。证据仍限离线模型，绿例不能代替缺口覆盖。
- H3派发六路径窄修关闭原Important并取得Spec Accept：linked新派发先当前全SOI核固定sole/A，再原eligible SQL；NULL marker、原ACK、合法已全派发原400保留。修前和仅撤fullrow守卫反向均75项72绿3红，finally恢复作者及独立规格均75/75自然0/signalnull/audit0，精准整体13和fix6份reverse apply --check均0。质量门正在进行，未勾H3；H4以后与真实数据库仍未验。
- H3随后Quality Accept，无剩余Critical/Important，质量只读核真实链/固定75绿及反向证据，并独立核两份reverse apply和diff。H3子项已勾，本地完成行/仓保护与锁后实际出库取数；E2父项未完成。现在实施H4共享实际E/终结归还证据、单向解除及退货ready新操作状态门；H5/H6/F/E7和真实MySQL/DDL/应用/现场仍待后续。

- H4首红已保留固定 `/tmp/go-live-h4-red.log` 与 `.result.json`：六文件128项107通过21业务断言失败，自然exit1/signalnull/audit0，无未知SQL/import或夹具setup失败；15项原来源进度缺失与6项两类退货ready新键错误终态行为形成实施反例。真实packages表、声明列投影及实例级回执夹具已核，当前实施共享facts/proof/解除窄接点；初始红例不等于真实业务问题复现或修复完成。

- H5完整签认预览、canonical整头全行指纹、历史父存在性及固定多来源ACK窄接点完成Plan Spec Accept→Plan Quality Accept；不JOIN主档漏行、不改原批准/updated_at，后续目标重新核当前主档。该记录仅允许后续H5有限实施；H4仍在写，H5/F代码与实际DDL/并发均未完成。

- H4 PR完成规则依据实际全行出库调用链窄澄清并完成Plan Spec Accept→Quality Accept：仅头3当前准确PRI/A、全集E=A及终结实物闭合可完成冻结R0，不恢复额度；头4才释放未执行量。正常无WT待执行E0读取与解除强证明分开，源进度避免将正常计划误标异常。H4仍在实现，这不是数据库或完整H4验收。

- H4作者冻结21路径 `/tmp/go-live-h4-increment.diff`，根已核精准reverse apply和tracked diffcheck均0。固定最终七文件183/183自然0/signalnull/audit0；有效生产撤修183项163绿20业务红且4文件finally字节恢复，首次旧邻接9setup已单列并修纯夹具不计业务。callerconn共享E/终結/归还、source→PO→target→link单向CAS解除、原最小ACK及terminal return-ready门已交独立Spec；尚未勾H4，H5/H6/F/E7及真实DB/DDL/应用/现场未验。

账务/并行职责已按推荐规则形成[确定方案](2026-10-04-go-live-accounting-parallel-policy.md)，待与其余批次共同审阅。采用完整基础账务、存货报废证据核实后人工凭证；自动报废凭证不属于本轮扩展。特殊分机电话未有真实格式样例，保持已完成一般规则；重复开单已完成最小二级入口，不因未有频率资料扩建常购后台或自动置顶。

- H6原表单/独立草稿/持久完整体/本人核对有限接点已独立Plan Spec Accept→Plan Quality Accept，仅方案允许实施；H6代码未编写。H4首轮Code Spec发现两处Important：SO4零实发证据矛盾和legacy转换回执身份未完整校验。七文件183/183离线绿色不能覆盖该静态缺口，已交作者窄修并保持H4未完成，质量门及H5/F/E7均未提前开始。

- H4两Important窄修已冻结11路径，整体仍21路径；首红及生产撤修反向均215项183绿32业务断言红，finally两生产文件字节精确恢复，修后215/215自然exit0/signalnull/audit0。根核两个精准补丁reverse apply及tracked diff均0；独立Code Spec复验进行中，尚未进入Code Quality或勾完成。F1取消来源资格与非现金事件的两段澄清已独立Plan Spec Accept→Plan Quality Accept，仅方案完成，退款实现仍待后续批次。

- H4窄修后独立Code Spec Accept，两Important关闭，受影响邻接未发现Missing/Extra；独立再取215/215自然exit0/signalnull/audit0，固定 /tmp/go-live-h4-spec-fix-independent.*。现在进入独立Code Quality，未把规格门写成全批完成，H5尚未开始。

- H4质量审查发现一个剩余Important：PR4夹带WT7实发及PR任务同时有销售指针的脏组合被provider当闭合。实际cancelPR/ship明确拒绝此两组合，应有限补PR4 E0及PR任务sale_order_id显式NULL门，provider与冻结证据共用，不能按不合法部分取消释放预算。这是严格离线模型发现，未复现真实数据库/GUI；H4仍保持未完成。

- H4采购退货边界质量门正式未Accept，确认一个Important；固定两真实service/helper反例 /tmp/go-live-h4-quality-pr-probe.* 为0/2自然code1/signalnull/guard audit0，无运行中进程。这是异常历史模型而非真实数据库复现。作者已补15新业务反例，首红230项215绿15业务红/audit0；恢复检查另9项只读commit计数夹具红单列，正修计数不削pending/E/回滚断言，仍待最终冻结及Spec→Quality复验。

- H4第二轮质量窄修冻结7路径（整体21路径刷新），仅facts.evaluate新增PR任务显式NULL销售归属和PR4 E0门，provider/frozen共用。最终同文本反向230项215绿15业务红，finally生产文件精确还原；最终230/230自然exit0/signalnull/audit0。9只读commit计数夹具红独立存档，不算生产/反向业务。根两补丁reverse apply和tracked diff均0；原规格复验进行中，随后原质量复核，H4尚未勾完成。

- H4第二轮窄修后独立Code Spec Accept→Code Quality Accept，无剩余Critical/Important；最终230/230自然exit0/signalnull/audit0，撤PR两guard同最终文本215绿15业务红及finally精确还原。根补丁/差异核对通过。E2后端H1–H4仅本地完成，来源与旧单员工UI仍E5/H6；H5整单签认开始，E3/E4/E5/E7不提前勾完成。

- H5完整旧单签认开始：根静读新conversion strict VM白名单/精确SQL及事务夹具后注册h5-backend（新conversion+H4七文件），未加载真实config/app。首红268项230邻接绿38新增缺能力断言红，自然code1/signalnull/audit0，无import/SQL/setup；这证明接口/serializer/无intent本人转换查询尚缺，不把先缺sign方法的rollback测试称真实事务缺陷。真实执行/失败边界将由实施后严格实际函数和反向补证，E3仍未完成。

- H5作者冻结16路径 `/tmp/go-live-h5-increment.diff`，根核精准reverse apply和tracked diff均0。最终八文件277/277自然exit0/signalnull/audit0，单撤自批、实物痕迹和已转换执行三门后273绿4业务红，finally两生产文件字节精确恢复。五项VM跨realm参数夹具误报单列，不计生产缺陷；完整预览、整单原子签认与固定永久ACK正在独立Code Spec审查，E3尚未勾完成。真实277、MySQL、应用与现场仍未验。

- H5独立Code Spec Accept→Code Quality Accept，无Missing/Extra或剩余Critical/Important；独立277/277自然exit0/signalnull/audit0，固定 `/tmp/go-live-h5-independent-spec.*`。根及质量核精准增量、永久协议、纯3实际执行防重和反向/恢复证据，E3后端本地完成。H6员工页面与恢复开始，F1–F6及E7仍未完成；277未执行、真实MySQL/GUI/现场仍待验。

- H6五份新增前端定向测试已静读依赖/严格adapter、根注册h6-frontend，尚无本批通过结论。F2原余额重算的同账户全流水锁限定已独立Plan Spec Accept→Plan Quality Accept；先取得准确收入账户X后保留原当前重算，不追锁其他来源账户/OUT。F代码仍未开始，该限定不代表真实数据库无死锁。

- H6首红固定 `/tmp/go-live-h6-red.*`：五文件14/14能力断言失败，自然exit1/signalnull、workerGuards5、audit0，无未知API/import/setup。涵盖初始持久库/hook占位能力缺失、真实原页面缺处理入口/非法来源参数降为空白和工作区身份碰撞；此证据不等同最终生产守卫的撤修反例。完整原表单、恢复和边界测试仍在实施，H6/E5未完成。


- 2026-10-05 H6作者已冻结42路径（15新增、27修改），精准 `/tmp/go-live-h6-increment.diff`，handoff/manifest/before齐。恢复后五文件51/51及受影响邻接三文件35/35均自然exit0/signalnull，worker5/3、audit0；最终production撤三门51项48绿3业务红，finally三生产文件按原字节恢复且根现场SHA复核一致。根核reverse apply及tracked diffcheck均0；首红占位能力与setup/fixture已分列，旧neighbor不充新strict恢复证明。现在独立Code Spec审阅中，H6/E5尚未完成；F1–F6/E7、真实存储/GUI/277/MySQL/现场仍未验。


- 2026-10-05 H6首轮独立Code Spec未Accept，集中三项Important：错误模型销售退货忽略handling参数降空白单、销售/来源报废canonical删空sourceNo/sourceType导致mixed变合法、确认持久后清理前缺owner复核。独立五文件51/51自然exit0/signalnull/5guards/audit0仅证明原覆盖，不能关闭这三项静态Missing；固定 `/tmp/go-live-h6-independent-spec.*`。原单一作者开始窄修及真实负例，H6/E5不勾，Quality/F/E7未提前开始；无GUI/DB结论。

- 2026-10-05 H6三Important作者窄补已冻结：整体44路径（15新增）、修补9路径，根核两精确reverse apply和tracked diffcheck均0、44/9当前SHA与3恢复SHA全部一致。五文件最终63/63、四邻接80/80 natural0/signalnull、guard5/4/audit0；撤三生产门同最终63项51绿12业务红，finally字节恢复。既有sourceHandoff缺纯mock订阅导出0test为SETUP，单列修夹具不充业务反证。原独立Spec复验中，H6/E5不勾完成，Quality/F/E7不提前；真实GUI/存储故障/数据库/277/现场仍未验。

- 2026-10-05 H6窄修后独立Code Spec Accept，原三Important关闭，未发现新Missing/Extra；独立五文件63/63 naturalexit0/signalnull/5guards/audit0，固定 `/tmp/go-live-h6-spec-fix-independent.*`。现在独立Code Quality审阅44路径整体及9路径修补，尚未勾H6/E5，不进入F；只限源码/离线组件，GUI/真实存储/MySQL/现场未验。

- 2026-10-05 H6首轮Code Quality未Accept：一个Important，来源对外isCurrent未绑定读取活动代次，隐藏→恢复会使旧报价/原PO/数量策略guard重新true，旧慢响应可回填。现63/80绿色不覆盖该active ABA；此为真实调用链静态确认，未运行新探针。单一作者开始现strict adapter真实负例及H6 opt-in窄活动generation修补，普通默认调用、原草稿/键不改；H6/E5继续未完成，F/E7不提前。

- 2026-10-05 F3已收到来源与正常后续业务限定经独立双计划门接受：不重跑新交易准入，核不可变收到事实与全部消费封顶，收入账户收到时type快照保证后续编辑不改变历史腿/hash。F1–F6仍代码未开始，278仍待source；H6质量读取代次修补中，真实财务与数据库未验。

- H6活动代次质量修补首红已固定：真实五文件68项63绿5业务红（报价成功/错误、PO成功/错误、数量策略），四邻接81项80绿1业务红（R9同钩子晚报价）；naturalexit1/signalnull、guard5/4/audit0，无unknown/import/setup红。固定 `/tmp/go-live-h6-quality-fix-red.*` 与 `-neighbors-red.*`。真实页保持实例隐藏→恢复后旧99报价、旧PO/错误或数量策略被接受，员工原量/原单号及fresh读取断言保留。作者开始11路径窄修；H6仍未完成，不把源码模型当GUI复现。

- H6活动ABA窄修作者DONE/STOP，整体45路径（15新）、本轮11路径已冻结，root核两reverse apply0、45/11当前SHA一致、tracked diff0和4恢复SHA一致。最终五文件68/68与四邻接81/81 natural0/signalnull/guard5/4/audit0；联合仅撤本轮4门分别63绿5业务红/80绿1业务红，finally精确恢复，明确不是四门逐个独立mutation。67/68的PO共享reads二次deferred夹具失败已单列，起点固定后最终红/绿同文本，不能算生产反证。固定 `/tmp/go-live-h6-quality-fix-final-green.*`、`-neighbors-final-green.*`、`-final-reverse*`。原Spec独立复验中，H6/E5继续未勾；F/E7未提前，真实GUI/存储/MySQL未验。

- H6活动ABA窄修后独立Code Spec Accept，无新增Missing/Extra，45/11 SHA未漂移；独立五文件68/68与四邻接81/81 naturalexit0/signalnull/guards5/4/audit0，固定 `/tmp/go-live-h6-quality-fix-independent.*` 与 `-independent-neighbors.*`。原1Important已在规格门关闭、普通默认与R9同族/原3Spec修保留；现在原独立Quality复验，H6/E5仍不勾，不提前F。证据仍不代表真实GUI/存储/数据库。

- H6独立Code Spec→Quality均Accept，所有已发现Important关闭，45/11精确冻结与最终68/81自然0/audit0证据接受；H6子项勾选，E5父项保留未完成（退款页面/恢复尚未实现）。现在唯一作者开始F1：278三表、准确原付款/预算/当前授权、非现金create/confirm/cancel/永久回执及PR reserved退款门。F1测试导入先根静审注册，仅本地源码与严格VM，不执行278/连接数据库/启动应用。F2–F6/E7未提前。

- F5/F6改为一个有限前端安全交付批（独立双计划门接受）：实际页面/审批与持久完整请求恢复直接依赖，同一作者一并完成并核两套验收后共同代码Spec→Quality、同勾；不先交仅内存阻断POST页面。F1–F4仍逐批双门，业务/权限/数据与未知重试规则不扩，E7/数据库/现场仍另验。当前F1基础开始，F2后未实施。

- F1准确权限目录载体已订正：现有BE/FE常量与前端PERMISSION_GROUPS，042/roles.service的sys_role_permissions是实际授权、没有独立sys_permissions表；278不插授权或造目录，仅说明新四码。actor sys_roles仅行存在，不查询不存在的active/deleted列。静态核对，不是数据库验收。

- 2026-10-05 F1严格离线初始四测试已由根逐字静读闭包并登记，固定 `/tmp/go-live-f1-red.*` 为38项0绿38红，自然code1/signalnull/audit0。36项为新域、接口或278缺能力，实际confirmPR/cancelPR两项为既有链未拦reserved RF的业务断言；缺能力不算事务或SQL已验证。首次fixture语法造成的3导入失败与2能力失败另存first-red，不计产品反证。单一作者开始F1，F2–F6/E7仍待实施，278尚未执行、数据库/资金/GUI未验。

- F1初步73/73与两既有邻接41/41离线绿仅为能力/边界覆盖，仍在有限反证和冻结。根进一步静核实际直付与汇款两独立ID序列，确认合法同ID/不同准确原单号不能一律拒绝；现三元组来源契约待窄双计划门，旧仅追加FAT的collision负例不当作正常双路径或数据污染证明。141原biz_no30上限已要求F1保全UUID稳定短号，未改旧FAT/迁移/真实数据。

- F1原付款三元组澄清现已独立Plan Spec→Quality Accept，无新增Missing/Extra/Critical/Important。作者正在用完整entry/receipt两parent合法同ID正例先红过严predicate，再按唯一准确(2,id,no)修复；相同三元组重复和坏来源仍拒。RF号真实修为27字完整UUID编码、278源列30，与原FAT长度一致。先前反向75项50绿25业务红、五文件finally字节恢复只是该时点有限门证明，最终碰撞修后须刷新与冻结，F1/F2–6/E7未提前完成。

- F1作者DONE/STOP并冻结30路径（14新增/16修改），精准 `/tmp/go-live-f1-increment.diff`，根核30当前SHA、reverse apply和tracked diffcheck通过。最终四专项77/77、两邻接41/41自然0/signalnull/audit0；联合五生产门撤修77项52绿25业务红、finally五文件原字节/SHA恢复。完整双parent来源初红与2事件夹具SETUP分别列，单撤exact bizNo匹配76项74绿2业务红也是有限联合反证，旧错误collision假设已撤销。现在独立Code Spec审阅，F1未勾、Quality/F2未提前；278/真实数据库/资金/GUI未验。

- F1独立Code Spec Accept，无Missing/Extra，独立禁网四专项77/77与两邻接41/41 natural0/signalnull/audit0，30路径SHA无漂移，固定 `/tmp/go-live-f1-independent-spec.*` 与 `-neighbors.*`。核准原可退量不以POI下单量重解释，F1不提前承担F2完整对账刷新。现进入独立Code Quality，F1未勾、F2仍未开始；真实278/MySQL/金额/GUI仍未验。

- F1独立Code Spec→Quality均Accept，无剩余Missing/Extra/Critical/Important；已核30冻结路径、77/41独立自然0/audit0及最后五文件精确恢复。F1子项勾选，仅本地完成非现金基础。现在唯一作者开始F2真实IN/AP/对账/往来/事件/固定ACK同conn接点，不负付款或改原分配；F3–F6/E7、真实278/MySQL/资金/现场待验。

- F2新严格VM receive专项与helper已逐字静读完整依赖并登记唯一f2-backend，真实fund/balance/recon/events/period函数均精确边界stub而无DB/auth/logger/config真实加载。固定首红 `/tmp/go-live-f2-red.*` 34/34缺receive/inner能力断言，自然1/signalnull/audit0，无SETUP；不称34交易守卫已反向证明。原F1准备真实create/confirm通过，新实际回款仍在实现。对账精确金额仅F2 opt-in窄接点待Plan双门；F3后续未提前。

- F2原对账刷新精确金额opt-in窄契约已独立Plan Spec→Quality Accept，只本域currentRead+exactMoney用BigInt及四位文本，保原min/max、draft、total>0和其他default/E1/旧DTO。唯一作者继续实际receive；借用locator由服务器锁定snapshot提供，firstordinary在company及RFX后。计划门不是代码/MySQL证明，F2仍未勾。

- F2作者DONE/STOP，21路径（5新增/16修改）冻结于 `/tmp/go-live-f2-increment.diff`。根核全21当前SHA、四恢复SHA、精准reverse apply与diffcheck均通过；最终专项51/51与六文件邻接118/118 natural0/signalnull/audit0，联合四文件10条件撤修35绿16业务红、0setup并finally精确恢复。初34缺能力、两成员浮点表示合同和1000合法金额成员真实刷新1u偏差分别分类。原精确成功借用ACK撤权/闭期分支已补，当前独立Code Spec审阅；F2不提前勾，F3–F6/E7、278/MySQL/实际资金/GUI仍待验。

- F2独立Code Spec Accept，无Missing/Extra；独立专项51/51及六邻接118/118 natural0/signalnull/audit0、21当前SHA未漂移，固定 `/tmp/go-live-f2-independent-spec.*` 与 `-neighbors.*`。现进入独立Code Quality，F2尚未勾、F3未提前实施；真实MySQL/资金/278/GUI仍待验。

- F2独立Code Spec→Quality均Accept，无Missing/Extra/Critical/Important；质量核实际原触发器、锁序/资金与原回执、21冻结SHA及固定离线证据，无重复跑套件。仅F2子项勾选，E4父项仍未完成；现在单一作者执行F3单笔/批量凭证共源、结账门、净paid及四位/分位可见性。F4–F6/E7和实际278/MySQL/银行/GUI/现场仍待验。

- F3首组真实模块VM及两个实际页面strict Axios测试已经根完整静读闭包并登记；初夹具固定4元和事务写错committed已在首红前改为准确RF amount与同conn state。固定 `/tmp/go-live-f3-backend-red.*` 31/31缺能力断言红，natural1/null/audit0，不称31业务链已被证明；FE首次URL/flush setup另列，纠正后 `/tmp/go-live-f3-frontend-red.*` 3项1绿2业务红（流水四位被两位显示吞、勾稽未消费新DTO），natural1/null/2guards/audit0/unknown0。现在实施F3，F4–F6/E7未提前，实际资金/凭证/SQL/数据库仍未验。

- F3中间定向45/45、两实际页面3/3及七文件邻接169/169自然0/null/audit0（FE两个guard已加载），仅当前作者绿，未冻结或独立Accept。真实默认提交后边界、原批量生成、原结账调用和净已付消费者已覆盖；结账company门后坏源仅为离线查询顺序模拟，不代表MySQL等待后可见性已验证。汇款型正例在实际F1创建前准备完整80已核销来源，收到后另AP核销20，不重写历史快照；两轮夹具计数/异步flush问题单列SETUP。继续补有限字段/回调反例与生产撤修、文档和冻结，F3不提前勾选。

- F3补充反例检出逐AP差额相消及已有有效凭证闭期后重核被降pending两个真实行为缺口。净已付已改为总额展示并保逐AP不一致标记；闭期证明固定 `/tmp/go-live-f3-closed-proof-red.*` 53项52绿1业务红，natural1/null/audit0，正沿“先证明有效既有凭证，仅明确缺失/陈旧再原upsert并证明”的有限修正收口，人工冲销不复活。新夹具错误保存注入时点属SETUP分列，不将这些证据写为数据库通过；F3仍未冻结/独立接受。

- F3作者DONE/STOP并冻结28路径（6新/22改）；根核全部before/current/frozen SHA、四finally恢复SHA、精确reverse apply与tracked diffcheck一致/0。最终BE56/56、FE两文件8/8、七邻接169/169自然0/null/audit0；同最终文本联合四文件九条件撤修47绿9业务红/56及6绿2业务红/8、0SETUP，finally精确恢复，不称九门逐个独立反证。可选收到reason合法完整canonical首红56项55绿1业务红已修，初能力/夹具SETUP与各中间版本分列。现在独立Code Spec审阅，F3未勾，F4–F6/E7未提前；真实MySQL、凭证、资金、278和GUI仍未验。

- F3独立Code Spec未Accept：1个Important，完整凭证分录证明遗漏aux_type，供应商腿真实类型1被改0而其余/hash保持仍可能放行。根核实际builder/insertEntries/类型语义认可本域最小补验，旧hash保持；作者仅修此门及实际proof/postcommit/closePeriod负例，不重复无关FE/邻接/九门。独立56/8/169自然0/null/audit0与28SHA一致只代表现覆盖，不能关闭该静态缺口。F3不勾，Quality/F4仍未提前；无额外探针或数据库结论。

- F3辅助类型1Important窄修作者DONE/STOP，5路径fix与整体28路径冻结刷新；根核28/5全部before/current/frozen SHA、两精准reverse apply和tracked diff均一致/0。六实际consumer反例首红及单builder辅助类型撤门同62文本56绿6业务红、0SETUP，finally字节/SHA恢复，最终62/62自然0/null/audit0。FE8/邻接169字节未变保已有独立证据，旧九门反证仅原56版本；不重复无关整套。原Spec复验中，F3未勾、Quality/F4仍不提前，真实数据库/资金/278/GUI未验。

- F3辅助类型窄修后独立Code Spec Accept，原1Important关闭、无Missing/Extra；独立62/62自然0/null/audit0，固定`/tmp/go-live-f3-spec-fix-independent.*`，整体28及fix5 SHA一致。FE8/169未变化保前轮独立证据，不重复未受影响检查；现在独立Code Quality审阅完整F3调用链，F3仍未勾、F4不提前。所有接受仍只源码/离线模型，真实会计/资金/SQL/迁移/GUI未验。

- F3首轮独立Code Quality未Accept：1个Important，RF结果保存写voucher_generated_at但实际278只有voucher_id与voucher_generate_error VARCHAR(500)。strict fixture自行生时间属性掩盖真实SQL列不匹配，原62/8/169绿不能证明落库。根核schema与实际SQL认可现字段最小修，作者补按278有限列/长度模型及真实generated/notRequired/pending保存反例；不加迁移、不改278、不重复未受影响FE/邻接，修后重新Spec→Quality。F3不勾、F4仍不提前，实际MySQL/资金/GUI仍未验。

- F3真实RF结果列质量窄修作者DONE/STOP，6路径fix与整体28刷新；根核28/6 before/current/frozen SHA、两reverse apply、tracked diff、单accounting恢复SHA一致/0。改为278既有voucher_id/error≤500，严格模型纯文本对照32列，generated/zero/pending及真实controller→detail/list覆盖。正式首红66项48绿18业务红/0SETUP；分别撤结果列名18红、撤500宽度1红，finally精确恢复；最终66/66自然0/null/audit0。初6夹具SETUP和旧反向版本分列，不重跑未受影响FE8/169；原Spec复验中，F3未勾、F4不提前，278未改未执行、真实DB/资金/GUI仍待验。

- F3 RF schema修后原Spec复验后端已关闭且独立66/66自然0/null/audit0；发现1个直接前端Missing：实际financeAPI/资金追溯页仍用不存在RF时间字段判断，真实voucher_id正ID/errorNULL误显示待核对。原FE只有zero例、代码未变不等于不受DTO影响；作者窄补原F3三FE消费者及合法generated真实adapter正例，既有权限/身份/晚响应门保持，不留F5。F3仍不勾、Quality/F4不提前，实际DB/GUI待验。


- F3真实前端schema消费者窄修作者DONE/STOP，6路径fix与整体28已冻结；根核两套before/current/frozenSHA、精确reverse apply、tracked diff及单页面finally恢复均一致/0。实际资金页以voucher_id正安全ID/errorNULL展示已保存生成结果，zero/pending保持实际结果文本，无RF虚构时间。两实际页面10/10自然0/null/2guards/audit0；首红及单runtime展示门撤修均9绿1业务红/0SETUP，finally精确恢复。后端66/邻接169未变保已固定证据，旧FE8不冒充新generated消费证明。原Spec复验中，F3未勾、Quality/F4不提前；真实DB/GUI/资金及E7待验。


- F3实际资金页字段修后原Code Spec Accept，前端Missing关闭、无新增Missing/Extra；独立真实两页10/10自然0/null/2guards/audit0，固定`/tmp/go-live-f3-frontend-schema-fix-independent.*`，28+6 SHA一致、其余22未变。现原Code Quality完整复验实际schema/来源证明及前端消费者；F3仍未勾、F4不提前，数据库/实际资金/GUI待验。


- F3独立Code Spec→Quality最终均Accept，aux类型、RF实际schema及FE消费者发现项已关闭，无剩余Missing/Extra/Critical/Important。28路径冻结SHA一致，独立BE66/66、FE10/10自然0/null/audit0（FE2guards），未变邻接169保固定证据；修前反证各守其版本。F3子项勾选，E4/E5父项仍未完成；现在唯一作者开始F4专用跨期补录，沿首次服务器批准日/完整原申请身份/同conn业务与执行痕迹/提交后单笔证明。F5/F6/E7、实际278/MySQL/资金/凭证/GUI仍待验。


- E7前置有限schema静核只读完成：276资料容量、277四表与历史199转换真实字段、278三表14/32/11列及实际F1–F3读写/FK身份核对未发现新增不匹配阻碍。真实RF结果仅voucher_id/error500已对齐。严格夹具仍只是有限SQL/SET模型，不代MySQL类型、NULL、CHECK/FK与DDL执行；未测试或执行迁移，F4–F6未纳入此次预核，E7不勾。


- F4实际模块严格VM专项/helper与shared fixture的prepareOnly/refundDate有限选项已根完整静读并登记。固定`/tmp/go-live-f4-red-confirmed.*`31项1绿30红，natural1/null/audit0：4个原guard批准日期/业务期重开逻辑反例，26个新域缺能力断言，无unknown或SETUP；不称26交易守卫已被反证。初31项3绿28红中两个能力断言被assert.rejects包住的夹具假绿另列，修夹具后取confirmed。唯一作者开始F4，不连接DB/迁移/实际业务，F5/F6/E7未提前。


- F4冻结前已沿实际链收窄申请锁序与身份：来源/当前授权准备释放公司/user锁后才申请INSERT，执行申请X→companyX；批准期关闭在任何PO之前拒，合法已执行原ACK另只读核。actualcreator20/applicant9/approver10正例、完整HTTP补录reason复用、当前RECEIVE先于PO及批准RF snapshot在资金写前核均补离线反例。新kind全部申请FAT唯一/准确绑定、readonly inspect的零分完整source及实际BFcontroller文案闭合；原F3无申请override从假合法正例改成准确非法负例、F4实际执行补合法override。现作者50/50与早期235邻接仅中间证据，最终反向/恢复/冻结和独立Spec→Quality未完成，F4不勾、F5/F6/E7不提前。

- F4作者DONE/STOP，精确24路径冻结；根逐一核before/current/工作树SHA及三组finally恢复六生产文件SHA全部一致，精确reverse apply --check和tracked diff --check均0。固定最终51/51与八文件235/235自然code0/signalnull/audit0。相同最终51文本的有限联合撤修26绿25业务红、身份组46绿5业务红、结果组47绿4业务红，均无SETUP并精确恢复，不称每个条件已独立反证。先前能力红、同义断言及夹具SETUP单列于作者交接；模型容量中断只影响冻结收尾，恢复后证据已固定。当前独立Code Spec审阅，F4仍未勾、F5/F6/E7未提前；真实SQL/期间/资金/会计/迁移/GUI未验。

- F4独立规格静核检出一个Important共享来源缺口：settle/inspect核全部申请FAT唯一，但F3共用loadSources只取biz6，已执行申请回放只按ACK资金ID读取；两路径均可遗漏同申请额外异类型流水。根核实际调用链认可，审查在缺口处停止，本轮尚未取得独立测试或Code Accept。原作者只补批量全部申请流水与已执行准确唯一绑定、真实consumer负例；旧51/235绿色保其覆盖范围，F4仍不勾，F5/F6/E7不提前。

- F4共享来源窄修作者DONE/STOP，9路径及整体24精确冻结；根核before/current/工作树SHA、两reverse apply检查和两生产finally恢复SHA一致/0。最终66/66、八邻接235/235自然0/null/audit0；联合仅撤两个新增unique门，同最终66文本58绿8业务红并恢复。正式clean-red9项为8业务旁路与1缺批量读取能力；首红四错误码预期及跨VM比较39项夹具SETUP另列，主资金字段原已有拒绝不冒充新缺陷。原Spec复验中，F4不勾、Quality/F5/F6/E7未提前；此前51项三组反证仅属于修前版本，真实MySQL/资金/会计/GUI仍未验。

- F4新独立Code Spec Accept，原共享来源Important关闭，无新Missing/Extra；实际全24调用链及真实258/260/278字段已核，24+9冻结SHA无漂移。独立专项66/66、八邻接235/235自然0/null/audit0，固定`/tmp/go-live-f4-fresh-spec-independent.*`和`-independent-neighbors.*`，根已读结果。当前进入独立Code Quality，F4仍不勾、F5/F6/E7不提前；证据只限源码/离线模型，真实数据库/资金会计/迁移/GUI未验。

- F4首轮质量审查因模型额度中断，替代独立审查完成并给Code Quality No：一个Important。新增settleVouchersFor种类SELECT在try外，execute业务提交后查询失败会抛出，scheduler本域分支也会中断后续申请。根核实际494/664/731链确认，只交唯一作者修后提交pending与逐笔重试隔离；原66/235证据保覆盖范围，不能关闭此失败边界。F4继续未勾，F5/F6/E7未提前；未执行新真实业务/数据库验证。

- F4提交后边界窄修作者DONE/STOP，修复8路径及整体24精确冻结；根核before/current/工作树SHA、两reverse apply检查和单生产finally恢复SHA一致/0。正式首红70项66绿4业务红；最终71文本联合撤修66绿5业务红、0SETUP，finally精确恢复。最终专项71/71、八邻接235/235自然0/null/audit0，错误保存失败也不反转原回款ACK，逐笔重试继续。文档收窄为“种类读取失败时不猜旧生成路径”，不改变其他未知kind策略。

- F4窄修新独立Code Spec Accept，无Missing/Extra；独立专项71/71、八邻接235/235自然0/null/audit0，固定`/tmp/go-live-f4-postcommit-fix-spec-independent.*`及`-spec-independent-neighbors.*`。24+8冻结SHA一致，其余16未变；现在原质量审查者复验唯一Important及完整必要调用链，F4仍不提前勾，F5/F6/E7未开始。真实MySQL、资金/期间/会计、迁移及GUI仍待隔离与现场验证。

- F4原Code Quality复验Accept，唯一提交后查询/逐笔重试Important关闭，无剩余Critical/Important/Minor；质量只读核实际调用链、24+8冻结SHA与独立固定71/235、联合撤修5业务红及finally恢复，未重复套件。F4子项勾选；现在单一作者开始共同交付的F5/F6员工页面、统一待确认接点与持久完整请求恢复，两验收包都完整才同勾。E4/E5/E7及真实MySQL/资金/会计/迁移/GUI/现场仍待验。

- F5/F6首个审批/来源VM专项与原F1严格fixture完整闭包已静读登记。固定`/tmp/go-live-f5-f6-backend-red.*`四项自然1/null/audit0，三项缺RF独立document接点/准确source字段，另一项受控页查询失败回滚与释放通过；只是缺能力反例。实际RF字段为created_by/remark、用户real_name，夹具后续同步真实列。源DTO可有限追加canonical原行、准确AP ID与四位当前paid，详情可追加同只读事务计算的confirmAllowed；不改原永久ACK或授权、自批、预算规则，不用role1豁免。仍在实施，F5/F6及E7未勾。

- F5/F6首组恢复hook实际Axios离线执行15/15自然0/null/guard1/audit0，首次执行前已写部分模块，故不冒充实施前业务首红。页面扩充后23/23自然0/null/guard2/audit0仅为当时覆盖；初React提交前等待及文案断言差异另列夹具/呈现问题。现新增真实KeepAlive、活动同步ABA、撤权本人恢复、刷新失败重挂及跨期原申请查询；补录实际页面新kind/四位/零分文案尚待实现首红，不把旧核销的“不涉及凭证”当退款零分结果。RF待审分支复用同RR当前actor完整角色/权限/范围读取，原六引擎与原三单级默认规则保留。根静核清理原请求及申请的两次写入有孤记录风险，要求先全组身份/确认预检、一次持久清理；未知或失败继续保留原日期/UUID/key/body。扩充专项与邻接已按真实闭包登记，F5/F6尚未冻结或独立接受，E7/DB/现场未验。

- F5/F6补录页扩充反例固定40项34绿6业务红：原PO/PR/原价数量/准确退款分配与坏JSON提示缺失两例、服务器/账号/同步workspace变化后三例旧POST、一个迟到成功通知。首个raw变量ReferenceError属于实施错误另列，不算该业务反证。真实RF补录页现在按合法mount owner与目标活动代次限制详情/批准/驳回/撤回/执行/凭证重试，独立Section隐藏再显示仍保原备注、隔离Portal并禁旧target；旧四kind默认不扩。最新定向前端41/41、前端邻接46/46、后端邻接252/252自然0/null/audit0（两FE各3guards），只是作者当时覆盖，最终撤门/恢复/冻结和独立Spec→Quality尚待；F5/F6/E7仍未勾。旧审批处置3例因夹具缺现H6 sources summary/pagination而红，已单独补有限GET分支，不当RF产品缺陷或数据库验收。

- F5/F6作者DONE/STOP，41路径（15新）精确冻结为 `/tmp/go-live-f5-f6-increment.patch`；root核全部before/current/工作树SHA、reverse apply检查和tracked diff均一致/0。最终BE6/6、FE41/41、邻接BE252/252与FE46/46自然0/null/audit0，FE各3guards。仅撤实际BF target活动代次等式后41项40绿1业务红、finally字节SHA恢复；旧hook同步workspace门反证35项34绿1红仅保其版本，未冒充41覆盖。完整交接分F5/F6两验收包，root已派新的独立Code Spec，Quality/E7及F5/F6勾选尚未提前。真实DB、迁移、现金/凭证/GUI/现场与发布仍未验证或执行。

- F5/F6首次独立Code Spec No：三项Important分别为补录RF列表读取未冻结活动代次、RF Portal关闭回调未核原/current target、准确PR已付负余额409没有错误触发退款来源接点。root逐项核actual company-only key/通用GET、Dialog→setTarget链及confirmPR→shared headroom→AppError.code/data链，认可有限新kind/准确PR opt-in修补；旧四kind、原paid门与sales/无原PO语义保留。四独立门6/41/252/46均自然0/null/audit0、41SHA无漂移只证明已覆盖范围，不能关闭这三处Missing。原唯一作者重新开始窄修与实际离线反例，Quality/E7仍未启动，F5/F6未勾完成。


- F5/F6规格窄修新增真实迟到list/Section及delegate原Dialog旧回调、PR structured409来源正反例。正式FE首红46项41绿5业务红、邻接53项46绿7业务红；E1初29项18绿11红中10项为F2新增纯decimalMoney未接旧夹具的SETUP，核真实纯闭包后clean-red29项27绿2业务红，unknown/audit均0。当前作者fresh FE47/47、邻接54/54、E1 BE29/29自然0/null/audit0（两FE各3guards），原PR权限及旧核销无RF VIEW保持；仍待有限撤门/finally恢复、精确冻结和原Spec复验，Quality/E7及F5/F6勾选未提前。


- F5/F6三项规格窄修作者DONE/STOP：整体47与窄14包分别冻结，原41包保留修前历史；root核两层全部before/current/workspace SHA、两patch reverse apply及tracked diff均一致/0。最终FE47/47、E1 BE29/29自然0/null/audit0，邻接FE54保固定绿；新版恢复后迟到用例与同版有限联合撤门47项41绿6业务红、BE29项28绿1业务红，finally两个生产path字节/SHA恢复。旧hidden时resolve反证只保旧顺序，不冒充新读门。已交原Spec三项复验与三个受影响job独立一次；F5/F6仍未勾，Quality/E7不提前，实际数据库/资金/会计/GUI未验。


- F5/F6原Spec最终Accept，三处Important全部关闭、无Missing/Extra；独立受影响FE47/47、邻接54/54、E1 BE29/29自然0/null/audit0（FE各3guards），两层47/14 SHA及reverse/diff0且复验无漂移，fixed /tmp/go-live-f5-f6-spec-fix-independent-*。原BE6/252保持首次独立未变证据；旧SETUP与最终同版联合反证各守其界限。已派全新Code Quality只读审查整体真实链，F5/F6不提前勾、E7未开始。

- F5/F6首轮Code Quality No：一个Important，真实finish等待刷新后按账号/服务器/草稿/kind粗身份重新选当前confirmed记录，可能清掉另一窗口的新UUID/key/body记录并显示旧ACK。根沿实际hook与storage CAS核实：单次CAS未替代原完整身份/原ACK核对。唯一作者已保存6路径before，新增实际QueryClient等待、同粗身份换请求/ACK/来源日期/会话、原receive/app父体与换组8例，根完整静读后只允许已登记FE专项首红及最小修；原BE6/252、邻接54、E1 29未受影响保其证据。F5/F6/E7仍未勾，随后仍须Spec→Quality复验；真实DB/资金/会计/GUI待验。

- F5/F6 Quality窄修作者DONE/STOP，当前整体47与窄6冻结为quality-final/quality-fix包，旧41、Spec14/47与旧57测试版本完整保留；根核两层before/current/workspace SHA、两patch reverse检查及tracked diff全部一致/0。finish入口冻结原cash/ACK及原query app成员，前后await核完整身份、原父请求/来源/日期/组成员与原ACK；应用永久ID/单号不变才原CAS转态，异常仅current(o)清旧呈现，仍单次CAS且保新组bytes。首红55/48/7、永久申请身份57/55/2、同57细化旧缓存呈现2业务红分列；最终仅联合3身份组撤门57/48/9 BUSINESS（未撤缓存门）、finally hook字节/SHA恢复，fresh57/57自然0/null/audit0/3guards，固定log SHA均核一致。只受影响FE进入原Spec独立复验，旧BE/E1/邻接证据不重复；F5/F6/E7不提前勾，真实DB/资金/会计/GUI仍未验。

- F5/F6 Quality身份窄修后原Code Spec Accept，唯一Important关闭、无Missing/Extra；独立受影响FE57/57自然0/null/audit0/3guards，固定quality-fix-spec-independent日志/result/SHA及6/47无漂移。当前交原Quality只读复核，不重复无影响绿；F5/F6与E7仍待最后质量门，数据库/实际资金/会计/GUI/现场未验。


- F5/F6最终原Code Quality Accept，唯一清理Important关闭，Critical/Important均0，窄6与整体47 before/current/workspace SHA一致且其余41沿此前完整审阅；质量只读核actual finish/CAS/原app永久身份与固定独立57日志，不重复套件。F5/F6共同勾选。全部H/F子批已取得独立规格→质量接受，现在E7累计源码冻结、九项统一离线检查与新独立全批审查；E4/E5父项与E7待整批收尾再勾。真实MySQL/276/277/278、资金/会计/GUI/设备/现场、提交合并发布仍待后续。

- E7首轮七项统一离线检查完成但未通过整批：backend lint、30纯函数662/662及CI三条可达守卫自然0/null/audit0；契约81项78绿3红（文案23处、三新RF路由单行影响旧标题解析、supplierRefund新状态缺守卫登记）；frontend lint6错误/37警告、app tsconfig20类型错误；FE236文件1692项1688绿4红且guard阻止4次HTTP企图，不能称HTTP已解决。两构建尚未运行。原七固定日志/result与357源码完整保存在`/tmp/go-live-e7-initial-*`，与R11旧绿分开。独立全批静审确认提交后最后详情查询可掩盖真实业务/凭证成功，以及01c其他字段精确/前缀/字面LIKE仍缺；唯一作者正在窄修并补反例，原本地H/F接受仅代表当时覆盖。E4/E5/E7继续未勾，不连接数据库、不起应用、不执行迁移或现场测试。

- E7首轮独立Whole Code No绑定初始357冻结：Critical0、Important2，分别为补录已commit后最后详情query/fmt失败会改报失败，以及01c其他字段精确/前缀/字面LIKE Missing。A窄修后定向source/qty48、HTTP两例2、H6来源/签认68均自然0/null/audit0；状态379/379及仅撤手工supplierRefund登记367绿2红、finally字节/SHA恢复。全FE诊断236文件1692断言全绿，但仍audit4/runner1：临时XHR trace将四企图准确定位到OrderEntryForms sale仓库/客户/承运与purchase仓库夹具；默认enabled:false被hook显式配置覆盖，只补精确真实Axios只读响应，不改生产查询。原4网络企图证据保存在`/tmp/go-live-e7-A-diagnostic-*`，最终全FE仍待重跑。B实际Controller详情query/fmt clean-red82/74/8及旧kind扩充88/74/14为业务反证；首跨VM数组SETUP另保原版，不混作业务红。无真实HTTP、数据库、DDL或现场执行。


## 2026-10-05 本地开发最终收尾

本轮新增职责已按推荐确定：促销是正常销售优惠；旧批准处置整单签认后冻结原直接执行，来源目标重新审核；存货报废保实物执行与台账，准确成本证据由财务核对后按原权限/期间录人工凭证；保留完整基础账务与资产/折旧；新实物及资金以极序唯一执行、旧系统只对照。重复开单采用二级最小入口、默认不带数量。D1–D8保留初始评估记录，不再逐项等待产品选择。实际人员、历史资料和切点单据属于现场执行资料，不能凭推荐方案伪填。

E7初始Whole的两项Important已关闭：B隔离确定提交之后的申请详情读取，真实原业务ACK/落期/凭证结果与“详情待加载”分别返回和展示；提交前或commit不确定仍拒绝。C补六字段四档、ESCAPE !字面化及全局取齐后的商品rank/id排序，原数字游标、权限/范围和停用品差异保持。A修严格检查、文案与有限夹具，未弱化原完整请求/活动ABA保护。

精准A/B/C包39路径、最后单路径纯类型overlay及累计360路径（197修改/163新）均保存实际before/current及SHA。初357、原F5/F6 47/6及所有红/绿证据仍独立保留。原39patch在其原current冻结目录reverse为0，最终type overlay在live reverse为0；累积tracked和163新路径diff检查无错误。

| 本地检查 | 最终结果 | 证据界限 |
|---|---|---|
| 后端lint | 自然exit0 | 不证明事务或真实数据库 |
| 30文件纯函数/有限VM | 682/682，0取消/跳过 | 实际服务调用与有限SQL边界，未连接DB |
| 26文件源码契约 | 81/81，0取消/跳过 | 权限/API/状态/锁序等静态契约 |
| CI接线 | 指定3/3守卫 | 本地静态可达，不是GitHub CI运行 |
| 前端lint | 0错误、37警告 | 33既有+此前资料/财务3+H6来源面板1，未称零警告 |
| 前端类型 | `tsconfig.app.json`自然exit0 | 不使用空壳tsconfig冒报通过 |
| 全前端单测 | 236文件、1699/1699，236 guard ready | 严格禁网/禁敏感配置读；audit与XHR diagnostic均0 |
| ERP/PDA静态构建 | 两端自然exit0 | 只输出/tmp；未打桌面安装包/APK、未启动或部署 |

九门固定索引 `/tmp/go-live-e7-final-checks-manifest.json`。全前端与构建完成后仅补测试ack的真实类型注解，两份TypeScript输出逐字节相同，证明 `/tmp/go-live-e7-type-erasure-proof.json`；仅补受影响lint/type和H6五文件68/68（5 guards/audit0），未重复未受影响套件。初八绿一类型失败的完整记录保存为nine-firstpass，不抹去历史失败。

独立E7 Code Spec Accept→Code Quality Accept→原Whole最终Accept，Missing/Extra/Critical/Important均无剩余可证问题。Spec独立四窄job为88/88、62/62、17/17、13/13，自然0/null/audit0；质量与Whole只读核固定证据，不重复全绿。报告分别 `/tmp/go-live-e7-spec-review.md`、`/tmp/go-live-e7-quality-review.md`、`/tmp/go-live-e7-whole-final-review.md`。B unsafe-detail反证88/74/14、C联合rank/literal/tie反证17/7/10与13/12/1均finally准确恢复；初SETUP与BUSINESS分列，不冒充真实业务复现。

### 仍需执行的启用工作（本轮未执行）

1. **隔离MySQL8验收：** 276资料长度、277来源与278退款的首次/重复迁移、元数据/外键/CHECK；实际SQL排序/SQL_MODE/执行计划，RC/RR读取与真实锁等待/并发、事务回滚、四位金额与应付/资金/往来/凭证/期间。只能用明确独立且可证明归属的环境，不连接生产或开发主库。
2. **员工与设备现场验收：** 约5人多岗/第二人审批与替岗、原权限和仓库范围、GUI流程与未知结果、真PDA扫码、物理标签/单据打印及物流，真实银行/现金与会计核对；补实际负责人/替岗人、切点时间和逐张未结旧单归属。
3. **并行及发布：** 按[并行职责方案](2026-10-04-go-live-accounting-parallel-policy.md)准备期初、库存/预占/预计绑定、未结往来和未核销原付款资料，首个完整月与首次结账对照；连续两周差异闭合后再结束重复对照。提交、合并、CI、部署和在线版本证据均未办理，不能把本地构建当正式启用。

无新增未开发功能被隐含纳入本轮。仍明确不做CRM、人事薪资界面、万能工作流/核销、自动采购或自动改账、复杂生产装配、到货建单、采购跟进、常购管理后台、强制成套模型/历史订单迁移、自动存货报废凭证或双系统自动执行同步。趣味组件保持默认隐藏、暂停扩展，便签与既有用户偏好保留。

当前实现仍在 `codex/go-live-batch-one`、HEAD `14e97aa`、三端0.12.0的未提交工作区；main与其他工作树未修改。上述本地完成不构成真实数据库、现场或正式上线接受。


### 2026-10-06第1–3项运行验收续接

用户授权“123开始做 / 继续”后，本轮已启动本批专属回环MySQL、ERP/PDA服务和鉴权GUI。上方“本轮未执行”保留为2026-10-04/E7当时记录，不再代表今天全未做。

1. **隔离MySQL/API已补一批**：第二个新空实例完整278迁移成功；131项元数据/双SQL_MODE重放与真实搜索SQL检查；既有财务/会计/期间/范围/PDA鉴权专项、修正夹具后的并发123/0；最终处置/供应商退款9业务子案例（TAP10/10，0失败/跳过/取消）。本轮修了CHECK元数据比对、通知调拨范围SQL、退款DATE的北京DTO、旧混合处置文案及资金看板类型显示；未改变库存事实源或核销边界。
2. **本机GUI与合成财务已补一批，现场仍未完成**：搜索/原单退货/资料/审批分页定位/预占解释/重开草稿/历史转换、浏览器PDA三动作与未知回执恢复、退款实收和跨期另一人审批、资金追溯真实走查。合成退款两笔21.1234、原付款100.0000保留、应付已付78.8766、实物/缓存10.00、旧业务199001保留且凭证202610。浏览器PDA不证明Android扫描头/重启离线/物理打印；合成资金不证明真实到账与财务人员签认。
3. **资源已收尾，正式交付仍未办理**：两个owned容器及卷、本批服务PID、固定命名浏览器会话与合成auth profile精确清理并复核；共享3307与main保留。工作仍在隔离分支未提交/合并/推送/部署；真实旧单归属、切点余额、并行职责、员工替岗、现场设备与正式全量CI/发布仍待执行。

完整证据与修前失败分类见[2026-10-06运行验收结果](../../2026-10-06-go-live-runtime-result.md)。不以本批通过代替全部未验边界，不把创建退款abort的setup失败或真机缺项写为通过。
