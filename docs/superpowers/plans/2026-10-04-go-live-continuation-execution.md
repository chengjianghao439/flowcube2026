# 极序 Flow 落地待办续批执行记录

日期：2026-10-04。授权：用户要求“全部开始，自主多轮运行”。

**Goal：** 在已完成第一批的基础上，持续完成剩余本地开发和独立审阅，集中保留真正需要业务决定及现场验收的事项。

**Architecture：** 复用当前查询、工作区、单据和执行链。入口合并不合并业务模型；库存事实、预占、实物执行、账款、资金、核销、会计各自保留。高风险处置先完成历史兼容设计，再按明确政策实现。

**Tech Stack：** React/TypeScript、React Query、Zustand/HashRouter、Express/CommonJS、mysql2/MySQL 8。

## 基线和执行约束

- 工作树：`/Users/chengjianghao/.codex/worktrees/go-live-batch-one/flowcube`，分支 `codex/go-live-batch-one`；HEAD `14e97aa9dc9df0700b394d59cafbc53dba0c5e69`。
- 继承第一批未提交成果，状态见 `2026-10-04-go-live-batch-one-implementation.md`；不重做已完成的搜索、原单退货和审批定位。
- 逐项实现，需求审阅通过后再做质量审阅；问题修补后复核。仅一个实现者写业务文件，不并行改同一调用链。
- R3 后将 R4–R6 作为一个连续的前端入口批次实现和审阅（共享路由、工作区与首页注册表，避免来回改同一文件）；R7–R8 作为一个 PDA 批次，先闭合旧拆分请求保护再归并入口。任务验收仍逐项记录，不以批次完成代替个别缺口。
- 不启动应用、不连接数据库或生产、不执行真实业务测试；可写迁移源码和离线回归，但迁移执行及真实事务验收明确未做。
- 不推送、部署、删数据、改版本或改写已执行迁移。不触碰 main、钉钉或其他工作树。
- 查询/数量说明不粗减 reserved、不重算历史；入口合并保留权限、仓库范围、原 URL、草稿、回执与历史快照。
- 不把先前排除的到货建单、采购跟进、完整 CRM、人事薪资、自动采购/改账、通用工作流、复杂装配重新纳入。

## 执行队列与完成门

下面只记录本次续批进度；未勾选不代表对应旧业务能力不存在。完整需求及静态依据见主待办。

- [x] **R1 资料规则统一（04a–04d）**：名称100、联系人50、电话30（数字/空格/+()-）、地址200、备注500；前后端与导入同一字符口径，超限报行/字段、不截断；客户导入兼容可选地址尾列；新幂等迁移补必要电话/名称快照列；不改旧快照，核对打印承载。已本地实现、独立规格/质量接受；整批离线完成，迁移、GUI/Excel/打印待验。
- [x] **R2 库存解释及预占追溯（03a/03b）**：说明当前在库、原可用口径与含预计供应 ATP；商品+仓库只读分页追有效预占、预计依赖和准确单据；批量概要、权限/仓库范围、一致读取口径；不新增库存账。已本地实现、规格/质量接受；MySQL/EXPLAIN、GUI和现场待验。
- [x] **R3 审批单级覆盖（10c）**：采购、处置、报销原待审适配统一列表；来源种类/业务ID/节点去重，范围在统计及分页前生效；仍用原审核接口，不创建虚假引擎任务；首页计数同口径。已本地实现、规格/质量接受；整批离线完成，真实MySQL、GUI待验。
- [x] **R4 销售主入口与管理导航（07/15/部分12）**：普通默认、成套明确选择；旧模型/URL/草稿保留。ABC及审批流收进管理，打印模板维持已有位置，隐藏不代替授权。已本地实现并通过独立规格/质量审阅；整批离线完成，GUI待验。
- [x] **R5 财务工作区（08/部分12）**：客户往来、供应商往来、资金工作区；只展示原权限子视图，保留现结按单/月结按对账单、对象ID、各自筛选与回执，不建新资金事实源。已本地实现并通过独立规格/质量审阅，另闭合月结仅报表权落点与Finder挂载；整批离线完成，真实资金业务待验。
- [x] **R6 首页与待办（09/部分12）**：新用户常用工作+待处理+少量指标，沿原履约区分待我处理/待认领/需关注；roleWorkbench分类计数不冒称精确去重单数。旧布局和便签保留，推荐布局仅主动应用；待办靠近首页。已本地实现并通过独立规格/质量审阅；整批离线完成，GUI待验。
- [x] **R7 PDA拆分保护（11a）**：旧 I→B 稳定资源请求键、原资源/载荷/操作者/服务器快照、事务回执及待确认恢复；兼容电脑合法调用；未知结果只查原回执/原请求重试。已本地实现、独立规格/质量接受；RR重放当前读Important已关闭，真实MySQL并发及设备打印待验。
- [x] **R8 PDA入口归并（11b/部分12）**：整件放盒、盒还原整件、整件拆散件盒三独立动作；保持原码种、数量、身份、回执和旧深链，不覆盖未决操作；沿用已有下一步。已本地实现并通过独立两门，整批离线完成，GUI/真机待验。
- [x] **R9 最小重复开单（05）**：本次用户“全部开始”授权准备最小实现，不建常购后台；客户/商品身份与可选数量，默认不带数量；当前价格/单位/状态/仓库/套件版本重核，不复制预占/预计绑定/发货/资金/审批状态。已本地实现并通过独立规格/质量门；整批离线完成，是否作为默认常用入口仍按现场频率评估，真实业务待验。
- [x] **R10A 滞销处置已确定第一段（06a/06b及兼容保护）**：估值口径、新独立单只报废、旧1/2停止提交/批准/扣库而保留取消驳回、建议接正常业务导航、报废原回执及本人恢复已本地实现，独立规格和质量接受。整批离线完成，真实事务待验。
- [ ] **R10B 完整来源与历史转换（06c–06f）**：有限来源/预算/进度与兼容方案已独立设计复核，尚未实施；旧批准单签认、转换权限及供应商退款政策待决定，采购退货锁序与预算需技术验证。禁止猜造许可、补单或凭参考成本入账。
- [x] **R11 条件入口与整批收尾（14/12）**：会计职责未确认前保留资产/账套/报税能力；新入口、旧深链、权限、草稿及搜索跳转完成独立代码审阅，窄补均通过规格/质量门。最终前端225文件1546/1546、后端纯离线115/115、契约81/81、前后端lint、类型及ERP/PDA构建均自然exit0/audit0。迁移、真实SQL/并发、GUI、设备与现场待验。

