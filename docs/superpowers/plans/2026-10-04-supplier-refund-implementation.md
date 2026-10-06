# 供应商实际退款：有限来源与账务实施契约

**Goal:** 员工先建准确采购退货草稿，登记供应商实际退回的原付款，再沿原采购退货审核、实物出库及应付冲减；钱与货分别留痕。

**Architecture:** 专用供应商退款域，不改201客户退款含义、不写负数付款、不改原汇款及其核销余额。复用原资金流水、应付、对账、往来、补录与凭证引擎；新分配只保留退款来源和额度，不能成为第二套资金账。

**Tech Stack:** CommonJS/Express、MySQL 8手写SQL、React/TypeScript。迁移278已保存源码，未执行。截至2026-10-05，F1–F6及E7补录结果修补本地实现并获独立代码复审；最终离线证据见[剩余项执行记录](2026-10-04-go-live-remaining-execution.md)。下方静态计划门记录保留各阶段当时状态，不能据旧“未实现”覆盖当前结论。真实资金、会计、数据库与现场仍未验。

## 当前依据与有限选择

- `refunds/refund-orders.service.js`及迁移201绑定销售/客户，execute写负数payment_entries、OUT/biz5，不能改名套供应商。
- `returns-purchase.service.js`、`warehouse-tasks.ship.js`及`returns.helpers.js`的PR确认/实际出库保留原已付保护；退款并未由退货自动产生。
- `payment_entries`保存原正额付款分配。直付以entry ID及原PO单号定位真实OUT/PAYMENT；汇款核销以receipt ID及receipt_no定位真实付款，不用数字ID碰撞或同名猜测。
- `finance-accounts.service.recordTransaction/refreshBalance`是原资金事实/余额投影入口；复用纯`utils/decimalMoney`定点，金额四位，现金及AP不可为了凭证分位而截断。
- `party_ledger_events`的241总额触发器只记录total_amount变化。本域只减paid不能依赖它；原receipt/entry不改，显式正delta退款事件以稳定退款来源唯一化。
- `voucher-engine.buildFundVouchers`当前消费1/2/3/5，凭证分位；`closePeriod`目前只调用销售来源门，不能称全来源闭合。
- 主核算主体有限首版固定服务端主账套1，核退款账户及准确原付款账户同为1；不接受请求体或当前页面账套选择改归属。原业务AP公司级没有company_id，不虚构该字段。新biz6仅在真实所属账套投影，旧1/2/3/5默认范围保持。

例：原AP total100/paid100/balance0，实际退款30后为100/70/30且现金+30；PR实物出库30后为70/70/0，不再收一次钱。PR后来取消不得恢复已付或现金；销售退货、供应商退款也不恢复处置来源实际执行量。

## 不可变资料与状态

迁移278新增：

1. `supplier_refund_orders`：准确PR、PO、AP、供应商、主账套、仓库快照、正amount、收入account、真实refund_date、四态、申请/确认/实际登记人、fund_transaction_id、凭证结果/错误；create UUID/key/完整载荷hash/原响应。
2. `supplier_refund_allocations`：退款头、准确AP/PR、原正entry、原receipt可空、原唯一OUT流水、正四位amount及完整来源快照；自己的budget_state=draft/reserved/received/released。退款头与所有分配转态同conn；不删、不级联、不得依预算查询锁另一退款头。
3. 本域永久操作记录：全域唯一operation UUID、action、actor、原key、完整请求hash、准确资源及原响应。创建、确认、收到、取消分别保存原响应；TTL后仍能回放准确原结果。UUID变action/actor/key/body/resource拒绝，不根据status3或现有流水猜本次成功。

新字段长度/主键与实际父表一致，金额DECIMAL四位、数量不扩精度。新增索引/外键按名字+列序幂等补，不仅CREATE IF NOT EXISTS。权限前后端常量及前端既有PERMISSION_GROUPS同步；数据库sys_role_permissions保存实际角色授权，没有独立sys_permissions目录。迁移仅说明新权限码、不插入角色授权、不新建目录表。往来事件可复用既有baseline_key的独立退款命名空间，不能重用record/receipt历史基线键；一退款唯一事件且正delta与退款amount精确一致。

allocation的原OUT流水保存准确ID与冻结证据，由服务逐字段核对，不新增硬外键引用原FAT：AP之后INSERT触发父行共享锁会重新形成AP→原FAT方向，与原付款先refreshBalance锁账户流水、再AP的方向相反。其它外键也须核实际父锁位置，不能AP之后补取原账户、receipt或另一RF头。RESTRICT仅防硬删除，不防减量、软删或重复回款，也不在取消后自动解绑历史；不得作为业务预算或幂等门的替代。

状态1草稿→2已确认→3实际已收回登记，或未执行1/2→4取消。确认冻结PR/PO/AP/供应商/金额/原分配/账户/真实日期；首版不新增已确认改单或删单。原单据资料后来漂移则拒绝，不静默更新快照。确认沿原`selfApprove`规则；补录自批仍硬拒绝。

## 来源与预算

只接正常准确来源PR草稿：来源PO及每条采购行完整，原供应商/仓库/原价/基本量一致。无原单历史PR、手工AP、未核销预付款、缺账户、缺准确分配或非唯一OUT流水返回待人工核对，不伪造来源。正常未关联处置来源的PR也可使用专用退款；处理来源预算与退款资金预算仍各自解释。

