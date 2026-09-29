# 财务 / 权限 / 时间口径

> **来源**：本文件由 `AGENTS.md` 的 §8 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改账款与核销、凭证与结账、发票、HR 工资、权限与仓库范围、或任何业务日期与账套隔离逻辑时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---


- **顺丰/德邦月结直连（顺丰沙箱已联调、正式月结已绑定，正式下单待验收）**：直连运单在整批 `packDone` 校验通过后，按当前仓库任务已完成箱子自动填件数；每批最多 30 箱，超出分批，各批独立订单号，保存全部母子单号。界面不采集重量；按用户最新约定，顺丰 `totalWeight`、德邦 `packageInfo.totalWeight` 默认传 1（kg），件数仍来自实际箱数，不随件数放大默认重量。该值仅用于下单，最终实重由快递员称重确认，不写入实际重量/运费账单。旧 `DEFERRED_WEIGHT_MODE` 不再使用；已提交请求快照保持原样、仅查询原单。产品默认来自承运商、本单可覆盖，PDA 不决策。未提交平台的运单可补充寄收件、产品与寄付/到付，件数和箱子归属仅后端维护；系统缩批自动移除的未提交批次可恢复，人工作废不自动恢复；已提交箱子变更需先核实原单，当前取消确认同步尚未接入。HTTP 在事务外，提交前固化原始业务报文和凭据引用、不保存密钥；结果不明、进程中断及失败回写后只查原单，不再 create（德邦同渠道号重下可能追加子件）。状态 6 为下单待核实，旧重试入口对此仅查询，已提交直连单禁止通过本地作废伪装平台取消。官方面单打印及实际轨迹查询开通属于独立能力，取到号不等于已完成打印。2026-09-06 已用顺丰官方测试月结号验证本地适配器实际联网下单/原单查询，以及独立沙箱取消、轨迹、两页 PDF 面单；全部测试订单已确认取消。顺丰下单、原单查询、取消、轨迹、PDF 五项官方接口均已上线，应用显示 5/5，正式月结绑定已获平台成功回执。该结果不代表正式下单、生产启用、队列全链路或本地取消/轨迹/PDF 功能已验收。开通与验收见 `docs/direct-express-2026-09-06.md`。
- **德邦接入配置（2026-09-09，纳入 v0.9.11）**：Docker 将根目录私有 `.env` 的德邦默认凭据组七项配置仅注入后端，默认 production；本地 Node 使用 backend/.env。正式接口必须为官方 HTTPS。sandbox 仅额外精确允许对接人提供的创建 10348 与原单查询 10347 专用 HTTP 地址，两种用途不能互换；生产运行禁止使用沙箱。真实权限、凭据及联调结果独立核对，不用配置完整或离线回归冒充正式开通。用户 2026-09-07 已提供并确认另配 IP 测试环境的下单/原单查询，正式权限按对接人答复上线后配置；不能再索取同一组测试资料或以官网旧沙箱进度否定独立测试环境权限。2026-09-09 独立 IP 测试环境改用用户原月结号后，XJTK/DJTK 两箱均仍只回一个号码，创建和查原单均成功响应；子母件处理需按流水核对，不据此重索已配置的接口权限，不改合同产品或放宽箱数校验。官网本地联调已成功，已用现有联系人资料、无面单照片方式成功提交人工上线审核，平台要求德邦对接人起草工作流；尚非正式审批通过或生产下单可用。实测及未撤销的测试记录见 `docs/deppon-onboarding-2026-09-09.md`，配置规则见 `docs/direct-express-2026-09-06.md`。

- **快递月结账号绑定页**：`/carrier-accounts` 复用承运商查看/编辑权限，仓库人员在同页搜索/选择已有承运商，或新增名称、平台、月结号，再选择中文常用服务；不录密钥、凭据引用、重量或官方短信验证码。GET/PUT `/api/carriers/:id/account-binding` 返回准备状态、严格校验输入，并以行锁与绑定字段摘要拒绝过期覆盖。快捷新增 POST `/api/carriers/account-bindings` 使用创建权限及稳定请求键，单事务建立默认暂停的承运商/月结资料，断网重试返回原记录；列表按有界批次完整加载。解绑提交 action=unbind 与 revision，须先暂停且无待处理运单，清空本地月结号与常用服务但保留承运商、凭据引用及历史，不解除官网授权。快递账号绑定页不再提供删除入口、删除提示或删除确认框；前端不调用删除接口。承运商管理中的主档删除仍要求自动下单已暂停、月结号已解绑，且无销售订单、运单、运费明细或结算单引用；后端在事务内检查后软删除空记录。保存资料默认暂停；单独暂停仅提交 action=pause 与 revision，不能因历史账号/服务格式不合规而失败；启用需正式接口配置、常用服务及管理员登记的已验收月结号全部就绪。更换月结号须先暂停且无状态 1/2/4/6 的待处理运单。顺丰服务默认内置特快/标快，可由服务端 `WAYBILL_<REF>_PRODUCTS` 覆盖为合同列表，已验收账号使用 `WAYBILL_<REF>_VERIFIED_MONTHLY_ACCOUNTS`；这仅是简易页的管理员验收记录，不冒充官方在线授权验证，也不追溯关闭既有高级配置入口或历史运单。开通步骤与验收边界见 `docs/direct-express-2026-09-06.md`。
- 快递账号资料衔接（2026-09-08，纳入 v0.9.11）：承运商管理在未启用取号时也展示平台选择并保存，绑定页只对缺少平台的旧档案要求补选，不按名称猜测平台；已配置时直接显示承运商带入的快递公司。两个页面共用 carriers 查询失效范围，刷新绑定状态但保留同平台月结资料的未保存草稿及其原 revision，避免覆盖同事的新资料。承运商列表可定位对应账号，已打开的绑定页按新的页面定位切换、有草稿时先确认。账号页仅保留业务填写项、必要状态和操作，移除重复开通步骤及技术长说明。顺丰内置官方常用产品 1（顺丰特快）、2（顺丰标快），可由 PRODUCTS 覆盖为合同选项；展示产品不代表月结授权。说明与验收见 `docs/carrier-account-ux-2026-09-08.md`。
- 快递生产配置传递（2026-09-08，纳入 v0.9.11）：`docker-compose.yml` 将根目录私有 `.env` 中两家默认凭据组传入后端容器，不传前端、不打入镜像；本地 Node 仍读取 `backend/.env`。Docker 默认正式模式，顺丰默认官方正式地址；德邦正式下单/原单查询地址及 sign 依平台实际分配填写，不能复用此前 HTTP 测试地址。`test:direct-express` 包含配置传递回归。2026-09-09 顺丰正式凭据已配置到服务器私有 `.env`，通过服务器专用 `docker-compose.override.yml` 仅注入后端；基础映射发布前该覆盖文件须保留，后续移除须先核对渲染配置等价。沿用已部署镜像，仅重建后端，内外 ready 及生产账号 GET 验证通过，现有适配器使用运行时凭据取得正式原单查询 6150 回执。官网应用 5/5、正式月结绑定已复核，但尚待常用服务选择和真实订单验收；验收清单为空，自动下单暂停，不能宣称已可真实发货。德邦仍未配置。备份、验证及收尾见 `docs/carrier-production-setup-2026-09-08.md`。


- **往来明细账（v0.9.10）**：`/payments/ledger/customer/:id` 与 `/payments/ledger/supplier/:id` 读取 `GET /api/payments/party-ledger`，使用公司级 PAYMENT_VIEW 权限。迁移 238 保存启用时净余额为历史结转，以后在原业务事务内记录账款总额变化、直接收付款/退款、汇款单登记；核销不重复影响往来净额。正余额为欠款，负余额为预收/预付或应退款项，不能当成资金账户余额。单位 ID 从原销售/采购单取得并固化；汇款由核销源单或显式选择的单位 ID 归属，旧客户端名称仅在现名/历史快照名唯一时兼容；迁移 239 回填 receipt.party_id，240 禁止触发器覆盖服务层明确的空归属。继续核销必须保持相同单位 ID，空归属不能核销到已知单位。无明确归属的手工/运费或历史记录保留待核查，不用模糊名称塞进单位明细。按记账时间算期间余额，业务日期仅供追溯；启用前不可伪造历史流水。执行迁移前须停止业务写入（含定时任务/worker），完成后再启动。说明和验证见 `docs/party-ledger-2026-09-08.md`。
- `payment_records` 按 `(type, order_id)` 幂等；应付变化需遵守财务确认闸门。账款重算、退货/退款、对账投影保持同事务一致。销售授信与应收均按 `total_amount - discount_amount` 的折后净额计算；首次占库与补占均先从已用额度排除本单再加回本单净额，预览采用相同口径；出库复查本单敞口还要扣除已收款，整单折扣按已发原值占订单原值的比例分摊，不能按商品数量比例分摊。已批准的超额授信申请只在客户、信用额度和本单净额快照一致且当前超额不超过获批额度时有效，订单或额度变化后不得沿用旧审批扩大敞口。
- **历史账款修复（2026-09-08）**：生产两笔应收已校正，合计 358.43。采购侧后续按用户“直接改到符合逻辑的状态”授权完成：收货 ID 1..4 补齐采购关联；收货 1 根据旧入库流水 108、在库容器 101 恢复已完成/已结算、上架数量 1，容器 101 归入该收货行；重复或随已取消采购遗留的未上架容器 102..105 作废，收货 2..4 已取消。保留原始快照及调整事件，采购状态、应付 33.13、ACTIVE 库存和预占均未改变；没有新增实际收付款/出入库/退货。38 项只读检查已无前述差异；新增代码守卫纳入 v0.9.10。状态 3 是待上架，`putaway_qty=0/audit_status=0` 本身正常。修复依据与验证见 `docs/production-receivable-audit-2026-09-08.md`、`docs/purchase-repair-2026-09-08.md`。
- 结算方式和 due_date 是首次生成账款时的快照，补收/退货/分批发货不能追溯改写。到期日复用 `buildDueDateSql()`；月结才使用账期，基准日取结算发生的北京时间日期（与 MySQL 会话时区无关）。回款状态独立于销售订单状态，按账款快照显示。
- 客户/供应商批量导入只接受现结（`现结`/`1`）、月结（`月结`/`2`）或空值（默认月结）。`3`/`4`、旧名称及其他非空值逐行报错，不静默映射；现结账期归零。历史 `normalizeSettlementType` 的 3/4 兼容仅供既有数据读取与原有调用，不证明任何现存月结档案来自误导入。追查历史来源须有原文件、导入回执或其他可核实的来源证据。
- 对账单候选 `GET /api/payments/statements/candidates` 返回原账款 `id`，创建对账单必须把该 `id` 作为 `recordIds`；已建对账单详情的明细才使用 `recordId`。月结供应商“全部账款”对 `confirm_status=0` 的应付提供受 `payment.confirm` 权限控制的“确认结算”入口，核对收货上架明细后调用现有确认接口；仍只能经已确认对账单核销，不能在该列表直接付款。确认、对账和资金流水分别由后端事务校验，重复确认不可重复出款。
- 成本 `avg_cost` 按既定入库移动加权，退货/撤回不反冲是既有设计；利润使用成本快照，不“顺手修正”。
- 利润/库存分析（2026-09-12，工作区修复）：销售仅统计已完成订单，日期按开单时间；净额为整单原值扣折扣，每单只计一次，商品按明细金额比例分摊净额，成本快照回退链保持不变。读取沿用销售整单仓库范围（头仓及全部明细仓均需授权）。库存/滞销汇总覆盖全部授权数据，不从前 20/30 条排行榜推算；滞销库存与最后出库采用同一授权仓库集合，按商品合并，含无出库记录。本页滞销卡片打开同口径明细；分仓库龄与移动加权成本估值仍属另一分析口径。报表加载未知值不显示零，刷新失败保留旧数据并警示；库龄与效期分别重试，未打开效期不主动刷新。详见 `docs/report-correctness-2026-09-12.md`。
- 经营 KPI（2026-09-12，工作区修复）：销售沿用 `sale_date` 业务日期和已出库状态，净额扣整单折扣，每单只计一次；当期/上期/趋势/分仓使用同一金额、成本快照及销售整单仓库范围。月份采用半开区间，趋势止于所选月末；回款按 `payment_date`，无限制仓库账号保留全部应收分录，受限账号仅纳入可归属至有权查看的非删除销售单回款（不要求来源单已出库），无来源手工款不推断仓库。分仓仍按订单头仓库，销售占比为本仓净额/全部分仓净额；负值上期环比以绝对值作分母。接口 `gmv` 键兼容保留，展示名改为销售净额；利润页按创建时间，两个页面不能直接比较日期汇总。详见 `docs/kpi-correctness-2026-09-12.md`。
- 仓库运营状态与当前状态机保持一致：今日出库只统计 `WT_STATUS.SHIPPED`，优先按 `shipped_at`，历史空值回退 `updated_at`；拣货中只统计 `PICKING`，今日入库只统计收货订单 `finish.to` 的已全部上架状态，完成日期暂沿用 `updated_at`。三项及流程积压排除软删除任务；积压只含 `WT_STATUS_ACTIVE` 六个阶段，标签来自后端状态名，前端颜色引用生成常量，不再手写旧五阶段映射。

