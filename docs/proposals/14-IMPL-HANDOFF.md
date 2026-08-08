# 14 正式上线修复计划 · 交接词

> 用途：把"基于 7 路深度审计的正式上线修复计划"交接给下一个会话执行。
> **接手第一件事**：读 `docs/proposals/14-正式上线修复计划.md`（完整修复清单与分阶段计划）+ 记忆 `erp-wms-feature-design-docs`（进度）、`user-hands-off-full-autonomy`（工作方式）、`release-dirty-worktree-technique`（发版精确 add）。

## 停靠点（当前状态）

- **main 已含本次审计与收敛改动**（合并提交 `f8e069d`），但 **`main` 领先 `origin/main` 5 个提交，尚未 push**——`4aba208`（.worktreeinclude）+ 会话内的 `158292c`（收敛功能）/`70bf14e`（文案润色）/`f21a244`（修复计划）+ `f8e069d`（合并）。
- **主仓库工作区有未提交改动**：`docs/proposals/HANDOFF.md`（另一会话的 WIP，**不要碰**）。
- **系统尚未正式投入使用**：本机是开发版，GitHub/服务器有正式版但没真实业务数据。这是修复成本最低的窗口期——结构类修复（索引/迁移/清数据）无需数据保全预案，行为变更无中断风险。

## 背景

2026-08-09 对 flowcube 做了 7 路深度审计（安全 / 代码质量 / 测试 / 前端 / 数据库 / 运维 / 业务流程），所有结论均经源码交叉验证。审计核心发现：

| 短板 | 一句话概括 |
|------|-----------|
| 数据权限漏 | 销售写接口 + 导出/报表/看板/通知完全无视仓库 scope（H2/H3 高危） |
| 测试覆盖极不均 | 51 模块仅约 7 个有直接测试；前端/桌面零测试；v0.4.60/61 两大新功能无测试 |
| 发布运维断点 | CI 跳过 release-gate；备份从未演练；4 张日志表无界增长；oplogs 清理未自动执行 |

**强项（修复时勿破坏）**：容器级库存引擎 + 14 条不变量、并发控制（FOR UPDATE + CAS + 幂等键）、金额全 DECIMAL、参数化 SQL 彻底、审计追溯、前端 strict 全开 + Keep-Alive 架构。

## 本会话已完成（可复验）

1. **收敛重复/下线功能**（`158292c`，已合入 main）：
   - 删除报表版采购计划 `/reports/procurement-plan`（与正式 /procurement 模块重复）
   - **删除来料质检合格率 `/reports/qa-quality` + 后端 `qa-supplier-report` 接口全链路**（controller/service/query/routes 四处）
   - 审批与提醒并入岗位工作台（`ReminderBlock`），删独立页/路由/报表中心入口卡
   - 库位五段编码合并进 `locations/index.tsx` 内置弹窗，删除死组件 `LocationFormDialog.tsx` 与 `useLocations.ts`
   - **注意**：删质检合格率只删了展示层与查询接口，`checked_qty/rejected_qty/concession_qty` 字段、PDA 质检流程、`inbound_qa_dispositions` 表原样保留，可随时恢复。
2. **全站文案润色**（`70bf14e`）：报表中心/波次/PDA 的生硬翻译改自然中文，仅用户可见文案。
3. **修复计划文档**（`f21a244`）：`docs/proposals/14-正式上线修复计划.md`（P0/P1/P2 + 分阶段执行 + 验证清单）。

## 待执行（按修复计划文档的 P0 → P1 → P2）

> 完整细节见 `14-正式上线修复计划.md`，此处是摘要与关键路径。

### P0 — 上线阻断级（8 项）

