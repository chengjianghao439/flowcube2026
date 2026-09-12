# 仓库运营与 PDA 读取范围专项 — 2026-09-12

本专项承接全模块回归中仓库运营四项指标的缺表降级。代码位于 `codex/operations-optimize-20260912` 工作树，以 `8d2fd0c` 为本专项起点；本文描述工作区实现和本机独立测试库证据，不代表提交、CI 已运行或生产部署。

## 根因与当前口径

- `pda_error_logs`、`pda_undo_logs` 没有 SQL 迁移；`scan-logs.service.js` 的 `logScanError`、`logUndo` 和 `getAnomalyReport` 沿用 `CREATE TABLE IF NOT EXISTS`。本次初次检查两表确实不存在，真实调用两个记录服务后成功建表并写入各一条。首次空库报表的降级是现行初始化生命周期，不能据此认定四项 SQL 本身无法运行。
- 独立缺陷是仓库运营错误汇总、撤销汇总、人员错误数、最新异常记录未使用用户仓库范围。现已经 `task_id → warehouse_tasks.warehouse_id` 与扫码指标使用相同范围。受限用户排除 `task_id` 为空或任务已不存在的日志，不限仓用户保留全部日志。
- `todayShipped` 的 SQL 日期与仓库参数顺序原先相反，且把 `PACKING(5)` 当作已出库。现按 `WT_STATUS.SHIPPED(7)` 统计并优先使用 `shipped_at`；当前合法出库入口 `warehouse-tasks.ship.js` 在同一状态CAS写该时间。初始迁移允许此列为空且没有历史回填，故旧记录缺失时兼容回退 `updated_at`，不能把回退日期称为精确历史出库时间。真实出库日与更新时间错开的夹具分别验证优先级。
- 卡片“拣货中”只计 `WT_STATUS.PICKING(2)`，不混入待分拣/待复核。今日入库使用 `getStatusRule('inboundTask', 'finish').to(4)`，即全部上架完成，排除待上架(3)；前端提示同步为“已全部上架完成”。收货表无独立完成时间列，日期仍依照 `updated_at`，后续更新可能影响历史日期归属，未宣称精确事件时间。上述任务指标均排除软删除。
- 流程积压按 `WT_STATUS_ACTIVE` 与 `WT_STATUS_NAME` 展示六阶段：待拣货、拣货中、待分拣、待复核、待打包、待出库；排除已出库、已取消、软删除。前端颜色直接引用生成 `WT_STATUS`，不保留旧1..5错位映射或“完成积压”说明。
- 空范围原先生成 `IN ()` 并使扫码总量、人员和小时趋势降级，现复用 `scopeFilter([])` 的零可见语义。正常空结果不再依赖 SQL 异常兜底。
- 最新异常遵循页面既有“今日快照”说明，只返回北京时间当日最近 10 条错误日志；同一时间追加 `id DESC` 稳定排序。错误率仍是错误事件数除以成功扫描记录数，可能超过 100%，本次未变更分母定义。
- `/api/scan-logs/stats`、`/anomaly` 原先只检查 `SCAN_LOG_VIEW`，controller 未传仓库范围；现传入当前认证用户的 `warehouseIds` 并在所有统计消费者一致过滤。原 `BETWEEN startDate AND endDate` 漏掉结束日午夜后记录，现为 `>= startDate`、`< endDate + 1 day`，单侧日期也独立生效。
- `/api/scan-logs/task/:taskId` 原先知道任务 ID 即可读到其他仓记录。现先检查未删除任务存在，再做仓库范围断言：跨仓/空范围 403、任务不存在 404。不限仓仍按既有授权语义读取。

## 真实回归与红绿证据

新增 `npm run smoke:warehouse-ops`，命令复用 `tests/helpers/testEnvironment.js` 的显式独立测试库校验；已加入 `.github/workflows/test.yml` 数据库回归任务，尚未执行远端 CI。

