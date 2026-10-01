# 后端 / API / 数据库规范

> **来源**：本文件由 `AGENTS.md` 的 §5 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改后端 routes/controller/service、写 SQL、加迁移、动批量写入或 SQL 标识符时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---


- 严格 `routes → controller → service → db`。routes 注册路径、鉴权、权限、zod/PDA 校验；controller 取参并返回响应，不写 SQL；service 放 SQL 和业务规则，不接 HTTP 对象。
- 大模块新增逻辑放对应窄职责文件，例如 `inbound-tasks.putaway.js`、`warehouse-tasks.ship.js`，不要堆回 service 门面。
- 错误使用 `AppError` 交给统一 errorHandler；成功使用 `successResponse`。信封为 `{ success, message, data }`，失败可含 `code`；列表分页位于 `data.pagination`。
- **请求体解析错误必须映射为 4xx**：body-parser 的 `entity.parse.failed` → 400、`entity.too.large` → 413，不能在 errorHandler 里落到「未知错误」500（2026-09-17 验收修复，此前畸形 JSON 会返回 500 并把堆栈记成 `[Unhandled]`）。
- **客户、供应商编号由服务端决定**：`POST /api/customers`、`POST /api/suppliers` 的请求体验证排除 `code`，允许 GUI 不带编号提交；service 调用 `generateMasterCode` 后返回并持久化编号。客户端即使提交 `code` 也不能指定编号。两类编辑请求也允许省略编号；供应商编辑若传入 `code` 仍按原有长度与非空规则校验，但 service 不更新已有编号。`npm run smoke:masterdata` 使用真实 HTTP 和独立测试库覆盖该契约。
- **客户、供应商导入的结算方式单独严格解析**：CSV/XLSX 列仅接收 `现结`/`1`→CASH、`月结`/`2`→MONTHLY、空→默认 MONTHLY；其他非空值返回带行号的错误且该行不入库。CSV 这两类导入须保留原始单元格文本，避免 ExcelJS 将 `01`、`1.0`、`1e0`、`0x1`、`2.0` 转为 1/2 后绕过校验；XLSX 错误单元格也不得转成空值。先校验再取自动编号。历史数据读取继续使用 `normalizeSettlementType` 的旧值兜底，不把它当导入校验器。真实 multipart HTTP 回归为 `npm run smoke:masterdata-import`。
- **分拣格补分配为主管受控写入**：`GET /api/warehouse-tasks/sorting-bin-pending` 与 `POST /api/warehouse-tasks/:id/assign-sorting-bin` 均要求 `WAREHOUSE_TASK_ASSIGN`；POST 还要求稳定 `X-Request-Key`。GET 接受可选 `taskId` 精确过滤（与 `warehouseId` 均须唯一、安全正整数），在分页前叠加到数据/计数的同一条件，同时保留仓库范围、任务类型、阶段、已绑格与取消/改单挂起限制；空结果不区分他仓状态，不进行写操作。仅销售出库任务在 PICKING/SORTING、无已有分拣格及取消/改单挂起时可补分配。service 锁任务后按同仓空闲格行锁分配，双向绑定、任务事件和资源级幂等回执同事务提交；没有空格返回 409。重放同键返回原回执，不能重复占格或写事件。真实 HTTP/MySQL 并发专项为 `npm run smoke:sorting-bin-recovery`。
- **系统设置项只允许「真正生效的键」对外**：`settings.service` 维护 `DEPRECATED_SETTING_KEYS`，其中的键不出现在 `GET /api/settings` 列表、也被批量保存静默跳过。当前包含 `sale_prefix`/`purchase_prefix`/`stockcheck_prefix`（迁移 230/231 后由 `code_prefix_*` 接管）、`code_digits`（codeGenerator 未读取，固定 6 位主数据/3 位流水）与 `code_prefix_customer`/`code_prefix_supplier`/`code_prefix_product`（`generateMasterCode` 刻意不接入前缀覆盖）。恢复这些能力必须先把 codeGenerator 真正接上配置并处理新老编号格式分叉，不能只把键放回页面。
- **SQL 标识符（表名/列名/列清单/别名）必须经 `assertSqlIdentifier` / `assertSqlColumnList` 白名单校验**（`backend/src/utils/sqlIdentifier.js`）；值走 `?` 占位，但**占位符保护不了标识符**，两者必须同时做。契约测试 `npm run test:sql-identifier` 扫描全部 SQL 模板插值，要求每个标识符型插值在**所属函数内**有校验，或命中三种可机械验证的安全形式（硬编码三元白名单、for-of 字面量数组、文件内箭头函数参数）；不接受一句话豁免。2026-09-18 全仓审视据此收口 `lockStatusRow.columns`、`generateMasterCode.table/codeField`、`price-change.applyApprovedPrice`、`search.columns`、`scan-logs` 别名、`carriers.binding` 表名、`price-lists.field` 等 7 处——其中 `columns`、`generateMasterCode` 两处是「同类守卫有、新增入口漏一个参数」的又一实例。背景、审视范围与反向验证证据见 `docs/sql-identifier-guard-2026-09-18.md`。
- **批量写入用 `VALUES ?`（mysql2 展开二维数组），禁止在循环里逐行 INSERT/UPDATE**：一次生成可能有上百行的路径（采购计划、工资单等）逐行走一次往返会明显变慢。**`VALUES ?` 传空数组会 `ER_PARSE_ERROR`，必须先判 `length`**；表名与列名固定、值走批量参数。2026-09-18 已在 `procurement.service.generatePlan`（每行 3 次往返 → 2 次，快照并入 INSERT）与 `hr.service.createPayroll`（N → 1）落地，实测 MySQL 8.0.46 可用。
- 销售建单和草稿编辑复用 `sale.items.js`，每批最多 100 行使用 `VALUES ?`；`createSaleSchema` 限制单据最多 200 条明细，空数组不执行批量 SQL。
- SQL 参数化；API 小写、连字符、复数名词。页面不分页，但传输与 SQL 保留有界批次；批次查询按主排序追加唯一 ID（库存按商品/仓库组合）保持稳定，防止相同时间或名称在不同批次重复/遗漏。后台批次复用 `normalizePagination`，导出遵循既有上限与截断告警，不能用无限大 pageSize 绕过分页。
- **`role_id` 列必须与 `sys_roles.id` 同量级**：`sys_users.role_id` 与 `sys_role_permissions.role_id` 原为 TINYINT UNSIGNED（上限 255）且**无外键**，角色数超过 255 后给新角色分配权限/挂用户会 `ER_WARN_DATA_OUT_OF_RANGE`；迁移 `253_widen_role_id_columns.sql` 已对齐为 BIGINT UNSIGNED（本机测试库曾因此自毒化，表现为 round2-transfer fixture 大面积失败、看起来像代码回归）。
- `GET /api/users?hideDevelopment=1` 与 `GET /api/users/options?hideDevelopment=1` 供所有前端过滤开发账号，列表按账号编码在 SQL 分页与总数统计前过滤；`GET /api/export/users?hideDevelopment=1` 与页面列表保持一致。缺省后端请求仍返回全部用户供测试使用。部门列表对开发账号负责人隐藏姓名但保留原 ID，避免改写审批关联。`GET /api/users/assignable-roles` 返回 `id/code/name`，`code` 供前端隐藏开发角色，实际角色授予仍由服务端权限子集校验。
- 操作日志页面和导出都传 `hideDevelopment=1`，服务端在列表与总数统计前按操作人账号编码排除开发账号；匿名访问仍保留。缺省后端接口保持完整审计数据供排障使用。
- 操作日志页面和导出还传 `hidePrintPolling=1`，在列表与总数统计中排除历史成功打印机心跳和任务领取请求。失败请求继续显示，原始日志不删除；后端缺省查询仍可用于排障。`opLogger` 对新请求跳过成功心跳与空领取，实际领取、完成和失败回执仍按原规则记录。
- 新迁移按当前最大编号新增，**不得修改已执行的迁移**，不得未经明确授权删除字段、兼容代码或迁移文件。编号冲突、幂等执行、回填与消费者兼容要一起考虑。
- 新迁移若建临时表并按字符列连接或比较既有表，须显式对齐双方的 charset/collation；不能依赖本地测试库默认值。v0.11.0 角色预置迁移在 MySQL 8 默认 `utf8mb4_0900_ai_ci` 测试库与既有 `sys_roles.code` 的 `utf8mb4_unicode_ci` 比较时失败，修复见 `257_seed_job_role_presets.sql`。发布前在独立测试库用 CI 默认排序规则完整迁移，避免生产部署阶段才发现差异。
- **迁移必须逐条执行**：`backend/src/database/migrate.js` 经 `sqlStatements.js` 切分后逐条 `query`。整文件当一条多语句发送时，非末条 `CREATE TRIGGER ... <单语句>;` 的函数体会把结尾分号一起写进 `ACTION_STATEMENT`，mysqldump 导出成 `... ); */;;`，导入必然 1064 且备份不可恢复（2026-09-14 事故，见 `docs/backup-restore-trigger-terminator-2026-09-14.md`）。新增触发器迁移后要确认函数体不残留结尾分号；`sqlStatements.js` 不支持 `DELIMITER`，需要时先扩展再写迁移。
- 后端启动不自动迁移；本地显式 migrate。生产由部署脚本执行，不能把两者混为一谈。
- 数据库列注释可能过期，状态含义以常量和执行代码为准。不能凭历史迁移文本认定生产已经存在某列。