- 仓库运营与 PDA 日志读取统一按当前用户仓库范围过滤；错误/撤销/扫码通过任务归属仓库，受限用户排除无归属日志，空仓库范围返回空结果。`/scan-logs/task/:taskId` 先校验任务存在与范围；统计/异常日期按北京时间整日，结束日使用次日排他上界，单侧日期独立生效。仓库运营最新异常限今日最近10条并追加ID稳定排序。GET异常分析仍有既有按需建表DDL，不能当作数据库完全只读。新增 `smoke:warehouse-ops` 使用第3节独立测试环境，已接入Tests CI；范围、日期、现行状态口径及本机证据见 `docs/warehouse-ops-regression-2026-09-12.md`。

- 区分公司级业务口径与带 company_id 的会计/发票账套口径；不能只在报表一端加账套过滤、另一端凭证生成仍读全量，造成勾稽失衡。改变隔离必须核对数据表、写入、回填、查询和报表全链路。历史背景见 `docs/claude-md-archive-2026-09-04.md` 第 20 节第 50 条。
- 采购来源凭证金额变化/归零使用自动红字修订链，保留原分录；迁移 `232_acct_voucher_source_revisions.sql` 的 `source_root_id` 指向唯一来源根凭证。恢复金额新增正向修订，重算幂等；人工红冲后不自动恢复，已结账期间不可改写。凭证写入与期间开关先锁账套行；序号最大值使用当前锁定读。总账/导出必须包含原凭证及其红字抵消，不能用 `status<>3` 过滤掉原凭证。普通删除不得删除红字、被冲销凭证或有冲销关联的凭证。
- **销售跨期凭证（2026-09-22）**：收入与成本按 `warehouse_tasks.status=7`、未删除任务的 `shipped_at` 归属实际出库月；以任务明细 `picked_qty` 按销售单、商品、任务仓库唯一关联销售行，并逐行核对累计任务量与 `sale_order_items.shipped_qty`。缺日期、没有真实出库任务、来源缺失/重复或数量不一致抛 `ACCT_SALE_SOURCE_INVALID`，不能用首次应收日期猜历史。只读批量取数不改业务事实。成本沿用销售行首次固化的 `cost_snapshot`（缺失按 0），不是新增逐批成本快照。
- 销售期内金额取按出库日期、任务 ID 稳定排序的累计值之差：折扣按已发原值占整单原值分摊；税额累计目标为 `min(整单销项税额, 累计折后净额)`，期间取差，不能每个月重扣整单税额；成本也用累计两位金额取差消除尾差。销售退货仍独立冲收入/成本，不从发货毛额再扣一次。业务事实仍为单租户共享口径，凭证、发票税额、历史抵扣与闭期检查按账套隔离。
- 销售跨期投影以十进制字符串解析并用 `BigInt` 固定点累计：数量两位、销售基本单位单价八位（迁移 187 的多单位折算精度）、成本快照四位。每期金额从精确累计值四舍五入到分后相减，不能先用浮点乘加再修尾差；例如三期各 1×1.005 的收入/成本为 1.01、1.00、1.01，合计 3.02，与一次发货一致。销售分录、历史分录抵扣、借贷校验和 SQL 写入保留两位十进制字符串；人工红冲头金额及分录直接复制数据库精确金额，完整支持 `DECIMAL(16,2)`；单行或凭证合计超界明确拒绝，不经过 Number 静默丢分。其它来源的既有金额接口保持不变。精度回归见 `tests/accounting-sale-money.test.js`。
- 业务勾稽概览除原来源和自动修订外，也纳入 `source_type=manual`、`is_reversal=1` 且 `reversed_id` **直接关联同账套相关业务来源**的人工红字；资金按反冲方向扣减，应收/应付按分录借贷净额抵消。不把独立手工凭证、手工凭证的红字或其他来源红字混入业务勾稽。人工红冲后业务事实本身不回写，概览可如实显示与业务余额的差异。

- 迁移 `256_acct_sale_source_period.sql` 增加 `source_period`，销售唯一来源为 `(company_id, source_type, source_id=销售单ID, source_period=YYYYMM)`；其它来源及旧累计根保留空期间。旧凭证与分录不搬期、不改金额；新期间投影为「真实当期目标分录 − 同期间旧累计根已记净分录」。例如旧八月 50、事实八月/九月各 50，九月只记 50；旧八月 100、事实各 50，开放时追加八月负 50/九月正 50。账套锁后的历史凭证、分录与闭期对账使用当前锁定读，避免调用方旧事务快照漏抵扣刚提交凭证。期间根后续变化、归零、恢复复用 `source_root_id` 自动修订链，保留历史分录。人工冲销旧累计根停止该销售来源的自动恢复；人工冲销期间根停止该期间恢复。
- **闭期与历史兼容边界**：生成任一月份之前先对账全部销售闭期；历史归期或金额不一致抛 `ACCT_SALE_CLOSED_PERIOD_CONFLICT`（订单 ID、期间、来源类型），即使请求的是后月也不可绕过。没有可验证出库事实的历史累计量必须先核查修复来源，不自动回退日期。结账入口补只读销售来源完整性检查，漏生成/陈旧投影抛 `ACCT_SALE_VOUCHER_REQUIRED`；该检查与凭证写入共用账套锁，但实际出库事务未持该锁，**不保证检查之后的实时出库与结账互斥**。跨期回归见 `tests/accounting-sale-period.smoke.test.js`，采购既有修订回归仍由 `tests/audit-finance-security.smoke.test.js` 覆盖。

- **资金期间闸门与跨期补录（2026-09-26，任务 7）**：收付款登记、核销、退款出账三条资金入口在写入前调 `assertFinancePeriodOpen`（`accounting/finance-period.guard.js`）；业务日期落在**已结账**期间（`acct_periods.status=2`）默认返回 **409 `FINANCE_PERIOD_CLOSED`**，不再静默放行。有权限者（`finance.period.backfill`——**只加常量、不写 seed 迁移**，与 `PAYMENT_CONFIRM` 同样"不 seed、由产品手动开放"）可带**必填原因**走特权补录，落痕于 `finance_period_backfills`（迁移 258/260/261）。**补录不撬开已封的期间**：业务数据（账款余额、`payment_entries`、资金流水）按业务日期落库，资金流水 `happened_at` **保持业务日期不变**；调整凭证落在**执行审批当天所属的未结账期间**（`voucherDateOverride = beijingTodayYmd()` 写入 `finance_account_transactions.voucher_date_override`，凭证引擎取 `r.vdate_override || r.vdate`）。**生成时机是"业务提交后立即"**：`finance-backfills.service.js` `execute` 提交业务事务后立即 `settleVouchersFor`，跑 `generatePeriodVouchers` 并**逐笔核对**本申请产生的每条资金流水（有**有效**凭证、期间=补录当期、借贷各自等于该笔流水金额、分录 ≥2 条），通过才置 `voucher_generated_at`；核对不过才写 `voucher_generate_error` 停在待生成，由审批页 `regenerateVoucher` 与定时 `retryPendingVoucherGeneration` 重试。两段事务**不可合并**：凭证生成是独立的全量重算，读的是已落库的流水与单据，塞进业务事务会读不到自己未提交的写入、把刚补好的凭证判成缺失。**若补录当期（审批当天所属期间）本身也已结账**：`assertFinancePeriodOpen` 在**业务事务内、已持账套锁与期间行锁**时调 `assertBackfillPostingPeriodOpen(..., { lockForUpdate: true })` 复核，直接 **409 `FINANCE_BACKFILL_POSTING_PERIOD_CLOSED`** 拒绝——**业务分文不写**，补录单停在「已批准 · 待执行」，**不是"钱先动了、凭证再补不上"**。`resolvePostingPeriod` 里另有一道不加锁的**预检**（措辞相同、为的是在写业务之前就给出明确拒绝）；预检通过不代表写入时仍放行，事务内那次才是真正的防线。**证据强度：端到端。** `tests/finance-backfill-approval.smoke.test.js` **§O** 就是这条的反例：申请后、批准前把**真实的当期行**临时置为已结账（先连原值快照，finally 按原值回写；原本不存在则删本轮新建行——两条分支各实跑一次），批准即返回 409 `FINANCE_BACKFILL_POSTING_PERIOD_CLOSED`，并断言停在「已批准 · 待执行」、付款分录 0 条、账款已付仍 0、资金流水数不变。~~此前标注的"该错误码在 `tests/` 中零引用、无专门反例回归"~~ 已作废。核销类补录（`receipt_settle`）**本来就不产生资金流水**，按 `NO_FUND_TXN_BIZ_TYPES` 跳过核对，不判为失败。回归 `tests/finance-backfill-approval.smoke.test.js`、`tests/finance-period-guard.smoke.test.js`。
- **资金写入与结账的锁模式必须分离（2026-09-26）**：普通资金登记只取**共享锁** `lockAccountingCompanyShared`（`acct_companies FOR SHARE` + `acct_periods FOR SHARE`），跨期补录与 `closePeriod` 取**排他锁** `lockAccountingCompany`（`FOR UPDATE`）（`accounting/accounting.period-lock.js`）。共享-共享兼容 ⇒ 并发登记**不互相串行化**；共享-排他互斥 ⇒ "检查时未结账、写入时已结"这一竞态被挡住。加锁顺序全链统一：**账套 → 账户 → 对账单 → 账款**；凭证写入与结账**必须共用同一把账套锁**。**把任一侧改成另一种模式都会坏**：全排他 → 并发登记排队（性能退化为串行）；全共享 → 结账挡不住写入（闸门形同不存在，正是本模块存在的理由原样复现）。回归 `tests/finance-period-lock-order.smoke.test.js`（含**反向验证**：改回排他锁后 §1 精准红 `ER_LOCK_WAIT_TIMEOUT`，其余断言不受影响）。注意 `acct_periods` 主键是 `(company_id, period)`，**没有 `id` 列**。
- **非单据应付进总账（2026-09-26，任务 3）**：运费结算与手工应付原先只在 `payment_records` 落账、不进凭证引擎。现 `voucher-engine.js` 的 `generateVouchers` 内 `...await buildUnbilledPayable(conn)` 把**无业务单据来源**的应付接入主流程，按 `is_freight` 分派 `SOURCE_TYPES.FREIGHT_SETTLE` / `MANUAL_PAYABLE`。借方科目取 `payment_records.debit_account_code`（迁移 `259_payment_debit_account.sql`）；**该列为 NULL 表示历史未分类，引擎跳过、不猜科目**。手工录入走 `payments.service.js` `createManual`，`assertDebitAccount` 拦不存在/已停用/汇总科目/2202 本身；运费侧 `logistics.freight.js` 固定写 `6601`。回归 `tests/payable-posting.smoke.test.js`。

