# 第1–3项运行验收结果（2026-10-06）

本轮承接用户“123开始做 / 继续”，完成可独立执行的隔离数据库、浏览器及合成财务验收，并修补实际发现的问题。**结论是本地运行证据已补齐一批，不是正式上线通过。** Android设备、实物打印、员工试用、真实银行/现金、旧系统并行核对及正式交付仍待完成。

工作位置：`/Users/chengjianghao/.codex/worktrees/go-live-batch-one/flowcube`，分支 `codex/go-live-batch-one`，HEAD `14e97aa9dc9df0700b394d59cafbc53dba0c5e69`，未提交工作区。main仍在同一HEAD，仅保留原未跟踪待办文档；未提交、合并、推送、打tag、部署或连接生产。未连接共享3307实例。

## 1. 环境与归属

使用 Node22.23.2、MySQL8.0.46，数据库 `flowcube_golive20261006_test`。两个本批随机容器/卷分别映射回环32773、32774。每轮建库、迁移、种子或业务写入前走真实 `assertOwnedRepairInstance`：0600证明、容器/卷label、精确ID、时间窗、runner存活、端口映射及server_uuid；未以库名、空表或stub代替归属。

第一实例用于发现、修补及既有专项；随后删除并验证精确资源不存在，第二实例从空库重新迁移，用于最终新链路及GUI。后端/ERP/PDA仅监听本机回环，调度、物流外发、钉钉等外发关闭。测试Node进程限制回环连接和真实env读取，未观察到被拦截的外发尝试；这一结果不等于全机网络抓包证明。

[公开归属摘要](acceptance/2026-10-06-go-live-runtime/batch-two/task-ownership-public.json)保留实例身份，不含口令。数据库默认隔离级别为REPEATABLE-READ；原实现显式采用RC/RR的事务调用链参与了验收，没有开展所有隔离级别下的长时间压力矩阵。临时MySQL最初使用UTC，GUI阶段仅把本批实例时区改为`+08:00`并重启本批API连接，未修改共享实例或历史时间字段；未据此声称午夜边界已验。

## 2. 数据库与API结果

计数按各脚本自身口径列出，不把断言数、TAP父测试或重跑累计成业务案例总数。过程退出状态与原始日志在[证据目录](acceptance/2026-10-06-go-live-runtime/manifest.json)。下表最终执行均退出0，无watchdog终止；部分既有smoke自行在清理后调用`process.exit`，这不证明所有句柄自然耗尽。

| 验收 | 实际结果 | 证据与边界 |
|---|---|---|
| 新实例完整迁移 | 278个文件首次执行成功 | [日志](acceptance/2026-10-06-go-live-runtime/batch-two/migration-clean-first.log)。第一实例补跑277/278及再运行0个迁移也成功，保留修前失败。 |
| 元数据/迁移重放/搜索SQL | 131条检查、7张新表、1238条条件式重放语句 | [日志](acceptance/2026-10-06-go-live-runtime/batch-two/schema-clean-double-mode-replay.log)、[元数据](acceptance/2026-10-06-go-live-runtime/batch-two/schema-metadata.json)。按名称及列序核索引/FK，核长度、CHECK及UUID/JSON负例；默认SQL_MODE与`NO_BACKSLASH_ESCAPES`下重放/字面LIKE/四档排序。EXPLAIN已保存，不代表大数据性能压测。 |
| 财务专项 | 118断言通过 / 0失败 | [日志](acceptance/2026-10-06-go-live-runtime/batch-one/finance-owned-01.log)，按单/对账单边界及流水/余额/账龄。 |
| 会计 / 期间 | 11 / 20断言通过 | [会计](acceptance/2026-10-06-go-live-runtime/batch-one/accounting-owned-01.log)、[期间](acceptance/2026-10-06-go-live-runtime/batch-one/accounting-period-owned-01.log)。 |
| 期间锁 / 跨期补录 | 14 / 147断言通过 | [期间锁](acceptance/2026-10-06-go-live-runtime/batch-one/period-lock-owned-01.log)、[补录](acceptance/2026-10-06-go-live-runtime/batch-one/backfill-owned-01.log)；各TAP外层只有1测试，不将它混入断言数。 |
| 原退货退款 / 处置 | 14 / 32断言通过 | [退款](acceptance/2026-10-06-go-live-runtime/batch-one/refund-owned-01.log)、[处置](acceptance/2026-10-06-go-live-runtime/batch-one/disposal-owned-01.log)。 |
| 仓库范围 / PDA会话 | 43 / 28断言通过 | [范围](acceptance/2026-10-06-go-live-runtime/batch-one/scope-owned-01.log)、[PDA会话](acceptance/2026-10-06-go-live-runtime/batch-one/pda-session-owned-01.log)；PDA鉴权API不代表扫描头验收。 |
| 并发保护 | 修正夹具后123断言通过 / 0失败 | [最终日志](acceptance/2026-10-06-go-live-runtime/batch-two/concurrency-owned-fixed.log)；修前118通过/3失败另存。故障注入确实命中一次，失败事务原容器余量不变、不留子容器，结束恢复原函数与缓存。 |
| 本轮处置/供应商退款新链路 | **9个业务子案例通过，含父测试TAP共10/10；失败/跳过/取消均0** | [最终日志](acceptance/2026-10-06-go-live-runtime/batch-two/go-live-new-chain-runtime-final.log)、[退出状态](acceptance/2026-10-06-go-live-runtime/batch-two/go-live-new-chain-runtime-final.result.json)。最终执行在本轮日期DTO修补之后，GUI采购审批阈值在finally准确恢复。 |