## 业务决策与默认处理

已通过异步问题集中询问，不为每项开发停下来询问继续。

**新授权承接：** 用户随后明确“未开发的和待我决定的（按你的建议）全部开始，自主多轮执行”。以下表格保留本轮收尾时的未定状态，现已按推荐规则进入[剩余项自主实施计划](2026-10-04-go-live-remaining-execution.md)：旧批准单受控签认、子单重新审批，供应商实际退款准确关联原付款，保留完整基础账务并收拢高级入口，正式启用后极序唯一执行、旧系统对照记录。新决定不等于代码已完成；R10B按新计划逐批记录。

| 事项 | 未明确时的处理 |
|---|---|
| 完整账务/报废凭证/固定资产/报税职责 | 保留当前能力，不新增自动报废凭证，不自行隐藏资产或账套管理 |
| 旧已批准未执行促销/退供应商单是否存在、签认人 | 完成分类与兼容方案；不改写原批准快照、不删除、不给未明确角色新增转换权 |
| 旧系统并行的实际收发/收付款主系统 | 形成并行操作边界草案，不启动任何双系统同步或实际执行 |
| 促销含义 | 按单次成交优惠设计，正式全局改价仍走原改价审批 |
| 旧来源采购退货与退款 | 保留无原单和原人工财务核对，不从处置成本猜结算价、应付或退款；现有正式入口无供应商退款闭环，人工调账户余额不能解除已付保护 |
| 供应商退款收回/抵货款 | 待决定先退款或先退货、能否抵后续货款及准确原付款分配；未定前保留原已付保护，不加负数付款、不自动改账或套用客户退款 |
| 特殊分机电话 | 先实现已明确一般电话规则；需要“转/x”时以可靠格式样例补齐 |

### 旧系统并行操作边界草案（待现场签认）

启用前分别指定实物收发、账款和实际收付款的主系统及负责人，不能因“并行”在两套系统各执行一次。同一实物或资金事件只执行一次；另一系统若需登记，按经签认的只记录流程人工标明准确外部单号，不假造本系统原单ID或补造付款/发货状态。现有无原单退货入口继续明确其历史来源，退货与退款分别核对。

交接核对分开记录商品基本量与单位/仓库、ACTIVE容器余量、预占和预计绑定、应收应付、已收已付及未核销；差异追准确原单及实际事件，不用余额调整代替退款、不粗减reserved、不自动修库或改账。本轮不实施双系统同步、到货建单或采购跟进。正式启用日期是规划目标，仍须迁移、隔离及现场验收和上述职责签认，未取得这些证据不得称可正式上线。

## 验证记录

各任务完成后记录实际变更文件、红绿证据、规格/质量结论与未验事项。最终 lint/类型/构建及全量离线回归统一运行；不把运行中的命令、组件或 SQL stub 称作数据库/GUI/现场/CI/上线通过。

### R11 最终离线结果（已完成；下方保留首轮与修补过程）

最终代码停写后，生产接点窄补及最后两夹具均通过独立规格→质量门。修后完整前端225文件1546/1546、225个worker守卫就绪、自然exit0、audit0；先前15次HTTP企图已按worker定位并隔离，最后日志无该错误，不能将此前内层断言全绿当成当时整批通过。

| 最终检查 | 实际结果 | 证据与限制 |
|---|---|---|
| backend-lint / frontend-lint | 均exit0/audit0；前端0错误/36 warning | 33既有+3新增React Refresh warning，未声称零警告 |
| frontend-types | `tsc -p frontend/tsconfig.app.json --noEmit` exit0/audit0 | 最后夹具修改后复跑 |
| backend-functions | 115/115，exit0/audit0 | 精确14文件，严格VM/纯函数，不覆盖MySQL |
| backend-contracts | 81/81，exit0/audit0 | 精确26文件，不覆盖真实HTTP/数据库业务 |
| ci-wiring | 首轮选定静态3/3，exit0/audit0 | 后续package/CI未改变，未重复；不是远端CI或全部部署测试 |
| frontend-unit | 225文件1546/1546，exit0/audit0，worker225 | 最后夹具两门后完整复跑；真实组件/adapter，非GUI验收 |
| erp-build / pda-build | 两种均exit0/audit0 | 输出仅本任务/tmp，之后只有夹具/文档变动；不是桌面安装包或Android打包 |

实际命令均通过`bash scripts/with-dev-env.sh env -u NODE_OPTIONS node /tmp/go-live-final-runner.cjs <job>`。最后结果保留`/tmp/go-live-final-<job>.log/.result.json`及各自独立审计目录；临时runner/config/guard是本轮隔离措施，不是新的仓库通用测试入口。常规后续验证见`docs/verification-commands.md`。没有连接数据库/生产、启动应用/浏览器、运行实际业务smoke、迁移、推送或部署。

276容量迁移未执行；真实SQL/RR快照/锁序与并发、权限及仓库真实数据、GUI/PDA、Excel和实体打印、现场一人多岗与旧系统并行仍待分层验证。R10B完整06c–f、旧批准单签认、供应商退款及账务职责未决保持未实施。基础会计/资产/折旧/凭证/期间锁/补录、便签及旧布局继续保留。

收尾差异检查：tracked `git diff --check` exit0，77个未跟踪文本文件逐个`git diff --no-index --check /dev/null <path>`均无空白诊断（正常“有差异”exit1不当错误）；暂存区为空。main及隔离工作树HEAD均14e97aa9、三端版本0.12.0，未提交/推送/部署。任务创建的浏览器/应用/数据库服务为零，无此类资源需收尾；本地代码及审计/tmp结果保留供复核。

以下为历史过程记录，其中“待验/尚未通过”指当时状态，当前结论以本表及执行队列为准。

在R9、R10实现者停写且独立两门完成后，用`bash scripts/with-dev-env.sh`确保Node22，统一做前后端lint、`tsc -p tsconfig.app.json --noEmit`、ERP与PDA构建、前端完整单测及经源码核对的后端纯离线回归/契约。两种构建分别输出本任务的/tmp目录，顺序执行；不做Android同步或打包、不启动开发服务。测试名含`test`不能作为安全证明，必须排除实际app/浏览器/DB及生产访问；不得用`node --test tests/*.js`泛跑。