直付：entry.receipt_id=NULL，entry.record_id=准确AP、amount>0、account_id有效；唯一原资金OUT/biz2，其biz_id=entry.id且biz_no=准确原PO单号，并核金额及日期/账户归属。原entry与receipt在054/139分别自增，数字ID合法重合。来源唯一性以由准确parent确定的(biz_type=2,biz_id,biz_no)三元组为准：不同准确单号的另一域同ID不属于本来源候选，不因数字重合误拒；这不证明其他流水合法。相同三元组多条必须拒绝，不能用金额、账户或日期挑出一条。缺准确三元组、金额/方向/账户/日期不符仍待人工核对；不补身份列、不迁移旧FAT。

汇款核销：entry指向准确receipt，receipt.type1、party_id=准确supplier、account与唯一原资金OUT/biz2匹配，其biz_id=receipt.id且biz_no=receipt_no；各entry金额可小于整笔receipt金额，但同receipt原正分配合计不得超过真实付款。历史NULL身份不按名称补齐。停止使用的原账户仍可核历史证据。收入账户当前启用且未软删的条件仅用于create/confirm/receive；未执行RF的cancel只释放自身预算，允许准确收入账户后来停用或行仍存在的软删，不能复用当前可选账户过滤导致无法取消。仍核准确ID、company及冻结身份、当前权限/范围和自有allocation，不重绑账户、不写现金/AP；state3不可取消。

RF草稿不占额度，因此原PR可能在RF草稿存在时按原流程合法取消。仅新建/确认/实际收到沿准确PR草稿资格；RF.cancel核原PO/PR/AP与自身冻结来源身份、当前授权/范围和自身allocation，但不复用新建的PR.status=1过滤。准确来源PR已合法取消至4不能困住尚未执行RF1的取消；取消只释放/终结自身记录，不重新申请退款额度、不写现金/AP、不恢复PR。state3仍不可取消，来源真实身份或冻结金额不一致仍拒绝。必须补RF1+PR4取消反例；不把RF草稿改成占用。

非现金F1事件沿明确本域事件类型留痕，若复用payment_record_events，不采用旧PAYMENT_EVENT.REFUND的最近往来改写分支；F1不得写或改party_ledger金额。实际收到的唯一正delta往来在F2同conn单独完成。

每entry余额=原正分配−已收到−其他已确认占用；每PR余额=原准确价格×可退款数量−已收到−其他已确认占用。数量两位×原价四位得到六位中间量，先定点累加整张PR再按原金额四位舍入，与原SUM(quantity*unit_price)冲应付口径一致，不先累加逐行已舍入amount导致尾差。核保存头金额与准确行价量一致，异常保持待核对。分配合计=head.amount且≤当前AP.paid。业务表四位定点计算，不用浮点容差吞超额，不夹到0。草稿不占预算；confirm才reserve，receive转received，cancel转released。

同AP的确认/执行/取消均先共同AP门，再当前读budget allocation；不JOIN其他RF头取得状态。只锁本域allocation，不能AP之后再拿另一RF头、原receipt或原账户。原PR在已确认未收到退款时，确认/取消明确要求先完成或取消退款；已收到后可取消PR，但显示退款已登记、财务待核对，资金/AP不回退。

## 原事务与锁序

普通receive：账套/实际业务期间S→执行人user S→当前role S及权限/仓范围当前读→准确PO S→PR X→RF X→收入账户X→原receipt升序X→对账单升序X→AP X→准确原entry/退款allocation当前预算。补录先锁原申请X，再账套/期间X，之后同序；receive不反锁申请，不升级普通S到X。

create/confirm/cancel不写资金：主账套1身份S→当前执行人user/role及权限、仓范围S→准确PO S→PR X→已有RF X→收入账户S→原receipt升序X→statement升序X→AP X→准确entry及allocation当前预算。新create没有既存RF头可锁，头INSERT延后至这些原父门与预算核对之后。账套S只用于身份及新增company外键父锁，不检查或锁期间，不因此禁止闭期建草稿/确认/取消；确认取消不得随后调用资金期间闸门或凭证，不升级S到X。自身事务可有限下一事务RC；禁止SESSION/global改动。所有身份预读仅用于定位，锁后完整重核公司、日期、PR/PO/AP/供应商/仓库、账户和来源，漂移409而非改目标。

### F1新增外键与INSERT时序

以下为278的有限首版白名单，父ID类型须与实际迁移的BIGINT UNSIGNED一致，全部新增约束RESTRICT，并按名字、所属表和列序核对。不能在AP之后才依靠INSERT的隐式父S锁取得先序资源：

