# 全仓审计整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 持续执行，不在步骤间等待用户批准。

**Goal:** 修复审计 F01–F12 与 R01–R03，保留现有功能并给出当前本地验证证据。

**Architecture:** 保持模块化单体；授权在后端资源边界执行，设备生命周期使用同一行锁协议，销售凭证采用可核实的发货期间事实且兼容历史来源。前端复用 HashRouter 和工作区可见性，部署安全头按实际响应验收。

**Tech Stack:** Node 22 / Express / mysql2 / MySQL 8、React / TypeScript / Vite / Vitest、Nginx。

## 执行与范围

- 工作树：`/Users/chengjianghao/.codex/worktrees/audit-remediation-20260922/flowcube`，分支 `codex/audit-remediation-20260922`。
- 全部修复授权已给出；不触碰真实配置、生产、推送或发版；不删除其他任务改动。
- 每组先运行失败测试，再改实现，再跑定向验证；最终共用函数和路由变更跑全套相关回归。
- 根代理负责 package.json、CI、综合结果及会计；一次只派一个实现子代理，文件职责明确，完成后分需求与质量两轮独立复核。

## Task 1 — 前端行为 F09/F10/F12

Files: `frontend/src/components/layout/KeepAliveOutlet.tsx`、`frontend/src/api/allRecords.ts`、`frontend/src/hooks/useDashboard.ts`、相关 `.test.ts(x)`、`docs/frontend-pda-conventions.md`。

- [x] 为 HTTPS 与 file URL dirty popstate、分页部分重叠、隐藏工作区轮询写失败测试并运行。
- [x] 用当前文档 URL + hash 恢复地址与 history state；取消不丢上下文，确认导航到原目标。
- [x] 为分页行做跨页身份一致性检查（兼容复合键列表），重叠拒绝而不是去重后伪装完整。
- [x] 仪表盘 hook 使用现有工作区激活条件，保持 queryKey 去重。
- [x] `npm --prefix frontend run test:unit`、app tsconfig 类型检查；同步主题文档；复核。

## Task 2 — 资源授权 F01/F02/F05/F06/F08

Files: `backend/src/modules/credit-overrides/*`、`print-jobs/*`、`users/*`、`pda-devices/*`、前端 UserFormDialog / roles API hooks、`tests/audit-remediation-security.smoke.test.js`、财务/打印主题文档。

- [x] 从审计独立库场景建立失败用例：申请权限批准、跨仓补打/消费、自改角色、全局设备、自定义角色分配。
- [x] 无流程授信提交 fail-closed；已有无实例待批也不能用申请权限批准/驳回。
- [x] 打印动作统一资源范围，保留工作站/ackToken 校验；客户端只领取有权访问的任务。
- [x] 非超管不能自改角色，角色存在性与允许分配权限服务层校验；动态角色选项替代 2–5 上限。
- [x] 无仓设备按全局资源处理，所有读写保持一致；合法作用域请求继续成功。
- [x] 跑权限、角色、授信、打印、仓库范围与新增安全 smoke，同步文档并复核。

## Task 3 — 设备生命周期 F03/F07 与 R01/R02

Files: `backend/src/modules/pda/pda.sessions.service.js`、`pda.routes.js`、`todo-counts.service.js`、`backend/src/modules/pda-devices/pda-devices.service.js`、`middleware/pdaSession.js`、新设备并发测试。

- [x] 写建会话 vs 换仓/重置交错、重置失败回滚、未登录 todo-counts、分页边界的失败测试。
- [x] 创建/续期/换仓/重置遵守设备锁协议；同事务重读当前状态，密钥重置与吊销原子；请求检查设备绑定与会话是否一致。
- [x] 待办加用户认证，以用户范围和设备仓交集统计；设备票据不替代用户权限。
- [x] PDA 设备分页用 normalizePagination。
- [x] 跑设备专项及主线，验证无超时/死锁，文档与复核。

## Task 4 — 销售跨期凭证 F04

Files: `backend/src/modules/accounting/voucher-engine.js`、新增窄职责销售凭证来源模块、必要的新迁移（最大编号+1）、`tests/accounting-sale-period.smoke.test.js`、`docs/finance-permission-time.md`。

- [x] 沿 warehouse-tasks 出库、任务明细、应收及凭证生成完整调用链确认业务日期和来源；既有凭证不可直接迁移为重复来源。
- [x] 写两期发货、旧期关账、重复生成、税额折扣、退货、旧来源兼容的失败测试。
- [x] 按实际发货期间分配销售收入和成本，保留总额与借贷平衡；历史累计来源与新增分期来源有明确切换/抵扣，缺事实拒绝而非猜日期。
- [x] 不修改关闭期间，不静默丢失差额；兼容既有采购修订和其他凭证类型。
- [x] 跑 accounting / finance / reports-values / accounting-period 与新专项，同步来源语义并复核。

## Task 5 — Nginx 与测试依赖 F11/R03

Files: `docker/nginx.conf`、必要的共享头片段与 Dockerfile、`frontend/package.json` / lock、`tests/deployment-resources.test.js`、运维主题文档。

- [x] 用配置/响应断言证明子 location 安全头缺失，再统一静态响应头与缓存策略。
- [x] 升级 Vitest 到官方修复版本，核实 Vite/Node peer 要求；不做无关 major 升级。
- [x] 运行前端全量单测、lint、类型、ERP/PDA 构建和完整依赖审计；记录 moderate/high/critical 结果。

## Task 6 — 整体验证与交付

- [x] 新测试接入根 package.json 与 CI；源码守卫须证明破坏会失败。
- [x] 独立合成 MySQL 测试库执行全部迁移和 strict schema 检查；运行根 test:* / smoke:* 可本地隔离的全量套件与 CI 单独命令。
- [x] 对浏览器/设备无法等价验证的事项给出明确边界；关闭自建进程/会话，不停止用户 MySQL。
- [x] 逐项对照 F01–F12/R01–R03，保留红→绿证据；更新审计整改结果，检查 diff 与全部改动范围。
- [x] 最终需求审查通过后做代码质量审查，修复发现再复验；向用户报告结果和本地位置。

执行结果、最终证据和未执行的环境相关检查见 `docs/audit-remediation-2026-09-22.md`。计划勾选表示本地整改任务已执行，不代表生产发布或真机验收。