记录每个命令自然退出码、实际用例数及失败原因。既有lint warning与新错误分别核实；失败修补后只补受影响检查，必要时才扩大重跑。离线通过仍不能替代276迁移、SQL/隔离并发、权限与仓库真实数据、GUI、PDA、实体打印、现场或生产验收。最终保持未提交/未推送/未部署，main及其他工作树不动。

独立静态预检已核纯离线脚本的实际require边界。除DB/浏览器/smoke外，`warehouse-scan-closure`和`export-list-filters-passthrough`也会加载真实DB配置，严格清单剔除；前者不等于已连接DB或读取.env。Vite/Vitest使用/tmp配置禁环境文件加载、HTTP/WS/API/browser并限制两个fork；构建清除dev auth seed变量并输出/tmp。临时guard拒绝显式HTTP/fetch及所有socket连接/监听，覆盖已审readFile环境文件路径，父进程+fork自检自然0；它不是通用文件沙箱，首次实际R9定向Vitest初始化暴露/tmp软链及外部setup允许路径问题，临时配置改用canonical路径并限定允许文件后自然6文件52/52，6个worker守卫就绪、拦截事件0；这不代表整批最终检查通过。每次最终检查独立审计目录，任一拦截须汇总为非0，不吞噪音作通过。

R10停写窗口内独立预检接受runner及新增处置VM回归，worker setup现检查全部10个拦截标记（fetch、request/get、connect/listen、三种readFile）。ERP/PDA输出目录原先不存在，由根代理以0700原子新建`/tmp/go-live-final-erp`和`/tmp/go-live-final-pda`后才允许构建清空；不清理其他目录。此处是准备及静态接受，整批检查仍待R10质量门。

首轮9个job已在全部业务停写、两门接受后自然完成，原日志与结果保留为`/tmp/go-live-r11-initial-<job>.log/.result.json`。除前端单测的15次HTTP企图被拦截外，其余job audit0；没有执行真实HTTP请求、数据库、应用或迁移。被拦截企图不能作为通过。

| 首轮检查 | 实际结果 | 收尾处理 |
|---|---|---|
| backend-lint / frontend-lint | exit0；前端0错误/36 warning | 独立实跑相关HEAD文件：既有33、本批新增3，均非阻断的React Refresh导出警告；不能称全部既有 |
| frontend-types | exit2，7项错误 | 补正确生产接口/工作区元数据与fixture形状，不禁类型检查 |
| backend-functions | 115项，114通过/1失败，audit0 | 库存route夹具新增PDA middleware未隔离，加载真实认证环境配置后缺JWT_SECRET；补严格VM依赖，不补环境掩盖。没有.env读取/DB连接证据 |
| backend-contracts | 81项，79通过/2失败，audit0 | 14处员工文案需去实现词；inline恢复route导致粗解析与打印标题误配，保留路由并修符合约定的结构 |
| ci-wiring | 指定静态接线3/3，exit0 | 不是完整部署/业务smoke或远端CI证据 |
| frontend-unit | 224文件，222通过/2失败；已注册1522项中1521通过/1失败；audit15 HTTP | 修api mock导出及可选参数断言；追加worker testPath关联定位未隔离企图，保持网络拦截 |
| erp-build / pda-build | 两种构建自然exit0/audit0 | 只静态/tmp产物，不是运行验收或Android包 |

最终跨批只读集成审阅Accept，无新增Critical/Important，1项Minor（重复开单存储读取error时核对入口隐藏）。该Minor与上述首轮缺口已集中交唯一作者窄补；ProductFinder传readOwner但未实现亦须补真实R9读取/回填守卫，不仅删prop过类型。修后停止写入、独立复核并补受影响检查；不称当前整批通过。会计/趣味/排除项继续保留既定处理。

初轮warning专项复核仅对日志涉及的8个HEAD已有文件执行ESLint `lintText`并保留原绝对`filePath`，另1个为新文件；不是HEAD全量lint。新增3项为`PartyPrintText.refreshPartyPrintFields`及`pdaRoutes.PdaPlasticBoxPage/PdaSplitRecoveryPage`的`react-refresh/only-export-components`。Node22.23.2、自然exit0、audit0，配置/锁文件未改；详见`/tmp/go-live-r11-warning-baseline.result.json`及`.audit-result.json`。

R11已集中窄补29文件并停写：真实商品选择器的R9读取/回填归属、保留输入、分类查看权和取消自动续批；存储error时本人恢复入口；正确类型接点、严格VM依赖、夹具/员工文案/路由布局。新增真实选择器及入口先红后绿，续批另有1红/64绿→65/65证据；最终前端6文件65/65、后端相邻12/12自然exit0、audit0、diffcheck0。交接为`/tmp/go-live-r11-fixes-handoff.md`及精确files/increment文件。正在独立规格→质量复核，最终类型与整批受影响复验尚未执行，初轮15次HTTP企图尚未定位；窄补audit0不能据此宣布全部企图关闭。

独立R11规格门已Accept、无Missing/Extra；质量门随后Accept、无新增Critical/Important或阻断Minor。两门各自后端12/12、前端8文件87/87自然exit0、audit0、前端worker8，增量diffcheck0。根已复跑受影响检查：前后端lint、正确tsconfig的类型检查、ERP/PDA静态构建均exit0，后端纯离线115/115及契约81/81，均audit0。完整前端单测的网络审计仍在收尾，尚不能称整批验证通过。

修后完整前端单测自然结束：225文件/1546项断言通过、inner exit0，但wrapper因15次HTTP企图被拦截而FAIL。worker ready的testPath已将其精确关联到`purchase-requisitions/form.convert-key.test.tsx`9次及`pda/receive.test.tsx`6次；前者未隔离闭窗供应商Finder既有读取，后者未隔离数量策略读取。该轮保留`/tmp/go-live-r11-http-before-unit.log/.result.json`，审计目录`/tmp/go-live-final-frontend-unit-audit-CYV1V4`；没有实际HTTP连接。只窄补这两个夹具，不改变业务默认行为或守卫；修后须独立审阅和完整前端复跑，不能仅凭断言全绿称离线通过。

最后两夹具及验证记录已窄补停写，精确adapter仅接受原供应商GET/参数和当前商品数量策略GET/参数，未知请求在afterEach显式失败，保留真实页面与数量hook。两文件14/14自然exit0、audit0；未知供应商URL反向9红/5绿，audit0，已还原后再绿，证明Query接住错误不能吞掉测试失败。独立两门与最终完整前端/type/lint待接续，生产代码未再改变，因此已通过的后端及构建无需重复。