- 重置密码、禁用或删除超管时在服务层锁定操作人/目标，验证操作人确为超管；拥有普通用户管理权限不等于能接管超管。改价未匹配审批流应返回明确配置业务错误，不越过审批或抛空引用 500。
- 修改登录账号只允许超级管理员，服务层锁定操作人和目标用户并检查活跃账号唯一性；改名后旧账号不能再登录，现有会话通过用户 ID 读取新账号。密码仅存 bcrypt 哈希，用户管理列表、详情与导出不返回原密码或哈希；管理员只能重置密码，沿用现有会话失效机制。回归见 `npm run smoke:user-account-management`。
- 自行审批是用户级 `allow_self_approve`，授予仅超管；复用 `selfApprove.js`，不扩大成全局豁免。收回立即生效，相关测试 finally 还原不可删除。
- 每个业务接口鉴权与服务端权限校验；权限常量在 `backend/src/constants/permissions.js` 与 `frontend/src/lib/permission-codes.ts` 手工同步，必要时追加 seed 迁移并跑一致性测试。前端隐藏按钮不能替代权限控制。
- 仓库范围用 `user_warehouse_scope`、`scopeFilter` / `assertInScope`；按业务是否涉仓接入。财务公司级接口不能盲加仓库过滤。
- 塑料盒所有读写和资料导出均执行仓库范围；空盒创建校验启用商品、仓库和库位归属，删除锁容器并复查余量及任务锁。供应商采购门户继承采购仓库范围；客户对账门户通过账款来源销售单的客户 ID 关联，不能用名称模糊匹配，无法唯一关联的历史记录保留在财务总列表供核查。
- PDA-only 写操作同时遵守 `X-Client: pda`、设备会话和绑定仓约束，ERP 不能绕过。未绑定设备显示受限引导，不放行业务请求。**后端挂了 `pdaOnly` 的路由，前端对应调用必须显式带 `X-Client: pda`**——`X-Client` 是逐个接口手加的，2026-08-09 给收货路由加守卫时漏了 `receiveInboundApi`，导致 PDA 收货 403「此操作仅允许 PDA 扫码完成」并在生产里完全不可用（2026-09-14 发现）。新增/修改 PDA-only 路由或前端调用后必须跑 `node --test tests/pda-only-client-header.test.js`，该静态契约测试逐个比对 pdaOnly 路由与前端调用；细节见 `docs/pda-receive-pda-only-2026-09-14.md`。
- 会计查询键包含账套 ID；切换账套取消并清理会计缓存、重置会计页面编辑状态并明确提示，存在提交中的写请求时拒绝切换。请求固定发起时的账套，迟到的旧账套响应不得显示。导出和错误上报共用认证客户端，二进制业务错误必须恢复为可读提示。
- HR 工资明细通过已有模块 GET /payrolls/:id、PATCH /payrolls/:id/lines/:lineId 维护，应发须明确录入（0 合法），仅草稿可编辑，PATCH 要求不超过 80 字符的稳定请求键。HR 写入先锁账套再锁单据，与凭证锁顺序一致；累计台账保留负净额，计税时才截为非负税额。核算逐月验证本年度任职起月至上月的工资与累计链，缺月或陈旧台账拒绝；缺少入职日期以可知首期工资为起点，不允许后来补建改变已使用的起点。已有已核算/发放后月时，拒绝改变上游，结果完全相同的重复核算仍允许；发放再验前月已发及本期台账。扣款超过应发拒绝核算，发放核对明细与汇总金额，个人社保凭证取明细合计。旧版无录入标记或累计失效的单据禁止直接发放，不自动改历史凭证；详见第二轮工资修复说明。
- 资金余额聚合在账户锁后使用当前锁定读，删除账户同事务锁定并检查流水。资产计提账簿与凭证共用实际封顶金额；重复月份不重写累计值；提足资产仍允许处置，处置补提与处置凭证同事务。
- JWT access/refresh 分工、token_version、refresh jti 一次性轮换要一起维护；改密码/禁用可撤销旧会话。登出清理 React Query 缓存。
- 登录/退出属于公开路由，不能用请求体 `username` 或未经验证的 JWT 作为操作日志身份。登录成功仅从 service 已校验的用户回执设置请求内 `operationActor`；退出须校验 refresh 类型、签名、用户版本及未作废会话，并在事务中完成 jti 作废后才设置该身份。无效、过期、重复退出保持匿名。通用 `operation_logs` 与 `auth_audit_logs` 对成功认证记录同一账号，密码和 refresh token 继续脱敏；回归入口 `tests/auth-session-remediation.smoke.test.js`（独立测试库）。
- 客户端登录/退出递增仅内存中的会话代次，正常 `setTokens` 续期不变；请求首次派发绑定代次，迟到响应、续期、重放和 PDA 换票前均检查归属。旧会话不能覆盖新账号或以新账号执行旧请求。PDA 旧心跳取消不清票据，其他失败也仅清同代次且仍匹配原 token 的票据。创建账套纳入 mutation，提交中禁止关闭、重复创建及账套切换，成功刷新列表。
- refresh 请求复用运行时 API 基址和超时配置（含原生自定义服务器地址），并发 401 共用一次续期，失败统一清会话；不能从 Electron/file 或 Capacitor origin 请求相对 `/api`。
- 公开登录/更新/健康检查与公司 Logo 等是现有明确例外，新增接口不得据此省略鉴权。Logo `<img>` 场景不能携带 Bearer；更改公开资源策略需核对桌面跨源加载。
- `/health`、`/api/health` 为存活/网络检查；公开 `/api/ready` 用应用连接池执行只读探测，整体最多2秒，短缓存合并并发，仅返回就绪状态。新版本部署与服务监控使用 ready，回退尚无该接口的旧镜像才允许原存活检查。连接池获取默认最多5秒（`DB_ACQUIRE_TIMEOUT_MS`），超期返回503且不派发排队 SQL，迟到连接归还；不把已开始的事务用响应超时伪装成取消。
- **业务日期唯一时区为北京时间**：前端复用 `lib/dateTime.ts`，后端复用 `utils/backendTime.js`，数据库/容器配置保持一致。mysql2 从 `DATE` / `DATETIME` 读出的 `Date` 对象也须显式按北京时间取年月日，不依赖运行主机的本地时区。禁止用 `toISOString().slice(0,10)` 充当北京业务日期。
- DATETIME 查询按既有半开区间处理，DATE 列按日期语义处理；不可机械统一为同一种边界。到期日等于北京今天时不算逾期。


## 数量策略的最小只读权限（2026-09-22）

`GET /api/products/qty-policies` 只返回所查商品的 `id/allowDecimal`，允许商品查看权限或该规则实际消费页面的数量作业权限任一访问（收货、退货执行、盘点、销售建改/占释/发、采购/请购、调拨、处置、库存调整/拆分）。仍经 `loadRolePermissions` 与 `requirePermission`，无相关权限返回 403；商品列表、finder、详情的完整主档/价格权限不放宽。对应白名单以 `products.routes.js` 为准，测试 `product-qty-policy-route.test.js` 同时检查合法作业账号、无权限账号及完整商品记录仍受限。

### 2026-09-22 授信与账号权限整改

- 授信放行提交未匹配审批流时返回 `409 CREDIT_APPROVAL_FLOW_REQUIRED` 并保持草稿；历史待批单没有活跃审批实例也不能直接批准/驳回，需撤回后按有效流程重新提交。申请权限不能代替审批步骤权限。
- 部门负责人用于审批流寻人：新指定负责人必须是启用且未删除的用户；历史负责人失效时部门页警示并要求更换或清空。删除部门除检查子部门、直属用户外，还拒绝被任何审批流节点显式引用的部门（包括已停用流程），先调整流程再删除；申请人所属部门 `department_id=0` 不算显式引用。运行中的审批实例按既有快照处理。部门安全回归接入 `npm run test:permissions`。
- 普通操作人不得给自己改角色；分配他人角色必须存在且权限为本人权限子集。角色选项通过专用 API 动态读取，未分配权限的角色不靠前端隐藏来保护。
- 迁移 `257_seed_job_role_presets.sql` 增加仓库作业员、库存专员、采购主管、销售主管、财务专员、会计、客服专员七个系统预置岗位，并按岗位授予最小可用权限；不授用户/角色管理、设置、审批流配置、应付结算确认、资金账户调整、会计结账或授信直接放行权限。临时角色编码表显式使用与 `sys_roles.code` 相同的 `utf8mb4_unicode_ci`，避免 MySQL 8 默认排序规则不同导致迁移失败。只给新插入的角色写初始权限，重复执行不补回管理员后来撤掉的权限；现有角色与账号不改派。所有前端隐藏 `smoke_` / `codex_` 开发角色仅影响展示，不能当作鉴权。
- “我的信息”与“我的仓库权限”通过 `/users/me`、`/users/me/warehouse-scope` 从认证身份读取，仅返回本人资料；不要求 `user.view`，也不接受客户端传入目标用户 ID。管理其他账号的 `/users/:id` 及仓库范围接口仍要求相应查看权限。
- 限仓操作人新建账号继承其范围；仓库授权必须为本人范围的非空子集，拒绝通过他人账号获得不限仓权限。写入与操作人状态校验共用用户行锁。

### 2026-09-23 审计确认修复

- PDA 会话的 `user_id` 必须等于当前 JWT 用户；作业和续期共用校验，失败不更新会话活跃时间。
- 条码详情在返回前校验当前仓库范围。角色权限仅请求内复用，仓库范围每请求从数据库读取，移除不能跨进程撤销的 60 秒缓存。不限仓的既有业务定义保持。
- 收付款核销的累计、比较和余额使用四位固定点整数，写 SQL 时传十进制字符串，API 边界才转数字；超过四位小数显式拒绝。账户投影的期初与流水聚合也按同口径相加，支持负余额。

### 2026-09-24 认证与资金账户整改

- 个人改密码在同一事务内锁定用户、验证旧密码并更新口令；管理员并发重置后，个人请求不能凭旧快照覆盖新密码。refresh token 必须带一次性 jti；迁移前没有 jti 的令牌要求重新登录。密钥轮换期间，登出与续期均尝试当前及上一把密钥，并只撤销 refresh token 的 jti。
- 资金账户期初、调整目标与流水金额在 service 写入边界调用 `moneyUnits` 校验；超过四位小数返回 `MONEY_PRECISION_INVALID`，合法值作为十进制文本写库。余额差额按固定点计算，避免先转 Number 再被数据库静默舍入。

### 2026-09-27 列表导出必须与页面同口径

- **规则**：列表导出必须透传对应列表接口 `findAll` 支持的**全部**筛选。页面筛了、导出却不过滤，会让用户把**其他往来方**的账款一并交出——这是对外的信息泄露，不只是「数字对不上」。
- **边界**：`getStatementsExportPayload`（对账单）与 `getPaymentReceiptsExportPayload`（收付款单）此前只透传 `type/status/keyword`，丢弃往来方/单号/日期/金额区间；同文件的 `getPaymentsExportPayload` 在 2026-09-18 审计已修过同类问题，属同根因的漏网实例。
- **可选 ID 的空值语义**：`customerId`/`partyId` 传给 `findAll` 前必须把空串规范为 `null`——`findAll` 判 `!= null` 后 `Number('')` 得 `0`，会抛 400「编号无效」，而清除筛选后前端常发出 `customerId=`。分页（`page`/`pageSize`）由 `collectExportRows` 注入，不属于筛选。超过 `EXPORT_MAX_ROWS` 一律明确拒绝，不静默截断。
- **回归**：`npm run test:export-filters`（纯离线，从 `findAll` 签名解析筛选键）与 `smoke:prelaunch-scope-export`（真实服务 + 真实库）。两者都做过反向验证：摘掉任一透传即精准报红对应的那一条。

