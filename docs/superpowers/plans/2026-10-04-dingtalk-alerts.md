# 钉钉报警整理实施计划

> **For agentic workers:** 使用 executing-plans 在当前会话逐项实施；本任务不委派、不提交、不推送、不发版；主目录保持main，实施放在独立工作树codex/dingtalk-alerts。

**Goal:** 服务器消息按影响和处理优先级呈现，新故障不被已有预警遮蔽，用作业异常预警替换钉钉经营预警。

**Architecture:** 保留 Bash 探针及发送入口，由宿主 Node 22 公共模块负责 JSON 编码、告警状态和摘要格式。按稳定故障标识记录已通知状态，发送成功才确认；慢查询数量仅进入摘要，容器重启按近期采样增量判定。

**Tech Stack:** Bash、Node 22 CommonJS、node:test；验证使用任务专属临时目录和模拟 Docker/网络命令。

## 1. 消息编码及监控状态

文件：`scripts/lib/ops-common.sh`、新建 `scripts/lib/ops-alerts.js`、`scripts/monitor.sh`、新建 `tests/ops-alert-notifications.test.js`。

- [x] 补真实脚本回归：换行/引号/反斜杠保留；公网故障先于磁盘；已有异常时新故障通知；持续同一故障去重；逐项恢复；发送失败下一轮重试。
- [x] 运行失败用例：`node --test tests/ops-alert-notifications.test.js`，确认失败来自旧行为。
- [x] 用 `JSON.stringify({ msgtype: 'text', text: { content } })` 编码；保留 HTTP 与 errcode 确认，限制长消息并显式提示截断。
- [x] 监控按服务、数据安全、资源分组；状态兼容旧 `ok`/`bad <epoch>`，新状态记录当前故障与已成功通知的故障。保留独占锁、探针时限和持续提醒。
- [x] 补慢查询仅摘要、近期重启增量及容器重建重置基线的回归。

## 2. 日报与恢复结果

文件：`scripts/daily-report.sh`、`scripts/restore-check.sh`、上述公共模块与回归。

- [x] 正常日报一行；异常依次显示影响、待处理事项、备份/恢复演练、服务和资源指标，不再声称收到日报就代表系统正常。
- [x] 展示最近备份文件时间与大小，明确文件级信息不代表可恢复；自动恢复演练成功/失败落独立结果供日报读取，历史手工演练不覆盖自动结果。
- [x] 日报使用最近监控采样的慢查询数量；采样过期或缺失明确写出。保持日报心跳。

## 3. 停用经营预警并同步说明

文件：`backend/src/scheduler.js`、`.env.example`、`docs/print-deploy-ops.md`、`docs/runbooks/failure-recovery.md`、`docs/verification-commands.md`、`.github/workflows/test.yml`。

- [x] 移除 `dingtalk-alert` worker，注册只读作业异常worker：当前最新出库箱标签失败/超时、有效波次8小时/4小时无近期作业；消息带单号/持续时间/处理位置，资源级去重、发送成功后确认。不改站内通知与登录导航；保留 `stock-drift-check` 及其 webhook/签名配置。
- [x] 用隔离 scheduler 执行验证实际注册的 worker 名称，不加载数据库或业务数据。
- [x] 新回归接入已有 CI 运维回归步骤，同步主题文档和配置样例。
- [x] 统一运行：`node --test tests/ops-alert-notifications.test.js tests/ops-monitor-restore.test.js tests/deployment-resources.test.js tests/restore-trigger-normalize.test.js tests/migration-trigger-bodies.test.js`；执行 `bash -n`、`node --check`、`npm run test:agents-md-guard`、`git diff --check`。
- [x] 核对最终差异，报告本地验证与线上接收尚未验收的边界。

## 实施与本地验收结果