### 2026-09-22 审计整改：角色与授权写入

- 用户角色从 `GET /users/assignable-roles` 读取，不再限于内置 2–5。服务端核对角色存在，普通操作人不得改自己的角色，也不得分配超出本人权限集合的角色；超管角色仍不经普通表单授予。
- 用户创建/编辑的账号与姓名在请求校验时去首尾空格，再检查长度；密码保留原始输入，不做隐式去空格。前端校验只改善提示，直接调用 API 也必须拒绝空白姓名和空白账号。
- 用户创建/修改先按用户 ID 顺序锁操作人和目标，再锁待分配角色。角色删除、权限覆盖、角色复制读取源角色也先锁角色行；删除在同事务内重查用户引用，避免“检查时无人使用，删除时刚被分配”。
- 限仓操作人创建的账号在同事务内继承其实际仓库范围；给他人改仓库范围只能授予自身范围的非空子集。空数组代表不限仓，不能作为限仓操作人的清空捷径。
- 专项入口：`npm run smoke:audit-remediation`；角色与范围的判断同时覆盖 HTTP 权限与服务层事务。

- 导入 MIME 白名单不匹配返回 400 `IMPORT_FILE_TYPE_INVALID`，不作为服务器异常上报；MIME 仅用于前置筛选，文件内容仍由既有解析和业务字段校验决定是否接收。
- **具名子路由必须注册在同 method 的 `/:id` 之前**：Express 按**注册顺序**匹配，形如 `PUT /xxx/yyy` 的具名路由若排在 `PUT /:id` 之后，会被当作 `:id='yyy'` 命中通用处理器——**静默返回 200 而业务完全不生效**，调用方看不出失败。2026-09-29 实例：`PUT /api/price-lists/bind-customer` 曾排在 `PUT /:id` 之后 ⇒ 返回 200「更新成功」、客户 `price_level` 未变（修复是把该路由移到 `/:id` 之前并加顺序注释）。回归 `npm run smoke:price-list-bind-customer`（真实 HTTP + 真实副作用，非源码字符串比对；已入 Tests CI）。