| 新字段/父资源 | 明确取得父门的位置 |
|---|---|
| RF头company_id→acct_companies.id | 普通create/confirm/cancel先主账套身份S；receive先原公司/期间S，批准补录先公司/期间X。非资金动作不执行期间判定 |
| RF头purchase_order_id/purchase_return_id/payment_record_id→准确PO/PR/AP | 分别为PO S、PR X、AP X；锁后核供应商、仓库及准确价量，不写旧父FK |
| RF头income_account_id→finance_accounts.id | 普通非资金动作在RF后、receipt/statement/AP之前显式账户S；receive同位置账户X，不能AP后插头才取账户父S |
| RF头本次creator/confirmed_by/received_by/cancelled_by、本域operation.actor_id→sys_users.id | 当前执行人user S位于PO之前，并沿本次动作当前权限及范围重核；只预锁本次要新增/改变的actor，不重锁全部历史创建人 |
| allocation.refund_id→本次RF头 | 新头为同conn自有新行；既有头先X，不锁其他RF头。allocation的PR/AP为经头核对的冗余预算身份，不增重复FK |
| allocation原entry/可空receipt→payment_entries.id/payment_receipts.id | receipt先于statement/AP；准确entry按ID升序的当前读S纳入AP之后预算核对，之后才INSERT allocation |
| 本域operation绑定的refund ID及RF头创建operation UUID | pending UUID先只写当前actor/请求摘要、资源FK为空；源和目标绑定在相应父门及自有新头成立后complete。同conn自有pending操作不是外部资源 |
| RF头fund_transaction_id→新IN资金流水 | create时NULL；receive由同conn先插真实新IN再绑定自己的新父行，可以保留此FK，不引用旧OUT |

supplier_id/warehouse_id等业务身份作为准确PO/PR派生的冻结快照，不额外新增直连供应商/仓库主档FK或主档锁；allocation冗余PR/AP、operation冗余来源ID及历史statement/role/scope快照也不加重复父FK。公司、账户、原分配等由上述确定父资源核对，快照不能成为授权或预算事实。原OUT流水、原付款账户仅保存准确引用与冻结证据、不设后置FK、不在AP后回锁；原付款账户停用仍可核历史证据。

新create在父门及预算检查后按“INSERT RF头→批量INSERT本次allocations→complete永久操作→原事件/回执→一次commit”保存。不能为模仿旧单锁位置提前INSERT头，再因company/user/account FK产生后置共享锁。confirm/cancel使用更新字段白名单，只改状态、本次已预锁actor、时间及自有allocation.budget_state，不重写来源FK、REPLACE或删后重建；固定来源的真正漂移明确拒绝。cancel仍在原序取得收入账户S，但查询必须能定位已停用/软删的原行，不能只查可选启用账户；停用/软删本身不是冻结金额/归属漂移。收到动作的原新IN/资金/AP/往来与完整回执仍同生共死。

独立离线反例须记录显式父锁和INSERT/UPDATE顺序、未占期间锁的闭期草稿、pending资源FK为空、source漂移/错误actor/receipt/entry、同conn一次提交与任一插入/回执失败整笔回滚。另覆已确认未执行RF收入账户后来停用/软删：receive拒绝，但原合法cancel释放自身reserved，state3仍拒绝取消，缺行/错ID/company或冻结金额漂移仍拒绝；不改现金、AP或原付款。它们不模拟声称MySQL真实隐式FK锁已通过；首次278、元数据幂等、FK等待和与旧付款/补录/关账的真实并发仍待隔离环境验证。旧054与251的payment_entries→AP约束实际删除规则不能由文件名推断，本轮不改旧约束。

F2原资金余额接点的有限限定：本计划“AP后不锁原付款账户/FAT”约束来源核验不得追锁其他原付款账户或原OUT，不禁止原 `recordTransaction→refreshBalance` 在**已于statement/AP前取得收入账户X**后，重入同一账户并当前锁读该账户全部流水、重算余额。同一账户也可能包含准确原OUT，甚至原付款账户就是本次收入账户；这不能改成缓存累加或跳过原余额当前读。范围只限此前已锁的准确收入账户，不扩大到其他账户/FAT、不新增原OUT硬外键、不改变来源证据的非锁读取。须补同账户原OUT纳入重算和异账户不追锁的离线反例；此处是实际调用链的静态澄清，真实MySQL锁等待/并发仍待隔离验证。

receive可借用原补录conn，但不得在借用事务中begin/commit/rollback或中途SET隔离。公司门必须在所有业务锁与operation_requests写锁之前。借用分支用服务端锁定批准申请的不可变snapshot定位主账套1/真实日期/PO/PR/RF，再依序取得公司与业务锁、完整重核；不能在company前普通peek业务头。正常顶层先在begin前定位。

原OUT金额/方向/账户/biz身份单号不可变；原确认冻结的entry/FAT引用必须已提交。新kind第一次业务普通SELECT仅在company及已确认RF权威头锁后，避免等RF锁之前形成旧RR视图看不到刚确认的原来源。随后准确receipt/entry按原次序当前锁读，与同conn读取的已提交immutable OUT证据一致核对。不能持AP后回锁原付款账户/FAT，避免与原账户refreshBalance的全流水锁反向；不能仅说“company后”即声称旧view问题消除。

现有来源写链已静态核对：`payments.service.js`及`payment-receipts.service.js`只追加正付款分配，receipt仅创建/继续核销；对账单解锁、移出不撤销付款。`finance/finance-accounts.service.js`只插入本金流水、更新同次新行balance_after；账户调整另写流水，凭证冲销只写会计。原付款在当前AP锁下增量更新paid，`inbound-tasks.settle.js`重算保留paid，`returns.helpers.js`只改total/balance/status。本轮不新增不存在的原付款更正出口。以后若另行授权更正，须按原锁序及共同AP门当前读取已占退款预算，并明确409，不依赖外键报错。

正常顶层receive先独立只读核持久原成功操作、本人及当前准确资源范围再返回原响应；已成功原日期后来结账也不能丢原结果。没有永久原操作不得根据state3回放。新写仍需专用receive及原数据范围。原操作回执/业务/流水/分配/往来/事件同conn落库、一次提交；回执失败整笔回滚。

