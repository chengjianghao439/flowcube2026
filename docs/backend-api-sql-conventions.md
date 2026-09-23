# 后端 / API / 数据库规范

> **来源**：本文件由 `AGENTS.md` 的 §5 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改后端 routes/controller/service、写 SQL、加迁移、动批量写入或 SQL 标识符时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---


- 严格 `routes → controller → service → db`。routes 注册路径、鉴权、权限、zod/PDA 校验；controller 取参并返回响应，不写 SQL；service 放 SQL 和业务规则，不接 HTTP 对象。
- 大模块新增逻辑放对应窄职责文件，例如 `inbound-tasks.putaway.js`、`warehouse-tasks.ship.js`，不要堆回 service 门面。
- 错误使用 `AppError` 交给统一 errorHandler；成功使用 `successResponse`。信封为 `{ success, message, data }`，失败可含 `code`；列表分页位于 `data.pagination`。
- **请求体解析错误必须映射为 4xx**：body-parser 的 `entity.parse.failed` → 400、`entity.too.large` → 413，不能在 errorHandler 里落到「未知错误」500（2026-09-17 验收修复，此前畸形 JSON 会返回 500 并把堆栈记成 `[Unhandled]`）。
- **系统设置项只允许「真正生效的键」对外**：`settings.service` 维护 `DEPRECATED_SETTING_KEYS`，其中的键不出现在 `GET /api/settings` 列表、也被批量保存静默跳过。当前包含 `sale_prefix`/`purchase_prefix`/`stockcheck_prefix`（迁移 230/231 后由 `code_prefix_*` 接管）、`code_digits`（codeGenerator 未读取，固定 6 位主数据/3 位流水）与 `code_prefix_customer`/`code_prefix_supplier`/`code_prefix_product`（`generateMasterCode` 刻意不接入前缀覆盖）。恢复这些能力必须先把 codeGenerator 真正接上配置并处理新老编号格式分叉，不能只把键放回页面。
- **SQL 标识符（表名/列名/列清单/别名）必须经 `assertSqlIdentifier` / `assertSqlColumnList` 白名单校验**（`backend/src/utils/sqlIdentifier.js`）；值走 `?` 占位，但**占位符保护不了标识符**，两者必须同时做。契约测试 `npm run test:sql-identifier` 扫描全部 SQL 模板插值，要求每个标识符型插值在**所属函数内**有校验，或命中三种可机械验证的安全形式（硬编码三元白名单、for-of 字面量数组、文件内箭头函数参数）；不接受一句话豁免。2026-09-18 全仓审视据此收口 `lockStatusRow.columns`、`generateMasterCode.table/codeField`、`price-change.applyApprovedPrice`、`search.columns`、`scan-logs` 别名、`carriers.binding` 表名、`price-lists.field` 等 7 处——其中 `columns`、`generateMasterCode` 两处是「同类守卫有、新增入口漏一个参数」的又一实例。背景、审视范围与反向验证证据见 `docs/sql-identifier-guard-2026-09-18.md`。
- **批量写入用 `VALUES ?`（mysql2 展开二维数组），禁止在循环里逐行 INSERT/UPDATE**：一次生成可能有上百行的路径（采购计划、工资单等）逐行走一次往返会明显变慢。**`VALUES ?` 传空数组会 `ER_PARSE_ERROR`，必须先判 `length`**；表名与列名固定、值走批量参数。2026-09-18 已在 `procurement.service.generatePlan`（每行 3 次往返 → 2 次，快照并入 INSERT）与 `hr.service.createPayroll`（N → 1）落地，实测 MySQL 8.0.46 可用。
- SQL 参数化；API 小写、连字符、复数名词。页面不分页，但传输与 SQL 保留有界批次；批次查询按主排序追加唯一 ID（库存按商品/仓库组合）保持稳定，防止相同时间或名称在不同批次重复/遗漏。后台批次复用 `normalizePagination`，导出遵循既有上限与截断告警，不能用无限大 pageSize 绕过分页。
- **`role_id` 列必须与 `sys_roles.id` 同量级**：`sys_users.role_id` 与 `sys_role_permissions.role_id` 原为 TINYINT UNSIGNED（上限 255）且**无外键**，角色数超过 255 后给新角色分配权限/挂用户会 `ER_WARN_DATA_OUT_OF_RANGE`；迁移 `253_widen_role_id_columns.sql` 已对齐为 BIGINT UNSIGNED（本机测试库曾因此自毒化，表现为 round2-transfer fixture 大面积失败、看起来像代码回归）。
- 新迁移按当前最大编号新增，**不得修改已执行的迁移**，不得未经明确授权删除字段、兼容代码或迁移文件。编号冲突、幂等执行、回填与消费者兼容要一起考虑。
- **迁移必须逐条执行**：`backend/src/database/migrate.js` 经 `sqlStatements.js` 切分后逐条 `query`。整文件当一条多语句发送时，非末条 `CREATE TRIGGER ... <单语句>;` 的函数体会把结尾分号一起写进 `ACTION_STATEMENT`，mysqldump 导出成 `... ); */;;`，导入必然 1064 且备份不可恢复（2026-09-14 事故，见 `docs/backup-restore-trigger-terminator-2026-09-14.md`）。新增触发器迁移后要确认函数体不残留结尾分号；`sqlStatements.js` 不支持 `DELIMITER`，需要时先扩展再写迁移。
- 后端启动不自动迁移；本地显式 migrate。生产由部署脚本执行，不能把两者混为一谈。
- 数据库列注释可能过期，状态含义以常量和执行代码为准。不能凭历史迁移文本认定生产已经存在某列。

### 2026-09-22 审计整改：角色与授权写入

- 用户角色从 `GET /users/assignable-roles` 读取，不再限于内置 2–5。服务端核对角色存在，普通操作人不得改自己的角色，也不得分配超出本人权限集合的角色；超管角色仍不经普通表单授予。
- 用户创建/修改先按用户 ID 顺序锁操作人和目标，再锁待分配角色。角色删除、权限覆盖、角色复制读取源角色也先锁角色行；删除在同事务内重查用户引用，避免“检查时无人使用，删除时刚被分配”。
- 限仓操作人创建的账号在同事务内继承其实际仓库范围；给他人改仓库范围只能授予自身范围的非空子集。空数组代表不限仓，不能作为限仓操作人的清空捷径。
- 专项入口：`npm run smoke:audit-remediation`；角色与范围的判断同时覆盖 HTTP 权限与服务层事务。

- 导入 MIME 白名单不匹配返回 400 `IMPORT_FILE_TYPE_INVALID`，不作为服务器异常上报；MIME 仅用于前置筛选，文件内容仍由既有解析和业务字段校验决定是否接收。