### R1 本地实现与独立审阅完成

- 本地规则/routes/service/表单/导入统一、276容量迁移源码、财务名称长度承载、名称地址Excel换行及三个HTML打印字段保护已实现，34个文件，未暂存/提交。
- 实现者在Node22自然完成 `test:party-profile` 30/30、`test:export` 5/5和六定向前端文件35/35；先有真实行为红灯再修复。根代理未将其称为整批最终验证，正独立规格复核。
- 前端定向命令：`bash scripts/with-dev-env.sh npm --prefix frontend run test:unit -- src/pages/customers/components/CustomerFormDialog.test.tsx src/pages/suppliers/index.profile.test.tsx src/components/print/TemplateRenderer.profile.test.tsx src/components/print/OrderPrintOverlay.test.tsx src/lib/partyProfile.test.ts src/lib/orderPrintData.profile.test.ts`。
- 测试及CI接线、导入说明、六主题文档已同步；diffcheck通过。待规格门通过后再做fresh质量审阅，然后进入R2。
- 首次规格复核发现非空资料行会被 `row[0] || row[1]` 静默跳过（编码/名称空但电话/地址等非空）；已修正为仅跳过整行trim空值。客户/供应商×CSV/XLSX四个真实解析回归先红后绿，覆盖数值0与原行号；规格审阅者独立重跑 `test:party-profile` 34/34，自然exit 0，给出Spec Accept。
- 新质量审阅agent创建触发工具 `agent thread limit reached`；复用未参与R1实现的既有独立审阅者，继续质量门，不把工具失败记为审阅通过。
- 质量审阅者独立证实唯一Important：150%预览fit不能保证100%物理版面fit（固定padding与整数DOM尺寸）；根代理因实现者followup同样触发协作额度限制，作为唯一写入者做三文件窄修。按钮先恢复100%再测，溢出拒绝并恢复原缩放/保留提示，合法afterprint保持原缩放。真实组件非等比例场景自然exit1后修复，与既有Overlay合计16/16自然exit0；日志 `/tmp/go-live-r1-physical-scale-{red,green}.log`。独立审阅原探针1/1红→绿、16/16复跑及diffcheck通过，最终质量Accept，无剩余Critical/Important。
- 276未在MySQL执行；DOM测量是受控组件证据，真实排版/打印、Excel客户端、数据库字符集及漂移待验。应用打印按钮保护不等于系统菜单或外部打印端保护。

## R2 实现前的调用链核对

- `inventory/inventory.service.js:getOverview` 经 `inventory/inventoryProjection.js` 读取缓存 quantity/reserved，available 保持 `max(0,onHand-reserved)`。说明应准确称为容器事实的展示缓存，不将当前列表改成另一本账。
- 详情复用 `containerEngine.getStockProjection` / `getStockProjections` 的 ACTIVE 事实与 reserved；预计量复用 `expectedStock.getExpectedStock`（采购2/5、未取消收货已上架量、有效绑定），不得先减绑定再减全部 reserved。
- `stock_reservations` 无销售行ID，按商品/仓库/来源单聚合有效记录；`sale_order_expected_bindings` 有原销售行/采购行ID。不能把来源单预占猜成某一行。
- “当前可拣”只是容器作业参考，沿原 `sale.service.js:getReservePreview` 的同仓 ACTIVE、正余量、未被任务锁定口径；不代表已获预占、可以直接出库或能把不同订单份额加总发出。
- 数量摘要、可见明细总数/分页、有效绑定采用同一只读连接快照；明确缓存预占与有效记录合计的差异。差异只展示，不自动修平，不用负数截断掩盖异常来源。
- 只读 `GET /inventory/reservations` 要求 `INVENTORY_VIEW`，严格商品/仓库正ID与分页；仓库范围先核。原单概要要求原销售查看权与原完整头仓/物料仓范围；采购同样按原查看权/范围。
- 无原单查看权的占用只返回已允许的汇总数量，不泄露单号、客户、原单ID/链接、状态或采购来源。可见原单明细分页与不可见占用汇总分别标明，不能显示后再由前端隐掉敏感字段。
- 最小文件单元：后端 `inventory.reservations.js` 负责只读查询与整形，routes/controller 委派；前端 `ReservationDetailsDialog.tsx` 负责详情/分页，既有 inventory API/types 与页面接入。禁止把写引擎或通用追踪平台混进此任务。

## R3 实现前的调用链核对

- 当前引擎列表由第一批六类静态分支联合读取，原单授权在 COUNT/LIMIT 前应用；这些分支存在不代表单级单据会创建实例。
- 原采购单待审状态5，处置与费用报销待审状态2；实际审核仍在各 service 原事务中，自批规则读取 `sys_users.allow_self_approve`，不能按角色1自行推定豁免。
- 新来源必须明确区分引擎与单级，复合读取身份包含来源种类/业务类型/业务ID/当前节点；不为原单造 engine task/instance id，旧真实task ID保持。
- 同一原单有活动引擎实例时单级分支不重复收录；采购、处置、费用各自的查看/审核权限及费用本人/view_all保持，原单范围在统计与分页前生效。
- 导航可汇入已有单级审核者，但不能因此让仅有单级权者读取引擎审批或其它业务。若沿用现有审批查看入口，明确其权限边界；接口、页面、首页widget必须一致，不在前端单独扩大。
- 新读取不修改 approvalEngine、业务审批写接口、自批许可、历史节点或期间闸门。首页摘要与完整分页复用同一个读取口径，API默认取齐兼容保留。
- 采购/处置制单人分别是operator_id，报销是applicant_id；采购与处置无可靠submitted_at时不能把created_at冒称提交时间，列表应标“创建/提交时间”或分别注明依据。`selfApprove.js`实际只认用户allow_self_approve（处置旧注释“超管豁免”与代码不一致，不照抄）。
- `routeDefinitions`已有PermissionRequirement数组支持任一权，不需新授权模型；dashboard registry目前只单PermissionCode，扩到同一声明并同步widget/页面/API。源身份resolver要兼容旧真实taskId及新document复合entryKey，不能给单级伪造instance/task/flow整数。

## 当前进度