## 实际回款投影

同事务核全部来源和预算后，AP.paid按四位精确减少，balance/status沿原规则；total_amount不变、不解除原确认。落正IN/biz6唯一原资金流水，原recordTransaction刷新收入账户。对账单先锁后当前刷新；供应商往来显式正delta唯一RF来源，原付款receipt与entries均不改。返回实际业务回执，不把随后凭证生成失败变成退款失败，重试凭证不再写现金/AP。

receive原成功DTO只包含固定的实际业务事实（退款ID/单号、state3、fund ID、四位金额）和固定提示“回款已登记，凭证结果见详情”，在业务事务内完整持久化。首次响应、同键回放与本人原结果查询返回完全相同DTO，不合入随后变化的凭证结果。业务提交时凭证状态先为pending；提交后立即尝试生成、逐笔证明和持久化结果。生成或结果状态保存失败不能把成功回款改成失败；未保存结果仍显示pending，不声称完成。有专用VIEW时详情另取当前凭证状态，VIEW撤回后只可查本人原业务回执。独立regenerate-voucher仅写会计，不再动现金/AP。借用补录事务的receive不在外层提交前生成凭证，由调用方提交后执行相同单笔生成及证明，并保存申请和退款的相应结果。

单笔会计来源`SUPPLIER_REFUND_IN`绑定fund ID：借1001/1002，贷2202〔准确supplier ID/name〕；voucherDate为原实际日期或经验证的补录override。引擎先核专用RF实际state3、fund绑定/方向/金额/账户/日期/供应商/company/唯一分配及预算一致；坏来源fail-loud，不跳过。只写acct表，不能反向修业务。

源投影可窄提取pure single-spec，被原generateVouchers及单笔生成共同复用。业务提交后独立company X事务单笔generate→逐笔核对来源/hash/期间/有效凭证/分录/金额；失败持久voucher_pending/error如实显示。人工冲销不会被自动复活。

### 已收到来源与后续正常业务

RF3的会计来源证明独立于新建/确认/收到的准入：只核已收到的不可变来源及累计消费，不能重跑PR.status=1、当前剩余额度足够再收本RF或本RF执行后AP快照相等。正常PR实发2→3会减少AP.total、保paid、重算balance/status并重置confirm_status；RF收到后、PR尚未实发时可以按原规则取消1/2→4，已实发PR3仍不能取消。两种合法后续过程都不恢复退款现金/AP，不使原收到来源失效。

专用已收证明须核RF3、自己的allocations全部received/合计=amount、准确永久收到操作、唯一新IN与fund绑定，以及完整原PR行/POI/基本量/原价、PR/PO/AP归属、原正entry金额和准确receipt/账户/订单关系、唯一原OUT本金/方向/biz身份/账户/日期。累计已收按原entry和PR汇总不得超原正分配或原准确PR金额；其他RF后来合法收到纳入消费，不能把同一RF再扣一次剩余额度。全域净paid为全部原正entries减全部已收RF。真实换绑/缺失/减量或超额仍fail-loud。

PR合法状态变化、AP.total/paid/balance/status/confirm、statement归属/汇总、receipt后续合法核销的settled/balance不参与冻结对象相等或凭证hash；当时快照保留审计。receipt本金/type/party/account/no及准确原entry/OUT证据仍核。单笔、整期生成、补录证明及新6结账共用本域已收验证与稳定投影，不能沿新交易资格helper。

收入账户当前type允许后续编辑，因此F2在准确收入账户X锁下将实际回款时type（1–5）保存为不可变`received_account_type`，迁移278先留该可空字段及状态/取值CHECK。F1不伪填；F2落RF3时同conn写入。F3由该收到时type映射现金1001或银行1002，不以账户后来type重算历史腿/hash；原账户ID/company仍精确核，缺此实际收到映射待人工核对、不能兜底当前type。此新增字段仅是收到时会计证据，不是第二现金事实源，也不改变旧1/2/3/5来源映射。

必需反例：RF30收到后PR3/AP70/70/confirm归零仍证明通过；RF收到、未发PR取消4仍通过；其他合法RF收到及receipt继续核销不使原RF失效；不可变身份/本金/分配篡改与累计超额失败；收到后账户type编辑保持原腿/hash，叠加零分与补录override。以上仍是后续代码契约，尚未实现或运行。

原四位正整数单位u，分位目标为整数`(u+50)/100`；新6生成、补录逐笔证明及结账门共用此纯投影，不先浮点round2。0.004实际现金/AP仍变0.004，完整资金/source验证后明确“分位为0，无需凭证”；0.005目标0.01，要求两条有效借贷0.01。零分仍必有真实资金流水，坏来源不能因零分静默跳过，不加到NO_FUND_TXN_BIZ_TYPES。结果区分“已生成凭证”与“零分投影已核对”，不得仅用voucher_generated_at声称凭证生成。四位资金总额、逐来源分位投影合计及舍入差分别呈现，不自动余额调整、凑分或掩盖多笔0.004的实际现金影响。

现closePeriod在company X下加仅新biz6本期来源门：实际资金使用override||happened_at判期，核缺失/过期/坏来源，拒结账；读取已提交业务事实，不反锁PR/RF。正常company S与closing X同门可确保等待后新资金可见，必要当前读取不能被旧RR视图掩盖。不是重建所有老资金来源结账门。

