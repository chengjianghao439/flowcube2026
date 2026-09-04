# 系统审计修复实施计划

> 执行方式：使用 systematic-debugging、test-driven-development、dispatching-parallel-agents 和 verification-before-completion；分领域实现后逐项检查需求，再审查代码质量并运行集成回归。用户已批准修复审计报告全部问题，无需重复审批方案。

**目标：** 修复报告 F01–F17 和第 5 节三个验证缺口，保留既有业务边界，将回归验证接入 CI。

**架构：** 保留容器事实源、预占明细、现有手写 SQL 与事务接口。修复部分数量分配及预计绑定生命周期，账务通过明确归零/反冲维护审计关系；原生客户端共享 API 配置并由主进程验证更新来源。部署必须绑定同一提交的通过状态，统一失败恢复。禁止生产数据修改和部署。

**技术栈：** Node 22、MySQL 8.0、React/TypeScript、Electron、GitHub Actions、Bash。

## 1. 库存与采购（F01–F05）

修改 `return-tasks.service.js`、`expectedStock.js`、`containerEngine.js`、`reservationEngine.js`、`inventoryEngine.js` 和采购相关调用方；测试放 `tests/audit-inventory.smoke.test.js`，必要时扩展既有 ATP 冒烟。

- [x] 先构造 10 件部分质检、采购 10 件分批上架、现货与预计各占 5、采购撤回/驳回、到货后销售履约/短装结案的失败测试。
- [x] 部分质检拆分合格、拒收、未检三部分；总量不变，剩余可继续质检。
- [x] 已入库量立即从采购未到供应扣减；预计绑定只扣一次；总承诺不能超过有效供应。
- [x] 出库核销指定订单预占后保留其他合法预计预占，投影与有效明细一致。
- [x] 采购退出和减量覆盖所有路径；到货/履约按量兑现绑定，不遗留悬空依赖。
- [x] 隔离 MySQL 8 验证新增回归，再跑 `smoke:atp`、`smoke:mainline`、`smoke:concurrency-guards`、`smoke:sale-adjustment`、`test:integration`。

## 2. 会计与账号（F06–F10）

修改 `accounting.ledger.service.js`、`voucher-engine.js`、`accounting.voucher.service.js`、users controller/service 和 `price-change.service.js`；测试放 `tests/audit-finance-security.smoke.test.js`。

- [x] 建账套 1 借贷各 100 的失败用例，以及第二账套和跨期间用例；修复两处占位符顺序。
- [x] 非超管重置超管被拒，超管授权重置正常；操作人必须传入服务层，保护目标账户并防并发角色切换。
- [x] 来源由 100 归零时，旧凭证不可残留；结账期间不得静默改写。补生成幂等和来源恢复用例。
- [x] 红字及其关联凭证不能通过普通删除破坏冲销对；普通未参与冲销手工凭证仍可删除。
- [x] 无匹配改价审批流返回明确业务错误，不直接通过审批、不返回 500。
- [x] 跑新增用例及 `smoke:finance`、`smoke:accounting`、`smoke:accounting-period`、`test:accounting` 和用户角色回归。

## 3. 客户端（F11–F15）

修改 PDA 退货上架页、API client、Electron main/preload/updateCheck 与更新提示组件；沿用既有 UI。测试放前端 Vitest 文件及 `tests/audit-desktop.test.js`。

- [x] 条码查询真实容器/库位 ID，确保任务归属和状态校验，覆盖 I/CNT/R/LOC 格式。
- [x] 续期地址继承运行时 API 根地址，设置超时，保持并发请求只续期一次及失败退出语义。
- [x] 证书身份校验失败默认拒绝；若保留自签名能力，必须显式配置可信指纹并校验证书身份，不能仅按主机名放行。
- [x] 主进程保存可信更新清单；下载必须匹配版本/URL/摘要，损坏文件不能安装。
- [x] 更新订阅在应用根部可达，订阅就绪可恢复待通知结果，清理监听，保留手动检查/下载。
- [x] 用当前模块而非复制实现验证地址、错误证书、错误摘要、事件消费；运行前端 lint、tsc、Vitest 与两端构建。

## 4. 部署、测试环境与扫描（F16–F17、验证缺口）

修改 `.github/workflows/deploy-browser.yml`、`security-scan.yml`、`test.yml`、`scripts/server-update.sh`、`tests/helpers/smokeTestKit.js` 与标签镜像执行入口；新增小型测试工具模块与 `tests/audit-tooling.test.js`。

- [x] 部署只允许同 SHA 的必要检查成功，不接受旧 SHA 成功；手动入口同样验证，避免更换并发提交。
- [x] 部署从构建、迁移、健康到页面门禁失败统一恢复旧镜像；验证回退健康，不声称数据库已经回滚。
- [x] npm audit 非零漏洞结果可分析，网络/安装/JSON 错误必须失败；保留直接依赖高危门禁并报告传递风险。
- [x] 测试不加载真实 backend/.env；显式测试连接与测试库命名保护，独立测试环境配置；CI 和开发命令一起同步。
- [x] 标签镜像在 Node 22 实际执行，通过已有 TypeScript 工具编译/载入，不跳过；保留现有 5 个用例。
- [x] 补缺陷级行为验证，使用假 Docker/curl/gh 验证部署错误路径；不连接生产测试脚本。

## 5. 集成与交付

- [x] 检查四个领域对审计条目是否完整覆盖，特别是部分数量、归零、错误/无配置路径。
- [x] 独立代码审查：锁顺序、并发/重复提交、账套/期间、客户端信任边界、部署回滚。
- [x] 独立 MySQL 8 全套既有和新增回归；两端 lint、tsc、Vitest、ERP/PDA 构建；检查迁移和权限一致性。
- [x] 更新 AGENTS.md 现行语义、报告修复状态、证据与本地测试说明；保留原审计证据作为修复前快照。
- [x] 同步回当前项目前比对原文件哈希，保留用户其他变动；不提交、推送或发版。
- [x] 清理本次临时数据库/凭据和运行资源，说明真机/生产尚未验证的边界。
