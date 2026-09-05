# 上线审计：资金账户与固定资产修复（2026-09-05）

此记录描述专用开发工作树中的实现与本次测试；未提交、未推送、未部署，不代表已修复生产历史数据。

## 资金账户

`finance_accounts.current_balance` 仍由期初与流水重算。账户锁只保证写入串行，不能刷新调用方此前普通查询建立的 MySQL REPEATABLE READ 快照，因此余额聚合与修改期初前的流水检查采用当前读。删除也在事务内先锁账户，再当前读检查流水后软删除；删除和收付款写入只能有一方在冲突场景成功。

账户流水 API 的 `happenedAt` 返回北京日期 `YYYY-MM-DD`，与 DATE 列的业务语义一致。

## 固定资产

计提与处置都先锁账套（与期间关闭共用锁），再按顺序锁资产。共同折旧函数读取锁定历史，按实际剩余可折旧额截断本期金额，台账、本次返回金额及借贷凭证统一使用实际金额。到原值减预计残值即标记已提足；已提足资产处置不再增加折旧。

已有期间重试直接跳过，不改历史累计额或凭证；新期间不得插入现有最新折旧期间之前。处置日期不得早于购置日期或已有最新折旧期间。处置当期未计提时，同一事务创建折旧台账和折旧凭证，再生成处置单及处置凭证，任一步失败全部回滚。

资产购置日期、处置日期与折旧历史日期统一按北京日期输出 `YYYY-MM-DD`。

历史审计发现的余额漂移、重复期间累计数值及漏凭证数据不自动修复；生产数据检查与修订仍需走已授权的正式流程。

## 容器流水号

序列表中 0 表示未播种；已初始化的 I/B 序列直接原子递增，无需扫描容器表。首次初始化以当前读读取历史 I/CNT 或 B 编号最大值，避免旧 RR 快照漏掉已提交条码；序列行通过重复键 UPDATE 获取排他锁，避免共享锁升级死锁。以 `GREATEST` 保留先完成并发初始化者的值，再递增；不会将序列回退。

## 验证

独立本机 Docker MySQL 8 测试库 `flowcube_finance_fix_test`，经 `configureTestEnvironment` 校验。未加载开发库或生产库配置。新增 `tests/prelaunch-finance.smoke.test.js` 使用真实迁移、SQL、服务函数及凭证引擎；时序钩子只暂停真实查询，不模拟查询结果。

初次红测：8 组全部失败，包括余额 20 而应为 30、删除与收款同时成功、末期凭证 16.67 而台账 16.65、已提足处置凭证不平、重复累计 16.67→33.34、逆序计提被允许、处置缺少 95 元折旧凭证和重复编号扫描 3 次。

最终新增回归：15 组通过。除原始失败项，覆盖并发计提、处置失败事务回滚、残值下限、处置历史顺序、旧 RR 快照首次播种及 8 个事务同时申请容器编号。后两项曾分别出现错误的 `B000001`（应高于历史 `B900000`）及共享锁升级死锁，均先补失败断言再修复。

本次验证命令（执行前加载项目开发环境，并显式提供安全的 `.env.test`）：

```bash
DB_NAME=flowcube_finance_fix_test node tests/prelaunch-finance.smoke.test.js
DB_NAME=flowcube_finance_regression_test node tests/finance.smoke.test.js
DB_NAME=flowcube_finance_fix_test node tests/accounting.smoke.test.js
DB_NAME=flowcube_finance_fix_test node tests/accounting-period.smoke.test.js
DB_NAME=flowcube_finance_fix_test node tests/audit-finance-security.smoke.test.js
npm --prefix backend run lint
node --check tests/prelaunch-finance.smoke.test.js
git diff --check
```

- 新增财务专项：15 passed / 0 failed。
- 既有财务：108 passed / 0 failed。
- 既有会计：11 passed / 0 failed。
- 会计期间：15 passed / 0 failed。
- 财务安全审计：17 passed / 0 failed。
- 后端 lint、测试文件语法及 diff 检查通过。

最初在红测库执行既有财务套件得到 106/108，失败的两项都是全库余额一致性检查，命中了红测留下的两条故意漂移账户。为避免掩盖问题，另建空库 `flowcube_finance_regression_test`，重新迁移后执行财务套件，得到 108/108。最终新增回归会按所创建 ID 清理自己的资金流水、资产台账、处置及凭证；共享 smoke 基础数据和已消耗流水号保留。

迁移输出仍有仓库既存重复编号/缺号提示；本任务未增加或修改迁移。此处未执行页面验收，交互联调由主任务统一处理。AGENTS.md 与根脚本入口由主任务同批同步。