资金工作区及流水类型加入供应商退款，正IN方向与金额准确。原gross资金/应付勾稽口径保持，单列本域净已付款核对：原positive entries−已收RF=AP.paid，balance=total−paid；不要把新的2202退款贷方加到比较total_amount的旧毛额白名单，也不要把type6正amount当支出求和。

## 闭期补录

本轮包含专用kind `supplier_refund`，先申请→他人审批→原身份、key、准确快照重核→原同connreceive及执行痕迹→提交后单笔生成/逐笔核对。申请不写现金/AP；申请创建/找旧申请在业务事务前，不能持业务锁等待申请头。 申请的当前授权/完整来源准备与申请INSERT分段：准备事务释放company/user及来源锁后才插入/重复键查明申请，避免company→申请与执行的申请X→companyX反向；执行锁重核仍是资格权威。原申请键是本次永久身份，不从当前RF界面重新构造载荷。

新域默认409提示保留真实收回日期，明确跨期补录，不引导改日期；既有其他资金入口文案不因此全面改写。仅新kind固定服务器首次approved_at日期：锁申请查询`DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date`，pure转换postingDate/Period；缺批准日期拒绝，不用客户端或快照日期重绑、不兜底今天。

当前旧execute按执行日resolvePostingPeriod，guard又取fresh今天；这与AGENTS字面审批日存在差异，不能称旧补录已经统一。新kind跳过执行日普通预检，沿内部`kind=supplier_refund, postingDate, postingPeriod`精确guard先company X、校验日期月份一致及批准期间当前未关闭，返回准确override。即使原业务期间重开仍验证批准期间并保留该override，不能沿!closed提前返回NULL。其他kind默认不变，不改已执行迁移。

批准10月31日、锁等待或重试到11月仍落10月31日。批准期间后来关闭则409、业务无写入，保留已批准待执行交财务核实，不自动迁月/重写approved_at。markBackfillExecuted、生成、证明和新6结账门使用同一批准期间；原business_date/happened_at始终保持真实回款日。

扩原backfill快照、replay、bizType名称、资金来源CASE及仅本域逐笔凭证证明；新kind需准确原RF绑定，不借客户refund.kind。申请自身的持久结果、DTO及列表summary也须区分实际生成、待核对与“零分投影已核对/无需分位凭证”；零分仍必须有完整真实FAT，不能将整个新kind放入NO_FUND_TXN白名单，不能以时间戳直接宣称已生成。复用现有结果字段或有限派生，原receipt_settle及其它kind含义保持；实际补录页面沿此准确呈现。业务来源漂移、写权或仓库范围撤回、原申请人停用等按原授权边界拒绝，不能以审批人代替原申请人执行。读原业务结果不等于获得新的执行权。

本域采用有限同conn授权helper，位于company之后、PO之前；receive再先取得原期间门，非资金create/confirm/cancel不取期间门。分开FOR SHARE当前读sys_users、当前sys_roles、角色权限及仓范围，不普通预读、不pool、新事务或隔离改动。用户存在、未软删、is_active=1；角色存在，沿原role1特例，其余须本次专用CREATE/CONFIRM/RECEIVE及完整准确来源查看权限，cancel沿CREATE。返回内部operator/warehouseIds/scopeLoaded；undefined/非法范围/加载失败拒绝，成功查无范围行的null仍为原不限仓含义，不能混成缺上下文。准确PO/PR/RF仓库必有合法ID再逐项范围核，不能借assertInScope对null的原默认放行。

原申请applicant ID、快照本次执行actor、持久原操作actor/key/UUID/hash必须一致，冲突409；RF创建人可为其他合法经办人，不强制等于回款经办人。新kind按请求键查旧申请或复用时，也须核完整本人、持久快照/指纹与准确RF/body/UUID/key；现通用`findApplicationByRequestKey`只返回摘要，不能作为此完整证明。仅补新kind有限查验，旧kind返回契约保持；未知结果沿原申请查询，不能自动新建。已停用/撤权/换角色/范围收回先提交则当前锁读拒绝；receive先取得授权S门则这些调整等待本事务结束，不能只用begin前权限快照声称撤权竞争闭合。现用户写方user X、角色权限写方role X，未见它们反取company；实际串行边界仍待隔离MySQL证明。其他补录kind不扩此新授权helper。

## 后端与员工界面分批

