# 权限隔离安全扫描修复（2026-10-06）

基线 `14e97aa`，工作树 `security-scan-remediation`，分支 `codex/security-scan-remediation`。本报告的编号对应 `output/security-scan-2026-10-06/findings.json` 的 1-based 数组编号。这里只报告本组的代码与验收，不把本地修复表述为提交、推送或部署。

## 根因与改动

| 扫描项 | 根因 | 修复与本组状态 |
|---|---|---|
| #2 退货 PDA 队列/收货/质检 | controller 丢用户范围，设备仓空值放行，写路径在范围检查前回放旧回执 | 队列核设备仓与用户范围；收货/质检明确透传范围，收货/质检/上架均先锁任务并核用户与非空设备仓，再 begin/replay。已修复并有离线与真实 HTTP/SQL 证据 |
| #7 报销审批 | 只有基本查看权限，无申请人约束 | 业务元数据增加窄授权回调，在读取审批实例前核报销申请人；超管或当前数据库角色含 `finance.expense.view.all` 才可看他人。缺失报销资源明确 404。已修复并验证 |
| #8 包裹查询 | 任务列表和条码查询没有用户仓范围 | controller 透传用户范围，service 在商品/打印查询前按拥有任务仓核授权；无仓归属对限仓用户拒绝。已修复并验证 |
| #11 盘点 PDA | controller 丢设备仓，且旧回执先于范围检查 | 设备仓透传到服务，先锁盘点单、核用户与非空设备仓，再回放；合法终态旧键仍可回原结果。已修复并验证 |
| #12 全局搜索 | dashboard.view 授权被误当作所有实体授权；报销归属/发票账套漏过滤 | 静态实体登记各原模块查看权限，查询前排除未授权类型；报销核本人或查看全部，发票核当前 companyScope，销售及关联退款/授信核头仓与全部明细仓。已修复并验证 |
| #16 无界分页 | 运单、运费账单/结算、报销、库龄的 pageSize 直接落 LIMIT | 本组五个服务入口先拒绝非整数/非有限/unsafe offset，再用共享 normalizePagination 夹到 500；对账保持 200 并补同类校验。已修复并有真实函数 SQL 桩证据；print-jobs 由打印组负责，其结论由主代理汇总 |
| #17 对账范围 | 报表不接用户范围，导出重建查询丢 scope | 汇总、计数、明细共用采购/销售来源授权，应收同时核全部明细仓；限仓账号不看手工或缺失来源账款，空范围空结果。导出复用 collectExportRows 收齐有界批次、保留 scope 和所有筛选、总量超限拒绝。已修复并有离线与真实 HTTP/SQL 证据 |
| #27 PDA 建包 | 只有用户范围，没有设备仓 | controller 透传真实 req.pda.warehouseId，创建前要求非空设备仓并与任务仓一致。已修复并验证 |

退货上架的范围先于回放修正与 #2 共用授权顺序。对账旧导出请求 10000 行但公共 query 夹到 200，导致 200<total≤10000 时截断；本次改为既有工具分页收齐，没有放宽公共查询上限。没有改共享 pagination helper、库存/账款数量算法、状态机、资金锁、凭证或迁移。

## 红绿证据

全部命令先 `source "$HOME/.config/flowcube/dev-env.sh"`，实际 Node `v22.23.2`。退出码均来自自然结束，无 watchdog kill。