### 成套配件基础接口（C2b-1，2026-10-01）

独立 `/api/kits` 模块按 routes → controller → service 分层，当前只提供主档维护与只读预览，**尚未接入销售订单保存、占库、履约、退货或会计**。列表、详情、`finder` 使用 `product.view`；创建、编辑、软删分别复用 `product.create/update/delete`。`POST /api/kits/preview` 同时要求 `sale.order.create` 与 `product.view`，在数据库 READ ONLY 事务中运行。具名 finder/preview 路由在 `/:id` 前注册。列表与 finder 入口页码须为 1–100000 的有限整数、pageSize 为 1–100，offset 最大 9999900；超界返回400，不能把 Infinity 交给 MySQL。

迁移 `269_kit_definitions.sql` 增加主档、不可变组成版本、版本组件三张表；索引/外键在 CREATE IF NOT EXISTS 后单独幂等补齐，并按 information_schema 的名字与列序核对，已存在但形状不一致即失败。主档当前版本用 `(id,current_version_id) → (kit_id,id)` 复合外键防串套。主档 code 可维护，未软删编码唯一；停用不释放编码，软删后可以同码新建。

写入必须有稳定 `X-Request-Key`。创建使用载荷指纹 action，编辑/删除使用资源 ID action；锁主档 → begin/replay → 核 revision → 业务/同 conn 回执 → commit。重放先于旧 revision 拒绝，以便本次成功后原键仍可取回原结果。新键携带过期 revision 返回 `409 KIT_REVISION_CONFLICT`，不写版本或主档；改组成/每套参考价创建新版本，改名/编码/启停仅递增主档 revision，历史版本可通过 `GET /api/kits/:id?versionId=...` 读取，停用/软删仍可解释历史。