- [x] F1 基础（本地源码/离线双代码门完成，278与真实DB未验）：278、准确source只读API、本域纯金钱/身份模块、create/confirm/cancel及长期防重；真实VM调用服务严格依赖白名单，package/CI静态接线。只读分页范围先于count。PR防未收回退款门在此批同步。
- [x] F2 实际登记（本地源码/离线独立双代码门完成，实际资金/DB未验）：receive同conn与预算/资金/AP/完整对账/唯一往来/事件/长期固定原响应，scope先于重放；仅本域exactMoney opt-in保四位。独立51/51与118/118自然0/audit0，有限联合撤修16业务红、四文件finally精确恢复。
- [x] F3 会计（本地源码/离线独立Spec→Quality完成，实际会计/DB未验）：准确单笔builder、原引擎接点、逐笔证明/持久pending、专用closePeriod门、资金及净付款可见性；不自动报废凭证、不变其他gross事实。受影响源码守卫保持原意义。
- [x] F4 闭期补录（本地源码/离线独立Spec→Quality完成，真实期间/资金/会计与DB未验）：专用kind/replay及精确批准/落期规则、原申请身份/范围/键、执行痕迹、补录凭证核对、跨月/漂移负例；不新增引擎或补录自批豁免。最终专项71/71、八邻接235/235自然0/audit0，提交后失败与逐笔重试Important已关闭。
- [x] F5 页面：采购退货详情的专用退款二级入口及退款列表/详情、原付款分配选择、真实收入账户/日期、确认与已实际收到的明确动作、原source状态/凭证待生成。正常PR已付保护错误给准确退款入口；客户退款原标题/路径保留。待确认RF接入现统一待我审批及首页列表，动作仍回原RF详情。路由名=工作区/页标题，遵守现有权限及keepAlive/草稿。
- [x] F6 恢复：owner/user/base/session/active/固定完整请求/UUID/key持久，未知结果仅本人核对不自动POST；读写权限撤回分别处理。补录申请未知先核原申请/操作，不重新申请、改日期或换key；存储失败禁止发POST，容量满拒新而不淘汰未知记录。真实adapter组件测试每个afterEach断言未知调用，禁止HTTP/listen。

### F5/F6共同交付的有限前端批次

F1–F4继续分别实施并独立规格→质量接受。F5页面中的实际POST、本人原回执核对和F6持久完整请求直接互相依赖，因此F5/F6作为一个前端安全交付批次：单一作者完成实际页面、统一待确认接点与完整持久恢复后，再一次独立Code Spec→Code Quality。F5与F6两项仍分别核验各自验收包，只有两包都完整才同时勾选；不交付仅内存阻断、未持久原体的中间写入页面。本安排只改变实施分组，不扩大业务能力、权限、数据来源或未知结果重试规则。真实数据库/GUI/现场仍另验，统一离线E7仍在全部代码后进行。

`GET /api/supplier-refunds/source`、列表、详情分别受专用VIEW及准确原PO/PR/账款查看与仓库范围；`POST /` CREATE、`/:id/confirm` CONFIRM、`/:id/receive` RECEIVE、`/:id/cancel` CREATE，所有写路由权限和稳定原key必备。`GET /operations/:uuid`仅认证本人原成功结果及当前准确仓范围，不额外VIEW/写权、不附原价款详情。controller不SQL，service不HTTP req。只提供准确PR来源，旧无原单PR入口继续保留但不能产生虚构RF。

## F5统一待确认入口

RF创建后的state1草稿须确认后才占用预算，可作为现有`document`单级审核来源；确认不代表收回现金。state2/3/4不列审批待办。使用真实RF单号、事由、创建人/时间、四位退款金额和稳定`document:supplier_refund:<id>:confirm`身份，引擎instance/task/step/flow均NULL。

`approvals.service.js`目前的BIZ_DOC_META同时驱动六类引擎节点及`/biz`历史查询。RF使用独立document元数据接点，不扩该六类引擎集合或BIZ_TYPES，不配置新审批流。专用VIEW+CONFIRM、原`allow_self_approve`、`PURCHASE_ORDER_VIEW/RETURN_ORDER_VIEW/PAYMENT_VIEW`及准确当前仓范围在COUNT/LIMIT之前过滤，与RF详情保持同一可读口径；不能列出已无原来源查看权的待办。

`approvals.routes.js`任一入口权限及前端`PENDING_APPROVAL_PERMISSIONS`增加本域CONFIRM，沿已有路由、首页registry、useApprovals/useDashboard贯通；仅新增确认权不能读取旧引擎节点。共享前端业务映射增加“供应商退款”及其完整查看权限，定位`/supplier-refunds?detailId=<RF id>`。复用原approvalNavigationPath、useApprovalDetailHandoff及提示，保留筛选、KeepAlive与正在新建/回款的草稿；读取新鲜、身份/权限/当前标签成立后才允许确认。

create/confirm/cancel原成功后失效`approval-pending`及`dash-pending-approvals`，本人原操作查询证明成功后再刷新；未知/失败不假移除。待办列表和首页的RF金额局部保留四位（如0.0049），不沿两位money显示为0，不改旧类型的呈现。后端来源分页和首页继续同一只读RR数据源，不新增提醒系统。

相应离线验收覆盖RF四态、完整查看/确认权限、自批、仓范围、COUNT/LIMIT、稳定document身份与NULL引擎字段，旧六类引擎不扩；新岗位入口、分页/首页、四位金额、成功刷新/未知保留、真实RF页面草稿/撤权/迟到响应分别扩现有审批专项。

## 证明边界

必要离线反例：同AP不同PR抢同entry、确认/收到/取消交错与精确四位预算、六位中间整单四位尾差、原source/公司/日期/账户漂移、直付/receipt数字碰撞与非唯一流水、原receipt余额不回升、RF收到后PR取消不冲回现金、借用事务不嵌套、原operation TTL后重复/错body/错actor、普通/补录/结账同门调用顺序、批准日跨月等待/后来关闭/业务期重开、批准日期缺失或伪造、0.0001/0.0049/0.005/0.0051、无FAT但零分或坏来源被零分吞掉、另一账套新6排除、人工红字不恢复、凭证失败业务成功不重复钱、owner/server ABA及confirmation晚到。首次生成失败后重试成功、零分/正常生成、提交后丢响应或凭证状态保存失败均不得改写原回款DTO或重复现金/AP；VIEW撤回后不得补取凭证详情。授权负例含审批人有权而申请人无权、申请/snapshot actor冲突、停用/软删、角色权限删除/换角色、范围收回/加载失败/合法不限仓；首次业务普通SELECT仍在RF锁后，AP后不反锁原付款账户/FAT。

