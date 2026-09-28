# 本地实例脚本的「启动 / 迁移」职责拆分（2026-09-28，仅本地）

> **来源**：`docs/export-filters-fix-2026-09-27.md` §23.5 的"下一批候选"（该处只留指针）。
> **何时读**：改 `scripts/mysql8-dev.sh`、`npm run dev:mysql8*`，或需要"只借 3307 实例做隔离测试"时。
> **当前口径**：`docs/verification-commands.md`（`dev:mysql8` / `dev:mysql8:migrate`）。

## 一、背景

2026-09-28 为取得 3307 实例做隔离测试，执行了 `npm run dev:mysql8`（`scripts/mysql8-dev.sh start`）。该脚本的 `start` **一件事干两件**——起容器 + **对固定开发库 `flowcube_dev8` 跑结构迁移**；命令名里看不出迁移，于是"只想借实例"也把结构写进了开发库（脚本回显确认 263/264 落进 dev8）。这是**同类"迁移目标库边界失效"**的第二次发生：2026-09-26 那次（`docs/dev8-migration-drift-2026-09-26.md`）根因不同——是 `source` 指向不存在的文件导致 `migrate.js` 的 dotenv **回退 `backend/.env`**，**不是**本脚本。两次机制不同、类别相同。

Codex 批准**方案 A**：`start` 默认只起实例，迁移必须由**命名清楚的显式动作**触发。

## 二、改造（`scripts/mysql8-dev.sh` + `package.json`）

- **`start` 只启动实例**：容器复用 + 数据卷保留，**不改动任何库结构**；输出显式提示"如需迁移开发库请运行 `npm run dev:mysql8:migrate`"。
- **新增 `npm run dev:mysql8:migrate`**：唯一会迁移 `flowcube_dev8` 的入口。目标**硬编码**为回环 `127.0.0.1:3307` / `flowcube_dev8` / `root`，**不受外部 `DB_*` 影响**，且**不接受额外库名参数**。
- **`migrate` 绝不隐式启动**：只检查"profile 可用 + 指定容器 running 且 healthy"，未就绪即**非 0** 并提示先跑 `npm run dev:mysql8`。**只有 `start` 会启动** colima profile 与容器。
- **顺序修正（独立审查发现）**：docker context 由 colima profile 创建，**全新机器上尚不存在**；故 `start` 必须**先启动 profile、再检查 context**。反过来会让首次使用因 context 检查失败而**永远起不来**。
- **凭据边界（独立审查发现）**：凭据生成**只允许 `start`**；`stop`/`migrate` 缺凭据即**非 0**，**不替用户创建随机口令**。三个动作**都**校验"已存在且仅本人可读（600）"；**已有凭据绝不覆盖**。
- **远程 context 拒绝**：三个动作都要求 context 为本机 `unix://`，`tcp://` 一律拒绝。

## 三、守卫（stub shell 契约，不连库、不起容器）

`tests/mysql8-dev-script.test.js`（`npm run test:mysql8-dev-script`，**已接入 CI**）：把 colima/docker/npm stub 到临时 PATH；把**真实脚本复制到任务自建临时目录、只替换 `CONFIG=` 一行**指向伪凭据，运行**同一份脚本逻辑**——**不改 HOME、不读真实配置**；每个用例 `finally` 清理本次自建路径。共 **20 例**（Node 22 下 **20/0**）。

**反向验证（逐条精准变红）**：

| 摘掉的守卫 | 结果 |
|---|---|
| 迁移目标硬编码（改为 `${DB_NAME:-…}`） | **仅**「目标不受 DB_* 影响」变红 |
| start「先起 profile 后验 context」的顺序 | 「顺序保护」变红（连带依赖 start 成功的用例） |
| 凭据「只在 start 生成」（改为所有动作生成） | **仅** stop / migrate「缺凭据不生成」2 例变红 |
| CI 接线（摘掉 workflow 该步） | `deployment-resources` 守卫**点名** `test:mysql8-dev-script` 变红 |
| 改造前的整版脚本 | 首轮 **3 红**（start 会迁移、migrate 动作不存在） |

## 四、文档同步

- **现行主题文档**：`docs/verification-commands.md` 已更新 `dev:mysql8` / `dev:mysql8:migrate` 口径（只启动、目标固定、不覆盖凭据、不隐式串联）。
- **历史归档保留原文 + 指向当前说明**（不改历史内容）：`docs/agents-md-archive-2026-09-19.md`、`docs/codex-local-setup-2026-09-04.md`、`docs/local-mysql8-cutover-2026-09-04.md` 各加一段「2026-09-28 更新（本段原文保留）」，指向 `verification-commands.md`。

## 五、边界（如实）

- **未连接 `flowcube_dev8` 跑任何写测试**；本轮**未再迁移 dev8**；该库保持 263/264 已存在的现状，**不回滚**。
- 契约测试是 **stub 行为测试**，只证明脚本的**调用契约与退出码**，**不**证明真实 colima/docker 的运行时表现；真实启动与真实迁移**本批未执行**。
- `stop` 现在也要求 profile/凭据就绪（缺失即非 0）——相对改造前"colima 未启动时行为未定义"是**收紧**，属有意为之。