- `SECURITY_SCOPE_BASELINE=14e97aa node --test tests/security-scope-pda.test.js tests/security-scope-search-approvals.test.js`：exit 1，25 项中 23 红、2 绿。测试装载冻结基线源码，不回退或覆盖共享工作树。缺范围/设备检查、先回放、缺每类权限/归属/账套、controller 丢上下文均被实际函数反例捕获。日志 `/tmp/security-scope-baseline-final-red.log`。
- 对账/分页测试在产品代码修改前运行：exit 1，15 项中 14 红、1 绿（原报表 200 行夹值本来已存在）；最终红日志 `/tmp/security-scope-reconciliation-red.log`。最早夹具缺依赖导致的 JWT 配置错误已排除，未计为业务红证据。
- `node --test tests/security-scope-pda.test.js tests/security-scope-search-approvals.test.js tests/security-scope-reconciliation-pagination.test.js tests/audit-return-putaway.test.js tests/search-all-dates.test.js tests/qty-execution-boundaries.test.js tests/export-list-filters-passthrough.test.js`：exit 0，67/67。日志 `/tmp/security-scope-focused-final.log`。新增授权回归 40 项，既有条码/数量/日期/游标/筛选断言保留；搜索旧夹具明确加测试用户权限，直接退货/盘点调用明确加设备仓。
- 17 个本组变动的 backend controller/service/routes 文件 scoped eslint：exit 0，无输出。日志 `/tmp/security-scope-eslint.log`。
- `npm run test:sql-identifier`：exit 0，标识符插值扫描 392 文件、失败 0。日志 `/tmp/security-scope-sql-identifier.log`。
- `node --test tests/query-loop-contract.test.js` 的有效查询循环守卫：exit 0，未发现新增只读逐行查询。日志 `/tmp/security-scope-contracts.log`。曾在同一命令误列不存在的 sql-identifier 文件名，Node 未执行它；实际 SQL 标识符验证以随后明确 npm 命令为准。
- `git diff --check`：exit 0。

## 真实 HTTP/MySQL 验收

`tests/security-scope-warehouse.smoke.test.js` 由主代理在统一 fresh 独立数据库 `flowcube_security20261006_4ffbe743_test` 串行执行，本组已读取其结果日志核对。该专项 1/1 自然通过；与会话专项同一 run 的总数为 2/2，不混为本组用例数。日志 `/tmp/flowcube-security-db-first.log`。

执行方式：

```sh
source "$HOME/.config/flowcube/dev-env.sh"
FLOWCUBE_TEST_ENV_FILE=/tmp/flowcube-security20261006-253ed028/.env.test node --test tests/security-scope-warehouse.smoke.test.js
```

脚本先 validateTestEnvironment 并核 SELECT DATABASE()。每次随机创建自有两仓、角色/用户、PDA 会话及合成权限单据，真实 HTTP 登录与 middleware 授权覆盖：包裹读范围、PDA 建包设备仓、退货队列/收货/质检、盘点设备仓、报销审批归属、dashboard-only 搜索、报销本人搜索、发票当前账套、销售仓范围，以及对账汇总/计数/明细/导出。范围外和无来源合成账款不返回，空范围导出为空。

合成单据状态和账款是权限测试夹具，不是库存/资金业务流程证明。被拒绝的 PDA 请求未增包裹或退货容器。finally 关闭随机回环 HTTP 服务与 pool，按精确自有设备 ID 删除会话并停用设备，停用自有账号并撤销自有角色权限；合成单据保留供审计，没有全表清理、生产库读写、浏览器或生产进程操作。

## 接线及未验证边界

主代理已将三项离线新测试接入 `test:security-scan-remediation` 与 Tests 静态 job，将 `security-scope-warehouse.smoke.test.js` 接入 `smoke:security-scan-remediation` 与独立 MySQL job；脚本按 `--test-concurrency=1` 串行运行范围与会话专项。本组已读取 package.json 与 workflow 核对接线；远端执行待验证，本组未改 package.json 或 CI。已适配的既有直接 service 调用位于 `accounting-period.smoke.test.js`、`audit-2026-09-18.smoke.test.js`、`audit-inventory.smoke.test.js`，仅加真实夹具的设备仓，未重跑这三套完整业务回归。

未验证：全后端/受影响完整财务与库存回归、远端 CI、ERP GUI、PDA 真机/现场员工、实物打包/打印、正式提交/推送/部署。#16 打印分页修复及发布链路由主代理合并其他组证据。日志路径是本机本轮证据，重新运行需要本轮或另一专属 `.env.test`，不是生产配置。

## 本组文件清单

17 个后端文件：