上述只能证明代码、SQL契约和组件交互，不证明MySQL隔离/锁等待/并发、真实金额结果或供应商已打款。真实278幂等/信息架构、隔离完整资金/退货/补录/凭证/结账链、银行对账与现场双人角色全部待验。本轮不连接DB/生产、不启动app/browser、不提交/推送/合并/部署。

## 静态计划门记录

2026-10-05，独立Plan Spec Accept：F1–F6与主E4无Missing/Extra，准确付款来源、共同AP预算门、借用同conn/current授权/首次批准日期、四位与分位投影、单笔生成/逐笔证明/新6结账门及历史/恢复边界均接受。此为后续分批实施契约，全部F批仍未实现；没有真实资金、MySQL或业务测试结果。

随后独立Plan Quality Accept，静态对照现有用户/角色、资金账户、receipt/statement/AP写方未发现新增Critical/Important；授权锁序、原OUT读取位置和零分完整资金证明可按有限规则实施。此计划质量门不证明SQL可运行、真实并发或实际回款；所有F批仍待代码及其独立双门。

2026-10-05固定现金原回执与后提交凭证结果的窄澄清经独立质量审阅接受：原DTO永久不变，当前凭证状态仅从合法详情另取；外层补录提交前不生成凭证。已补相应负例，全部F批仍待实施。

同日原付款来源写链只读质量核对未发现旧API可删减原分配或恢复RF已减少的paid；补明原FAT无后置硬外键及隐式父锁边界。此为实施契约收窄，不是实际并发证明。

原FAT绑定/父锁边界与F5统一待确认入口窄补已独立Plan Spec Accept→Plan Quality Accept，无新增Missing/Extra或Critical/Important。RF仅新增业务document来源，旧六类审批引擎保留；全部F代码仍待实施，没有测试、数据库或资金结果。

F1外键父锁与延后INSERT窄补经独立规格接受；首轮质量发现取消被收入账户启用条件误伤，已限定启用条件只适用于create/confirm/receive，并允许未执行RF在原合法账户停用/行仍在的软删后取消释放自身预算。修后再次Plan Spec Accept→Plan Quality Accept，无剩余Critical/Important。父门、白名单UPDATE、pending资源FK空及自有新IN与旧OUT区别均为后续实现契约；全部F仍未实施，278未写或执行，不称真实FK锁或并发已验证。

F1取消来源资格与非现金事件的两段窄澄清已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或Critical/Important。原cancelPR保头与明细，RF草稿不占用时PR可先合法取消，RF1仍应沿原身份/授权/范围取消自身记录；不恢复PR、现金或AP。F1不套旧REFUND往来改写，F2实际收到再记唯一正delta。本记录仅计划接受，F1–F6仍未实施、278未写或执行、真实数据库与并发未验。

F2原余额接点限定已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或Critical/Important。准确收入账户X先于statement/AP；原recordTransaction→refreshBalance同conn重入该账户、当前锁读其全流水重算，可能包含同账户原OUT。其他来源账户/OUT仍不追锁，来源证明与原余额投影分别沿已有职责，不新增原OUT FK或缓存累加。仅静态方案核对，F2未实施，MySQL实际执行/等锁/并发未验。

F3已收到来源与后续正常业务窄限定已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或新增Critical/Important。准确累计消费代替新交易剩余准入；正常PR实发3或未发时取消4、AP投影和receipt后续核销不改变原收到事实。F2收入账户X下冻结received_account_type，F3使用收到时科目映射，278需可空字段/准确CHECK，F1不伪填。只有计划接受；F1–F6及278均尚未实施、数据库/金额/锁/凭证/现场未验。

F5/F6共同前端安全交付分组已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra或新增Critical/Important。页面实际写入与持久原体/本人核对/补录恢复同批接受，两套验收分别核后才共同勾选；F1–F4各自代码双门、E7及DB/GUI/现场边界保持。仅分组计划已接受，F5/F6代码未实施；当前F1唯一作者开始基础源码，尚无F代码接受或运行结论。

F1实施前再次静核权限载体：042仅创建sys_role_permissions，roles.service.listPermissions/replacePermissions读取与写入实际授权；前端permissions页消费lib/permission-codes.PERMISSION_GROUPS。纠正计划旧“数据库登记权限”表述为前后端常量/现前端清单，278仅权限说明、零角色授予DML；不新增权限事实源或默认授权。此为准确路径订正，不放宽当前角色锁、业务权限或范围。F1仍实施中，数据库未连接。

F1实施中静核两条真实写链发现数字ID独立自增可正常重合：直付entry ID+PO单号、汇款receipt ID+PY单号。原“碰撞不猜”明确为上述准确三元组和完整parent证明，不能误解成所有biz_id跨表唯一。只读窄挑战认可此反例与推荐；正在进行独立窄Plan Spec→Quality，尚无该澄清代码接受或真实资金结果。原单号需符合141资金流水biz_no的30字上限；稳定完整UUID采用全大写36进制可保全128位且27字，不截断身份、不改旧141。

