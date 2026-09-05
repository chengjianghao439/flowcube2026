# 第二轮审计证据

结论见 [主报告](../prelaunch-second-audit-2026-09-05.md)。JSON/日志是 2026-09-05 的观测，不代表未来代码仍有相同问题。`payroll-probe.cjs`、`transfer-probe.cjs` 和 `client-probe.test.ts` 部分断言刻意验证缺陷存在；退出 0 不表示业务正确，修复后应改成正确预期的正式回归。

## 安全环境与复现

数据库探针必须提供测试专用 `.env.test`，复用 `tests/helpers/testEnvironment.js`；仅允许回环与 `flowcube_*_test` 库，不读取真实 `backend/.env`。目标库须事先完成迁移。工资探针 finally 清理自己创建的账套；调拨探针保留随机前缀 fixture 便于查看状态，不应对共享开发库或生产运行。池探针仅持有一个连接约 11 秒并执行 SELECT。

从仓库根目录运行，路径改为实际测试配置：

```bash
source "$HOME/.config/flowcube/dev-env.sh"
FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test DB_NAME=flowcube_hr_fix_test node docs/audit-round2-2026-09-05/payroll-probe.cjs
FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test DB_NAME=flowcube_fix_24_test node docs/audit-round2-2026-09-05/transfer-probe.cjs
FLOWCUBE_TEST_ENV_FILE=/绝对路径/.env.test DB_NAME=flowcube_fix_24_test node docs/audit-round2-2026-09-05/pool-probe.cjs
```

前端探针归档在 docs，不参与常规 Vitest 收集。将其复制到一个不存在的 `frontend/src/api/round2.audit-probe.test.ts`，在 frontend 目录运行 `./node_modules/.bin/vitest run src/api/round2.audit-probe.test.ts`，完成后只移除该临时副本。包含真实 client 拦截器、模拟会话和 Axios adapter；不进行真实 HTTP。18 项为原有 16 项加新增 2 项，本轮执行记录见 `client-probe.log`。

## 文件说明

- `transfer-evidence.json`：26 条真实本机 HTTP 回执和扫码后的 SQL；账号、单据、容器均是独立测试 fixture，无真实凭据。
- `payroll-evidence.json`：四组独立账套实验和顺序对照；无银行或税务调用。
- `pool-evidence.json`：单连接被占用时的排队时长。
- `production-*.sql/log`：仅汇总的生产只读核查，不自动连接任何服务器。
- `restore.log`：本机隔离恢复记录。源备份时间以主报告/汇总 JSON 为准，日志 0 小时只是 SCP 复制时间；原始备份不纳入仓库。
- `knip-*.json`：扫描器原始候选；误报及保留原因见主报告。
- `npm-audit-*.json`：三端完整依赖审计，含开发依赖。

归档的数据库探针只把本机绝对根目录改成相对定位、测试配置改为调用方显式提供，业务复现步骤不变。根目录和文档两级关系应保持；产物默认仍写 `/tmp/flowcube-round2-*`。凭据不得写入本目录。证据文件哈希及被审代码哈希见 [汇总 JSON](../prelaunch-second-audit-evidence-2026-09-05.json)。