新增 `tests/go-live-runtime.smoke.test.js` 与 `tests/helpers/goLiveRuntimeFixture.js` 覆盖：促销来源回接销售、实际发货才执行实物量；退供应商回接采购退货；报废审批与执行分离；历史混合单整单签认且原头/行保留；准确原付款分配和跨采购来源拒绝；四位退款、应付净额、往来/对账单/资金/凭证；0.0001回款不生成零额凭证且原永久回执可核；闭期409与显式补录、另一人批准；并发退款预算及同原键一次实收；数量精度/仓范围/权限。

这是根runner在归属实例下的实际运行。新smoke目前是按主题文档手动运行，不声称已接入CI；未来接入CI也必须创建并证明本批专属临时实例。未穷尽每个SQL失败点、永久回执TTL场景、全组合压力和全部现场作业。

## 3. GUI实际走查

均为真实页面表单登录和权限账号，经本批API落地或读取；未注入登录store、未用mock响应代替业务成功。账号与客户/供应商资料均为合成数据。下面不累计重复JSON记录中的checks。

| 流程 | 实际操作及结果 | 主要证据 |
|---|---|---|
| 商品/全局/开单搜索 | 四档精确排序与命中字段、`!%_`字面匹配，未返回替代通配命中的对照商品 | [商品/全局](acceptance/2026-10-06-go-live-runtime/gui/gui-search.json)、[选品](acceptance/2026-10-06-go-live-runtime/gui/gui-finder-returns.json)。后者只支持前两条搜索检查，其原脚本后续定位失败，不冒充整脚本通过。 |
| 原单退货 | 销售原单20携准确ID/单号、原价20、剩余可退2；采购原单25剩余可退6、原价10 | [记录](acceptance/2026-10-06-go-live-runtime/gui/gui-returns.json)，只核表单承接，没有GUI提交新退货。后端新链路另有实际采购退货写入。 |
| 库存解释 | 商品22/仓5，实物8、预占10、预计25，其中已绑定预计2，可承诺23；可沿预占追到销售单21 | [记录](acceptance/2026-10-06-go-live-runtime/gui/gui-reservations.json)、[截图](acceptance/2026-10-06-go-live-runtime/screens/gui-reservations.png)。21张审批采购夹具增加预计量，不能沿用早期预计4的种子数。未改reserved含义或另建库存账。 |
| 客商资料 | 名称100、联系人50、电话30、地址200、备注500字符，非法电话不发PUT，合法更新200、重新打开完整保留、编码稳定 | [16检查](acceptance/2026-10-06-go-live-runtime/gui/gui-profiles.json)。打印纸面长地址仍待现场。 |
| 审批分页/原单 | 21张待审批采购，第2页只有1条，跳到准确原采购单26；申请人自批退款入口不可用，另一人经统一待审批定位退款18并确认 | [分页](acceptance/2026-10-06-go-live-runtime/gui/gui-approval.json)、[退款审批](acceptance/2026-10-06-go-live-runtime/gui/gui-refund-confirm.json)。 |
| 历史混合处置 | 预览三类行并由另一人整单签认，生成3个处理来源；原处置头/行、当时stock/containers严格相同 | [GUI](acceptance/2026-10-06-go-live-runtime/gui/gui-conversion.json)、[前](acceptance/2026-10-06-go-live-runtime/batch-two/gui-proof-before.json)、[后](acceptance/2026-10-06-go-live-runtime/batch-two/gui-proof-after-conversion.json)。不能把该阶段相同推广至后来PDA拆箱后的全部容器。 |
| 按此单再开 | 默认不带数量，当前商品/单价带入，数量0、仓库需重新选择；没有创建销售POST | [记录](acceptance/2026-10-06-go-live-runtime/gui/gui-reorder.json)。套件版本及真正提交/创建丢响应不是本次GUI证明。 |
| PDA塑料盒三个动作 | 浏览器PDA真实绑定：拆出散件盒10→6+4；从盒还原2；剩余整件6全部放入原盒；均真实POST成功，使用原I/B码与请求键 | [前两动作](acceptance/2026-10-06-go-live-runtime/gui/gui-pda-actions-first.json)、[放入](acceptance/2026-10-06-go-live-runtime/gui/gui-pda-actions-final.json)。一条脚本对noPrinterCount的错误预期属setup；实际有合成打印机，任务入队，无实物打印。 |
| PDA未知结果恢复 | 一次还原响应丢失后原回执自动GET恢复；另一次同时丢自动查询，原输入冻结、其他两动作禁用，手动只查询原资源回执，单个POST、恢复后解锁 | [自动](acceptance/2026-10-06-go-live-runtime/gui/gui-pda-loss.json)、[手动6检查](acceptance/2026-10-06-go-live-runtime/gui/gui-pda-loss-pending.json)、[待确认截图](acceptance/2026-10-06-go-live-runtime/screens/gui-pda-pending.png)。自动恢复脚本原先误等手动按钮而超时，只按成功GET记录判定自动恢复。 |
| 供应商退款创建/实收 | 原创建只落1单，重新核原创建回执GET200、无重建POST；另一人确认；实收响应确实在真实200后中断，刷新只GET原实收回执，实收只1个POST | [创建恢复](acceptance/2026-10-06-go-live-runtime/gui/gui-refund-recover.json)、[实收7检查](acceptance/2026-10-06-go-live-runtime/gui/gui-refund-receive-loss.json)。**创建丢响应注入出现`Route is already handled`，该次abort注入未证明成功，不列为通过**。 |
| 跨期补录 | 退款19原日期1990-01-15，直接实收409；申请200不动钱；申请人自批403；另一人批准200立即记账；原业务期199001、凭证期202610分别呈现 | [申请](acceptance/2026-10-06-go-live-runtime/gui/gui-refund-backfill-apply-final.json)、[自批拒绝](acceptance/2026-10-06-go-live-runtime/gui/gui-backfill-self-approve.json)、[批准](acceptance/2026-10-06-go-live-runtime/gui/gui-backfill-approve-final.json)。切账号后原始URL导航引发activity上下文变化，列表首次过滤为空（请求200）；显式刷新后核准来源再审批，未绕过上下文保护。 |
| 资金工作区 | 真实切换看板/账户/流水，标题一致；类型6是供应商退款，收入说明正确；按精确RF单号查询1笔，追溯日期、20.1234、凭证已生成 | [4检查](acceptance/2026-10-06-go-live-runtime/gui/gui-funds-final.json)、[追溯2检查](acceptance/2026-10-06-go-live-runtime/gui/gui-funds-trace.json)、[截图](acceptance/2026-10-06-go-live-runtime/screens/gui-funds-trace.png)。 |