2026-10-05原直付/汇款独立数字ID来源窄澄清已独立Plan Spec Accept→Plan Quality Accept：准确parent决定唯一(2,biz_id,biz_no)，合法另一单号同ID不误拦，相同三元组重复不按金额/日期挑行。当前F1正在修实际predicate并补完整双parent正例及既有重复负例，旧孤立PY FAT夹具不作为真实合法碰撞或污染证明。RF号已改为完整128-bit UUID的固定25位base36加RF前缀27字，对齐原141 biz_no30；278仅源码。此记录是计划接受，F1代码审阅尚未开始，实际数据库/资金未验。

F1现独立Code Spec Accept→Code Quality Accept，无Missing/Extra或Critical/Important，30路径冻结SHA与精准增量一致。独立77/77及邻接41/41 natural0/signalnull/audit0，有限五生产门撤修52绿25业务红且finally字节恢复；原setup和错误碰撞假设分别列交接。仅F1勾选，F2实际收到开始；F3–F6/E7、278及真实MySQL/资金/GUI/现场均未验证。

F2借用事务的准确定位采用内部 `{purchaseOrderId,purchaseReturnId,refundDate}` locator：正常入口仅BEGIN前从准确RF定位，借用入口由服务器锁定已批准申请的不可变snapshot给出，不接受HTTP body或页面定位。公司/期间与当前actor门后，当前PO S→PR X→RF X精确复核locator、公司与原单身份，才首次普通来源SELECT；不用RF S升级或沿source.peek提前形成RR视图。字段命名只是现已接受借用契约的有限实现落点，F2代码与其独立门仍待完成。

### F2对账刷新精确金额的有限接点（独立窄计划双门已接受）

实际 `reconciliation-statements.service.refreshSettlement(...,{currentRead:true})` 使用Number行累加后toFixed4，F2多行聚合需保四位定点。拟在同一个原刷新函数增加 `exactMoney:true` 明确opt-in，仅F2同时传 `{currentRead:true,exactMoney:true}`：保留原准确完整成员当前读，以decimalMoney BigInt累加和四位moneyText字符串写回；paid取原min(合计paid,total)、balance取原max(total-paid,0)、草稿仍草稿，其他状态仅在四位余额为0且total>0时结清，保留原投影规则。只有该opt-in返回四位文本，旧default/E1 currentRead及旧公开DTO原样，不默认扩全域、不新建投影或金额事实、不改表精度或绕开DB金额上限。F2同conn资金/AP精确金额不因此放宽预算或夹超额。须用合法数据库金额范围的多成员1u真实刷新反例和default邻接，首红/反向/回滚分别证明；本段未实施且当前待Plan Spec→Quality，不称真实DB金额正确。

F2精确对账opt-in已独立Plan Spec Accept→Plan Quality Accept，无Missing/Extra/Critical/Important。原min/max、draft、total>0及default/E1/公开DTO保持，BigInt到写回/optin返回四位文本，不改变额度准入。F2正在实施，并需兑现实际原模块的合法范围多成员1u/反向/回滚/default邻接；此为计划门，不是F2CodeAccept或实际DB结果。

F2作者已冻结21路径并DONE/STOP，根核当前全部SHA、精确增量和四文件反向恢复；专项51/51、六邻接118/118自然0/null/audit0，联合10条件撤修16业务红且0setup，恢复后同最终文本全绿。真实原资金/AP/完整对账/唯一往来/事件/固定永久ACK已在源码接通，实际生成凭证仍由F3承担。当前只进入独立Code Spec，F2尚未完成代码双门；278、真实MySQL/银行/会计/GUI未验证。

F2现独立Code Spec Accept→Code Quality Accept，无Missing/Extra或Critical/Important；独立51/51与118/118自然0/null/audit0、全部21冻结SHA一致，质量核原238/241触发器未重复写往来。F2子项勾选仅表示本地完成；唯一作者开始F3凭证与净付款/四位投影可见性，F4–F6/E7、278/MySQL/资金/GUI/现场仍未验证。


F5/F6现独立Code Spec Accept→Code Quality Accept，原三规格及唯一质量Important均关闭，Critical/Important为0。当前整体47与窄6冻结无漂移、两patch reverse检查及diff为0；实际恢复专项独立57/57自然0/null/audit0/3guards。完整immutable原请求/原ACK/原app组前后核对、一次CAS与合法状态推进不换永久申请身份已闭合；旧57版本与缓存首红、联合9业务反证分别保留。F5/F6共同勾选只表示本地源码/离线双门完成。E7现在执行，278从未运行，真实MySQL/资金/会计/GUI/现场与合并发布仍未验或执行。


2026-10-05 E7最终收尾：本域及整批独立规格→质量→Whole接受，无剩余Critical/Important。最后申请详情query/fmt失败与确定提交的现金/原ACK/落期/凭证证明分别报告；RF已执行重放读原永久结果，不重新settle，真实OperationResult由员工页准确消费。专项独立后端88/88、前端62/62；整批682后端/81契约/1699前端、lint/type及ERP/PDA静态构建均自然通过，网络/受保护配置读取审计0。完整证据、37警告、纯类型overlay与启用验收边界见主执行记录。F1–F6勾选是本地交付；278、真实锁/金额/凭证/银行/现场/生产及提交合并发布始终未执行。