组件只引用真实 `product_items`，不支持嵌套、替代或制造；每套 1–50 个不重复商品。原始基本量先校验两位数量尺度、再校验当前整数商品策略。组件 A 价快照与每套价为四位，显式权重输入最多四位；派生权重 = 明确提交组成时 A 价 × 每套基本量，采用整数微单位计算，`DECIMAL(20,6)` 及六位字符串往返保存，以保留 `0.0001×0.01=0.000001`。全套默认 A 价权重或全套显式非负权重二选一，混用、全零权重拒绝，不自动均分。版本详情返回 `weightSource/createdAt` 与参考依据解释；未提交组成而仅修改套报价时沿用原版本参考依据，只有明确重新提交组成才采当前A价生成默认权重。原始采样时刻未单独保存，`referenceSnapshotAt=null`；`createdAt`只表示该版本创建时间。以后商品 A 价变化不改旧版本的依据。

预览请求有客户、仓库与至多 200 个独立商业组：套组 `kind=kit,kitVersionId,quantity,priceSource=kit_default|manual`；普通组 `kind=ordinary,productId,quantity,priceSource=default|manual`；手工价必须传 `unitPrice`。套数为正整数；套默认价只取所选当前版本，旧版本返回 `409 KIT_VERSION_CHANGED`。普通默认价按现客户价格表优先、等级价兜底，读取使用有界批量 SQL。客户/仓库/组件须当前启用且未删，finder/preview 必须核仓库范围。

`commercialGroups` 保留每个商业组及组件金额，新预览父行金额按原四位单价×原两位数量的整数单位运算 half-up 到分（如 `1.005×1=1.01`），普通销售既有 `round2` 未改；组件金额按整数分、固定 sort/id 顺序分配尾差（零权重不分尾差），组件总额等于父行。`physicalItems` 仅按真实商品+仓库聚合，至多 200 行，普通商业归属仍独立，不造虚拟商品、容器或库存；新预览商业行/物理行/总额均不超过现订单金额 DECIMAL(14,4) 可保存的两位金额 `9999999999.99`，超限400 `KIT_AMOUNT_OVERFLOW`，避免Number回构丢分；物理单价八位仅作展示，不代替保存的商业金额。库存复用 `containerEngine.getStockProjections`，依据明确为“当前现货可用”（ACTIVE 容器余量减现有预占），并按本次整个需求向量计算缺量；finder 的独立可成套数不能相加承诺。未计预计到货、整容器独占或交期，返回 `expected/readyDate=null` 与解释。
