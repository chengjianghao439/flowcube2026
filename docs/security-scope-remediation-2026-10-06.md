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