1. **数据权限补全（最高优先，H2+H3）**：`sale.service.js` 的 `findById/update/requestAdjustment/ship/cancel/deleteOrder/reserve/release` 加 `assertInScope`，`sale.controller.js` 补传 `req.user.warehouseIds`；`export/reports/dashboard/notifications` 四模块接 `scopeFilter`。参照 purchase 模块的正确模式。
2. **opLogger 敏感字段（一行修，H1）**：`middleware/opLogger.js` 的 `SENSITIVE_FIELDS` 追加 `device_secret/session_token/deviceSecret/sessionToken/idempotency-key`（snake_case 漏网，PDA 设备密钥明文落库）。
3. **packages 补闸（H4）**：`packages.routes.js` 5 处写接口（create/add-item/remove-item/void/finish）补挂 `pdaSessionRequired()`（现只挂可伪造的 `pdaOnly` 头），service 内补 `assertInScope`。
4. **禁 roleId=1 提权（M1）**：`users.service.update` 禁止把 `roleId` 改为 1；`users.routes.js` schema 拦截。
5. **结转/盘点补测试**：`accounting.period.service.js`（closePeriod/reopenPeriod/generateClosingVouchers）与 `POST /stockcheck/:id/items/:itemId/scan` 均零测试，补回归（参照 accounting.smoke 的事务+rollback 模式）。
6. **CI 去 SKIP_RELEASE_GATE=1**：`deploy-browser.yml:101`，SMOKE 凭据注入 GitHub secrets。
7. **日志表自动清理**：`scheduler.js` 挂 `oplogs.clearOld()`（每 6h）；print_jobs sweeper 加完成/失败 N 天删除；scan_logs/inventory_logs 加 TTL/分区。
8. **001 迁移去硬编码密码哈希**：`001_create_sys_users.sql` 移除 bcrypt 哈希，由 `bootstrap-admin.js` 完整建号。

### P1 — 3 个月内（10 项）
前端 9 类业务大表真分页（参照 `accounting/vouchers` 的 PAGE_SIZE=20）、双 toast 治理（61 处 mutation onError）、前端测试起步（vitest 先覆盖 labelGeometry/换算/状态推导）、补索引（printers.client_id / inventory_logs / warehouse_tasks / sale_order_items）、备份恢复演练 + 异地副本、报表数值测试 + 并发压力重写挂 CI、采购审批环节、出库信用复查、死代码清理（35 个死 API + 3 个死组件 + vBody 统一）、迁移编号校验。

### P2 — 上线后增量（16 项）
PDA 离线队列、供应商考核、采购价格管控、销售折扣、销项开票流程、退货退款单、部门组织 + 审批流引擎、FEFO 效期优先、呆滞处置单、经营 KPI 仪表盘、多账套预留、loki/sentry、Docker 非 root、慢查询、密钥轮换、组件拆分。

## 实现纪律

- 动库存/账款/占库/结算/状态机前**读透调用链**（engine/常量文件注释记录历史事故根因）。
- **每修一个高危项就补一条对应测试**（参照 `tests/` 现有 `smokeTestKit` 模式），不让修复本身成为新的无保护代码。
- 改后跑齐：`mainline`（必）、涉权限加 `warehouse-scope`、涉 PDA 加 `pda-device-session`、涉财务加 `finance`、涉库存加 `p0/p1/integration`、并发加 `concurrency-guards`。
- 新权限码**三处同步**（后端 permissions.js + 前端 permission-codes.ts + seed 迁移）+ `test:permissions`（当前各 169）。迁移只新增，编号取当前最大 +1。
- 前端 `tsc -p frontend/tsconfig.app.json --noEmit`（**不要用 tsconfig.json，那是空壳**）+ 两端 lint。

## 环境坑（本会话踩到，接手必防）

1. **多 worktree 隔离**：仓库有 10 个 git worktree，每个是独立代码副本 + 独立分支。**改了代码只影响当前 worktree/分支，别的会话从别的 worktree（或 main）启动前端看到的是旧代码**——这不是 bug，是 worktree 机制。要让改动全局生效必须合并进 `main`（已做）。接手时先 `git worktree list` 确认自己在哪个 worktree。
2. **主仓库 cwd 与 worktree 分离**：脚本 `cd` 会漂移，统一用绝对路径。命令前缀 `cd /Users/chengjianghao/flowcube`。
3. **共享 Browser 面板被另一 chat 争用**：验收优先 `get_page_text`，比 screenshot/scroll/click 稳；PDA 页须 `tabs_create` 开新标签（跨端守卫）。
4. **zsh `status` 是只读变量**：轮询 CI 的循环里 `status=$(...)` 会直接失败，改用 `st` 等别名。
5. **`main` 领先 origin 5 提交未 push**：接手若需发版，先确认是否 push（会触发 CI 部署）；不 push 则改动只在本机。

## 接手怎么继续

1. 读 `docs/proposals/14-正式上线修复计划.md` 全文 + 本文件 + 三条记忆。
2. 建议按修复计划"阶段一→阶段四"顺序执行（1-2 天起）：opLogger 一行修 → packages 补闸 → 禁 roleId → 迁移去哈希 → 每项补测试 → 数据权限补全 → 结转/盘点测试 → CI 门禁 → 日志清理。
3. 用户已授权全自主（含发版，见记忆 `user-hands-off-full-autonomy`），但**本任务是修复而非新功能**，建议在 P0 全部完成、测试全绿后再谈发版。