### 2026-09-27 改价审批的自批内控（P8）

- **自批豁免** `sys_users.allow_self_approve` **只有超管**能改（`users.service.assertCanGrantSelfApprove`，否则 403 `SELF_APPROVE_GRANT_DENIED`）；`utils/selfApprove.canSelfApprove` **不做缓存** ⇒ **撤销对该用户的下一次判定即时生效**。
- **撤销与既有单的关系**：新提交由 `approvalEngine.startApproval` 重查挡；**既有未完结实例**由**动作层的 `assertNotSelfApproval` 每次重查**挡——**"运行中的实例按既有快照处理"针对的是选人名单，不等于"撤销对既有单无效"**。
- **`price-change` 必须与其余五个审批模块同范式**：`approve`/`reject` 在动作处调 `assertNotSelfApproval`。缺这一层时有两条绕行：① `assertCanApproveTask` 对 `roleId===1` **恒放行** ⇒ 超管自提的改价即使 `allow_self_approve=0` 也能自批；② 快照已含本人 ⇒ 撤权后仍可批既有单。
- **"本人"是两个身份**：申请单 `applicant_id` 是**创建人**，引擎实例 `applicant_id` 是**提交人**（`create` 与 `submit` 可不同一人，且 `submit` 目前无归属校验）。动作处必须**对两个身份都做当前授权断言**（相同 ID 去重）——只查创建人会漏掉提交人自批（含提交人为超管的情形）。回归 `tests/price-change-history-oldprice.smoke.test.js`（含 A≠B、超管自提、撤权后自批三条反例）。
- **归属校验（是否阻止 B 提交他创建的单）单列待定**，不并入本次改动。

### 2026-09-27 费用报销付款的跨期闸门（第四条出钱路径）

- **规则**：写 `finance_account_transactions` 的**四条**出钱路径——直付登记、收付款单核销、**费用报销付款**、退款出账——在写入前都必须过 `assertFinancePeriodOpen`（`accounting/finance-period.guard.js`）；业务日期落在已结账期间默认 409 `FINANCE_PERIOD_CLOSED`，整事务回滚、分文不写。
- **范围按「凭证引擎实际读什么」定，不按「谁写 `payment_entries`」**：`voucher-engine.buildFundVouchers` 是读资金流水 `biz_type IN (1,2,3,5)` 来生成 receipt_in / payment_out / **expense_pay** / refund_pay 四类凭证的。早期按后者界定落点（三个入口），而**费用报销付款只写资金流水、不写 `payment_entries`**，被整条漏掉。后果分两层，**证据强度不同、不要混用**：
  - **实测已证实（业务侧三项）**：闭期付款被放行 ⇒ 报销单状态照常流转、资金流水照常写、账户余额照常扣。
  - **代码审阅推断（未端到端实测）**：该笔流水的 `EXPENSE_PAY` 凭证会在**后续生成凭证时**因期间已封被 `generateVouchers` 跳过（`skippedClosed`），会计账上因此缺此分录。若真发生，**跳过那一步**会落一条 `logger.warn`——注意 warn 只在「真的去生成凭证并撞上已封期间」时才产生，不是付款当时就记；而**界面自始至终无任何提示**。（本轮未跑 `generateVouchers`：它是唯一生成入口且会写销售凭证，污染共享库。）
- **可达场景**：界面付款弹窗只传 `accountId`、不传 `happenedAt`（`frontend/src/pages/finance/expenses/index.tsx`），故界面路径的付款日期**恒为今天** ⇒ 真实触发是「**当月已结账后又在本月付款**」（提前结账），与直付路径受闸门保护的场景同构；API 侧 `happenedAt` 为可选自由字符串，可传任意历史期间。
- **锁顺序**：闸门放在行锁**之前**（`pay` 事务内先于 `lockStatusRow`），账套锁是全链最外层，与直付登记、固定资产计提/处置同序「账套 → 单据 → 账户」。有效业务日期只算一次（`happenedAt || beijingTodayYmd()`），闸门判定与落库共用同一值，避免「判的期间」与「写的期间」错位。
- **拒绝措辞按 `backfillHint` 区分**：有补录出路的入口（直付/核销/退款）默认保留「改用未结账的日期登记；确实发生在该期间的可走跨期补录」。费用报销付款传 `backfillHint:false`，改为「**请联系财务负责人核实处理方式；请勿为了让系统接受而改动真实付款日期**」——`finance-backfills` 没有 expense 分支，引导补录是走不通的路；而**提示「改用别的日期」更糟**：那等于诱导操作人把真实发生的付款日期填成假的，事实失真比账实不符更难查。
- **未做 / 待决策**：费用报销**当前缺少合规的跨期补录路径**（`finance-backfills.service` 无 expense 分支），闭期报销付款只能由**财务负责人人工决策处理方式**；是否补齐补录通道（需增 expense 分支及其审批）属**产品待决项**，不并入本次窄修复。
- **回归**：`tests/finance-period-guard.smoke.test.js` **§G**（套件整体 39/0）——闭期被拦（状态/流水/余额三不动）+ 开放期照常放行；**反向破坏**：摘掉闸门 → 仅 §G 的 8 条精准红、前六节 31 条不受影响。

### 2026-09-27 商品价格列的版本保护（旧表单不得回退已审批的价）

- **规则**：`products.update` 无差别写 `cost_price` 与 `sale_price_a/b/c/d`，而商品编辑页**全量回传**它打开时读到的旧值 ⇒ 别处刚生效的价格变更（含改价审批的 `cost`/`a`/`b`/`c`/`d`）会被一次普通编辑**静默回退**（隔离库实测：审批后 `cost_price` 150→100、`sale_price_a` 200→100；`sale_price` 因 §18.4 方案三未被写，说明当时只护住一半）。故商品侧需**版本校验**（与发票 §20 同范式）：迁移 **264** 加 `product_items.revision`；详情（`fmtProduct`）返回；编辑页回传；`products.update` **同一事务内先 `FOR UPDATE` 锁行**再比对，过期 **409 `PRODUCT_VERSION_CONFLICT`**、缺失 **400 `PRODUCT_REVISION_REQUIRED`**，UPDATE 带 `revision = revision + 1 AND revision = ?`（**SQL 是真正防线**，JS 预检只提供更友好的 409）。
- **审批侧成对**：`price-change.applyApprovedPrice` 写价格列时**同事务递增** `revision`，否则「审批前打开、审批后保存」的旧草稿仍能通过商品侧校验。
- **前端**：编辑页回传**与表单初始值同源的基线 revision**（不是 render 时的实时 `product.revision`——那会让"新版本 + 旧草稿"绕过 CAS）；冲突时**保留草稿**且**不自动刷新详情**（刷新会抹掉未保存输入），仅提示"复制后关闭重开核对最新价格"；提示**只由全局拦截器发一次**（不重复 toast）。
- **不递增的路径**：`inbound-tasks.putaway` 只写 `avg_cost`，与编辑页提交的列**不重叠**，故不递增（否则收货会让编辑页频繁冲突）。
- **回归**：**新专项** `tests/product-price-version-guard.smoke.test.js` 与 **`tests/product-price-history-integrity.smoke.test.js` 分别覆盖**——前者覆盖旧版本 409 且不改价/不写历史、`cost`/`B` 同路径、连续编辑、缺版本 400、`sale` 列既有保护、详情 revision 读契约、审批递增后旧页 409；后者覆盖**并发同一旧版本 1×200 + 1×409**，且冲突者**通过真实 `GET /api/products/:id` 重读**最新 revision 与当前价后明确重做 ⇒ **保留**历史链完整性断言。已接 CI。
- **发布顺序与兼容边界（**不是**无中断升级）**：① 迁移 **264** 必须先于后端（列不存在会让后端 SELECT 直接失败）；② 后端（含 CAS）先于前端，否则前端带版本而旧后端 zod **静默剥离**该字段 ⇒ **保护失效**。
  **但**：新后端会**严格拒绝**未带 `revision` 的旧客户端商品编辑（**400 `PRODUCT_REVISION_REQUIRED`**）⇒ **新后端上线后，未更新的桌面 / 浏览器客户端在商品编辑保存时会直接 400**。这是为堵住"旧表单静默回退已审批价"而**有意**付出的兼容代价，**不是无影响变更**，须作为**待发版协调项**：确认浏览器与 Electron 的更新顺序、准备旧客户端提示。本批**未**验证旧客户端行为，**不承诺**任何"回退顺序无中断"。前端类型已把 `UpdateProductParams.revision` / `Product.revision` 声明为**必填**，守住将来新增调用点。
  **2026-09-28 补（真实旧客户端实测）**：用 `git archive a2b7fb7^ frontend` 导出到**独立临时目录**的**真实旧前端**（引入版本保护之前）连当前后端实测：`PUT /api/products/:id` ⇒ **400**、**草稿保留**，但**刷新后仍 400**（旧客户端**永不**回传 `revision`）⇒ 原文案「缺少版本号，请刷新后重试」是**不可完成的指引**。已改为「**缺少编辑版本信息，本次修改未保存。请先复制需要保留的内容；浏览器请刷新加载新版，桌面端请更新后重新编辑。**」—— 关键是**把"复制"放在"刷新/更新"之前**，避免员工先刷新而丢草稿。**只改 message**（HTTP 码 `400`、业务码 `PRODUCT_REVISION_REQUIRED`、行锁、CAS、写入路径**完全未动**，**不放行**缺 revision）；新前端的错误码映射**不覆写**该文案，**只有后端文案能触达旧客户端**。**未**为文案另造源码文本守卫。

### 2026-09-27 发票 `source_type` 与关联口径收口（A）