```text
backend/src/modules/approvals/approvals.service.js
backend/src/modules/export/export.service.js
backend/src/modules/finance/expense-claims.service.js
backend/src/modules/inventory/inventory.aging.js
backend/src/modules/logistics/logistics.freight.js
backend/src/modules/logistics/logistics.service.js
backend/src/modules/packages/packages.controller.js
backend/src/modules/packages/packages.service.js
backend/src/modules/reports/reports.controller.js
backend/src/modules/reports/reports.query.js
backend/src/modules/return-tasks/return-tasks.controller.js
backend/src/modules/return-tasks/return-tasks.service.js
backend/src/modules/search/search.controller.js
backend/src/modules/search/search.routes.js
backend/src/modules/search/search.service.js
backend/src/modules/stockcheck/stockcheck.controller.js
backend/src/modules/stockcheck/stockcheck.service.js
```

4 个新增测试、5 个既有专项适配、4 份文档：

```text
tests/security-scope-pda.test.js
tests/security-scope-search-approvals.test.js
tests/security-scope-reconciliation-pagination.test.js
tests/security-scope-warehouse.smoke.test.js
tests/search-all-dates.test.js
tests/qty-execution-boundaries.test.js
tests/accounting-period.smoke.test.js
tests/audit-2026-09-18.smoke.test.js
tests/audit-inventory.smoke.test.js
docs/security-scope-remediation-2026-10-06.md
docs/finance-permission-time.md
docs/inventory-transaction-invariants.md
docs/backend-api-sql-conventions.md
```

本清单共 30 文件，仅计权限隔离组；主代理及其他组在共享工作树的文件不归入本组。随后经主代理授权补做的发布 ZIP 传输兼容修复由独立安全发布记录汇总。

## 2026-10-07 分支整合复核与补修

此段发生在同一隔离工作树的 `codex/release-v0.13.0` 整合工作区。主代理负责提交与发布，本组未暂存、提交、连接数据库或发布。本段离线结果不能替代原 go-live 工作树的运行证据，也不能替代最终整合 SHA 的全量/真实数据库/部署验收。

- 搜索冲突保留每类权限、费用本人/查看全部、发票账套与销售全部明细仓授权，同时保留商品匹配等级及有界 ID 游标；前端既有全分页收集后商品等级排序保持。审批保留业务授权 callback 与旧六类引擎详情，同时保留新采购/处置/费用/供应商退款 pending 分页、当前角色与自审批限制。
- PDA 拆分及其回执原先把 NULL 设备仓当作无设备上下文，active 设备/会话仓均 NULL 时中间件可以通过。新增明确 PDA 身份与设备仓闸门，fresh、原键回放及回执查询均先拒绝；PC 无设备上下文与正确设备仓保持。
- 塑料盒 controller 原先丢 PDA 身份，放货/还原同样存在 NULL fail-open。现透传 `isPda`，PDA 必须有效非空设备仓。真实 service SQL 桩还反证：探维度后、等幂等锁期间盒换仓，回放仍返回旧快照授权；还原锁后当前盒属另一仓却继续 UPDATE/创建容器。最小修正为回放共享当前读核范围，以及还原已有行锁后核范围/设备仓和维度一致，拒绝前无库存/流水/打印/回执变化。未改变库存数量算法或维度→容器顺序。
- 旧 `5d04014` 撤回收货/调拨补丁由主代理合入：本组确认当前仓已移走拒绝、所有未删除任务容器的调拨流水当前读拒绝 A→B→A 与 force-close VOID；正常未调拨仍能撤回，在途与用户范围闸门保持。调出/调入名称取真实商品主档普通读，异常了结删除无效 `inventory_containers.product_name` 投影，不增加任一仓库存。产品无需进一步修改。
- 旧拆分 smoke 仅将 action 断言适配当前 `inventory.container.split.<id>`；数量、原键/新键/无键、流水与撤销范围断言保留。报销分页测试仅新增其新幂等依赖的 SQL 桩，未用真实环境变量绕过离线隔离。