PDA使用浏览器手动条码输入，并分别核原扫码规则和回执；浏览器secureStorage仅内存，完整reload会失去设备绑定，因此沿真实“工作台→更多功能→塑料盒作业”导航。未把这当成Android离线持久化证明。根agent已目视核库存解释、PDA待确认、退款实收、跨期详情和资金追溯截图。

## 4. 合成资金勾稽

[最终数据库断言](acceptance/2026-10-06-go-live-runtime/batch-two/gui-finance-final-db.log)及[结构化快照](acceptance/2026-10-06-go-live-runtime/batch-two/gui-finance-final.json)：

| 事实 | 实际值 |
|---|---|
| 原付款分配13 | 100.0000，不改写原付款 |
| 退款18 / 19 | 20.1234 / 1.0000，各只有1笔IN（流水34 / 35），均已收，凭证12 / 13 |
| 合成退款账户6 | 21.1234 |
| 原应付25 | 总额100.0000，已付78.8766，余额21.1234 |
| 两张凭证分位投影 | 借/贷分别20.12/20.12、1.00/1.00；1002借、2202贷 |
| 跨期申请4 | applicant12 ≠ approver13，business_date1990-01-15、period199001、posting_period202610；资金日期仍1990-01-15，凭证日期为2026-10-06 |
| 商品23实物/缓存 | 都为10.00，reserved0.00；退款不第二次扣库存或采购退货量 |

