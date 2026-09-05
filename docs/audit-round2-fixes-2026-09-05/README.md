# 第二轮修复证据

对应[修复报告](../prelaunch-round2-fixes-2026-09-05.md)及[机器索引](../prelaunch-round2-fixes-evidence-2026-09-05.json)。所有数据库写入为回环13308专用测试库；截图使用合成账号、设备和单据。没有生产备份、认证token或配置密钥。

- `database-regressions.json`：26套数据库脚本，保存初次环境失败及正确目标复跑。
- `frontend-tests.log`、`integration.log`、`runtime-tooling.log`、`deployment.log`、`ops-cors.log`：最终门禁。
- `*-red.log`及对应green：修复前正确断言失败、修复后通过；`ops-cors-initial.log`为模拟器参数不兼容的初次结果。
- `pool-real-db.log`：实际MySQL排队超时后不写入及ready恢复。
- `restore-real-synthetic.log`：合成五表备份实际导入；`restore-review-*.log`验证退出和零CPU边界。
- `company-created.png`：ERP实际创建成功且刷新列表。
- `pda-partial-list.png`：首批出5后仍有剩余批次入口。
- `pda-second-batch-out.png`：模拟扫码键盘输入后实际HTTP提交，已出10。
- `pda-complete-out-list.png`：全部出完后只保留入库卡片。
- `qa-fixture.json`：上述测试单据/容器ID与条码，不包含设备密钥或会话票据。

浏览器键盘事件模拟、组件测试与HTTP测试均不替代物理PDA、打印和生产发版验收。部分构建日志保留原工具的警告，见汇总中的实际限制。