- **规则**：`fin_invoices.source_type` 的合法值只有迁移 `182_fin_invoices.sql` 列注释约定的 `purchase_order` / `sale_order`（或 NULL＝无单发票）。`voucher-engine.loadTaxMaps` 正是按这两个值把发票税额归到业务单：进项 `source_type='purchase_order' AND status IN (2,3)`、销项 `source_type='sale_order' AND status<>2`，两者都要求 `source_id IS NOT NULL`。
- **缺陷与修复**：`createInvoice` 原先在反查到订单时写死字面量 `'invoice_order'`（全仓唯一出现处、无任何消费方），而界面表单只发 `sourceNo`、不发 `sourceType` ⇒ **按界面录入且已正确关联订单的发票，税额也不进任何凭证**。现按发票类型写入约定值；`updateInvoice` 同样按**库内 `cur.invoiceType`** 重算——`invoice_type` 列不可修改，客户端传不同值明确 **400 `INVOICE_TYPE_IMMUTABLE`**（否则会照另一类去反查订单、把关联写错）。
- **订单身份与配额校验是两件事**：`assertInvoiceQuota` 只要单号或 id 能反查到订单就回报 `sourceId`（**不受有无账款基准影响**），「先开票后发货」因此仍有稳定关联，之后不会失去回连；配额硬校验仅在存在 `payment_records` 基准时进行（返回 `quotaChecked`）。
- **两种权威输入**：本次的「关联单号」或本次的「显式关联 id」。两者都由 `assertInvoiceQuota` **按发票类型限定表、加行锁**反查为同一份身份：可只给其一；**同给时必须互相印证**——id 与单号反查结果不符 **或单号根本查不到**，都 400 `INVOICE_SOURCE_ID_CONFLICT`（**不得按 id 兜底**，否则会把用户打错的单号悄悄吞掉并被替换成真实单号）；显式 id 不存在 400 `INVOICE_SOURCE_NOT_FOUND`。只给 `sourceType` 而既无单号也无 id ⇒ 400 `INVOICE_SOURCE_INCOMPLETE`（schema 接受但语义无效，不静默返回空关联）。**仅给 id 也走同一套配额校验**，补上「不给单号就绕过额度」的历史缺口；落库的单号一律取**反查到的真实单号**（仅给 id 时也能得到可读快照）。
- **编辑时的关联意图**：本次显式给出 `sourceNo`（含清空为 null/''）时**只能用本次的 `d.sourceId`**，不得沿用旧 `cur.sourceId`——否则改单号会与旧 id 冲突而误报，清空单号会被旧 id 反查「复活」。未提供 `sourceNo` 的部分更新才沿用旧值。
- **未做（重要）**：**不新增自动改写存量 `invoice_order` 的迁移**——旧值规模未知，且改正归属后可能触发**已结账期间的税额差异/反结账**。存量评估见 `docs/export-filters-fix-2026-09-27.md` §15 的 B 项，需生产只读统计后再决策。
- **回归**：`tests/invoice-quota.smoke.test.js`（**51/0**）覆盖销项/进项两类、编辑自愈、清空关联、先开票后发货、显式输入契约（一致通过 / 类型冲突 / id 冲突 / id 不存在 / 单号查不到却给 id / 只给 `sourceType` / 仅 id 受配额约束）、以及编辑三类意图（改关联 / 清关联 / 部分更新）。**证据强度**：业务侧 API+DB 端到端；「税额是否落在 `loadTaxMaps` 谓词内」为**按该函数 SQL 复刻的谓词级验证**，**真实凭证生成（`generateVouchers`）未跑**。

### 2026-09-27 发票编辑的乐观锁（并发编辑不得静默覆盖）

- **规则**：`updateInvoice` 除了**状态 CAS**（`status = 1`）之外还必须有**版本校验**——这是**两件事**，不要混称：状态只说明「这张票当前可编辑」，`revision` 才说明「你手里那份是不是最新的」。客户端**必须**回传详情/列表读到的 `revision`；**缺失 400 `INVOICE_REVISION_REQUIRED`**（注意 `Number(null) === 0`，必须先判 null 再判整数），**过期 409 `INVOICE_CONCURRENT_MODIFIED`**。
- **为什么**：修复前只有状态 CAS ⇒ 两个并发编辑同一张发票会互相**静默覆盖**。隔离库真实 HTTP 实测 **8/8 轮**「两次都 200、最终只留其一」，**实测到的字段是金额与备注**；`source_no`/`source_id` 与它们走**同一条全字段 `UPDATE`**（前端也是整单提交），按该路径**存在同样的覆盖风险**，但**本批未单独构造并发的来源字段反例**。来源一旦被覆盖，会改变 `loadTaxMaps` 的税额归属。
- **实现**：迁移 **263** 给 `fin_invoices` 加 `revision INT NOT NULL DEFAULT 1`（幂等 DDL）。**不能拿 `updated_at` 当版本**：它是 **datetime（秒精度）**，同秒并发取不到变化（本反例正是同秒）。`updateInvoice` 改为**事务内 `SELECT ... FOR UPDATE` 锁发票行** → 比对 `revision` → `UPDATE ... SET revision = revision + 1 WHERE ... AND revision = ?`。**SQL 的 `AND revision = ?` 才是真正的防线**，JS 预检只是给出更友好的 409。
- **锁顺序（有调用链依据，不是直觉）**：写 `fin_invoices` 只有 4 处——`createInvoice` 的 INSERT（在后、且是新行）、`updateInvoice`、`changeStatus`、`removeInvoice`；锁订单行的只有 `assertInvoiceQuota`（`sale_orders`/`purchase_orders`）。`updateInvoice` 是**先锁发票行、再调它**，另两处是单语句无锁 ⇒ **不存在「订单行 → 发票行」的路径**，不成环。
- **`cur` 的定位**：它仍在**事务外**读，只用于「未提供字段」的合并与载荷校验，**不承担并发安全**；安全前提是「**客户端回传的 revision 与锁内 revision 相等**」。
- **前端（2026-09-28 更新，与 §30 一致）**：编辑弹窗带 `revision`；409 时**提示由全局拦截器统一给出**（弹窗侧**不再重复 toast**）。**现行行为**：409 ⇒ **保留弹窗与草稿** + 内联提示「先复制 → 关闭 → 等列表刷新完成后重开核对」；**不自动关闭、不自动重试、不 merge 新版本**。原因：早期实现是"失效列表 + **自动关闭**"，会把已填草稿一并丢掉（**§30 已取证并修正**）。准确说法仍是「**列表刷新完成后**再重开弹窗」才拿到新 `revision`；列表刷新/失败期间**阻止重新编辑**（编辑按钮 disabled）。
- **回归**：`tests/invoice-edit-concurrency.smoke.test.js`（并发一个 200/一个 409、冲突码、最终值=成功者、`revision` +1、缺版本 400、**GET 详情/列表返回 revision 的读契约**、顺序编辑不受影响）；既有 `tests/invoice-quota.smoke.test.js` 的编辑点已带版本（55/0）。
- **2026-09-28（缺 revision 的 400 文案）**：与商品侧**同根因对齐**，把 `INVOICE_REVISION_REQUIRED` 的 message 改成与商品侧**同一句**（「缺少编辑版本信息，本次修改未保存。请先复制需要保留的内容；浏览器请刷新加载新版，桌面端请更新后重新编辑。」），**同样只改 message**（码 / 行锁 / CAS 未动）。**边界**：本批**只对商品侧**做了真实旧前端验证，**旧发票客户端的 GUI 未验**，故**不得**把"旧发票客户端会收到新指引"当成已验证事实。
- **409 恢复（2026-09-28 已修）**：原实现 `onError` 执行 `invalidateQueries + onClose()` ⇒ **弹窗关闭、草稿丢失**（真实页面组件测试取证：提交载荷含草稿、随后 dialog 从 DOM 消失、重开后备注回到原值）。现改为 —— **保留弹窗与草稿** + 内联提示「本次修改未保存（该发票已被他人修改）…请先复制需要保留的内容，再关闭本弹窗、等列表刷新完成后重新打开，核对最新内容后再提交」；**不自动关闭 / 不自动重试 / 不把新版本 merge 进旧草稿**（避免"新版本 + 旧草稿"），toast 仍由全局拦截器统一给出。
  另：列表 **`isFetching` / `isError` 期间阻止重新编辑**（编辑按钮 disabled；标题分别为"列表刷新中，请稍候再编辑" / "列表加载失败，请先重试再编辑"），列表出错时给出**可重试错误区**（`QueryErrorState` + `refetch`）。
  **边界**：`editTarget` 本就是**点击时快照** ⇒ "后台刷新不换编辑基线"属**既有正向**（**不是**缺陷，故**未**新增 revision ref）；**旧发票客户端 GUI 未验**，不外推。

### 共享资金幂等分类的扩展：无业务码 5xx 也算「结果未确认」（2026-09-29）

- **改动**：`frontend/src/components/shared/payments/useIdempotentSubmit.ts` 的 `isUncertainError` 在原有 `REQUEST_TIMEOUT` / `NETWORK_ERROR` 之外，**新增「所有 5xx（500–599）」为未确认**（实现只看状态码区间，**不区分有无业务码**）。理由：网关/代理中断、上游异常、连接被重置后由网关兜成的 502/504 等**不能证明提交没做成**；旧判定把它们当「确定失败」⇒ 换请求键 ⇒ **可能把已经做成的那一笔再做一遍**（2026-09-29 转采购单实测：后端已建单、连接中断 ⇒ 前端收到 500 ⇒ 换键重试 ⇒ **又建一张采购单**）。
- **原则不变**：**只有确定的业务拒绝才换键**。明确 4xx（含带业务码的 409/400）仍判「确定失败」并轮换；`FINANCE_PERIOD_CLOSED` 走 `periodClosedError` 分支（复用同键补录），不受本扩展影响。
- **对资金入口的影响（调用方：付款登记、核销、应付补录、退款）**：改动使 **5xx 的错误分类不再换键**（保留请求键 + 「未确认」提示条 + 引导「查询上次结果」）。资金调用点已**审阅**、相关**专项**通过，但**真实资金场景本轮未做验收**，**不外推**为「全流程不会重复记账」的保证。**未削弱后端闸门**（结账期、额度、状态机、唯一键原样保留），**未新增框架**。
- **回归**：`useIdempotentSubmit.test.ts`（新增「服务器 5xx/网关中断属于未确认」「确定 4xx 仍不算未确认」两例）；付款域专项 `src/components/shared/payments` 4 文件 / 27 例、`src/pages/refunds` + `src/hooks` 13 文件 / 50 例全绿（**代码改动距今未跑前端全量**，全量与三端构建**待发版前验证**）。

### 2026-09-29 资金入口异常恢复与请求键复核（R1–R5，真实 GUI + 代理 + 隔离库）

> 环境：本批独立库 `flowcube_finance_recovery_20260929_test`（264 迁移）、Node 22、回环 3307、`NODE_ENV=test`；丢弃响应代理（`POST /api/payments/:id/pay`、`POST /api/payments`）转发后销毁浏览器侧连接；会话 `flow-finance-recovery-20260929`。全部为**本批自建夹具**，非真实客户账款。

- **四条入口的 action 绑定与「未确认期间改内容后同键重提」的后果（逐入口证据分级——只有前两条是实测）**：

  | 入口 | 载荷是否进 action | 改内容后同键重提（结论） | 证据强度 | 证据 |
  |---|---|---|---|---|
  | 手工应付创建 | **是**（`payment.record.create.<sha256(载荷)[0:16]>`） | **新建第二笔** | **端到端**（真实 GUI + 代理 + DB） | 同键 `payable-…890khv` 下两条不同 action 回执；落库 `id=5`（R2） |
  | 付款/收款登记 | 否（`payment.record.pay.<recordId>`） | **replay：新内容被忽略** | **端到端**（真实 GUI + 代理 + DB） | FWN5 首笔 10.00（丢响应）→ 真实击键改 20.00 重提 ⇒ `paid` 仍 **10.00**、分录仍 1 条、后端该次无 `PAYMENT_EVENT`（R1） |
  | 收付款核销（create） | 是（指纹） | **新建第二笔** | **端到端**（真实 GUI + 代理 + DB） | 同键下把金额 10→12 重提 ⇒ 新建 `receipt#4`、`record#7` paid 20→32（C2） |
  | 收付款核销（settle） | 否（`payment.receipt.settle.<receiptId>`） | 推断同付款登记（**改载荷反例未构造**） | **端到端**（同键同内容重试 replay 已验） | `receipt#7` settled=20，同键重试后不变（C4）；改载荷未构造 |
  | 退款执行 | 否（`refund.execute.<refundId>`） | 金额来自单据、界面不可改 | **仅静态（读代码）** | **同一张已执行退款没有合法的第二次执行**，与其余入口不同；本轮未构造 |