### 本轮红绿与静态证据

全部 Node 命令先加载 dev-env，均自然结束。

| 验证 | 结果 / 退出码 | 日志 |
|---|---|---|
| 只读旧 go-live 搜索/审批源码装载到安全授权测试 | 8 红 / 1 绿，exit 1 | `/tmp/security-golive-auth-before-merge-red.log` |
| 拆分 PDA NULL fresh/replay/receipt 反例（修改前） | 2 红，exit 1 | `/tmp/security-golive-split-null-red.log` |
| 塑料盒真实函数/controller：NULL、等待后回放与还原换仓（修改前） | 4 红 / 1 绿，exit 1 | `/tmp/security-golive-plastic-red.log` |
| 用补丁前 HEAD 撤回/调拨源码装载到新测试 | 4 红 / 1 绿，exit 1 | `/tmp/security-golive-inbound-transfer-red.log` |
| PC 既有非数字库存条码即时回放/本人查询（修复前实际函数） | 1 红，exit 1 | `/tmp/security-golive-split-legacy-barcode-red.log` |
| 搜索/审批/商品 finder/拆分恢复/塑料盒/撤回调拨，8 文件 | 65/65，exit 0 | `/tmp/security-golive-scope-final.log` |
| PDA/对账分页/库存预占/处置创建、目标、释放、转换，8 文件 | 225/225，exit 0 | `/tmp/security-golive-stock-disposal-final.log` |
| SQL identifier/query-loop/扫码闭环，3 文件 | 12/12，exit 0 | `/tmp/security-golive-scope-contract.log` |
| 9 个产品文件定向 eslint | exit 0 | `/tmp/security-golive-scope-final-eslint.log` |
| 所有本组路径 diff check、旧两套 smoke 与新增 HTTP smoke 语法检查 | exit 0 | 命令无诊断输出 |

主要离线命令：

```sh
node --test tests/container-split-recovery.test.js tests/security-scope-search-approvals.test.js tests/search-all-dates.test.js tests/approval-list-batches.test.js tests/product-finder.test.js tests/supplier-refunds-approvals.test.js tests/security-scope-plastic-box.test.js tests/security-scope-inbound-transfer.test.js
node --test tests/security-scope-pda.test.js tests/security-scope-reconciliation-pagination.test.js tests/inventory-reservations.test.js tests/disposal-transition.test.js tests/disposal-handling-create.test.js tests/disposal-handling-target-guards.test.js tests/disposal-handling-release.test.js tests/disposal-conversion.test.js
node --test tests/sql-identifier-contract.test.js tests/query-loop-contract.test.js tests/warehouse-scan-closure.test.js
```

红证据加载冻结源码，不恢复/覆盖共享工作树。塑料盒等待场景显式区分 RR 快照与锁后当前读，观察实际函数库存写调用；这是离线事务边界模型，尚不证明真实 MySQL 的竞争与死锁表现。中途 225 套件曾有 2 个 fixture 装载失败：一次费用合并重复 import，另一次新增 operationRequest 未 stub 导致缺 JWT 配置；均不是业务反例，不计为红证据，修正后 225 项自然通过。

主代理随后在统一 fresh MySQL 运行旧 F6 smoke，得到 26 pass / 2 fail（`/tmp/flowcube-release-db-container-split-idempotency.log`）：普通 PC 首次 200，立即原键回放 409 `CONTAINER_SPLIT_RECEIPT_INVALID`。实际首响应来源码为 `F6SRC-6b6e51ec-114cba62`，回执守卫却要求来源码匹配新造码格式 `[IB]+数字`；问题与请求键是否 UUID 无关。首次业务合法支持既有唯一来源码，回执不应再用新造码格式拒绝它。最小修正只将来源码约束改为非空、≤ schema `VARCHAR(64)` 字符；原 SQL 的来源 ID/完整条码/商品/原仓/目标 ID 和 B 码/原流水仍精确核对，目标码格式与 kind、资源 action、用户/设备范围、当前读全部保留。新增真实失败响应形状的首拆→原键回放→本人查询反例先红后绿，并覆盖空/超界/伪造来源 ID/条码/原仓、目标、缺流水、错误 action 的拒绝。旧 smoke 的成功预期不改。本组定向 lint 自然 exit 0；该实际数据库缺陷修正后的真 HTTP 重跑仍交主代理汇总。

