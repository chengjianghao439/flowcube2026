# 已确认审计问题修复计划

> **For agentic workers:** Use subagent-driven-development for bounded implementation tasks and requesting-code-review for independent review. Steps use checkbox syntax.

**Goal:** 修复报告中经当前代码确认的缺陷，保留既有业务语义，补可失败的回归证据。

**Architecture:** 沿用 routes/controller/service 和调用方事务。安全校验覆盖真实入口；前端共享状态及原生资源生命周期独立测试；部署身份校验失败关闭，不自动信任网络扫描结果。

**Tech Stack:** Node 22 / Express / MySQL 8 / React / TypeScript / Vitest / GitHub Actions。

## 范围与验证顺序

- [x] A：PDA 票据用户绑定、条码仓库范围、跨进程权限即时读取；先以模拟数据库行为测试复现拒绝缺口，再补独立 MySQL/HTTP 回归。
- [x] B：盘亏预占保护、扣减参数符号、手动出库请求载荷绑定；保留保存的实盘数，提交前整单拒绝不能由剩余实物支撑的已占库存，要求通过既有销售释放/调整流程处理。不能静默替业务选择牺牲哪张订单；预计采购绑定从实物预占中扣除。
- [x] C：结案行金额与建单一致、草稿更新请求键、收款核销及余额四位精度；比较/累计使用固定点，保留金额四位和单价八位来源精度，不把数量精度规则套在金额上。
- [x] D：待确认记录多实例共享、存储异常、相机卸载/异步启动竞态；前端真实 React 挂载测试先失败后修复，不持久化额外敏感内容。
- [x] E：采购建议分页避免每一页重算全部组合；保留净额和跨仓调拨候选的完整业务计算，使用有界、用户范围绑定的短期分页快照，不把跨用户结果共享。
- [x] F：可信 SSH 主机键、smoke 密码不进 argv、导入类型错误 400、生产 CORS 拒绝无边界反射；脚本行为测试和 workflow 接线守卫必须先出现红灯。
- [x] G：回执到期边界与异常上报，仅修能证实的缺口，未证实的长期离线重放/设计项不冒充已修。
- [x] H：同步业务、前端、财务、运维和验证主题文档；新增测试接入 package/Tests CI。运行根 test、独立库 smoke、前端全量单测/类型/lint/双目标构建，独立复核并处理有效问题。

## 主要文件与测试

| 任务 | 实现位置 | 验证位置 |
|---|---|---|
| A/B | `middleware/pdaSession.js`、`utils/warehouseScope.js`、`middleware/loadRolePermissions.js`、`modules/inventory/*`、`modules/stockcheck/stockcheck.service.js`、`engine/containerEngine.js` | `tests/confirmed-audit.test.js`、`tests/confirmed-audit.smoke.test.js` |
| C | `modules/sale/sale.service.js`、`modules/sale/sale.controller.js`、`api/sale.ts`、`modules/payments/payment-receipts.service.js`、`modules/finance/finance-accounts.service.js` | `tests/confirmed-audit-money.test.js`、实库 smoke |
| D | `hooks/usePendingRequests.ts`、`hooks/usePdaFlow.ts`、`hooks/useCameraScanner.ts`、窄职责 `lib` | 对应 `*.test.tsx` |
| E | `modules/inventory/inventory.procurement.js`、`inventory.controller.js`、`api/allRecords.ts` | 纯分页快照行为测试和现有采购 smoke |
| F/G | `.github/workflows`、`scripts`、`config/cors.js`、`modules/import/import.routes.js`、`utils/operationRequest.js` | shell/Node 行为测试、既有配置/部署守卫 |

## 测试纪律

每组先执行针对旧实现的回归，记录预期失败，再实现并重跑。新源码契约测试剔除整行注释并做反向验证。实库只用 `flowcube_confirmedaudit20260923_test` 与显式回环配置；不加载真实 backend/.env。未授权 push/tag/发布，不读取生产秘密。

## 不改项目

BUG-07/08/10/11/14/16、P2-04 及五项未证实推断不作为修复理由。BUG-18/19 保持不限仓及账套业务维度的现行设计。BUG-06 保留原始收款与独立退款流程，不自行改变退款政策。

## 完成边界

G 核实既有 Sentry 捕获与无 DSN 兜底后仅补后者；七天回执清理保留，因为报告没有证明客户端自动重放到期请求。验证记录见 `docs/audit-confirmed-fixes-2026-09-23.md`。未修改生产配置、未提交或推送。