- R1–R9及R10A本地实现、独立规格/质量审查及R11统一离线收尾完成。改动留在隔离分支`codex/go-live-batch-one`，未暂存/提交/推送/部署；三端仍0.12.0。主工作区`main`和HEAD仍`14e97aa9`，仅保留本轮最初的未跟踪静态主待办，未覆盖其他工作树。
- R10B有限关联候选规划已独立接受，但完整06c–f未实施；会计、旧签认、供应商退款及并行职责集中保留。276迁移、数据库/并发、GUI/设备/打印和现场未验，不把本地或离线通过称正式上线许可。

### R2 本地实现与独立审阅完成

- 只读接口、库存详情及零预占入口、准确来源分页、权限/范围过滤与读取所有者隔离已本地实现；无迁移及库存写路径改动。
- 实现者定向离线证据：后端6/6、前端2文件9/9，自然exit 0；ATP双扣反向变异先自然exit 1、恢复后通过。定向eslint、5项相关契约、CI接线26/26、文档守卫与diffcheck通过。
- 日志 `/tmp/go-live-r2-service-final.log`、`/tmp/go-live-r2-component-final.log`、`/tmp/go-live-r2-atp-mutation-red.log`。初红是新增入口尚不存在，不表示原业务已有真实DB故障。
- 尚未证明MySQL SQL/一致快照/EXPLAIN、员工GUI或现场；未起应用、连DB、运行最终整批检查或提交推送。
- 首次规格审查发现server仅依赖重绘校验：合法切换地址而不重绘时仍显示旧原单。已加共享API地址setter/订阅，ERP回退、ERP配置及PDA配置三条运行时改址统一，弹窗用useSyncExternalStore立即移除旧读取并fresh。无主动draw的真实回归自然红→绿，相邻6文件55项通过；日志 `/tmp/go-live-r2-server-{red,green}.log`。规格审阅者独立窄复跑13/13及diffcheck通过，最终Spec Accept。
- 独立质量审阅者最终Accept，无Critical/Important/Minor；独立后端6/6、前端三文件14/14自然exit 0及diffcheck通过。该结论不替代真实MySQL、EXPLAIN、GUI、CI或上线证明。

### R3 本地实现与独立审阅完成

- 原业务单级采购5、处置2、费用报销2已加入统一只读来源；保留真实引擎身份，单级不造任务。角色权限、自批flag、仓库范围、费用本人/view_all在统计分页前应用；同连接RR只读快照，首页沿同一API。后端定向9/9、前端9文件89/89由作者自然完成；整批类型/构建及真实MySQL仍未验证。
- 独立规格首次结论为唯一Missing：新增三类原成功回调已刷新两待办key，但原引擎授信、改价及请购仍只刷新原单。已交唯一作者补齐六类增减/推进待审的成功动作，保留旧key和原回调，失败/未知不按成功处理。首次独立后端9/9、前端13/13及diffcheck通过不等于规格已接受，须修后复核，再做质量门。
- 上述唯一Missing已关闭：新增13个真实状态成功动作回归先13红/3绿，修后16/16自然exit 0，独立规格复跑16/16给Spec Accept。作者相邻4文件61/61自然完成，但日志含未定位jsdom XHR噪声，不能称真实网络已验；质量门及整批验证仍待完成。
- 独立质量最终Accept，无Critical/Important/Minor；后端9/9、前端四文件42/42自然exit 0且本次无XHR噪声，三种范围六条SQL参数探针及diffcheck通过。没有真实MySQL/快照/EXPLAIN、GUI、远端CI或上线证据；整批最终离线检查待做。

### R4–R6 本地实现与独立审阅完成

- 销售主按钮和成套选择、管理导航、三组财务入口、子视图持久路径恢复、首页推荐及保存偏好保护已本地实现，作者停写，开始规格门。资金和核销原动作未改，原采购建议/报表/仓库运营组保持。
- 财务隐藏读取补到了原页面、账户动作及登记/结算弹窗；公共Dialog原可见性机制复用，不造另一套portal。TopNav仅对新财务组合续接已有合法child/query，原三组合主菜单行为保留。
- 作者定向12文件88/88自然exit 0；新增真实保存/组合挂载/布局初红4项及金融弹窗隐藏读初红2项后转绿。scopedlint自然0，TopNav一条only-export-components warning已核对为HEAD既有；conventions5/5、文档守卫和diffcheck通过。日志`/tmp/go-live-r456-{red,finance-red,final-targeted}.log`。
- 尚未独立规格/质量接受；真实GUI、资金业务环境、重启后界面恢复、CI、最终类型/构建与整批离线检查均未证明。
- 独立规格三项均Spec Accept，无Missing/Extra；7文件39/39自然exit 0及diffcheck通过。进入独立质量门；前述“尚未接受”是作者交付时状态，不是当前规格结论。
- 独立质量复跑7文件39/39后接受本批新增变更，并指出原月结页默认`statements`与仅`REPORT_VIEW`的合法入口不一致：实际先请求需`PAYMENT_VIEW`的`/payments/statements`。该相关Important正在窄修，修后复核再勾选R4–R6。前端以合法实际子页回退`records`，保留用户请求子页/草稿，不扩大后端权限；确认弹窗先读资金明细，须同时有原查看权及确认权。
- 真实月结leaf适配器回归继续发现`PaymentQueryDialog`和原核销弹窗的关闭Finder会无条件读主数据。必要窄修按原客户/供应商查看权和员工打开Finder的状态守挂载，不改查询快照或核销写规则、不为岗位补权限；邻接测试明确拒绝未stub端点，不把XHR噪声当正常联网。
- 最后月结窄修作者停写，真实leaf六例初红及closedFinder新增反例一红后转绿；最终7文件63/63自然exit0，无XHR噪声。独立规格与质量各自复跑同7文件63/63，均Accept，相关Important关闭，无剩余Critical/Important/Minor。日志`/tmp/go-live-r5-monthly-{red,receipt-finder-red,final}.log`。后端权限、财务写规则未改；该证据仍非真实资金、GUI、远端CI或整批最终验证。

## R7/R8 实现前的调用链核对