- **A（已确认 · 已修）：回执确认成功的提示回显「当前表单」的单号，与落库单号不符**。`CreateManualPayableDialog` 的「查询上次结果」成功分支把 **当前表单 state** 的 `orderNo` 写进提示；而未确认期间表单仍可编辑。真实 GUI（R3）：未确认后把单号由 `AP-20260929-K1IA` 改成 `AP-20260929-CHG1`，点「查询上次结果」⇒ 提示「上次提交的应付账款已创建成功（**单号 AP-20260929-CHG1**）」，而**实际落库是 `AP-20260929-K1IA`**（列表可核）。这是**显示与服务端事实不符**，不是「用户是否误判」。**窄修复**：删去单号回显（回执 `data` 只有 `{id, settlementType}`，前端**拿不到**真实单号，故不能改成回显服务端值）；与付款登记/核销/退款三处（均不回显可变字段）一致。**回归**：`CreateManualPayableDialog.test.tsx` 新增 1 例（未确认→改单号→查询，断言提示不含改后的单号、不含 `undefined`）；**反向验证**：改回带单号 ⇒ **仅该例红**（8 passed / 1 failed）。本批专项 `src/components/shared/payments` + `src/pages/refunds` + `src/hooks` **17 文件 / 78 例全绿**、`tsc -p tsconfig.app.json` rc=0。
- **B（待查 · 未判缺陷）：手工应付在未确认期间改载荷后同键重提会新建第二笔**（R2 实测：两笔不同 action、同键）。与 §38 转采购单**同构但处置不同**——转单有**载荷指纹守卫阻断提交**，手工应付**没有**；`submit()` 只做字段校验。**不判缺陷的理由**（与 §43 同口径）：同内容多笔是合法业务（R4 实测同单号同金额连续两笔均成功，`id=6/7`），列表刷新后可见第一笔，「用户误以为没执行」未证明。**残余风险高于转单链路**（无单号唯一约束、无余量闸门）。是否补「载荷指纹守卫阻断提交」属**产品待决**，本批未改。
- **C（既定设计）：资源级 action 不含载荷 ⇒ 未确认期间改内容后同键重提被 replay 忽略**（付款登记 R1 实测）。`UncertainSubmitNotice` 文案**已明确预告**「同一次提交系统会沿用上次的内容……改了金额再提交也不会按新金额记账」，与后端事实一致，故不是「静默」。**信息层残余（待决）**：提交成功后 toast 只报「付款成功」、不复述「按上次内容记账」，用户若改了内容会缺少最后一句确认；是否在成功提示里复述属产品待决。
- **R5（分别执行已验；跨目标回执恢复未验——勿读成「切目标整体安全」）**：同一请求键在未确认后用于另一张单据时，两次操作**分别执行**——`action` 含资源 ID ⇒ 落不同回执行（实测同键 `payment-pay-…rlqnvad` 下 `…pay.2` 与 `…pay.3` 两条、均成功）；提示条明确标注「在确认哪一笔」（`登记付款 ¥5.00 · … · AP-20260929-UX1X`），与当前目标可区分。**未验**：前端回执查询仍传 **base action**（`payment.record.pay`），而 `getScopedOperationRequestStatus` 对同键多条只认「恰好一条」⇒ 此时查询返回 `not_found`；且 `remember` 会用新目标重写 `label`。**跨目标回执恢复本轮未构造**，不凭静态推导修改。**附带观察（未判缺陷）**：付款弹窗切换账款时不重建表单，金额残留上一笔的值。
- **工具坑（影响后续验收方法）**：`agent-browser fill` 对 `type="number"` 输入框**不触发 React 的 onChange**（本机实测：DOM value 变了、组件 state 未变），据此做的「改金额」实验会退化成「同内容重提」。改数值字段须用真实击键（`click` + `press`/`keyboard type`）；`fill` 对文本框（如单号）正常。**R1 首轮因此未真正改金额**，改金额的结论由后补的击键实验给出。**补充**：在**非输入框**上按 Backspace 会触发浏览器后退（本机实测把页面带到 `about:blank`，随后会话丢失需重登）；改数值字段前必须先用 `eval` 聚焦目标输入框（确认 `document.activeElement` 是 `INPUT/number`），且**不要用 `fill` 改 number**。另：`agent-browser` 的 ref 每次渲染后重排，跨操作复用旧 ref 会点到别的元素（实测误点了「取消」「选择供应商」）。

#### 续：核销 create/settle 的异常恢复（C1–C6、C10；真实 GUI + 代理 + 隔离库）

> 同一独立库；代理新增 `POST /api/payments/receipts`、`/receipts/:id/settle`、`POST /api/refunds/:id/execute` 三条丢弃规则（`DROP_TIMES` 控制只丢首次）。全部夹具本批自建，**未做任何真实付款 / 外部动作**。

- **前置实测（核销可用未归属名称分支，成本远低于造采购链）**：`recordParties` 由关联订单推导归属，手工应付（`order_id` 为 NULL）得 `null` ⇒ `owners={null}` 仍 size 1；`specified=null` 时 `resolveReceiptParty` **不抛 409**，`assertAllocationParty` 的 `null→null` 也放行。真实 GUI 在核销弹窗输入现有手工应付的**同名单位**即出现候选（`AP-20260929-FWN5 · 余额 ¥45.55`），`create` 落库 `receipt#1.party_id = null`。**边界（不可外推）**：本条只证明**未归属名称分支**；**已知 supplier/customer ID 的归属分支本轮未实测**。
- **C1（create · 同键同内容重试 = replay）**：首提交经代理丢弃（`DROP:receiptCreate … status=201`）⇒ 后端已建 `receipt#1`(20.00)、`record#4` paid 10→**30.00**、账户 -32.11→**-52.11**；**同键原样重试**（响应正常返回）⇒ `receipts` 仍 **1** 张、`record#4` 仍 **30.00**、`fund_txns` 仍 5、create 回执仍 **1** 条。**未重复核销**。
- **C2（create · 同键改载荷 = 新建第二笔）**：同键把金额 10→12（真实击键）后重提 ⇒ **新建 `receipt#4`**(12.00)，`record#7` paid 20→**32.00**；同键下出现指纹不同的两条回执。⇒ 与 R2 同族，属**指纹级**；按 B/C 记录，**不判缺陷**。
- **C3（create · 查回执）**：未确认态点「查询上次结果」⇒ **success**、关窗 + 刷新；提示文案「上次提交的付款已成功，无需重复登记」**不含可变字段**（与已修的手工应付单号问题形成对照）。
- **C4（settle · 同键同内容重试 = replay）**：对挂账单 `receipt#7` 核销 20.00，首提交丢弃 ⇒ `receipt#7` settled=**20.00**/balance=10.00、`record#1` paid 16.11→**36.11**；**同键原样重试** ⇒ settled 仍 20.00、paid 仍 36.11、`settle.7` 回执仍 1 条。
- **C6（settle · 合法第二次）**：已确定后（键已轮换）对同一张单再核销 10.00 ⇒ **正常执行**：`receipt#7` settled=**30.00**/status=**3**、`record#1` paid 46.11；回执两条（**不同 request_key、同 action**）。⇒ 幂等不挡合法第二次。
- **C10（跨目标回执恢复——R5 未验项的实测）**：同一请求键先对 `receipt#9` settle、再对 `receipt#8` settle，两次响应都被丢弃 ⇒ 后端**分别执行**（`settle.9` / `settle.8`，同键不同 action，各 settled=20.00）。此时点「查询上次结果」：前端传的是 **base action**（`payment.receipt.settle`），服务端 `getScopedOperationRequestStatus` 对同键多条只认「恰好一条」⇒ **返回 `not_found`**（独立脚本复现：`{"status":"not_found","message":"未找到该请求记录"}`）。**信息层后果**：两笔其实都已成功，界面却报「查不到，可能仍在处理或没送达」；**行为安全**（用户按提示原样重提时，同键 + 同资源 action ⇒ 仍 replay）。**这是本节初测当时的结论**——同一缺陷随后在本节「续」中经真实 API 与真实 GUI 取证**确认并已窄修**（见下文「结果恢复入口无法准确定位」）。另实测：切目标后 `guard.uncertain` 与提示条**跨目标保留**，提示条用 `remember` 存的 label 标注「在确认哪一笔」（但同单位同金额的两张单 label 文本相同，无法区分）。
- **未验（如实）**：**「后端事务尚未提交时」的 `not_found` / `pending` 时序分支未构造**（**没有**手改 `operation_requests` 或业务状态去凑分支）。**`not_found` 本身并不是未验项**：下文 C10 已在真实 GUI 与真实 API 中**自然得到**（同键多条 ⇒ 前缀解析不唯一 ⇒ `not_found`）；未验的只是「事务尚未提交」那一种成因。**退款执行（C7–C9）见下文续记**。

#### 续：「结果恢复入口无法准确定位」——A 已确认并窄修（核销 settle）

- **A（已确认 · 已修）**：前端在「继续核销某张汇款单」时**已经知道 `receipt.id`**（弹窗标题就是这张单），但「查询上次结果」仍传 **base action** `payment.receipt.settle`。服务端 `getScopedOperationRequestStatus` 对同键多条只认「恰好一条」：
  - **实测（真实 API）**：同一请求键下传 `payment.receipt.settle.8` / `.9` 各得 **success 且 `resourceId` 对应**（8 / 9）；传 base 得 **`not_found`** ⇒ **后端本可精确定位，是前端没把 ID 传下去**。
  - **实测（真实 GUI）· 场景 1**（同键只 1 条：先提交 A 丢响应，再切到 B 但**未提交**）：在 B 的弹窗里点查询，拿到的是 **A 的 success**，界面提示「已成功」并**关窗**——用户会以为 B 也成功了，且 B 的草稿被丢掉。
  - **实测（真实 GUI）· 场景 2**（同键 2 条：A、B 都提交且都丢响应）：查询得 **`not_found`**，界面报「查不到」，而两笔其实都已成功。
- **窄修复（仅该调用方 + 一处 hook 能力）**：① `useIdempotentSubmit.remember(label, actionOverride?)` 允许调用方指定本次查询的 action（**不改**写入用的请求键、不改后端回放与多行保护）；② `SettleReceiptDialog` 在继续核销时把 `receipt.id` 绑进查询 action，并在提示条 label 上带 **`· 汇款单 <receiptNo>`**（同单位同金额的两张单此前无法区分）；③ 关窗与否按**「发起查询那一刻的提交目标快照」**与**「完成时的当前目标」**比较——不用会被后来提交覆盖的 ref，**切到另一张单或切到新建模式都保留当前草稿**；成功提示带上被确认的原汇款单号。
- **查询代次保护（组件证据，未做 GUI 验证）**：先取证的原始行为是——查询在途期间再提交一次，**陈旧的 success 回执会把新一次的「未确认」一并清掉并轮换键**（`deferred` 组件场景实测：`是否已轮换=true`），该笔若其实已成功，用户重试会带新键而可能重复核销。现按**提交代次**保护：查询发起后若又提交过，则该回执只作提示、**不动当前的未确认与请求键**。**该保护的证据是组件级的 deferred 用例，不是 GUI 实测**。
- **回归**：`SettleReceiptDialog.test.tsx` **5 例**（查询 action 必须带 receiptId；切另一张单时草稿值保留；切新建模式时草稿不清；两次提交按最后一次 ID 定位 + label 带单号；查询在途又提交时陈旧回执不抹新未确认）。**反向验证 3 次**：去掉 action 绑定 ⇒ 3 例红；去掉「不误关」判断 ⇒ 仅对应用例红；去掉代次自增 ⇒ 仅代次用例红。本批专项 `src/components/shared/payments` + `src/pages/refunds` + `src/hooks` **18 文件 / 83 例全绿**、`tsc -p tsconfig.app.json` rc=0。**真实 GUI 回归**：查询请求实测为 `...?action=payment.receipt.settle.10`（带 ID）、同键两条下仍 **success**、toast「上次提交的付款已成功，无需重复登记（**汇款单 PY20260929010**）」、**未误关**另一张单的弹窗。
- **同类未修 / 未验（如实，不可外推）**：**付款登记**（`payment.record.pay`）与**退款执行**（`refund.execute`）同样在查询时传 base action，风险机制相同（同键多条 ⇒ `not_found`；同键一条但目标是另一张 ⇒ 可能误定位）；**本轮只对核销 settle 取了证并修复，付款/退款两处未构造反例、未改**。手工应付与核销 create 走**载荷指纹**级（`beginCreationOperationRequest` 给 action 加 `<base>.<sha256(载荷)[0:16]>`），前端拿不到指纹，查询只能传 base 由服务端按前缀解析——这是**现行机制**（不是缺陷），不在本次修复范围。**但「未确认期间改载荷后重提 ⇒ 新建第二笔」的恢复体验仍是 B 类产品待决**（R2 / C2，见上文 B 条）：**不得**因为创建类带载荷指纹，就把整条异常恢复路径说成已成既定正确设计。