### 整合后的真实 HTTP smoke 与边界

2026-10-07 独立整合审查确认另一个发布前缺口：真实 `system.controller` 的本人 GET 可直接返回塑料盒放货/还原完整条码回执，原仓范围已撤销或 PDA 无票据仍为 200；此前 POST 重放修正没有覆盖前端 `getOperationRequestStatusApi` 恢复路径。离线真实 controller/设备闸/领域测试先红（5 pass / 4 fail，自然 exit 1，`/tmp/flowcube-release-plastic-receipt-red.log`），修正后补核原操作身份与双边流水仓，不从当前容器仓推断历史，也不独认响应 warehouse。只对已知 fill/repack 与 split 领域启用设备闸，宽查询在实际匹配后补核；RF/disposal 等本人 auth-only 查询不扩大权限或设备要求。更新旧「plastic 不进设备闸」测试为已知 scope 类必须核票据，其它领域保持。

原 scope smoke 已追加实际 HTTP GET：精确/base/宽 action，PC/正确 PDA 本人核对（撤执行权限仍可查询），无票据/NULL/别仓设备拒绝，以及撤原仓范围后 PC/PDA 两回执均拒绝；比较自有库存/流水/打印/回执行，GET 不增副作用。新增 DB 场景由主代理在统一 fresh MySQL 执行；本组没有连接数据库，不把离线 SQL 边界测试当实际锁、设备或实物打印证据。

本次修改后联合 `security-scope-plastic-box` / `container-split-recovery` / `sale-repeat-create` / `disposal-transition` 四文件 45/45、自然 exit 0（`/tmp/flowcube-release-plastic-receipt-green.log`）；相关产品和测试定向 ESLint 自然 exit 0，新增 smoke 语法及 diff check 无诊断输出。首次联合运行的 3 个失败是旧 controller VM fixture 拒绝新无条件 require，已将新 helper 装载限于本领域实际/请求 action，未改 RF/disposal fixture 或业务契约；不计作业务红证据。

已在原 `tests/security-scope-warehouse.smoke.test.js` 末追加塑料盒场景，待主代理在其统一 fresh 数据库串行执行：真实登录/授权、空盒 API、自有整件容器、唯一合法库存缓存入口；NULL/错误设备仓 fresh 和旧键拒绝，正常放入 10、还原 2+3 后盒剩 5 和两条整件码，库存缓存总量仍 10；正常同键回放完全一致，拒绝/回放不新增库存、流水、本人打印或操作回执；当前用户仓库改为 B 后两旧键拒绝。只按本轮独占商品/用户 ID 取事实，原精准会话/角色收尾保持，没有硬编码历史库/端口或全表清理。本组只做语法/diff 检查，未运行此新增数据库场景。旧 `plastic-box-batch-a` 硬绑定历史库，不能直接对统一 fresh 库运行。

主代理已告知将两个新增离线专项接入安全脚本。本组对应产品/测试改动为 search、approvals、inventory.split、inventory.split-receipt、system.controller、plastic-boxes controller/service；测试为 container-split-recovery、search-all-dates、container-split-idempotency smoke、security-scope-reconciliation-pagination、security-scope-warehouse smoke，以及新增 security-scope-plastic-box/security-scope-inbound-transfer。撤回/调拨产品及其旧 smoke 是主代理引入的旧补丁，本组只复核。

待验证：新增 HTTP 场景和旧 F1/F6 整合后的真实 MySQL；受影响完整库存/资金/全后端套件与远端 CI；ERP GUI、PDA 真机、实物打印/员工现场；最终提交、推送、版本和部署由主代理汇总。本组不以先前独立工作树 GUI 或运行结果证明最终发布 SHA。
