# 第二轮审计修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 R2-01 至 R2-08，并补齐连接池等待、业务就绪与恢复资源边界；明确外部监控和异地备份的实际接通状态。

**Architecture:** 业务事务保持原引擎入口；调拨按计划数量闭合并统一明细分配，工资累计按年度依赖保护，客户端请求绑定会话代次。基础设施改动集中在连接池、readiness 与恢复脚本，不改生产环境、不发布。

**Tech Stack:** Node 22、Express、mysql2/MySQL 8、React/TypeScript、Vitest、Bash/Docker。

## 0. 基线和归属

- [x] 保存已有 114 个改动路径的哈希到 `/tmp/flowcube-round2-fix-baseline.json`，不清理或覆盖前轮修复。
- [x] 使用专用 `codex/prelaunch-round2-fixes-20260905` 分支，保留当前工作区供本地页面联调；不提交或推送。
- [x] 执行时每个领域先读取全调用链和现有回归，再按以下用例观察失败、实现、复测。数据库一律公共测试环境校验和独占 fixture。

## 1. 调拨（R2-01/05/06/07）

文件：`backend/src/modules/transfer/transfer.{controller,service}.js`、PDA 调入/调出页面及回执 action、`tests/round2-transfer.smoke.test.js`、`docs/prelaunch-round2-transfer-fixes-2026-09-05.md`。

- [x] 将审计真实 HTTP fixture 改为正确行为断言，先运行失败：
  ```js
  assert.equal(firstReceipt.completed, false) // quantity=10, shipped=received=5
  assert.equal(secondOut.status, 200) // 重复商品两行各5也能完整执行
  assert.equal(outsideCreate.status, 403)
  assert.equal(replayForB.data.transferId, orderB) // 或明确拒绝跨资源键，不能回A
  ```
- [x] 统一扫码按商品合计可调量及逐行数量分配，兼容已有重复行；完成必须所有行计划、已出、已收闭合。
- [x] 创建入口传入 scope 并验证两端仓；action 绑定单据，同步回执查询消费者。保留整箱、设备仓、事务锁序和库存引擎约束。
- [x] 回归正常、分批、重复行、越界、同单重试、跨单键、错仓设备，保存数量/容器/状态证据；立即更新领域说明。

## 2. 工资（R2-03/04）

文件：`backend/src/modules/hr/hr.{tax,service}.js`、需要时新增窄职责依赖辅助文件及增量迁移、`tests/hr-tax.smoke.test.js`、`tests/round2-payroll.smoke.test.js`、`docs/prelaunch-round2-payroll-fixes-2026-09-05.md`。

- [x] 先观察正确期望失败：
  ```js
  assert.equal(february.tax, 0) // 一月0、二月10000，持续任职
  await assert.rejects(calculateFebruaryBeforeJanuary, { statusCode: 409 })
  await assert.rejects(changePredecessorOfPaidMonth, { statusCode: 409 })
  ```
- [x] 保留累计所得净余额，计税时截非正值；校验任职与年度边界。
- [x] 在稳定账套/年度锁下核验前置月份；已发放后月禁止上游更改，未发放后月失效或明确要求逆序撤算，发放再次验证基线。允许同一正确月份幂等重算，不静默修改历史已发凭证。
- [x] 真服务验证顺序累计、缺月、逆序、跨年、前月变更、跨月并发；复跑已有 HR 回归并写清历史数据兼容。

## 3. 客户端（R2-02/08）

文件：`frontend/src/store/authStore.ts`、`frontend/src/api/client.ts` 及续期测试、`frontend/src/lib/authSession.ts`、账套创建页面与组件测试、`docs/prelaunch-round2-client-fixes-2026-09-05.md`。

- [x] 先让迟到旧401的写请求拒绝、成功旧响应拒绝、同会话正常续期成功等测试在修复前失败。
- [x] 登录和退出递增非持久化会话代次，`setTokens` 正常续期不改变代次；请求首次派发捕获，所有响应/重放检查归属。避免旧请求被续期后覆盖身份；保留现有多端 API 地址及账套保护。
- [x] 创建账套用 mutation 管理 pending，提交中禁止重复与关闭；切换闸门覆盖这条真实写入口，成功正常刷新列表。
- [x] 真实 store/hook 组件测试覆盖退出→新登录→旧401交错、创建期间切换；补 lint、类型检查并同步说明。

## 4. 容量、readiness、恢复与监控

文件：`backend/src/config/db.js`、`env.js`、`backend/src/app.js`、窄职责连接池/就绪辅助模块、`scripts/restore-check.sh`、相关部署/监控脚本、compose、样例配置、`tests/round2-runtime.test.js` 及独立数据库探针。

- [x] 先证明连接池饱和时超期请求不会稍后继续执行：
  ```js
  await assert.rejects(queuedWrite, { code: 'DB_ACQUIRE_TIMEOUT' })
  held.release()
  assert.equal(await countUnexpectedWrites(), 0)
  ```
- [x] 对连接获取加有界等待，覆盖 pool.query/execute/getConnection，超期迟到连接立即释放；SQL/事务时限不靠只返回超时却后台继续写的 Promise.race。
- [x] 新增轻量有界 readiness，数据库不可达/排队饱和返回503；保留存活接口。同步部署门禁、容器 healthcheck 与监控。
- [x] 恢复容器默认限制 CPU、内存、进程及总时长；超时与退出可靠清理本任务容器，用合成备份实跑真实导入；超时与信号通过真实进程加模拟Docker验证。
- [x] 核对既有监控接收端配置，仅输出是否存在。补可配置接通验证与运维说明；缺少接收端或异地目标时明确保留外部配置待办，不虚构上线验证，不发送未授权外部消息。

## 5. 汇总、联调、交付

- [x] 主任务独立检查各领域 diff、跨文件契约与业务边界；运行新增回归、受影响旧回归、前后端 lint、app 类型检查、ERP/PDA 构建。
- [x] 本地开发页面实际验证调拨/账套/设备绑定；核实当前无工资前端页面，工资通过真实服务与HTTP验证（见汇总限制）；浏览器使用独立稳定会话并关闭确认。Windows、Android 真机和物理打印如环境缺失则明确未验收。
- [x] 更新 `AGENTS.md` 第6–9、10、15节和原审计状态，新增修复矩阵/证据，保留修复前原始证据不覆盖。
- [x] 检查实际变更路径、文档链接、`git diff --check`；保留用户开发服务，停止本任务测试容器；汇报本地实现、验证和外部配置限制，不执行发布。

完成记录以 `docs/prelaunch-round2-fixes-2026-09-05.md` 与汇总证据为准；外部配置与真机/生产验收不在本地通过项中。