#### 续：退款执行（C7–C9）——**已完成**（真实 GUI + 代理丢响应 + 真实业务链路前置）

> 前置全部走**真实业务 API**，PDA 步骤用**真实设备会话**（`POST /api/pda-devices` 登记 → `POST /api/pda/sessions` 换票，带 `X-PDA-Session` + `X-Client: pda`），**不是伪装 header 绕闸门**；打印收口只**模拟隔离测试客户端**（不接外部打印）；**未使用** `tests/refund-orders.smoke.test.js` 的 `seedSaleWithPaid`（它直接 SQL 写 paid/status，不满足本批约束）。

- **退款前置链路已端到端走通**（真实 API + 真实 PDA 会话）：主数据 → 采购单 + 确认 → 收货任务 → **PDA 收货** → **PDA 上架** ⇒ ACTIVE 库存；销售单 → 占库 → `POST /api/sale/:id/ship` 生成出库任务 → `start-picking` → `POST /api/scan-logs` 拣货扫码 → **`PUT /:id/ready`**（推进「待分拣」）→ 主管 **`POST /:id/assign-sorting-bin`**（**必须带稳定请求键**）→ `sort-done`（**必须带 body `[{itemId, sortedQty}]`**）→ `POST /api/scan-logs/check` 复核扫码 → 装箱 `POST /api/packages` → `/add-item` → `PUT /:id/finish` → **`pack-done`** → **`ship`（status=7）⇒ 应收生成** → 登记收款 → 建退款单 → `submit`。结果：`sale#4 / task#4(WT20260929004, saleOrderId=4) → 应收#10(SL20260929004, 40.00) → 收款 40 → 退款单 RF20260929001(20.00, 已确认)`。
- **沿途的服务端强制规则（对退款链是硬前置，不能用 API 绕过）**：① **装箱完成要求打印机绑定用途**（`finish` 抛 `PRINT_BINDING_MISSING`；出路 `POST /api/printers`（**`type` 是整数**，1=标签）→ `PUT /api/printer-bindings/package_label`）；② **出库要求箱贴打印完成**（`pack-done` 抛「箱贴仍待确认」，即 §PDA「箱贴未打印成功不得进入待出库」的服务端强制，审计还专门给 `complete-local` 补过 ack_token 校验堵旁路）——收口需模拟客户端：`POST /api/printers/client-heartbeat`（**`clientId`+`hostname` 必填**）→ `PUT /api/printers/:id {clientId}` → `POST /api/print-jobs/claim-client {clientId}` → `POST /api/print-jobs/:id/complete-client`（**`X-Printer-Code` 必须等于目标打印机 code**，并带 claim 响应下发的 **`ackToken`**，**只在首次 claim 时下发**）。
- **C7（execute · 丢响应 → 同键同内容重试 = replay）**：`POST /api/refunds/1/execute` 首提交经代理丢弃 ⇒ 后端已执行：退款单 status 2→**3**、账户 -199.11→**-219.11**、应收 `record#10` paid 40→**20**/balance 0→**20**、资金流水 15→**16**、回执 `refund.execute.1` SUCCESS。**同键原样重试**（响应正常返回）⇒ status 仍 3、账户仍 -219.11、应收仍 20/20、流水仍 **16**、回执仍 **1** 条——**各事实只变一次**。
- **C8（execute · 查回执）**：用该键查询，`refund.execute` 与 `refund.execute.1` **都返回 `success`（resourceId=1，message「退款完成」）**——退款入口的查询用 base action 也能定位（该键下只有一条）。
- **C9（execute · 新键对已执行单再执行 = 状态闸门拒绝）**：界面在 status=3 时**不渲染**「执行退款」入口；用**新请求键**直接调 API ⇒ **400「退款单已完成」**，且账户/流水/应收**均未再变**。与 C7 的「同键回放 200」并列构成完整结论：`beginResourceOperationRequest` 先于状态校验 ⇒ 同键回放合法返回原回执；新键才落到状态闸门被拒。
- **本轮的三处工具/环境阻碍（均已恢复，不是产品缺陷，也不作为跳过边界）**：① **登录限流**（脚本反复登录触发「登录尝试过于频繁」）——重启自己启动的测试后端即清零内存计数；② **`ackToken` 只在首次 `claim-client` 下发**，未留存会导致该打印任务只能由持 ack 的那次领取收口（本轮改走新建销售单链路，在**同一程序内**保存 ack 后收口）；③ **任务归属不能猜**：`warehouse-tasks.controller.list` **只接 `page/pageSize/keyword/status/warehouseId`，不接 `saleOrderId`**，`GET ?saleOrderId=…` 会被忽略 ⇒ 不能按「列表第几行/最大 id」选任务。可靠做法：从 **`POST /api/sale/:id/ship` 的返回 data.tasks** 或 **`GET /api/sale/:id` 的 `order.tasks`** 取 taskId，再 `GET /api/warehouse-tasks/:id` 核对 `saleOrderNo`/商品/仓库（本轮已按此复核：`sale#4` 的 tasks=`[{taskId:4, WT20260929004, status:7}]`，`task#4.saleOrderId=4 / saleOrderNo=SL20260929004 / product=P000002`）。
- **不得外推**：本条只覆盖**退款执行**这一条链路；出库链的服务端规则与 PDA 会话机制是**前置已验证**，不等于其它资源的恢复路径也已验；**物理打印未验**（客户端为隔离测试模拟）。
- **本批夹具清单（隔离库 `flowcube_finance_recovery_20260929_test`，全部自建，未物理删除）**：
  - 财务：`payment_records` 10 笔（应付 id=1..7 为前批，应收 id=10 为本批出库生成）；`payment_receipts` 10 张（1–5/7/9 已核销完，**6/8/10 仍有余额**）；`refund_orders` **1 张**（RF20260929001，已退款 status=3）；资金账户 `验收R1账户`（余额已被本批合法出入账改变，非「金额未动」）。
  - 主数据：仓库 `退款验收仓`(2)、库位 `A01-01-0101`(1)、分类/供应商/客户各 1、商品 P000001–P000003。
  - 采购/入库：`purchase_orders` PC…001（已确认，其入库任务 IN…001 **未收货 status=1**）/002/003（已收完）；`inbound_tasks` IN…002/003 已上架。
  - 销售/出库：`sale_orders` SL…001（已取消 status=5）、SL…002/003（**已取消 status=5**）、**SL…004（本批退款链，任务 WT…004 已出库 status=7，保留）**。
  - 库存/分拣：`inventory_containers` I000001(product2, 剩 8, ACTIVE, 未锁)、I000002(product3, 剩 10, ACTIVE, **未锁**)；`sorting_bins` B01/B02/B769 **全部空闲**。
  - 箱与打印：`packages` **L000001/2/3(WT1) 均已作废**、**L000004(WT4, 已完成) 保留**；`print_jobs` 箱贴 L000001（**status=3 已作废**）/箱贴 L000004（status=2，已完成）。
  - **取消逆向收尾（已按真实业务 API 完成，取代此前「无可合法回退」的结论）**：卡在待打包的 `WT…001` **本来就有合法出路**——先 `GET /api/warehouse-tasks/1/cancel-return-detail` 核对任务/箱/容器/原库位（返回 `status=5`、`cancelRequestedAt` 非空、容器 I000002 建议原库位 `A01-01-0101`、箱 L000001），再经 **受权限 + 真实 PDA 会话**保护的 `POST /api/scan-logs/cancel-return/box {taskId, packageId, barcode}`（**会顺带作废未完成的 print_jobs，含 status=1**）与 `POST /api/scan-logs/cancel-return {taskId, containerId, barcode, locationId}`（各带**稳定且不同**的请求键）⇒ 返回 `finalized:true`，`WT…001` 推进 **status=8（已取消）**、`cancelRequestedAt` 清空、`containers/packages` 皆空。**复核**：容器 I000002 `locked_by_task_id=null`、print_job L000001 `status=3`、B01/B02/B769 空闲、`WT…002/003` 亦为 **status=8**（其销售单已取消）。**故先前「ackToken 丢失⇒无合法入口重置」与「任务卡死」的判断均被推翻**，此处如实更正。
  - **保留（测试用，不称全库清空）**：ACTIVE 测试库存 I000001(剩 8)/I000002(剩 10)；`payment_receipts` 6/8/10 仍有未核销余额（30.00 / 2.00 / 24.00）；应付 id=1..7、应收 id=10、退款单 RF20260929001（已完成）、以及全部资金/库存事件历史**原样保留**。

#### 续：付款登记 / 退款执行的跨目标回执恢复（本批复验；上文「付款/退款未验」指的是**当时范围**）

> 上文「同类未修 / 未验」里写的「付款登记与退款执行未构造反例、未改」是**那一批当时的状态**；本批已对这两个入口**取证并窄修**，此处续记。环境：同一独立库、代理**只在真实 2xx 后 DROP**、复用有效登录；**本批未新跑 PDA / 库存 / 打印任何环节**（沿用既有夹具与已出库单）。

- **A（已确认 · 已修）：两个入口的「查询上次结果」都会（1）误关当前目标的界面、（2）同键多条时查不到**。两入口的查询此前都传 **base action**（`payment.record.pay` / `refund.execute`）：
  - **场景 1（实测）**：对 A 提交、后台已成功但丢响应 → 关窗**切到尚未提交的 B** → 点「查询上次结果」⇒ 后端按 base 前缀解析**只有 A 一条** ⇒ 返回 **A 的 success** ⇒ 界面提示「已成功」并**关掉 B 的弹窗/详情**（实测两入口 `dialog` 计数均归 0）。**只记录为「误关当前目标」**；**未重开核实草稿是否被清**，故**不称「草稿丢失」**。
  - **场景 2（实测）**：同键下 A、B **都真实成功**且都丢响应 ⇒ 传 base ⇒ 后端 `getScopedOperationRequestStatus` 前缀解析命中**两条** ⇒ **`not_found`**（付款：`pay.1`/`pay.2` 各 success；退款：`execute.7`/`execute.8` 各 success）。
  - **无效证据（如实剔除）**：中途一次 **refund#3/#4 的「同键两条」记录作废**——那两笔实际落在**不同键**（`…4paz4vyc` / `…msj90sc0`），原因是操作中途 **reload 使 hook 重新挂载换键**；**不得**记成同键证据。场景 2 的结论以随后**同键 A/B（refund#7/#8）** 的复验为准。