申请补录后、批准之前账户仍20.1234、已付仍79.8766，没有新入账；[批准前快照](acceptance/2026-10-06-go-live-runtime/batch-two/gui-finance-before-backfill-approve.json)。退款18实际收到前后[冻结前](acceptance/2026-10-06-go-live-runtime/batch-two/gui-proof-before-receive.json)与[冻结后](acceptance/2026-10-06-go-live-runtime/batch-two/gui-proof-after-rf18.json)的头、行、stock及containers严格相同。PDA主动拆箱发生在此前，不能声称整个GUI过程容器均未变化。

四位资金21.1234与分位凭证21.12分别保留；余差0.0034不能靠改业务金额抹平。新API案例另核0.0001无零额凭证及现有分位核对规则。此处是合成账务的指定案例，**不是实际银行到账、真实账套累计尾差或财务人员签认**。

## 5. 发现与修补，不掩盖初次失败

| 分类 | 修前实际观察 | 本轮处理及验证 |
|---|---|---|
| 迁移缺陷 | 277在真实MySQL的CHECK_CLAUSE比对失败，001–276已执行；MySQL元数据保留字符串引号转义 | 277/278四处预期文本用`CONCAT/CHAR(92,39)`准确比对；不改表结构/事实。离线反证54/62→62/62、逆向恢复再次54/62；新空实例278全迁移及两种SQL_MODE条件重放通过。当前尚未交付的新增迁移才原位修补；其他环境若已执行则须新增条件式订正，不能覆盖已执行迁移。 |
| 通知真实500 | 限仓账号通知查询引用调拨不存在的`warehouse_id` | 换为既有`transferScopeFilter`，保持来源仓/目标仓任一在范围内的语义；测试10/10，修前10中5失败（含父）；API重启后实际通知GET200。早期GUI记录中的500保留。 |
| 退款日期接口缺陷 | MySQL DATE成JS Date，API输出ISO；前端严格YYYY-MM-DD校验导致确认无POST | 只在`findAll/findById` DTO用现有北京日期函数归一，数据库日期/权限/期间/四位金额不变；4个Date/string用例反证2失败→4通过，退款8文件295/295；修后实际GUI确认、实收和原1990业务日补录通过。 |
| 两处显示缺陷 | 旧混合单文案只提促销/退供应商；资金看板类型6未正确呈现 | 旧状态3提示整单三类行签认；看板复用资金账户类型名，补收入/支出说明。不改SQL、状态或账务；实际转换和资金GUI通过。 |
| 既有并发smoke夹具 | 原打印stub没有影响已解构缓存的split消费模块，实际未注入故障，118通过/3失败 | 只调整测试：reload消费模块，断言注入一次、finally恢复函数/缓存；库存与打印业务文件不改，真实MySQL123/0。不能把它说成新修了库存业务。 |
| 本轮测试setup | ownership shell locale、schema脚本保留字alias/索引期望、downloads目录、三处既有状态拒绝400错期望409（实发采购退货取消、未提交新报废执行、已收退款取消）、真实201错期望200、界面标题/旧弹窗/网络渲染定位、创建abort路由重复处理 | 修临时脚本/测试夹具的准确前提，不放宽后端业务断言；失败日志保留。已成功的真实写操作不重做，后续沿原单/原回执继续。 |