- `/pda/split` 扫 B 还原整件已走 `plastic_box.repack.<盒ID>` 与持久待确认；扫 I 拆散件仍用普通 mutation。`inventory.service.splitContainerOp` 当前没有操作回执；先补此保护再归并入口。
- 放货 `/pda/fill` 已走 `plastic_box.fill.<盒ID>`，全量来源不可改成任意数量；设备票与设备仓校验在 plastic-boxes 的 `pdaSessionOptional` 及 service。拆散件需采用同等 PDA 标记/票据/设备仓检查，同时兼容电脑原权限/范围调用。
- 额外静态发现：`containerEngine.splitContainer`的已有目标盒分支未先拒绝`targetContainerId===containerId`；源扣量后，同一行又按原目标余量加量，存在自并盒增量风险。R7一并加窄领域拒绝及离线反向回归，合法不同来源/目标保持；尚未在真实MySQL复现，不称生产已发生。
- 拆散件幂等绑定原来源容器，回执必须含原生成 B 码/数量/打印结果；事务重放不再扣库或造码。原 payload、资源、操作者、服务器身份进入待确认记录，恢复不读取当前界面猜成功。
- 现有 `useCriticalPdaAction` / `usePendingRequests` 可复用；未知结果只查询原操作回执，明确无回执时以原请求键和原载荷重试。禁止按容器余量变化判定本次成功。
- 再读共享hook发现不能直接“接入即称闭合”：`useCriticalPdaAction.run`仅网络/超时保留pending，其余5xx会清记录；confirmPending只守会话代次，没有原服务器，`usePendingRequests`持久归属v2只有userId。R7须对新拆分采用窄恢复策略，冻结原服务器/资源/完整payload，5xx/未知状态保持阻断；明确not_found后才提供原键原载荷重试。可增加opt-in以保留其它旧动作行为，或复用既有可靠原查询流程，但重挂缺原载荷/归属时只能核对不能猜造重试。
- 系统request-status目前只为套单和箱贴做领域校验；新split成功回执须核本人、原资源及当前仓范围，原源/新目标码与回执资源一致，范围撤销后不能靠旧回执泄漏新码。沿`system.routes.js`本人核对原操作的既有契约，查询不新增执行权限门；写重放及重试仍核当前动作权限，PDA查询与写入均保留合法设备身份/仓范围。
- `operation_requests`默认7天清理；超过回执保留期的split恢复记录查询not_found不能当作原操作未执行，禁止据此提供可重复扣量的原键重试，保留人工核对提示。新鲜not_found也只允许员工主动使用完整原载荷和原键重试，不自动发POST；原回执成功与现容器状态不同，不能互相冒充。
- PC现有 `useCriticalOperationRecovery` / `criticalOperationRecovery` 是塑料盒还原专用试点，已有完整参数和端点快照、5xx保持及手动重试；可参考其持久身份/失败边界。它的body/result/存储均绑定repack，不能直接把新拆分伪装成还原或顺手泛化整个恢复平台。
- 三动作入口可统一为塑料盒作业的选择页，内部保留放入整件、还原整件、拆出散件盒各自页面/码种/深链。页面内返回动作选择前必须处理已有输入/未决操作，不能隐藏未决结果。原放货与还原的下一步衔接保持。
- 独立只读预检确认上述自并增量风险及同仓设备/回执接点；新盒回执包含源ID/码/余量、新B ID/码、商品仓库及原打印结果。已有目标保留`newContainerId/newBarcode`别名及`target*`字段；PC原合法全量拆分不被PDA原`qty<remaining`限制全局化。此次仅静态阅读，没有MySQL复现或库存业务测试。
- `transfer.service.scanOut`会合法改写原容器`warehouse_id`（约315行）。回执查询返回原操作快照，当前仓范围须授权原操作仓并核真实来源/目标身份；不能要求后来已调拨的容器仍在原仓，也不能据其当前状态/余量猜原操作。若用原拆分流水验证操作仓，继续只读、不新增库存账。写重放仍核当前资源范围，不能借旧回执绕过现有写授权。

## R9 实现前的调用链核对

- `SaleFormPage` 当前新建判定是精确 `/sale/new`、`/sale/new-kit`；增加来源query时须同步解析、路由身份和标签key，不能将新建query误当详情ID。来源ID要求单值、正安全整数；空值/重复值不得规范化为有效来源。
- `useSaleOrderForm` 的编辑初始化会携带原价格、仓库、运费和收货信息，不能拿原订单当“新单”初始化。新导入只白名单客户ID及普通商品/套定义身份、可选数量；重新取得当前主档和报价，其他字段为空，仓库由员工明确选择。
- 普通旧包装量可换成当前基本量，但必须显示口径并核当前整数/两位精度、单位转换，不能沿旧快照复制换算率。数量默认留空或0，主动勾选才带；价格默认当前客户解析价，不沿旧手工价/折扣。
- 成套成交按原commercialGroups识别套定义，复核当前active与currentVersionId及组成。旧kitVersionId不是当前版本，也不能按kitCode猜身份；可新增窄只读身份解析/批量当前主档，或要求明确重新选套，不能把组件降为普通复制导致丢失成套语义。
- 现有 `kits.loadVersions` 提供准确历史version→kitId映射，`getKitApi`按定义ID取当前版本且沿PRODUCT_VIEW；最小来源解析可只批量读已授权原单对应版本的父定义ID，不必改带FOR UPDATE选项的shared commercial-store.loadGroups。当前主档/预览仍走原合法接口，不能借重复开单另开价格或组件查看权。
- 复用已有owner/session/server保护和草稿隔离。源读取、主档/报价晚响应不覆盖员工已改行；撤权/换账号/换服务器停止接收。已有空白或另一来源草稿不覆写，30标签上限不能自动淘汰别的脏草稿。
- 不复制预占、预计采购绑定、出库任务/实发、运单、收付款、审核状态、旧lineKey/请求键、商业revision、历史分摊。保存新单仍走原创建/预览服务及合法规则；重复开单不是一键自动提交。
- 独立只读预检确认：现`KitReadOwner`只有baseURL/userId/sessionGeneration，普通`useSaleOrderForm`读取及保存未绑定导入服务器；R9需冻结导入归属并订阅改址，切走再切回也使旧导入代次失效，另核当前权限/范围。源接口可含原基本单位及原kitVersionId等核对元数据，但只用于拒绝不明换算/提示换版，绝不作为新单单位率/套版本/价格初始化。新开行重新取当前主档，数量维度变更时人工录入。
- 保存窄补查：普通`useCreateSale`失败保留键，但每次重取当前载荷；后端创建按`sale.create+载荷指纹`记录，同键改载荷仍可另建单。R9专用保存须冻结最终载荷、键、原owner/端点，未知结果阻断编辑和另发保存，沿本人原回执核对；不能凭稳定键就宣称不重复。普通空白新建保持原调用，成套重复沿既有预览/写恢复。回执成功须核`resourceType=sale_order`、安全新单ID及`resourceId===data.id`（不是等于来源旧单ID）；超7天或旧多指纹歧义不得据not_found重试。
- 来源商品身份与计划量分开：商业单保留所有当前未被替代成交组，包括部分关闭后的零计划组；普通成交组须有且仅有一个准确组件，缺失/多组件拒绝而不猜商品。基本单位用原组件快照，不要求被合法删除重建的原物料行仍存在；套件仍按准确父套件身份重新取当前版本。作者来源离线回归先4绿/2红、修后6/6自然完成，日志`/tmp/go-live-r9-source-group-{red,green}.log`；这是来源投影证据，R9整体两门与最终验证尚未完成。
- 作者首次交付前后端10/10、前端4文件48/48自然完成，root读取日志确认摘要；尚未交两门。最后diff发现ACK后合法改址仍可显示旧result，需窄隔离；root追加静态发现原`sale.commercial-receipts`仅给kit-v1核范围，普通sale.create本人回执缺当前范围守卫。R9必须补精确创建领域/准确资源/完整当前仓范围/缺资源拒绝，以及撤CREATE后关标签仍可到达的本人原结果查询落点；原编辑CREATE门不放宽，不加常驻主菜单或通用恢复平台。上述两项正在修补，旧green不作最终接受依据。

