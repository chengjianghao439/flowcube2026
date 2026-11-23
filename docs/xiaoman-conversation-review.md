# 小满会话复盘

会话记录工具随项目源码维护。它按会话记录每轮问答、确认和续办结果，并保留岗位编号、业务状态和耗时。打开历史任务时接回原会话。

## 查看记录

在项目根目录运行下面的命令。未配置独立运行目录时，工具读取项目内的 `agent/data/conversations/`。

```bash
npm run assistant:conversations -- --days 7
npm run assistant:conversations -- --days 7 --session 0123456789abcdef0123456789abcdef
```

第一条显示汇总及会话索引。将第二条的示例编号换成汇总中的 `sessionId`，即可查看对应会话的逐轮记录。如果服务配置了独立的 `AGENT_DATA_DIR`，用 `--data-dir` 指向同一个运行目录。日志按日写入私有数据目录。项目内的 `agent/data/` 和 `agent/output/` 已由 Git 忽略。

复盘时可优先查看同一会话内反复追问、结果待核和办理受阻的轮次。用逐轮记录确定是原单没找到、信息缺失，还是权限或业务状态卡住，再把脱敏后的典型问法加入回归样本。

## 本地验收

隔离 MySQL 的正式接口用销售、客服、财务、仓库作业员和只读账号验证了 **45 组会话、67 轮聊天、89 条请求**。日志覆盖无任务回复、续办、跨账号拒绝和常见凭据过滤。已复核服务重启后保留会话关联，以及日志写入故障时业务仍可回复。

本机合成样例在项目目录 `agent/output/xiaoman-conversation-journal/`，其中 `report-summary.json` 是汇总，`report-example.json` 是一组逐轮记录。采集从工具启用后开始，较早的业务任务快照无法补出完整问答。