| 阶段 | 结果 | 证明内容 |
|---|---|---|
| 仓库运营修复前 | 6 通过、9 失败 | 四指标串仓、出库数为零、多仓/空范围降级、HTTP 用户范围失效 |
| 仓库运营修复后 | 15/15 | 原四项真实非零、单仓/多仓/空范围/不限仓、日期边界、最新10条、HTTP401/403 |
| 扩展 PDA 读取修复前 | 23 通过、14 失败 | 结束日遗漏、统计串仓、空范围无效、跨仓任务详情可读 |
| 读取范围修复后 | 37/37，零SQL降级 | 初版夹具沿用旧状态数字，未证明出库/入库/流程状态口径正确；后续评审补查如下 |
| 现行状态补查修复前 | 35通过、4失败 | 真实状态夹具揭露待打包算出库、拣货混入后续阶段、待上架算完成、流程标签和数量错位 |
| 最终修复后 | 39/39，零SQL降级 | `TZ=UTC npm run smoke:warehouse-ops`；六阶段分别1至6个夹具、终态、软删除、跨仓与出库时间优先级精确验证 |
| 前端关联报表测试与类型 | 13/13、类型检查通过 | 三个报表测试文件及 `tsc -p frontend/tsconfig.app.json --noEmit` |
| 后端 lint | 通过 | `npm --prefix backend run lint` |
| 既有运行时回归 | 17/17 | `npm run test:round2-runtime` |
| 语法与diff | 通过 | `node --check tests/warehouse-ops.smoke.test.js`、`git diff --check` |

最终测试连接 `127.0.0.1:3307 / flowcube_operations20260912_test`，MySQL session time_zone 为 `+08:00`，Node 为项目环境 Node 22。shell 只 source 本机测试配置，没有读取 `backend/.env`，没有回显口令。

夹具为两个专属仓库、两个真实测试用户/角色、仓库/收货任务、错误/撤销/扫描日志；覆盖昨日23:59:59、今日00:00:00、今日白天、今日23:59:59、明日00:00:00，同操作员跨仓和无归属日志。授权单仓的精确值为扫描2次/数量5、错误12、撤销2；授权两仓为扫描3次/数量12、错误14、撤销3；任务状态回归中单仓今日出库3（含1条NULL时间兼容记录）、拣货中2、完成入库1，活动六阶段分别1至6。HTTP 直接挂载真实路由、JWT、当前用户、数据库角色权限与仓库范围中间件，监听回环随机端口，不启动业务调度器。

测试 `finally` 关闭 HTTP server 和连接池，按本次唯一标记/ID清理夹具；不会全表删除或 DROP 任何已有表。完成后对错误、撤销、扫描、仓库任务、收货任务、仓库、用户、角色和鉴权审计的本次标记重新查询，九表夹具残留均为0。首次按需创建的两个日志表保留；独立测试库和用户原有开发服务不删除。

本机证据在忽略目录 `output/module-regression-20260912/followup/`：

- `warehouse-ops-red.log`：四指标补证与修复前失败。
- `warehouse-pda-red.log`：扩展读取权限/日期修复前失败。
- `warehouse-ops-green.log`：读取范围37项通过与连接目标（不含凭据），状态口径补查前记录。
- `warehouse-ops-status-red.log`、`warehouse-ops-status-green.log`：现行状态专项35过4失败到最终39/39。
- `warehouse-ops-cleanup.json`：九表本次夹具残留0。

## 剩余边界

- GET `/api/scan-logs/anomaly` 仍调用两条 `CREATE TABLE IF NOT EXISTS`，不能标记为数据库完全只读；运行时建表迁移化、数据库账号仅DML权限时的可用性以及表索引/大规模性能不在本轮修改内。
- `logScanError`、`logUndo` 写路径继续保留现行权限、参数、失败警告和主流程不中断语义。本专项没有扩大到 PDA 日志真实性/设备绑定等写入策略。
- 本机独立库 HTTP 回归不等于本地开发页面、生产环境、PDA实机扫描或物理打印验收；这些证据由主任务分别记录。没有真实快递请求、生产发布、生产 SQL 或实机打印。