- 新消息/状态回归先在旧实现失败；完整运维组66项自然通过，最后菜单文案/日期有效性调整后相关12项复验通过。
- 后端修改文件ESLint、Bash/Node语法、差异空白、AGENTS注入、只读查询循环与SQL标识符守卫通过。新工作树的临时依赖链接已移除，主目录main干净。
- 独立临时MySQL8.0.46执行两条实际查询，命中当前打印失败/超时、长期无作业波次；排除补打成功、已出库、取消中、新入队、近期成功扫码、已结束任务及已取消波次。临时容器按本批label确认归属后移除，无数据卷。
- 仅本地实现，未提交、推送、部署或实际发钉钉。发版前全量业务回归、同SHA远端CI、生产cron/宿主Node22与真实机器人接收仍需验证。

作业消息示例（脱敏）：

> 出库打印失败｜WT-示例
>
> 仓库：示例仓；箱码 BOX-示例
>
> 持续：12分钟
>
> 处理位置：系统 → 条码打印查询 → 出库条码，用箱码查找并核对/补打

链接保留为辅助入口；登录后的跳转逻辑没有调整。消息正文提供定位和处理信息。

## 2026-10-07 发布分支整合复核

以上本地验收记录是原工作树历史结果，不能替代当前发布候选验收。本轮发现两条作业查询仍引用现行迁移没有创建的 `warehouses` 表；已改为迁移002定义的 `inventory_warehouses`。新增读取全部现行迁移表名的守卫，旧查询明确失败（自然退出1），修正后通过（自然退出0）；此离线守卫只能验证表名，不能证明MySQL查询行为。

`tests/operation-alerts.smoke.test.js`以 `configureTestEnvironment` 校验显式回环独立测试库，仅在一个事务内插入随机合成仓库、任务、箱、波次与扫码记录，调用真实 `buildOperationAlerts` 后 finally 回滚并关闭连接。覆盖最新标签失败/排队超时、终态/取消/改单/删除/旧补打排除、8小时/4小时波次、近期扫码，以及查询和响应不含打印正文。不启动应用、调度器、物理打印或真实机器人。由根runner先迁移 fresh 测试库，再串行执行：`FLOWCUBE_TEST_ENV_FILE=<本轮.env.test绝对路径> node --test tests/operation-alerts.smoke.test.js`；本文件记录时尚未执行本轮数据库验收。

三方整合保留安全分支 `cleanupSessionFamilies`，离线scheduler回归实际执行隔离的refresh清理闭包，同时核对作业异常worker、库存漂移worker与旧经营worker移除。定向告警回归13项自然退出0，新增合并回归2项自然退出0；后台三文件ESLint、五个Bash语法检查与新smoke/运维helper语法检查自然退出0。完整运维五套首轮65/67，另外2项因并行合并中的package.json冲突标记无法解析而失败（自然退出1）；该失败不记为通过，待根runner完成接线后复验。

根runner完成package/CI整合后，完整运维五套最终67/67自然退出0（`/tmp/flowcube-operation-alert-offline-complete.log`）。原历史数据库/真实机器人边界仍按本节单独验收。go-live runtime 的heartbeat/claim/complete调用也已改用自建工作站注册返回的完整headers；权限集已包含实际管理常量 `PRINT_PRINTER_MANAGE`，用途绑定没有另一枚 `PRINT_BINDING` 常量，GET/PUT/DELETE分别依赖打印机查看/管理权限。fixture语法与ESLint通过，真实业务回归由根runner在归属验证后的专属库执行。

生产切换仍须验证宿主Node22在cron PATH可用、`ops-common.sh`/`ops-alerts.js`与调用脚本同批落盘、状态目录可写且JSON状态0600、5分钟监控/9点日报/自动恢复记录与机器人实际接收。两个webhook配置键仍不同；应用外发由经营计数替换为作业异常、库存漂移保留，群应获准查看所有被提醒仓库。首次状态升级与应用重启可能对当前异常重报；本轮离线结果不代表生产切换或接收结果。
