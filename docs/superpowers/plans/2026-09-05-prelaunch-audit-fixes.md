# 上线前审计修复实施计划

> 执行方式：使用 test-driven-development、systematic-debugging 和 subagent-driven-development；独立实现子任务逐项委派，需求复核通过后再做质量复核。当前用户已授权全部修复，连续执行，不在常规子步骤重复请求批准。

**目标：** 修复 `prelaunch-deep-audit-2026-09-05.md` 的 F01–F17，处理 O01–O05 和死代码候选，保留业务事实与安全约束。

**架构：** 保留 routes → controller → service 和统一事务连接；抽取实际重复的资产折旧、导出读取、账套查询边界。只在隔离测试库运行写入回归；不修改生产历史账款。

**技术栈：** Node 22 / Express / MySQL 8、React / TypeScript / React Query、Electron、Docker Compose。

## A. 资金、固定资产与条码序列

涉及 `finance-accounts.service.js`、`fixed-assets.service.js`、必要的窄职责资产辅助文件、`codeGenerator.js`；新增 `tests/prelaunch-finance.smoke.test.js` 和领域修复文档。

- [x] 将审计探针改成断言回归，在新建 `flowcube_finance_fix_test` 运行旧实现，记录实际失败：
  ```js
  assert.equal(Number(balance.current_balance), Number(balance.actual))
  assert.equal(Number(last.monthly_amount), Number(last.total_debit))
  assert.deepEqual(repeated, original)
  assert.ok(disposalDepreciation.voucher_id)
  ```
- [x] 资金聚合改为当前读取，删除与记账使用同一账户锁；回归双事务交错，不用 mock 替换业务结果。
- [x] 统一封顶的实际折旧金额和台账 / 凭证写入，已有期间返回原结果，拒绝破坏历史顺序；已提足允许处置且不重复计提。DATE 响应统一业务日期。
- [x] 序列表存在时只递增，首次初始化才扫描历史最大值；并发首次初始化与唯一性回归。
- [x] 跑新增回归和原 finance / accounting / accounting-period / concurrency 回归；独立复核需求再复核实现。

## B. 仓库权限、客户身份和完整导出

涉及 `plastic-boxes`、`portal`、`payments/reconciliation-statements.service.js`、`export`、可能的新增迁移及公共导出分页辅助函数；新增 `tests/prelaunch-scope-export.smoke.test.js`。

- [x] 先写并运行受限用户、相似客户名、双账套和 503 条客户导出的失败断言：
  ```js
  assert.equal(outOfScope.status, 403)
  assert.deepEqual(statements.list.map(x => x.partyId), [customer.id])
  assert.equal(exportRows.length, 503)
  ```
- [x] 每个塑料盒入口传范围，服务校验仓库、商品启用和库位归属；删除锁定并重新检查余量。
- [x] 门户采购与常规列表共用范围；对账单使用稳定主体关联键，历史无法唯一关联时不混入其他主体。
- [x] 导出路由传经校验的账套 / 仓库范围；列表型导出通过统一有界分页读取完整数据，超过导出上限明确报错。固定资产状态 / 日期使用正确映射。
- [x] 跑新增 HTTP / SQL 回归及原 warehouse-scope / reports-values / accounting 套件。

## C. 前端账套、下载、日期和监控

涉及 `companyStore`、账套页面 / hooks、`api/client`、`exportDownload`、`GlobalErrorBoundary`、固定资产页面；新增对应 Vitest。

- [x] 失败测试验证 query key 包含账套、切换清除页面草稿、下载携带 `X-Company-Id` 并续期、错误上报使用运行时 API。
- [x] 账套切换作为页面生命周期边界，避免旧请求结果和编辑状态进入新账套；在会计页面显示当前账套。
- [x] 下载使用统一客户端二进制响应；错误上报复用已认证客户端，登录前仅保留现有 Sentry / 本地恢复，不开放匿名后台写日志。
- [x] 固定资产 DATE 文本和已提足处置入口修正；删除两个无引用文件，保留原生插件 / 运维脚本并纠正失效注释。
- [x] Vitest、lint、app 类型检查及隔离本地 Vite 登录 / 双账套 / 下载实际页面验收。

## D. HR、依赖和部署

涉及 `hr` 服务 / 路由、三端 package / lock、安全工作流、Compose、运维说明；新增 HR 和配置 / 依赖契约回归。

- [x] HR 草稿必须先有明确的工资输入，补现有 API 明细维护契约和服务端校验；测试缺输入拒绝、明确零值允许、实际工资核算 / 发放及重复提交保护。不扩张新的人事产品页面。
- [x] 查询官方 Electron 修复和支持版本，升级实际运行时及必要构建依赖；完整 audit 和门禁覆盖 devDependencies 中实际分发的 Electron。
- [x] 声明后端 Sentry 依赖并验证初始化 / 上报调用；不需要真实 DSN 或对外投递才能检查集成代码。
- [x] Compose 显式重置生产覆盖端口，传递应用实际消费的环境键；配置解析测试检查端口、旧密钥和超时键。
- [x] 测试和构建，记录 Windows / Android 真机及生产部署验证边界。

## E. 性能、总体验证和交付

- [x] 评估 PDA 路由按端分离，保留实际兼容目标；以构建产物验证 ERP 路由不再进入 PDA 包，不能仅凭总包体推断首屏性能。
- [x] 将本次修复涉及的重复逻辑抽取为窄模块；不纯为减少行数改写销售 / 打印状态机。
- [x] 新增回归绿灯后跑原 26 套领域 / 集成、前端、部署客户端、lint / 类型 / 双端 Web 构建 / audit。
- [x] 独立需求复核和代码质量复核，处理发现的问题，再核对文档及 diff。
- [x] AGENTS.md 第 6–10、14 节及审计报告标注修复位置、证据与剩余限制；保留原始审计 JSON。
- [x] 交付具体改动和验证结果；不推送、打 tag、发版或修改生产数据。

实际执行与限制见 docs/prelaunch-fixes-2026-09-05.md；实机/生产验收未被勾选项暗示为已完成。