### R7/R8 本地实现与独立审阅完成

- 普通拆分同事务原回执、来源自身目标拒绝、持久PDA结果恢复、单独本人核对页和三动作入口已本地实现；原PC/旧深链/写权限保留。作者已停写，进入规格门；尚不勾选任务完成。
- 作者窄离线自然exit0：后端9/9，前端6文件59/59；日志`/tmp/go-live-r78-backend-final.log`、`/tmp/go-live-r78-frontend-final.log`。首发明确回滚业务拒绝与前置403可修正，未知恢复重试仍保原键/载荷；持久未决可回工作台并保核对入口，不封锁库存查询。真实adapter与service反例先红后绿，隐藏成功处理反向破坏守卫自然红，恢复绿。
- 定向lint两端0错误，前端路由27条FastRefresh warning；CI静态接线26/26及diffcheck自然0。没有真实MySQL事务/锁/打印任务、PDA设备/扫码/物理出纸、GUI或远端CI证据；整批类型/构建和离线最终检查待R11统一。
- 独立规格最终Accept，无Missing/Extra；独立窄复跑后端9/9及恢复/三动作两文件27/27自然exit0，未改文件。已进入独立质量门，任务仍待质量结论。
- 质量门发现唯一新增Important：RR初始非锁读建旧快照，第二同键请求等锁后幂等当前读可见首请求成功，但普通流水/新盒JOIN核验仍用旧快照误拒。真实helper离线可见性探针得到事务重放409、fresh本人查询成功；未做MySQL双连接验证。正在窄补仅事务重放的当前读、原锁序及等待锁后回放回归，修后再复核，R9保持预读未实施。
- 上述Important已关闭：仅写事务重放显式`currentRead:true`，helper在该路径使用`FOR SHARE`当前读；初始维度无锁、维度→来源顺序、本人fresh查询及原流水仓/码条件不变。实际service/helper交错回归自然9绿/1红→10/10绿，日志`/tmp/go-live-r78-replay-snapshot-{red,green}.log`；独立质量复跑10/10和原探针，确认不二次拆分/打印且反向仍复现旧问题，最终Accept，无新增Critical/Important。未改前端故未重跑59/59，真实MySQL双连接、GUI/设备/打印及整批检查仍待验。R9已开始。

## R5/R6 实现前的调用链核对

- 财务原四入口分别是现结客户/供应商账款、月结客户/供应商对账；资金三入口是看板/账户/流水。现有 `MergedPage` 保存子视图自己的TabPathContext及已访问query，`useActiveWorkspaceTab` 已兼容组key并暂停隐藏视图，可复用，不改核销引擎。
- 组内导航需按子权限选首个合法入口，只有月结报告权也不能被导航到无账款权的现结页面；旧URL和对象 `party-ledger` 独立ID标签保持。工作区元数据、已有标题同步及已保存标签恢复须核对，不能把不同对象上下文扁平丢失。
- `sanitizeTabs`当前按规范group key去重会只留下同组最后一条path；把财务四旧页直接纳组会丢掉另外子页已保存query。实施前需保留每个旧子页路径/筛选作为合并组的子视图恢复上下文，不能仅改key/title并称偏好已保留；运行中的各已访问子视图继续KeepAlive。
- 新财务入口不向收付款、对账、流水传猜测的往来名称替代稳定partyId；backend payments已有partyId+type核验。各自筛选/对账候选、未知请求/草稿/回执和金额不因组内切换重建。
- 当前 `mergeLayout` 会按旧默认排列和宽度识别已保存布局并替换为新默认，这不符合保留用户偏好；应仅对无保存或主动恢复默认使用推荐，已有每个widget ID/宽度/显隐保留，新widget只作为隐藏候选加入。
- 合法已保存的 `widgets:[]` 也不能当“从未保存”处理；可补注册表候选但全部隐藏，避免员工主动清空后的卡片被自动加回。推荐只在null/无保存或明确主动载入后用于预览，保存仍走原布局接口。
- 现默认仍含业务推进、风险、趋势等多区；趣味默认隐藏已完成，不扩展或删便签。新默认以常用工作、待处理和少数指标为主，趋势仍在报表和组件库合法访问。
- roleWorkbench的 `summary.totalAlerts` 是分类count相加，非去重单数；同一销售可能同时待出库和低进价。不要把它显示为精确“X待办单”。只有有可靠业务类型/来源ID/动作的数据才去重，同单不同动作保留。
- 履约 `FulfillmentTodos` 已提供mine/unassigned/overdue及原单权限、范围和保存筛选；区分待我处理/待认领/需关注应沿其事实。roleWorkbench卡片不是用户任务归属证明，不能据角色推定本人或未分配。待办入口靠近首页，但仍保留REPORT_VIEW和各来源合法授权。

## R10 设计产物