- **窄修（复用既有 `remember(label, actionOverride?)`，不改后端/PDA/期间/权限/账套锁，不加持久化或唯一索引）**：① 查询 action 绑定**本次实际写入的资源 ID**；付款特别绑定 **mutation 参数 `id`** 而不是当前 `record.id`——**注意区分两件事**：写入用的是 mutation 参数 id，**原写入目标 A 本身保持正确、钱不会记到 B**；出问题的是**回执查询的身份**——「余额不足二次确认」与「跨期补录重发」的回调可能在用户切到另一笔之后才执行，若查询身份取当前 record，就会**以 B 的 id 去查 A 那一次提交的回执**（**组件反向验证证实**：退回用当前 record ⇒ 查询 action 变成 `pay.2`，而实际写入仍是 `payApi(1, …)`，用例同时断言 `body.amount/paymentDate` 仍为**提交时快照**）。② **金额/日期/单号取提交时快照**（随 mutate 传入），不用当前表单值。③ label 补**单号/退款单号**（退款此前不含，两张同额同客户的单无法区分）。④ 关窗按**「点查询那一刻的目标快照」**与**完成时的当前目标**比较：**切到另一笔时保留当前界面**（本批实测的就是这一种；付款/退款入口没有「新建模式」这一分支）。⑤ 成功提示**点名原单号**（「…无需重复登记（账款 AP-…）/（RF…）」），避免在另一笔的界面上被误读。
- **回归**：`RegisterPaymentDialog.crossTarget.test.tsx` **2 例**（切目标后查询按 id 定位 + 不误关 + 提示含原单号；**余额不足确认挂起期间切到 B 后执行原确认**——断言实际写入仍是 A，且 `body.amount/paymentDate` 仍是**原快照**，即使 B 上已把金额改为 999、日期改为一个**与提交前原日期不同**的值）与 `RefundDetailDialog.crossTarget.test.tsx` **2 例**（切目标不误关 + 提示含原单号；同键先 A 后 B 均未确认再查最后 B 定位 B 并正常收尾）。**反向验证 3 次**：付款去 action 绑定 ⇒ 红；付款退回用当前 record ⇒ 挂起用例精准红（`pay.2`）；退款去 action 绑定 ⇒ 红。**专项口径（分列，勿混）**：`src/components/shared/payments` + `src/pages/refunds` + `src/hooks` **20 文件 / 85 例**是**加入本批边界用例之前**的初测结果；补入两项边界用例后，**只补跑了受影响的这两个文件**，最终 **2 文件 / 4 例通过**（未再全量、故**不代表**当前完整专项的 87 例已整体跑过）。`tsc -p tsconfig.app.json` 于最终代码上单独执行，**rc=0**。
- **真实 GUI 回归（修复后，两入口各两场景）**：
  - **场景 1（切到未提交的 B 后查 A）**：付款——实测请求 `…?action=payment.record.pay.**1**` 且 **B 的弹窗未被关**；退款——实测 `…?action=refund.execute.**5**` 且 **B 的详情未被关**，提示条 label 已带 `· RF20260929005`。
  - **场景 2（同键 A/B 都真实成功且都丢响应 → 查最后一张）**：付款——同键 `payment-pay-…xl17fbzm` 下 `pay.3`/`pay.4` 各成功，查询实测 `…?action=payment.record.pay.**4**` 返回 success、**正常关窗**、toast 为「上次提交的付款已成功，无需重复登记（**账款 AP-20260929-FWN5**）」；退款——同键 `refund-execute-…rg0m6e6i` 下 `execute.9`/`execute.10` 各成功，查询实测 `…?action=refund.execute.**10**`、**详情正常关闭**。
  - 两次场景 2 均在**开始前刷新一次列表**让 A/B 可见，之后**整轮不重载/不卸载**（键保持稳定）。
- **本批夹具与净资金（精确汇总，合法终态，未用 SQL）**：
  - **付款（`payment_entries.id ≥ 22`）**：应付 **#1 新增 3 笔共 10**、**#2 共 3**、**#3 共 2**、**#4 共 2**。
  - **收款/退款**：应收 **#10 收款 5**；**退款合计 22**（RF…002/003/004 各 5、005 为 3、007/008 各 1、009/010 各 1，另 RF…001 为 20 的上一批历史），使 #10 的 **`paid` 20 → 3**。
  - **账户**：`验收R1账户` 余额 **-219.11 → -253.11（净 -34）**。
  - **退款终态**：**RF…002/003/004/005/007/008/009/010 = status 3**；**RF…006 经 `POST /api/refunds/6/cancel` 合法取消 = status 4**；**RF…001 保持不变**。
  - **为支撑退款场景 2**，用**真实收款 API**（`POST /api/payments/10/pay`，非 SQL）给应收 #10 收 5.00（`paid` 0→5，资金流水 +1、分录 entryId=34），随后两张各 1 元退款执行。
  - 全部**历史保留**（未物理删除）；应收 #10 的 `paid`、账户余额与资金流水随这些真实收付变动——**非「金额未动」**。
- **未验（如实）**：核销 settle 的「改载荷后同键重提」未构造；本批**未跑前端全量与三端构建**。

#### 续：资金时序真实验证（第一轮；A 的 API 版已验，GUI 在途与 pending 未验）

> 预算：前端 axios `timeout=15000ms`（`frontend/src/api/client.ts:212`）< 后端每连接 `innodb_lock_wait_timeout=30s`（`backend/src/config/db.js:32`）⇒ 可在「前端已超时、后端仍在等锁」窗口内取证；**未改任何产品超时或安全规则**。两个 helper 均为**本地取证用途、不纳入产品代码**，SQL 只有 `SELECT … FOR UPDATE` 与 `ROLLBACK`，**但两者并不相同（按实际各写）**：`/tmp/fc-timing-lock.mjs` 用 `finally { rollback }` 且**带目标断言**（`NODE_ENV=test`／`127.0.0.1:3307`／本批库名／`recordId`、`holdMs` 边界）；`/tmp/fc-timing-a.mjs` 的锁是 **setTimeout 回调里 rollback**（非 `finally`），且**没有 `RID` 参数边界断言**。⇒ 后者在异常退出时**可能不释放锁**；这是**取证脚本自身的缺口，不是产品缺陷**（产品侧连接与事务由框架管理）。

- **A「事务未提交时查回执」——API 版已验（真实 HTTP + 受控行锁 + 真实 15s 超时）**：`payment_records#5`，`03:47:49 LOCKED`（本机 11:47:49）→ 带 `AbortController(15000)` 的 `POST /api/payments/5/pay`（键 `timing-a-…`）在 **15.0s 后 `AbortError`** → **仍在锁内**查回执 ⇒ **`not_found`**（`锁内? true`，非 pending；**如实记录只得到 not_found**）→ 释放后 `paid 4→6` → **同键原内容重试 ⇒ replay**、`回执行数=1`（**只入账一次**）。
- **A 的在途 GUI 未验**：两次浏览器尝试（锁 11:45:30→58 vs 超时 11:45:59；锁 11:46:36→11:47:05 vs 查询 11:47:04）**均落在释放之后或临界面**，只构成「提交后恢复」，**已剔除、不计入在途证据**；界面侧目前只有**提交后**的未确认表现证据。
- **`pending` 未验**：全程未出现（该查询在未提交时返回的是 `not_found`）。
- **B「旧查询晚于新提交返回」——未完成**：代理已扩展「延迟返回」能力（`DELAY_PATTERN` + `DELAY_MS=12000`，**< 15s 以免查询自身超时**，仅本地回环），但本轮实测 **A 的延迟响应与 B 的提交同刻（11:52:32）**，**未能确定「A 响应晚于 B 提交」**，故**不能据此判断** generation 保护在真实 GUI 下是否生效——**该点仍未验**。**第二次尝试（单次 shell 串起全时序）仍未构成**：已把「点 A 查询 → 关 A → 开 B → 键盘填 B → 提交 B」并入**同一次 shell 调用**（避免模型往返），但本轮 **A 与 B 的提交均未发出**（代理侧无对应 `REQUEST`/`UPSTREAM_2XX_THEN_DROP` 记录，界面变化来自更早一轮残留），**真实 GUI 时序未构成**。**确切原因未定位**：该次已在**同一次 shell** 内串完全部步骤，因此**模型往返不能单独解释「未发出请求」**；而「ref 漂移」目前**只是方法层面的推断**，本轮**没有**具体点击失败或元素缺失的证据。**如实记为：多步自动化未实际触发提交，确切原因未定位**（不臆定根因）。**未改任何产品超时，不再扩大实验**；本轮保留**组件 4 例已验**，**A 的 GUI 在途与 `pending` 均记为未验**。

#### 本批最终本地交接（门禁结果与夹具汇总；**均为本地证据**）

> 以下为**本地门禁/本地库**结果，**不是**整套 GitHub CI、生产部署或真实 GUI 的通过证据。

- **门禁（Node 22.23.2，本地全 exit 0）**：两端 lint、`tsc -p frontend/tsconfig.app.json`、**全前端 149 文件 / 695 用例**；按 `test.yml` 的静态/纯规则清单 **61 个命令全部 exit 0**。
- **相关 DB 回归（16 个命令全 exit 0）**：`operation-request-concurrency`、`mainline`、`concurrency-guards`、`fulfillment-credit`、`sale-adjustment`、`atp`、`p0-regression`、`p1-regression`、`finance`、`invoice-quota`、`invoice-edit-concurrency`、`refund-orders`、`accounting`、`accounting-period`、`audit-20260926`、`integration`。运行于**三套独立新库**（`release_gate`、`release_gate_integration`、`release_gate_audit_20260929_test`，各 **264** 迁移），**未触碰本轮 GUI 库**。
- **构建**：桌面 renderer build、PDA renderer build 均 **exit 0**；**未构建 Windows installer、未构建原生 APK / 未做真机验收**。
- **C 既定设计（不修、不算通过）**：**纯 Web build 的尝试 exit 1** 属既定设计——`frontend/vite.config.ts:99-103` 已有取消纯 Web ERP 的守卫，**`8017df6` 基线同样存在**；该 exit 1 是**验证计划选择错误**，不是回归。日志与逐项记录：`output/local-gate-20260929/results.json`（79 项 exit 0，1 项为上述「不适用构建的拒绝」）。
- **夹具精确汇总（订正先前漏记；相对 `d64952f`）**：`payment_entries ≥ 37` 实际为 **37/#5/+4、38/#6/+4、39/#4/+4、40/#5/+2、41/#2/+2，合计 +16**（先前只记「#4 +4、#5 +2」**不全**）。当前：`payment_entries 41`、`fundflows 36`、账户 **-269.11**；`#3 paid 8`、`#4 paid 36`、`#5 paid 6`、`#10 paid 3`。**账户/账款/汇款核销三类聚合差异均为 `[]`**；测试库无其他连接。
- **幂等回执核对**：`request_key timing-a-1790653669355` 下**只有 `action=payment.record.pay.5` 成功 1 行**，与 A 实验「只入账一次」一致。按**真实 ID** 记录自动化尝试的实际入账，**不猜关联、未用 SQL 反向删除**。
- **已验 / 未验 / 既定设计（本批收口）**：
  - **已验**：手工应付回执提示不回显可变单号；核销 settle 查询按 receiptId 定位；付款/退款查询按实际资源 ID 定位且不误关当前目标（组件 4 例 + 反向验证 + 真实 GUI 两场景）；**A「事务未提交时查回执」的 API 版**（锁内 `not_found`、同键重试 replay、只入账一次）。
  - **未验**：**A 的在途 GUI**、**`pending`**、**B「旧查询晚于新提交返回」**（两次尝试均未构成真实 GUI 时序，确切原因未定位）、核销 settle 的改载荷反例、物理打印、**整套 CI / 生产 / 真实 GUI 证据**。
  - **既定设计**：纯 Web ERP 构建守卫（同上）；核销/付款/退款「创建类走载荷指纹、资源类走资源 ID」为现行机制。
- **本地待发布状态**：以上改动**均在本地分支**（`claude/happy-mahavira-0a2b4b`），**未 push / 未打 tag / 未发版 / 未连生产**；前端全量与三端构建的**正式**验证仍按发布流程在发版前统一执行。