对应代码：`backend/src/database/{277_disposal_handling,278_supplier_refunds}.sql`、`backend/src/modules/notifications/notifications.service.js`、`backend/src/modules/refunds/supplier-refunds.service.js`、`frontend/src/pages/disposal/components/DisposalDetailDialog.tsx`、`backend/src/modules/finance/finance-dashboard.service.js`、`frontend/src/pages/finance/dashboard/index.tsx`；测试与各主题文档同步。每类代码/夹具修补均先规格、再质量独立审阅，最终证据还做整体只读复核。

前端最终`tsconfig.app.json`类型检查退出0，[状态记录](acceptance/2026-10-06-go-live-runtime/static/frontend-types.result.json)。本次未重复运行无关全前端/全后端或构建；此前E7离线全绿仍是前置证据，不能说是本轮源码全量CI已通过。发版前须在最终提交统一跑完整受影响门禁与CI。

## 6. 保存与收尾

证据只保存合成数据、日志、选定截图与hash，不包含随机密码、PDA密钥、登录token、env或真实业务资料。[manifest](acceptance/2026-10-06-go-live-runtime/manifest.json)用于逐文件校验；根完成前再次核hash。修补before/after及失败反证存于`fixes/`，原360路径基线存于`source/`。

20:19已核：[浏览器收尾](acceptance/2026-10-06-go-live-runtime/batch-two/browser-cleanup.json)、[资源收尾](acceptance/2026-10-06-go-live-runtime/batch-two/resource-cleanup.json)。本任务稳定会话close后初次list出现异步退出竞态，再次list及最终核验均为空；删除精确两条合成auth profile与两份scratch密码/设备秘密。两个容器、两个卷、归属文件、5个API/Vite PID及2个esbuild PID均不存在。保留共享3307容器原ID/端口/运行状态，未清理其他浏览器、工作树或资源。

本轮修补与此前全部成果继续保留在隔离工作树，未暂存/提交。原360路径中348个hash不变，12处是本轮授权修补；另4个原先干净的tracked路径（资金看板service、通知service、并发smoke、workbench测试）发生本轮修补，新增2个runtime测试文件与执行计划。随后新增本报告/证据并更新主执行记录；最终路径与hash清单记录这些文档增量，不将它们冒充原360路径。

## 7. 尚未完成及下一次实施边界

1. **现场硬件与人员**：本机无连接ADB设备、无已配置打印机；约5人一人多岗、替岗与第二人审批、实际I/B码扫码、真实弱网/重启恢复、纸面打印/收发/物流需现场验收。现有打印任务入队不证明纸张打印成功。
2. **真实财务及旧系统并行**：明确各单由哪套系统执行，核切点期初、ACTIVE容器/预占/预计绑定、未结旧单、往来与原付款分配；真实到账/现金、财务负责人签认、首月及首次结账、连续差异闭合仍待做。不得把合成账务导入真实账套。
3. **正式交付**：本批提交/合并、最终全量CI、schema实际环境对账、发版部署与在线版本核验均未做。前述结果不能替代这些门槛，也不能把“本地验收”写成“1月1日可启用”。
4. **未覆盖边界**：原始URL跨账号导航后的更多activity/失活恢复组合（本次已验显式刷新后读取）、午夜业务日期、退款创建abort完整注入、GUI重复开单真提交/套件版本、更多故障点/长时间并发/操作回执过期矩阵应按风险列入后续隔离验收；已有业务守卫保留，不为了验收自动重试或取消旧请求。

继续保持明确不扩建CRM/人事薪资/万能工作流或核销、不自动采购/改账、不做复杂生产装配、不重新纳入到货建单/采购跟进/常购后台、不强制所有销售成套模型、不迁历史单、不做双系统自动执行同步。便签、已有固定资产/凭证/期间锁、历史快照、权限、审计与操作回执均保留。