- [滞销处置兼容方案](./2026-10-04-disposal-transition-design.md) 已完成只读调用链及独立设计复核。原泛化来源链的身份/生命周期/锁序Important已通过有限关联订正版关闭：普通单仓单行、固定行禁止重建、全领域操作UUID/持久原响应、A-R额度、取消归还后单向解除和历史FK策略；候选普通销售规划最终Accept，PR仅技术门规划Accept。第二段06c–f仍未实施，PR锁序/预算需独立隔离验证。先做估值/报废约束/旧1/2提交批准限制及保留取消驳回/正常业务导航/报废回执，不提前新增空表或泛化创建核心。旧签认政策和供应商退款链未确定。
- 独立补查及根代理实际源码核对：现PR确认预判及实发同事务锁原应付，禁止已付额超过退货后的总额；只冲总额，未减已付或登记退款。供应商付款/客户收款正式入口只增已付，销售退款是客户出账，余额调整不关联采购或解除保护。已证实这些现有入口没有供应商退款闭环；不得“人工调余额/负数付款”冒充完成。先退款或先退货、抵后续货款、原付款分配及权限/期间/凭证待业务决定；真事务竞态/回滚待验。
- R3集成只读补查：旧1/2或混合待批单仍留在统一审批document集合，保留真实NULL任务身份与既有entryKey，不因不可批准而排除；首页沿同一pagination.total，不另造计数。详情必须拆canApprove/canReject，类型限制不混入handoff读取actionsDisabled，原驳回/取消成功失效链已刷新统一待办与首页。处置document落点宜称“处理原单”，旧扣库确认文案随R10修正；不新增DTO/审批引擎。

### R9 独立规格门补查

- 作者正式交付普通创建领域回执范围和撤CREATE后的本人核对落点，后端13/13、前端六文件52/52自然完成；整批检查尚未运行。独立规格同安全runner复跑13/13及52/52、审计拦截0，仍判两项Missing：来源慢请求在隐藏后继续下游主档/报价读取，及地址簿portal未接重复新单的隐藏/归属代次/未知结果冻结。正在窄补真实异步与portal回归，未把旧green称规格通过，质量门待补后进行。

- R10第一段实施前只读核对已完成，新增完整明细当前读、mandatory requestKey、撤VIEW后的独立本人核对入口、晚portal确认、窄传输禁自动POST、双实例共享占位和清理失败保持、建议VIEW可达及不以旧参考快照硬闸、R3原可见待审集合等明确规格；已写入专题方案和实现任务，尚未实施/验收。

- R9作者已停写交修后规格门：45文件完整实现、两Missing增量11文件；新增9文件73/73自然0、9个worker守卫且拦截0，窄lint及diffcheck0。source隐藏2红与真实Header旧回调反向12红保留，空白/原商业调用未传guard继续原契约；不稳定jsdom键盘Select步骤已剔除，未当产品红。独立修后规格/质量结论尚待，GUI手势、MySQL和整批检查仍待验。

- R9独立修后Spec Accept，两Missing及Header其余portal回调冻结全部闭合，无新增Missing/Extra；安全runner独立9文件73/73自然0、worker9、audit0，后端未变不重复13。质量门已启动；作者只读准备R10，不提前写入。GUI/Select手势、数据库及整批检查仍未执行。

- R9独立Quality最终Accept，无Critical/Important；完整后端13/13、前端9文件73/73自然0，9个worker就绪、审计0及diffcheck0。本人撤CREATE后核对入口和完整回执仓范围已闭合。已启动R10唯一作者写入，仍不触碰06c–f或未定会计/旧签认/供应商退款；R11尚未运行。

- R10开发中窄证据：后端11/11自然0、审计0；前端已复现实际传输配置/401行为、旧1/2批准、旧3提示和VIEW建议入口缺口，恢复流程仍在实现，未交两门。正常导航真实权限为SALE_ORDER_CREATE、改价PRODUCT_UPDATE+页面PRODUCT_VIEW、采购退货RETURN_ORDER_CREATE；没有新增虚构改价/采购退货创建常量。

- R10收尾窄证据：前端4文件31/31自然0、worker4、audit0；相邻审批/请求客户端2文件38/38自然0、worker2、audit0。邻接真实回归曾37绿/1红：交接动作禁用不应隐藏已填驳回原因，现将可读草稿与可提交动作分开。状态3取消提示在documentStatusRules源修改；现generator只生成销售/仓库任务/对账状态，不生成该处置动作guard，未手改generated/status.ts。作者尚未STOP、独立两门及整批最终检查尚未开始；本段不等于06c–f完成。

- R10作者正式STOP交独立规格门：36文件实际增量，后端12/12、前端4文件33/33及相邻26/38自然exit0，worker4/2、audit0；分类守卫反向2红并已还原全绿。最后按资源隔离同实例切单的成功/未知结果，旧A待确认保持本人核对，不能阻断或清理新B。主交付`/tmp/go-live-r10-author-handoff.md`及`/tmp/go-live-r10-increment.diff`。两门及整批检查仍待完成，旧smoke未执行，06c–f、供应商退款及旧3签认未实施。

- R10独立规格12/12和33/33自然0、worker4/audit0，仍给两项Important Missing：guarded失败反馈只核id/active而未核操作起点owner/epoch，旧拒绝可写入新上下文；驳回草稿未绑定原单/owner，常驻详情A原因会带入B新闭包。两项由实际静态调用链确认，现有用例未覆盖，不称GUI复现。交唯一作者窄补延迟失败与真实Detail切单回归；保留原记录和A草稿，不能用清空输入兜底。其余第一段未发现新增Missing/Extra，质量门和R11继续排队。

- 上述两Missing的新增受控hook/Detail回归已自然11红、原33绿（44项，worker4/audit0）：POST/query迟到失败覆盖server/actor ABA与撤权，清理失败反馈归属、真实Detail切B/换owner沿用A原因。证据`/tmp/go-live-r10-spec-fix-red.log`及同名result；正在窄修，未改后端，修后规格/质量与R11仍待完成。它是组件模拟证据，不是GUI、网络或MySQL复现。

- R10六文件窄修STOP后独立Spec最终Accept，两Missing已闭合，无新增Missing/Extra。独立44/44自然exit0、worker4/audit0，核新增11红→绿及相邻38/38，后端未变不重跑。开始独立质量门，R11尚未运行。失败/成功/清理反馈核操作原owner/epoch与资源；驳回草稿按原ID及owner保存并按原草稿提交，保留actionsDisabled读取。

- R10A独立Quality最终Accept，无新增Critical/Important或阻断Minor；独立后端12/12、前端44/44自然exit0/audit0及diffcheck0。R11开始统一离线运行，Node后端测试并发也限定2；跨批次只读审阅并行进行。06c–f和旧状态3/供应商退款仍未实施，不因两门接受变更未验边界。
