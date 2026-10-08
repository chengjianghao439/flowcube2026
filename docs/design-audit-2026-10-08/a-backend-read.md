# A 代表只读 500 诊断与最小修复

2026-10-08。root 在 A 前端复验归档后追加授权，只修机械读取 SQL/投影错误，不改变业务、权限规则、迁移或业务数据。本轮读取 `backend-api-sql-conventions.md`、财务与业务语义相关段落，并沿各模块 route → controller → service/query 核对。凭据仅在脚本内部使用，未写入本报告或证据文件。

## 1. 真实退款列表错误

`GET /api/refunds?page=1&pageSize=200` 在当前源码 API 62091、限仓合成账号下实际 500 `INTERNAL_ERROR`，安全摘要见 `a-api-read-red.json`。后端日志定位 `refund-orders.service.js:86`，错误是 `ER_PARSE_ERROR`，near `AND so.warehouse_id IN (1)`。

根因：`warehouseScope.scopeFilter()` 返回带前导 ` AND ` 的片段，而退款 `findAll()` 把该片段插入 `conds` 后再 `join(' AND ')`，最终出现 `AND AND`。不限仓无片段，故不触发；空范围片段 ` AND 1=0` 同样触发。并非本批 schema 缺失或源数据不合规。

最小改动仅 2 行：`backend/src/modules/refunds/refund-orders.service.js` 直接追加 `scope.sql` 至已拼好的 where，并按原顺序追加 `scope.params`。count/list 仍用同一个 where/params，关联销售单头仓的授权口径、各筛选、分页、排序、详情与写操作均未改。

回归加入现有 `tests/refund-orders.smoke.test.js` 的 `scenarioRefundListScope`。正常 smoke 主入口及既有 `smoke:refund-orders` / Tests CI 入口仍运行该段；导出该只读段供现场单独运行，未调用创建/执行退款等写 scenario。断言从未过滤的真实行集合用 JS 独立判定授权，未复制被测 WHERE 拼接。

现场只读脚本先验证当前 runner、回环非共享端口、本批容器/卷/归属文件、实时 server UUID 等既有 `assertOwnedRepairInstance` 归属门，读取同批 runtime 私有配置，未读取生产配置或重建数据。

| 范围 | 修复前真实 SQL（red） | 修复后（green） |
| --- | --- | --- |
| null 不限仓 | 行、计数、组合筛选 3 项通过 | 3 项通过 |
| 合成仓 [1] | `ER_PARSE_ERROR` | 行、计数、组合筛选 3 项通过 |
| [] 空范围 | `ER_PARSE_ERROR` | 行、计数、组合筛选 3 项通过，结果真实空 |

`a-refund-sql-red.log`：3 passed / 2 failed、退出 1。`a-refund-sql-green.log`：9 passed / 0 failed、退出 0。当前临时库没有客户退款记录，现场只证明真实空集合读取及范围 SQL 可执行；正常 CI smoke 写场景完成后会对既有正向退款行运行同一授权集合断言，本文未把尚未跑的完整资金 smoke 说成通过。

`node --check` 2 个改动 JS 及 `git diff --check` 通过。`test:sql-identifier` 扫描 430 文件、34 处标识符插值，失败 0（`a-sql-identifier.log`）。主题文档已同步 `scopeFilter` 片段拼接与回归入口。

## 2. 仓库任务路径核实

真实前端 `frontend/src/api/warehouse-tasks.ts` 调用 `/warehouse-tasks/my` 与 `/warehouse-tasks/my-sku-summary`，对应 route 的查看权限与原 scopeOf 透传保持。两条本批真实请求均 **200**，见 `a-api-read-valid-paths.json`。

日志中的 `/warehouse-tasks/my-tasks` 和补查的 `/warehouse-tasks/my-task-sku-summary` 均未注册；它们落入 `/:id` 后 `+req.params.id` 得到 NaN，产生 `DB_COLUMN_MISMATCH` 500。这是错误探测路径，不是对应 PDA API/页面失败。不新增别名、不改权限，也未将修复不存在路径返回码扩成此轮 API 契约变更。该无效 ID 的 500 错误分类仍是一个已记录的输入错误边界。

## 3. 三个代表报表

当前 API 同库同权限实际请求均 200：成本对账 `/reports/avg-cost-reconciliation`、KPI `/reports/kpi` 及 `period=2026-10`、利润 `/reports/profit-analysis` 缺省及页面最近 30 日参数 `startDate=2026-09-09&endDate=2026-10-08`。成功信封的数据键与实际页面读取一致。

源码边界：成本对账复用 `findStockDrift` 只读；利润日期按创建时间，KPI 日期按 sale_date、回款按 payment_date；两者沿用销售整单仓库范围及原成本快照/估算链。未调整数值或放宽非法来源规则。API 200 仅证明本批代表读取，没有证明全部日期、数值正确性、图表交互或此前不同运行实例发生的原因。未修改这些报表后端或前端代码。

## 4. 现场重载后的证据

root 已将同一专属库的新源码 API 加载到 `http://127.0.0.1:50060`，Vite 5186。安全 HTTP 摘要 `a-api-read-green.json`：原限仓合成账号退款正常与关键字/状态/日期组合筛选均 200，列表计数 0；仓库两真实路径与三个代表报表 200。未改 scope/JWT 或数据库资料。

同一稳定命名浏览器实际查看退款正常空列表与关键词筛选；中断仅 `/api/refunds*` 后失败明确且不显示空/共 0，撤销中断点击重试恢复真实空并保留 RF-retry-keep，浅深核图，7 张补充截图列于 `a-after.md` 第 7 节。历史 500 截图保留，未覆盖或反称当时正常。没有有退款行的现场详情、业务出账或完整资金 smoke 证据；正向行断言留在既有 CI smoke 入口。

浏览器本会话 a 已 close，后续 list 仅 root，确认退出。
