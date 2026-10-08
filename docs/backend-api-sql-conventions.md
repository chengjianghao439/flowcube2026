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
- `scopeFilter()` 返回的 SQL 自带前导 `AND`，应直接追加到已有 `WHERE`；不能作为裸条件加入 `conds.join(' AND ')`，否则限仓和空范围都可能出现 `AND AND`。退款列表的不限仓、限仓、空范围及筛选读取回归纳入 `smoke:refund-orders`，列表/计数使用同一授权条件，未放宽仓库范围。
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

独立 `/api/kits` 模块按 routes → controller → service 分层，C2b当时只提供主档维护与只读预览；后续正式销售保存、履约、退货与会计接点见本文件下方C2段。列表、详情、`finder` 使用 `product.view`；创建、编辑、软删分别复用 `product.create/update/delete`。`POST /api/kits/preview` 同时要求 `sale.order.create` 与 `product.view`，在数据库 READ ONLY 事务中运行。具名 finder/preview 路由在 `/:id` 前注册。列表与 finder 入口页码须为 1–100000 的有限整数、pageSize 为 1–100，offset 最大 9999900；超界返回400，不能把 Infinity 交给 MySQL。

迁移 `269_kit_definitions.sql` 增加主档、不可变组成版本、版本组件三张表；索引/外键在 CREATE IF NOT EXISTS 后单独幂等补齐，并按 information_schema 的名字与列序核对，已存在但形状不一致即失败。主档当前版本用 `(id,current_version_id) → (kit_id,id)` 复合外键防串套。未软删编码唯一；停用不释放编码。2026-10-07 资料对齐后，新建编码由服务端统一取 K + 六位累计流水，编辑不修改编码；旧编码保持，软删除记录仍计入累计取号。

写入必须有稳定 `X-Request-Key`。创建使用载荷指纹 action，编辑/删除使用资源 ID action；锁主档 → begin/replay → 核 revision → 业务/同 conn 回执 → commit。重放先于旧 revision 拒绝，以便本次成功后原键仍可取回原结果。新键携带过期 revision 返回 `409 KIT_REVISION_CONFLICT`，不写版本或主档；改组成/任一档售价创建新版本，改名/元资料/启停仅递增主档 revision，历史版本可通过 `GET /api/kits/:id?versionId=...` 读取，停用/软删仍可解释历史。

组件只引用真实 `product_items`，不支持嵌套、替代或制造；每套 1–50 个不重复商品。原始基本量先校验两位数量尺度、再校验当前整数商品策略。组件 A 价快照与每套价为四位，显式权重输入最多四位；派生权重 = 明确提交组成时 A 价 × 每套基本量，采用整数微单位计算，`DECIMAL(20,6)` 及六位字符串往返保存，以保留 `0.0001×0.01=0.000001`。全套默认 A 价权重或全套显式非负权重二选一，混用、全零权重拒绝，不自动均分。版本详情返回 `weightSource/createdAt` 与参考依据解释；未提交组成而仅修改套报价时沿用原版本参考依据，只有明确重新提交组成才采当前A价生成默认权重。原始采样时刻未单独保存，`referenceSnapshotAt=null`；`createdAt`只表示该版本创建时间。以后商品 A 价变化不改旧版本的依据。

预览请求有客户、仓库与至多 200 个独立商业组：套组 `kind=kit,kitVersionId,quantity,priceSource=kit_default|manual`；普通组 `kind=ordinary,productId,quantity,priceSource=default|manual`；手工价必须传 `unitPrice`。套数为正整数；套默认价只取所选当前版本，旧版本返回 `409 KIT_VERSION_CHANGED`。普通默认价按现客户价格表优先、等级价兜底，读取使用有界批量 SQL。客户/仓库/组件须当前启用且未删，finder/preview 必须核仓库范围。

`commercialGroups` 保留每个商业组及组件金额，套件父行金额按原四位单价×原两位数量的整数单位运算 half-up 到分（如 kit `1.005×1=1.01`）；ordinary商业组冻结原entry fold `round2`预算（原 `1.005×1=1.00`），普通销售既有规则未改；组件金额按整数分、固定 sort/id 顺序分配尾差（零权重不分尾差），组件总额等于父行。`physicalItems` 仅按真实商品+仓库聚合，至多 200 行，普通商业归属仍独立，不造虚拟商品、容器或库存；新预览商业行/物理行/总额均不超过现订单金额 DECIMAL(14,4) 可保存的两位金额 `9999999999.99`，超限400 `KIT_AMOUNT_OVERFLOW`，避免Number回构丢分；物理单价八位仅作展示，不代替保存的商业金额。库存复用 `containerEngine.getStockProjections`，依据明确为“当前现货可用”（ACTIVE 容器余量减现有预占），并按本次整个需求向量计算缺量；finder 的独立可成套数不能相加承诺。这两种只读stock preview未计预计到货、整容器独占或交期，返回 `expected/readyDate=null` 与解释；不能把它当ATP交期。实际销售履约 `fulfillment.delivery.saleDelivery` 才从既有实际/预计供应分配消费共享组件一次，并给成交组齐套ETA（未知仍null）。

### C2 正式销售 DTO 与证据迁移（2026-10-01）

- `POST /sale`、`PUT /sale/:id`、`PUT /sale/:id/adjust` 接 `commercialModel:'kit-v1'` + `commercialGroups`；更新/改单另需 expectedRevision。kit 组为 kind/lineKey/kitVersionId/warehouseId/quantity/unitPrice/priceSource；ordinary 组为 kind/lineKey/productId/warehouseId/entryUnit/quantity/unitPrice/priceSource。服务端派生 items，拒商业组与客户端 items 混输。raw marker 先判再进入 schema，未知 model 不会被 zod strip 后误落普通路径。ordinary 原 DTO 保持。
- reserve/release 沿原 items（stable物料行ID），另带 marker/revision，单独改物料仓库拒绝。`POST /sale/:id/ship` 套单只接 marker/revision + groups[{groupId,qty}]，不猜物料 payload 属哪套。cancel/delete 接 marker/revision；旧客户端对已有套单缺标记/版本明确拒绝。新 kit 写动作及来源退货创建要求非空稳定请求键≤128。资源 action 用 `sale.update.<id>` / adjust/reserve/release/ship/cancel/delete；create 与 update 指纹仍包括原成交组、单位、价格和全部持久化表头。普通原 colon action 兼容。
- 资源范围与 model 在重放前校验，状态与 expectedRevision 在重放后校验；成功旧键仍回原结果，新键旧版本409。请求状态查询也重新检查当前资源仓库范围，包括已软删历史资源。回执完成与业务事实同 conn，失败全事务回滚。
- `POST /sale/:id/commercial-preview` 是只读编辑预览，sale.order.update + product.view + 资源范围/版本；不要求创建权限。原 `/kits/preview` 创建权限契约保持，允许0参考/手动报价只读预览。read DTO 明确 items/physicalItems 为唯一物料视图，commercialGroups 提供当前目标额、original、版本/报价 metadata、ordinary entry审计快照。
- `/returns/sale` 新套来源请求带 marker/revision 与每项 sourceItemId/commercialComponentId/dispatchComponentId，原商品展示字段仅兼容 DTO，金额由来源权威预算计算。来源 DTO 提供 sourceBudgetAmount/sourceQuantity/refundBudget、financialBasis/sourceFinancialEstimate、actualRefundGross/actualRefundAmount；不能以八位 unitPrice 倒算退款。confirm/cancel 是已冻结退货资源的状态动作，不重新选择来源，不要求当前 SO revision；原 scope/status/资金闸门保持。
- 270–275 依次新增成交快照、真实派发/金额证据、退款执行证据及净金额依据。271冗余 refund→SO FK 被272按精确名字/列序订正，保留来源/SRI/RTI约束与 order_id 索引；该 FK 已真实造成退款 stock→SO 与出库 SO→stock 死锁。274核 surviving FK 名字、列序、引用 schema=DATABASE() 及金额列 shape；错误 fail-loud。
- 273旧成功退款 NULL financial仅沿原实际 gross 减账事实；它对正式接口关闭前本轮旧夹具曾按当前头回填 basis，不能称原历史依据。275要求 basis_origin：新同事务实发为 real_confirmation；旧记录须人工核对真实初次执行证据后才能 legacy_verified。未知 confirmed origin 在迁移/读取显式拒绝，不降级到今日头。本机精确ID恢复脚本/manifest在 `/tmp/flowcube-kit-basis-owned-review.js` 与 `/tmp/kits-basis-owned-reviewed-manifest.json`，随机夹具ID不固化迁移。

C2规格复审范围补充：kit update在回执begin/replay之前核当前已保存全部物料仓库，包含quantity0历史行；只核head和新成交组不充分。kit create发现成功回执后，以存储的resource_type/resource_id当前锁读SO与其全部已保存物料范围，校验通过才返回原结果，软删历史仍可依法重放。scope/model与revision原前后顺序保持；ordinary创建回执政策不变。

C2仓库执行归还接点：`POST /scan-logs/cancel-return` 的kit分支用SO X协调预占，仓库授权沿当前WT的`assertTaskScope`，不据SO头仓授权。controller显式透传`req.pda.warehouseId`；body中的同名字段不是设备事实。服务层可选`pdaWarehouseId=null`兼容内部调用，kit HTTP经设备会话中间件始终有真实值。SO→WT当前锁读后范围/设备先于begin/replay核验，业务WT再核验；普通与box分支契约不扩大。


### C2 只读 DTO 接点（2026-10-02）

`sale.commercial-dispatch-read.load` 在原整单范围核对后以单批 LEFT JOIN 读 dg→WT→commercial group，验证同订单/仓库/销售任务和确认状态；当前组 `dispatch` 四个数量及完整事实字段见 `docs/business-semantics.md`。LEFT JOIN 不吞缺关联，历史事实不以 active 或软删过滤。`warehouse-tasks.kit-return-read.load` 在原 WT 范围核对后批量读 items+active PICK，返回每容器实际份额，与写 helper 的来源/余量/已拣上界一致；只读不请求业务行锁。普通 sale/return-detail DTO 原字段保持。

系统回执通过仅内部 `receiptContext.matchedAction` 传实际数据库 action 给窄 guard；同时核请求 base/exact 与匹配 action，不能按请求宽 prefix 放行。只有 kit sale_out 的原 scan-log.cancel-return 读回执可按 WT 范围，其他动作范围不变；公开回执 DTO、匹配与写重放均保持。没有新迁移，已执行269–275未修改。


销售退货列表的窄只读标记（2026-10-03 C2）：findAllSR在原分页SELECT中使用EXISTS(sale_return_items.return_id=sale_returns.id且dispatch_component_id IS NOT NULL)，仅命中行追加commercialModel=kit-v1给列表精度展示。以已存退货明细的来源关联为依据，不按商品名称/价格猜套、不额外读取整销售单；原过滤、仓库范围、分页和count仍保持，两次查询且没有逐行补查。普通行不追加标记，详情仍沿既有明细来源判断。totalAmount原值不变，无写入、状态/账款规则或DDL调整。对应守卫追加在现有sale-commercial-return-contracts.test.js，沿test:sale-commercial进入CI，不另加未接线命令。

## 安全扫描后的分页与对账导出（2026-10-06）

运单、运费账单/结算、费用报销与库龄服务在 SQL 前核分页参数为正安全整数，再用 `normalizePagination` 将单批行数夹到 500；不接受非整数、非有限值或不安全 offset。对账报表保持单批 200，并采用相同的整数/offset 校验。校验放在 service 边界，不能只相信 controller 的数值转换。

对账导出使用既有 `collectExportRows` 收齐多个有界报表批次，保留全部筛选与仓库授权范围；总量超 `EXPORT_MAX_ROWS` 或分页期间数据数量/身份发生变化时拒绝。不能向公共查询传很大 pageSize 并把被夹到 200 的结果当完整导出。回归与 CI 接线指针见 `docs/security-scope-remediation-2026-10-06.md`。


### 审批待办的只读授权概要（2026-10-04）

`GET /approvals/pending` controller透传已认证用户的userId/roleId/warehouseIds。service复用静态 `BIZ_DOC_META` 的六类型原单身份、查看权限和仓库列，补原单号、原事由/备注和当前状态；SQL表名与列名须显式校验，值使用占位符。引擎分支先约束当前用户待审实例/节点快照，再按主键关联原单；同一授权集合计数及分页，稳定排序追加来源、业务和真实节点身份，不先取一页后在JS过滤，也不逐单补查。计数和有界页共两次集合查询；R3另在同一只读快照批量读取角色权限与自批标志。未在本轮连接MySQL或执行EXPLAIN，不能据离线契约声称真实数据下性能已验证。

原业务查看权限不足、仓库范围外、已软删除或不在六类型注册表内的单据，不进入待办总数和页数据。费用沿原 `FINANCE_EXPENSE_VIEW_ALL`（或超管）允许全部，否则只能本人；费用、授信、价格等公司级单据不盲加仓库过滤。审批实例amount保持历史原值：采购申请是提交时估算额，授信是提交时超额额，改价是申请的新单价，不能转换成订单总额或另造金额。只读列表不授业务审批权；现有引擎、自批校验、单级审核以及历史事实不变，不包含采购单/费用/处置新增引擎适配。回归扩充到既有 `npm run test:approval-list-batches`（已接CI），以DB边界stub检查真实service生成的授权/批次查询和返回，不代替真实MySQL验收。

### 商品搜索统一口径（2026-10-04，本地实现）

Finder、商品管理与全局搜索的商品组共用静态 `productSearch`：编码、名称、条码、供应商型号、型号、颜色六字段，关键词先trim，值走占位符。LIKE统一显式ESCAPE '!'，按!→!!、%→!%、_→!_顺序转义，使搜索词按字面匹配而不依赖反斜杠SQL_MODE；WHERE的NULL字段自然不命中，命中说明用数据库同一字面LIKE比较并排除NULL/空串，不由JS大小写猜测。编码/条码精确等级0，其余四字段精确1，六字段前缀2，包含3；Finder与管理先按该等级，再沿原名称/id或创建时间/id稳定排序，无词沿原排序且不返回说明。Finder只查启用未删、保留仓库范围/分类子孙/库存projection；管理仍受原状态/分类/供应商/价格筛选，全局商品仍包含停用但排除软删。

全局SQL继续按 `id DESC`、20+1与数字beforeId游标取批，不以精确等级破坏id边界；返回可选searchMatch/searchRank，前端取齐所有类型/页后只换商品槽位，按等级ASC和显式数字id DESC，缺等级按包含3。SELECT参数固定为6标签contains+2编码/条码exact+4其余exact+6prefix（18），WHERE为6contains，值全部参数化。其它实体的字段、限仓和全历史口径、legacy数组响应不变。离线回归扩充既有 `test:product-finder` 与 `test:search-all-dates`，检查真实service的SELECT/WHERE/参数/排序与controller响应、NULL及特殊字符、续批不漏不重；没有连接MySQL或测EXPLAIN，实际排序规则与数据量性能仍待数据库验收。

### 客户与供应商资料统一规则（2026-10-04，R1）

两主档的 routes、service 和导入共用 `utils/partyProfile.js`：名称必填 100 字符、联系人可空 50、电话可空 30、地址可空 200、备注可空 500，先 trim 再计数。长度按 Unicode 码点计算（`Array.from`），与 utf8mb4 VARCHAR 字符容量一致；组合字符逐码点计数，拒绝不完整代理项。电话仅允许 ASCII 数字、空格、`+()-`，未增加分机 `x`、`转` 规则。原编码生成、活跃唯一性、软删、权限及结算、账期、授信、采购提前期规则继续沿用。

客户导入前六列、供应商前八列顺序保留；客户模板只追加第七列可选地址，旧六列仍可导入。姓名、企业名称、电话及地址均按主档规则校验，超限/格式错误返回原表格行号和字段原因，未经验证的行不进入查重、取号或 INSERT；不再静默 slice 截短身份。模板没有新增备注列。

数据行只有全部单元格经 trim 后为空才跳过；仅联系人、电话、地址、结算、额度/账期等有值的行也须进入共享校验并报告缺少名称，数字 0 属非空值。CSV 与 XLSX 的空行不压缩原行号，非法行仍不得查重、取号或写入；后续合法行可以正常导入，重复行按原表格行号报告。

原容量迁移在合并发布中编号为 `278_party_profile_capacity.sql`：仅当 information_schema 的已知形状匹配时，把 `sale_customers.phone`、`supply_suppliers.phone` 的 VARCHAR(20) 扩为 30，以及实际表 `sale_credit_overrides.customer_name` 的 VARCHAR(80) 扩为 100。重复执行已扩列形状为 no-op，未知漂移留给 schema 对账；不缩列、不重写主档值或历史财务快照。

2026-10-07 候选部署失败后的结构只读核对发现两主档 phone 实际为 nullable VARCHAR(11)，所以 278 虽已记执行，其 20 字符条件没有改变这两列。核对最大编号 280 后新增 `281_party_phone_capacity_known_legacy.sql`，保留已执行的 278：只订正这两列的 varchar/11/nullable YES/NULL 默认值/无 EXTRA 与生成表达式的普通旧形状。动态 DDL 保留原 charset、collation 与完整 COMMENT，字符集和排序规则名字经 ASCII 标识符条件及反引号引用；默认 SQL 模式使用 QUOTE，NO_BACKSLASH_ESCAPES 下使用单引号双写，原反斜杠与 Unicode 注释保持。已 30、其他长度、NOT NULL、非 NULL 默认值、CHAR 或生成列均 no-op，不猜未知漂移。

既有 `test:party-profile` 的离线契约覆盖精确范围与删除条件/元数据/SQL 模式守卫的反证；同文件真实 MySQL 分支仅由 `smoke:go-live-owned` 的活跃独占 runner 显式启用。建本批随机 scratch schema、重建夹具与精确删除均要求 `assertOwnedRepairInstance` 的容器/卷标签、实时端口、UUID 与存活 runner 正向证明，不读配置文件或使用应用单例池。真实逐语句执行 278/281，核旧 11 下 30 字符写入失败、281 后完整保存，20 沿原 278 扩容、重复执行及未知形状不改；同时核默认模式与 NO_BACKSLASH_ESCAPES 的单引号/反斜杠/Unicode 注释，以及不同列字符集、原排序规则、默认值和本批合成行保持。该独立实例证明与最终 SHA 的 CI、生产迁移和结构核对分别记录，迁移记录存在不代替列定义验收。


### 库存预占只读接口（2026-10-04，R2）

`GET /inventory/reservations` 经 INVENTORY_VIEW 路由，controller 不强转 query，委派窄模块 `inventory.reservations.js`。productId/warehouseId 必须为单个安全正整数，拒绝重复数组、指数/小数文本、空白及越界；page 默认为1、最多100000，pageSize 默认为20、最多100。null 仓库范围表示全部，空范围及范围外在取连接前拒绝。service 在显式只读 RR 快照中按 roleId 查询 sys_role_permissions，再检查库存与原单查看权，不能相信客户端自报 permissions。

来源销售原单须有 SALE_ORDER_VIEW，并满足头仓和全部明细 COALESCE 仓库范围（包含零数量行）；采购概要另须 PURCHASE_ORDER_VIEW 及原头仓范围。相同销售授权谓词进入 count 和 page，先过滤再 LIMIT，按销售ID稳定分页。没有原单查看权的占用只返回聚合数量，不返回原单ID、单号、客户、状态或采购身份；未知 ref_type 和孤儿只保留数量，禁止凭 ref_no 造链接。绑定按当前页销售ID批量查，再对可见合法采购行批量汇总上架/全部绑定，无逐单查询。每个请求内部是一份快照，各页请求之间允许业务变化，页面据新 total 收敛越界页。

`npm run test:inventory-reservations` 以真实 service/controller/routes 和真实 projection/expected helper，在数据库边界 stub 验证同连接、只读事务、权限/count/page、隐私及数量行为，已接 Tests CI static job。本轮未连接 MySQL、未执行 EXPLAIN，SQL可执行性、真实隔离及数据量性能仍待数据库验收；没有迁移或写链调整。

### 统一待办的原单级审核来源（2026-10-04，R3）

原采购待审状态5、处置待审状态2、报销待审状态2作为 `sourceKind: document` 只读纳入；不创建引擎实例、任务或流程，处理仍进原单沿原审核与历史链。引擎六类型继续 `sourceKind: engine`、真实taskId/instanceId/flowId/currentStep及本人assigned快照。单级来源的这些字段为NULL，entryKey包含来源种类、业务类型、原ID及实际审核节点；同业务同ID存在status1引擎实例时排除单级来源，避免重复纳入。

pending路由的四种入口权限为APPROVAL_TASK_VIEW或三种原单APPROVE；service在同连接显式READ ONLY/REPEATABLE READ一致快照中读取真实sys_role_permissions与sys_users.allow_self_approve，不信客户端permissions。引擎必须仍有APPROVAL_TASK_VIEW与原单VIEW；单级必须原单VIEW+APPROVE，采购/处置沿原头仓范围，报销沿本人/view_all范围，均先于count/LIMIT。自批只认flag=1，role1不能因此自动自批；creator为NULL/0沿原guard语义，不把SQL三值逻辑变成历史单据拒绝规则。`/biz`及所有动作权限不变，不排除旧处置待审或新增任何写权。

count、page和首页summary共用一个来源集合和顺序，角色/flag/计数/页查询数固定，不N+1。上述SQL与事务结构由既有test:approval-list-batches的离线服务/路由回归检查；MySQL可执行性、一致快照和真实数据量性能仍待独立验收。

### 普通容器拆分与历史回执（2026-10-04，R7）

`POST /inventory/containers/:id/split` 保留原 SPLIT 写权，增加 `pdaSessionOptional`；controller 提取原请求键、当前用户范围和设备仓，委派 `inventory.split.js`。新 PDA 缺键拒绝，资源 action 为 `inventory.container.split.<来源ID>`；旧 PC 无键和合法全量兼容。当前范围、设备仓在重放前核验，原 ACTIVE/余量/锁检查在重放后执行。库存、原打印任务结果和完整回执在同一连接一次 commit，失败 rollback/release；只有本事务新建请求的业务 4xx 且 rollback 成功才返回 `data.containerSplitNotExecuted=true`，重复/待确认/重放冲突不冒充未执行。

本人 `/system/request-status/:key` 不增执行/查看权限门；新 split 领域核资源ID、来源/新码、原操作仓和原 `container_split` 流水，宽 action 匹配到 split 仍走相同守卫。原容器后来已调拨、耗空或软删不改原回执口径，不能用当前量/状态/仓猜成功。新 split 的 PDA 查询条件核原设备票据与设备仓；旧套单、箱贴和其它回执契约保持。设备 middleware 有 last_seen 元数据更新，整个 HTTP 查询不能称纯 SQL 只读。静态 SQL 一次核两容器身份，不新增库存账或 N+1。

### 重复销售开单身份来源（2026-10-04，R9）

`GET /sale/:id/reorder-source` 保留 SALE_ORDER_VIEW 门，controller 将 raw ID 和真实 warehouseIds 委派 `sale.reorder-source.js`。来源 ID 严格正安全整数；同连接显式只读 RR，按原单 ID 三批查询头、全部物料、全部商业组及版本/组件，先核完整头仓、所有物料/历史组仓范围再返回白名单身份。不读旧价格、资金或运输；NULL 范围全仓、空范围拒绝。普通返回 productId/历史基本单位/基本量，商业 kit 通过历史 version 准确解析父 kitId；当前未 superseded 的零目标组仍有商品身份，普通商业组必须准确一个组件，其单位优先组件历史快照，缺身份或多组件 fail-loud，不猜商品或降级模型。最大200身份沿原创建上限。当前主档、单位、客户报价及套当前版本由各原接口重新授权读取。

原 POST /sale 的空白创建和载荷指纹幂等契约保持。仅 `X-Sale-Repeat-Create: 1` 请求，在新请求进入幂等事务、业务4xx且 rollback 成功、尚未开始 commitFulfillment 时，附 `data.saleCreateNotExecuted=true`；body 不能冒充 opt-in。pending、回放领域冲突、未知提交或 rollback 失败没有该证据，客户端必须保留原请求。未增加任何查看/创建/资金权限，没有新迁移。离线服务/路由/控制器见 `test:sale-reorder-source`；实际 SQL、索引性能、MySQL RR/并发及回滚仍待隔离数据库验收。

本人 request-status 的 `sale.create` 成功结果另核精确 requested/matched 动作（base 或原16位载荷指纹）、`sale_order` 资源类型与安全ID、data.id及原资源存在。普通销售核完整头仓及所有物料 COALESCE 仓，当前范围外或缺原单拒绝；不增加当前 SALE_VIEW/CREATE 查询门。pending/not_found 不编造成功或查询原单；原套单及其他动作领域范围规则保留。

### 独立报废API与窄回执领域（2026-10-04，R10第一段）

/disposals新create/update的schema与service均只接受disposeType3，历史详情类型仍1|2|3。update/submit/approve/dispose锁原头后同连接FOR UPDATE读取全部原明细，不JOIN主档或过滤旧行；空、未知或含1/2整单拒绝。旧reject/cancel、原自批allow_self_approve与范围规则保留，R3待办继续所有原可见status2，不按方式过滤。没有新增审批实例、迁移或写权限。

POST /disposals/:id/dispose由controller提取原请求键委派service；缺键拒绝。原成功回放返回{id,disposalNo,disposedValue}，以同事务当前读核operation row的实际action/resource，不二次扣库或入台账。system本人request-status只在requested/matched涉及disposal.dispose时调用新领域guard，不改变其他kit/箱贴/split规则；成功资源缺失、跨单/动作/仓范围拒绝。首发成功rollback证据仅本域，未知重试4xx不得冒充可另发。离线真实service/controller/routes回归test:disposal-transition已接Tests CI static job，SQL可执行性/EXPLAIN/真实RR与事务仍待数据库验收。


### 采购退货原单协调门（2026-10-04，E1）

采购退货创建与采购 `closeRemaining` 仅对下一次事务设置 `READ COMMITTED`，不改 SESSION/global。创建在同一连接准确解析原 PO（ID 或显式原单号），取得 PO 排他门后重核供应商、仓库、单号与范围；折算基本量后以准确 POI 校验原价和语句级当前可退预算。不能把外层锁当作相关子查询的当前读证明。

确认、取消与实际仓库出库共用 `returns.purchase-lock.js`：事务前同连接只定位身份并早核范围；事务内 PO 共享门→PR 排他锁→当前完整 PRI→WT→原库存/账款。锁后身份漂移、跨 PO/商品或来源孤儿拒绝 409。真实无来源历史（PO=NULL 且全部 PRI.purchase_item_id=NULL）仍合法，包括仅历史文本单号；不据文本自动关联 PO/AP。出库只采信锁后 WTI/PRI，不以 controller 的 pool 预检金额、数量或身份执行。原销售/套单/返货分支和权限不变。

收货 `closeReceiving` 在 IT 后、状态变更和 tryFinish/settle 前，对准确来源 PO 升序取排他门并当前重核完整来源和范围。`closeRemaining` 的结算窄传 `sourceReadMode:'current'`：保持完整来源断言、原 upsert/确认/快照，仅在已经持有 PO X 的 RC 事务中避免反向锁 IT/PRI；其余 recompute 默认原锁读。

退货账款调整按对账单升序→准确 AP 当前锁读，锁后身份或成员集合变化拒绝、不追锁新对账单；仅这条调用 opt-in 当前成员行投影，四位金额写回，其他刷新仍原聚合。取消核全部当前关联 WT/已发异常，同连接传原范围、操作者与内部 PR 归属；实物未归还保留 PR 状态并返回 pendingCancel，controller 202 与终态 null 响应兼容。没有新增 PR 修改/删除或 confirm/cancel 资源回执。离线专项已接 CI；MySQL SQL、锁等待和实际 RC 可见性仍待隔离验收。

准确 PO ID/全部 PRI 来源仍合法的历史单允许采购单号 NULL/空（原 create 可缺省该字段）；有非空文本必须精确匹配原 PO。不从文本补来源，新 create 存真实 PO 单号。

E1质量窄修（2026-10-05）：共享退货账款 helper 的初始普通 identity 读为空时，同连接按原准确 type/order 条件 `FOR SHARE` 核当前存在性。当前发现账款即409 `RETURN_PAYMENT_CONTEXT_CHANGED`，要求整笔回滚重核；不在已锁账款后追锁对账单。当前确实无账款仍返回原 null。此边界也覆盖先读普通金额/model、建立旧RR视图的销售退货；PO门不能作为销售AR存在性证明。

### 2026-10-05 H1：不可变处理来源与永久操作基础

真实 mount 为 `/api/disposals`。新增 `POST /handling-sources` 沿 `inventory.disposal.create` 保存普通处理意图；列表/数量详情沿 `inventory.disposal.view`。请求体仅 `intentUuid/operationUuid/productId/warehouseId/unit/handlingType/quantity`，不能伪造旧处置来源。原值先核正安全整数、准确36字符UUID、两位正基本量与当前商品整数策略，当前启用商品/仓库、基本单位及仓范围先于重放；不读库存作承诺。controller保留原始单值参数，数组/空值/指数ID不能变成默认合法值。分页1–100000、每页1–100，范围在count/LIMIT之前，count/page/批量关联预算共用一个只读RR连接；空范围不取连接，空页不发空IN。

`disposal.handling.operations`按领域全局operation UUID、action、actor、原key、完整canonical载荷与SHA256持久防重。意图UUID另有唯一预算，来源/原响应/成功操作同conn一次commit，失败整笔回滚。无TTL、不以单头状态猜success；原创建响应保留revision1，后续协调revision变化不能覆写原ACK。`GET /handling-operations/:operationUuid?intentUuid=…&action=disposal.handling.source.create&requestKey=…`仅认证读取本人精确原结果，校验当前原仓范围及操作/来源/载荷/资源/响应身份，不附目标单据或价款，不授写权或原单VIEW；pending/not_found仍待核对。H1目前只识别普通来源创建action，未来操作未开放。

迁移277源码增加来源/关联/持久操作/旧单转换四表及三个目标头nullable marker；从已核最大276递增。字符容量沿实际主档（商品code50/name150、仓code30/name100、unit20、用户名50），ID沿BIGINT UNSIGNED；数量DECIMAL(12,2)，原金额列不动。canonical原文存LONGTEXT并核JSON有效；UUID/hash用ascii_bin。列形状、具名CHECK、索引名/列序/唯一性/前缀、FK名/列序/父表/RESTRICT均以information_schema核对，缺失补齐、未知形状失败。历史目标line ID及旧处置item ID不设删除重建明细FK；证据不级联删除、不回填历史。这里只写迁移源码与纯拆句/结构核对，未执行DDL或schema对账；MySQL元数据规范化、重复迁移、索引/EXPLAIN及真实事务并发另验。H2正常目标创建、H3真实事实、H4解除、H5签认、H6UI均未实现。

277修补：外键constraint symbol在MySQL内属于全数据库命名空间，三个头marker须分别用`fk_dh277_sale_link/fk_dh277_pr_link/fk_dh277_disposal_link`，各段KEY_COLUMN_USAGE/REFERENTIAL_CONSTRAINTS名称与真实ADD声明一致。同表重复幂等repair可沿同名，不同表不能复用FK symbol；同表索引名`idx_dh277_link`仍可各表独立使用。新增离线迁移源码守卫检查跨表symbol唯一及metadata owner/name归属；这只关闭已发现静态命名缺口，不代替MySQL DDL验收。

277 CHECK漂移核对再次收窄：禁止对CHECK_CLAUSE全局LOWER/删括号/去introducer后比较，删除分组会把弱式当作一致。现对12个具名CHECK逐项使用`BINARY @dh277_check = BINARY <有限打印原文>`，保留标识符、字面量、空格及全部逻辑/比较/算术括号；状态和target字符串在CREATE/ADD显式`_utf8mb4`。只接受本迁移可推导的一个MySQL8打印形式，未知fail-loud；不自动DROP或重建未知约束。

源码依据（2026-10-05静读，非DB结果）：[sql_check_constraint.cc](https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/sql_check_constraint.cc)的print_expr使用QT_FORCE_INTRODUCERS；[item_cmpfunc.cc](https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/item_cmpfunc.cc)的AND/OR、IN、IS NULL/IS NOT NULL各保留括号，[sql_yacc.yy](https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/sql_yacc.yy)只展平同类AND/OR；[item_func.cc](https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/item_func.cc)比较/算术有各自括号、函数保留参数打印；[item_json_func.h](https://raw.githubusercontent.com/mysql/mysql-server/8.0/sql/item_json_func.h)确认JSON_VALID为bool，打印不加<>0。官方[check_constraints.result](https://raw.githubusercontent.com/mysql/mysql-server/8.0/mysql-test/r/check_constraints.result)也表明CHECK_CLAUSE是AST打印，而非原DDL括号字面串。实际有限原文直接列在277及本域测试；单纯保留原DDL串同样不能证明重跑一致。

守卫提取迁移真实SET检查条件，用本域有限表达式模型执行12个canonical正例、未知形式拒绝和缺约束ADD分支；两个弱式反例分别允许TERMINATED A=R=E=0、NULL evidence+bad-json response，而正确分组拒绝。这里只证明源级打印推导/判断模型，MySQL首次执行、CHECK_CLAUSE精确打印、幂等重跑和元数据对账仍须在独立环境验证，未修改已执行迁移。

## 2026-10-05 H2：可选来源的原创建事务

普通 `sale.create`、`createPR`、报废 `disposal.create` 在各自原 conn 内接严格 `disposalSource {sourceId, expectedRevision, operationUuid}`；仅 POST 接收，销售 PUT/adjust 和报废 PUT 在 schema strip 前拒绝该字段（含 null），kit-v1 与 repeat-create/source 组合拒绝。commercial schema仍从不含来源的原普通头定义扩展。原 CREATE 中间件加载权限，有源 controller 再沿 `hasPermission` 条件核 `INVENTORY_DISPOSAL_VIEW`，只传内部授权结果；无源不新增权限查询、不运行关联接点或读新表、原 generic 载荷逐字段保持，不补 null/undefined 来源字段。

锁/顺序为 source X→领域永久完整身份当前核对→仅新操作 revision 与当前基础 Q/A/R 预算→原 hydrate/fold/准确 PO 校验及当前主档→真实基本量 A 对同一预算比较→原头/明细/事件→按新头 SELECT 真实单行 ID→link、nullable 头 marker、revision 和永久原响应→原 generic 完成→原一次 commit。动态目标表/归属列/单号列仅取闭合静态映射且按 SQL 标识符规范校验。link/marker/永久结果任一失败整笔回滚；无永久结果而 generic 已成功明确 409 待核对，不能事后补关联。永久回放在旧 revision 拒绝之前，不依赖 generic TTL；用冻结 link 身份/A、原 minimal DTO 和当前头 marker/完整仓范围核对，允许原头软删、以后合法部分关闭缩量/删行，不重建或改写原响应。

本人永久操作新增精确 `disposal.handling.sale.create`、`disposal.handling.purchase_return.create`、`disposal.handling.scrap.create` 三 action，继续本人 actor/key/intent/operation 身份及当前源/目标范围核对，仅认证，不附目标价格或授 VIEW/CREATE。原 SOURCE_CREATE ACK 形状不变。277 源码未改/未执行；本批离线 SQL 边界与回滚模型不能替代实际 MySQL 事务/锁等待验收。


## 2026-10-05 H3：关联目标行与实际出库接点

原目标头 X 后按 `disposal_handling_link_id` 主键当前 `FOR SHARE` 读准确 link，核 target 类型/头、冻结商品/仓/单位及 A/R/E 结构；marker NULL 不查询新表，缺列/畸形值拒绝。所有本批原写路径不读、不锁 source；预占客户 X 前新增读取仅为 link 当前读，不建立 RR 一致视图。原无来源业务和授权保留。

关联普通销售 update、占库期/执行期 requestAdjustment 及关联报废 update 拒绝重建；销售同仓 reserve/release/分批派发保留，但新操作的唯一行 ID/商品/基本单位/仓/量须与冻结 link 精确一致（quantity=A），reserved=0 或释放后也不能换仓。原取消/部分实发结案可沿原逻辑缩量、删行，历史 A/line 不改；取消、删除和原成功回放不靠当前 SOI 重建原身份。PR 没有 update/delete API，本批未新增。

WT ship 事务前固定任务归属并拒绝 supplied saleData 的错 SO；原 SO X→WT X 后再次核准确任务归属，不能在持 WT 后追锁另 SO。link/marker/范围在原成功 ACK 前核；仅新 linked 实发在 ACK 后同 conn 当前读唯一准确 SOI/WTI，重建量和单价。事件 totalAmount 保持 SO 全单总额，原实扣、应收/成本、回执和 commitFulfillment 接点保持一次。合法成功键在后续结案缩行/删行后仍返回原 ACK。

linked 软删仅 SO X 后作保守非锁 RR 事实门，不新增 WT S/X：取消/改单标记、未终止任务、仍锁容器或非实发任务未归还的 status2 箱均拒绝；WT7 正常已发箱不是待归还。包含软删历史任务，不把非锁读称作当前读。H3 未接全历史执行 E 汇总、解除或 ready 状态转换；这些留 H4 共用 provider，未执行 MySQL/迁移/应用验证。

H3规格窄修：linked 新派发在原成功 ACK 后先 `FOR SHARE` 读取完整当前 SOI，核 sole 历史行/商品/单位/仓/精确 A；然后沿原 `dispatched_qty < reserved_qty` SQL 选余量。先过滤会隐藏零预占或已全派发的额外行。NULL marker 保持原 SQL，原 ACK 不读当前行；合法固定单行已无可发仍原 400，不误报身份 409。

## 2026-10-05 H4：共享执行事实与一次解除

`disposal.handling.facts` 只使用 caller conn，不取 pool、不启事务、不锁 WT/WTI/容器/箱。来源列表/详情的原只读 RR 与新解除事务共用它：三个目标类型的头、当前行、永久创建操作批读，完整历史 WT（含软删）、WTI、流水、仍锁容器、packages、报废台账及准确 POI 分开批取，再按准确身份聚合；不 JOIN 扇出、不逐 link 调目标详情。静态表/列映射经 SQL 标识符校验，空集合跳过。来源 count/page/budget/facts 同连接快照，Q/A/R 原预算不改。

来源数量 DTO 增加 `originKind: ordinary|legacy` 与 link `state: ACTIVE|TERMINATED`，用于解释普通意图/旧签认来源以及 R0 终结；不暴露旧单 ID，也不作为授权依据。目标 id/no/path、客户/供应商仅在 controller 从真实 `hasPermission` 得到对应 VIEW 且头、全部当前行和全部历史 WT 仓范围都合法后附加，query/body 自报权限无效。缺证据仅返回通用 pending 原因，不由 ref_no 猜链接。

`POST /api/disposals/handling-sources/:id/links/:linkId/release` 严格接原 UUID、正安全版本和 1–500 字说明，路由 source/link ID 也纳入 canonical 载荷。自己的下一事务显式 RC：source X→准确 PR 原 PO S（适用时）→target 头 X→link X；不新增事实表锁。当前完整来源/关联/marker/目标范围身份先于永久原操作重放，原 ACK 先于新 revision/预算/TTL 事实拒绝。仅新操作核 revision、全来源预算和闭合事实，绝对写 R=A−E，link 与 source revision 各 CAS affectedRows=1，version1 完整冻结证明、固定响应和永久操作同 conn 一次 commit，失败全 rollback。

精确 action 为 `disposal.handling.link.release.<linkId>`，resource 为 `disposal_handling_link`；本人结果仅原认证、原 UUID/action/key/actor/intent 及当前完整范围，固定 DTO 只有 sourceId/linkId/E/R/revision。冻结证据重算校验真实创建身份、终结/任务/流水/实物及必要字段；成功重放不因后续 revision、缩行/删行或流水 TTL 重算、重释。SO 无 shipped_at 列；无 WT 的 SO 强证明要求真实 task_id 及 SOI shipped/dispatched/reserved 字段明确存在，WT 的 shipped_at/取消/调整标记仍须明确。未知形态 fail-loud。277 未改、未执行；H5 签认、H6 UI 和供应商退款尚未接入。

H4 规格窄修：SO4 必须有准确正量 WT7 实扣 E>0；仅 WT8 或缺全部实发历史仍待核对，不能由当前 SOI 推 E0。legacy 授权改用纯 `proof.conversionIdentity` 核完整固定转换 DTO、全旧行一对一来源、来源冻结主档/创建身份/原响应与成功永久 operation；canonical null 或只有 id/originalDisposalId 不能授权。`disposal.handling.legacy.convert.<旧单ID>` 与 `SHA256(stableJson({version:1,head,items,approval}))` 固定，items/DTO sources 按旧行 ID 升序。payload 严格含 originalDisposalId/operationUuid/snapshotFingerprint/reason；头/行采用已定原199全部字段加头277 marker、准确 DECIMAL 文本与 JSON 时间，原响应每源 revision 固定1，当前协调版本不改原 ACK。H4 只验证该冻结协议，不实现 H5 serializer、路由或创建。

release 已持本源 X 后，全转换来源与原永久 operation 仅同 conn 非锁批读不可变身份/原响应，不锁其他 source，避免 sourceA X→sourceB S 的交叉解除环。缺、重、多来源、错映射、错 actor/key/body/hash/resource 或旧快照 fingerprint 不符均在新解除占位前拒绝。

H4 质量 PR 窄修：共享 evaluate 对每个采购退货 WT 要求 `sale_order_id` 字段明确存在且严格 NULL，0/缺字段/任何销售 ID 均待核对；当前 `SELECT *` 和 version1 冻结快照都须保留这一身份。PR4 必须无已发证据且 E0 才可闭合、释放 A，夹带准确 WT7/正量实扣也不能释放 A−E。PR3 当前 A/全集 E=A/实物闭合的 R0 规则保持。仅事实条件变化，无新增 WT/物理锁、查询或277变更。

## 2026-10-05 H5：旧批准整单签认与永久回执

新增真实 `/api/disposals/:id/conversion-snapshot`（原 VIEW）和 `/:id/sign-conversion`（原 VIEW+APPROVE），原 ID/当前整仓范围由后端核对。预览用一个显式只读 RR 连接读取原头及 `inventory_disposal_items WHERE disposal_id=? ORDER BY id`，不 JOIN 商品、不筛软删或漏掉物理缺档行；返回完整 version1 快照/指纹及已有转换最小摘要。共享 serializer 包含原199头18字段（加277 marker）及全部11行字段，items 按 ID 排序；qty 两位、金额四位采用准确 DECIMAL 文本规范化（只消除多余零，不舍入异常量/估值），Date 沿真实 JSON toJSON，不用当前主档名称、单位或参考价覆盖历史。

签认 body 严格只收 operationUuid/snapshotFingerprint/reason（1–500字）；路径原 ID 进入 canonical payload。自己取得 conn，原头 X→全部旧行 X→actor S，自批仅当前 allow_self_approve=1，role1不默认豁免。当前写授权/范围先于永久 ACK，新签再核原 status3、至少1/2、完整全行基本量/类型/creator/批准/空 marker 及指纹；漂移409不自动重取。库存日志按准确 disposal ref、log source 或原单号取全部候选，台账按原ID或单号取候选，不先筛正确 move/SKU/仓隐藏脏痕迹。旧执行日期/任何候选拒绝；无日志单独不能证明未执行。

actor/准确 warehouse/product 父 S 在各自 FK INSERT 前取得，product IDs 排序；父仍存在的停用/软删允许保存历史意图，物理缺失整单拒绝。混合3也按每个原行创建独立 intent UUID，共享此次 operation UUID，一次非空 VALUES ? 批插；按准确 legacy IDs+operation 同 conn 回读真实 source IDs，不猜自增连续。原头/行/批准/updated_at不 UPDATE。conversion、全 sources 同 canonical 原 DTO，永久 completeConversion 后同 conn 校验 H4 conversionIdentity，唯一一次 commit；任一失败全 rollback。不逐行调用自提交 createSource，不写库存/资金/审批。

永久 action 为 disposal.handling.legacy.convert.<旧ID>，resource=inventory_disposal_conversion/真实转换ID，legacy_disposal_id准确且 intent/source/target 五字段 NULL。原 DTO 固定 id/originalDisposalId/disposalNo/operationUuid/snapshotFingerprint/sources，各 source revision 固定1并按旧行ID排序；永久 ACK 优先于新快照/主档/revision/已有转换门，不依赖 generic TTL。auth-only handling-operations 先识别合法转换 action，不伪造单一 intent，核本人原 UUID/action/key、完整转换/全来源身份和当前原仓范围；只返回原最小 DTO，无估值或当前预算。只读查询普通 SELECT、POST 重放当前 head/conversion读且不锁 peer sources；原 create/target/release 分支保持。原 dispose 的新执行在成功 ACK 分支后、库存维度/容器前检查已转换，原合法成功 replay 保留。277不改/未执行；SQL/隐式 FK/并发真实验证待隔离环境。

### 供应商退款 F1：非现金基础与原回执

`/api/supplier-refunds` 仅装配准确来源、列表、详情、创建、确认、取消及本人原操作查询；尚无 receive/会计出口。controller 使用认证中间件覆盖的 `userId`，不信 body 身份；写路由逐一挂本域权限并通过真实 `validateBody({parse})`。服务在同连接读取当前用户、存在的角色、权限及显式范围；无范围行表示不限仓，加载失败/畸形字段拒绝。列表 count/page 在同一只读 RR 快照中，PO/PR/RF 的完整仓范围在 count/LIMIT 前过滤。本人查询仅回原 `{id,refundNo,status}`，不要求 VIEW/写权限、不附付款价款。

非现金写的下一事务 RC 锁序为公司身份 S→用户/角色/授权 S→PO S→PR X→既有自身 RF X→收入账户 S→原 receipt 升序 X→statement 升序 X→AP X→原 entry 升序 S/当前 allocation 预算。新 RF 在完整父门和预算之后 INSERT；allocation 非空 `VALUES ?`，事件、永久操作与原 ACK 一次提交，任一步失败整体回滚。取消只改状态/本次操作者/时间及自身预算状态，允许原收入账户停用但仍存在，不重新绑定来源。

待执行源码迁移 278 是三张专用表，唯一 UUID/原单号/created-operation、refund-entry 对及预算索引；所有新 FK RESTRICT，历史原 OUT/原付款账户及冗余 AP/PR 等身份不新增后置硬 FK。pending operation 资源 FK 为 NULL；future own IN 与收到时账户 type 留空。列、索引、FK owner/列序/父表/规则和每个 CHECK 的有限 MySQL8 AST 打印形式均 fail-loud 核对，保留逻辑括号并使用 BINARY，不自动重建未知约束。CHECK 明确排除收到 type 和成功 resource 的 NULL/UNKNOWN 弱式。278 未执行，首次/幂等重跑、隐式父锁与并发须隔离 MySQL 验证。

原直付 entry 与原 receipt 使用独立自增计数，可合法共用数字 ID；准确 parent 决定 OUT 的 `(biz_type=2,biz_id,biz_no)` 三元组。只该准确三元组要求唯一，再校账户/公司/日期/本金，不能按金额等属性从重复三元组中挑一条。另一原单号同 ID 不误拒，也不代替另一 parent 的完整证明。


### 供应商退款 F2：实际收到与同连接固定结果

新增真实 `POST /api/supplier-refunds/:id/receive`，沿本域 RECEIVE、稳定请求键及严格 action body；controller 只取认证 `userId`。服务拆出共用 context 与有限 receive/postcommit 边界，原 F1 无 receive 的路径保持。普通入口先独立只读核本人精确永久原结果，未找到才用池读取 PO/PR/date 作为锁路由；该 locator 不能作为授权或来源事实。自有下一事务显式 RC：账套及真实期间门→当前 actor/权限/范围→PO S→PR X→本 RF X→收入账户 X→原 receipt 升序 X→当前 statement 升序 X→AP X→原 entry/本域预算当前读。RF 锁后重核 locator，首次普通来源证明读取在账套和 RF 当前门后。内部借用入口只接 caller conn 与服务器固定 locator，不取池、不 SET/BEGIN/COMMIT/ROLLBACK/release；已持公司/期间门的外层按内部标记复用。

当前对账候选由实际 `reconciliation_statement_items` 取得，不能只用旧 entry.statement_id；statement 门后、AP 门内当前重核完整成员集合，漂移拒绝，不晚追锁新 statement。真实 `refreshSettlement(conn,id,{currentRead:true,exactMoney:true})` 只在 F2 用 BigInt 全程汇总/四位字符串写回，保留 paid=min、balance=max、草稿及 total>0 结清规则；默认/E1 currentRead 数字 DTO 不变。

真实 IN、余额刷新、AP paid/balance/status、own allocation received、对账投影、准确供应商往来、专用事件、RF3/实际账户类型/资金绑定/凭证待生成与永久固定 ACK 同 conn 一次提交，任一失败全回滚。只有精确已存在成功永久操作可先于新闭期、启用/状态和额度门回原 ACK；内部借用回放及本人 GET 仍核当前本人、全仓范围、不可变来源和唯一准确 IN，不能按 RF3 猜成功。新操作继续完整写权限；HTTP receive 路由门不放宽。永久固定 DTO 不混入提交后凭证结果，F3 才接实际会计生成/核对/保存，借用调用方须外层 commit 后才调用收尾边界。278 未改、未执行。

### 供应商退款会计投影 F3（本地源码，未接数据库）

`voucher-supplier-refunds` 由 caller conn 批取已收到 RF、准确 IN、原付款/OUT、完整分配及永久收到操作。LEFT 驱动和独立 RF3 查询保留缺父证据；动态批量表/列名均经标识符校验，读取次数不随来源笔数增长。此域仅 company1、新 biz6；原引擎 1/2/3/5 与采购毛额白名单不变。历史证明不复用新退款的 PR草稿/AP余额准入，合法退货后投影、后续核销和其它已收到退款保持原来源。 收到永久操作先核 payload.id，再按原 actionBody 严格解析完整 operationUuid/可选 reason，额外字段拒绝；完整原原因与 hash 不被重建时丢弃。公司过滤只限新 biz6 的准确账户/退款父身份，缺父必须保留证据并拒绝。

F2 默认 postcommit 现在调用真实单笔 `settleReceivedVoucher`：新账套 X 事务内批取→先证明已有有效凭证→需要时沿原 accountMap/allocator/upsert→逐腿/hash/期间/来源证明→保存 RF 核对结果。完整已生成来源在后来闭期仍可核对；缺失或陈旧凭证走原期间门，人工红字不自动复活。错误/结果保存失败保持 pending，原收到 DTO 与资金/AP不变。`POST /supplier-refunds/:id/regenerate-voucher` 用原 ACCOUNTING_VOUCHER_MANAGE，实际事务及失败后重新保存错误的事务都核当前 actor、全查看权及准确仓范围。

结账的 biz6 来源门位于原 company X 之后、期间及其它普通快照之前，不反锁 PR/RF/仓库资源。新退款勾稽另用只读 RR 批取，单列四位回款、各来源分位投影/舍入差、净已付及逐 AP 差异；正负差相消也不能称一致。旧 gross 勾稽保持原口径。以上为源级/离线模型证据；真实 MySQL 可见性、锁等待、凭证与现场待隔离验证。


F3 修后凭证证明逐腿同时核科目 ID/编码、方向、分位金额、辅助类型及单位身份/名称：供应商 2202 的 aux_type 必须为 1，资金 1001/1002 必须为 0，缺失字段拒绝。原引擎 hash 保持不变，不能用 hash 相等替代辅助类型证据；实际 prove/default postcommit/closePeriod 共用此本域证明。


F3 凭证核对结果严格沿278现字段保存：generated 写完整证明所得准确正 voucher_id 与 NULL 错误；完整零分写 voucher_id=NULL 与「零分投影已核对/无需凭证」；pending 写 NULL 与最多500个字符的错误。RF没有 voucher_generated_at，不能伪写时间或新增迁移绕过。真实详情返回原 voucher_id/error，列表现8字段保持，未来UI据详情呈现；voucher_id本身不能替代完整来源/腿证明。

### 供应商退款补录 F4 的有限接点（2026-10-05）

仅 `supplier_refund` 新种类接原跨期申请/他人批准/执行。普通 RF `receive` 的稳定业务体仍只有 `operationUuid/reason?`；`backfillRequest/backfillReason` 在实际 controller 单独取出，申请键≤64、原因4–300字，不缩短普通 RF 的100字符键/500字动作原因。申请预核公司/当前用户/完整来源后释放连接锁，再独立插入原 `finance_period_backfills`，避免申请唯一键等待时持 company→application 反向门；执行仍 application X→company X→当前用户/角色/范围→PO S→PR X→RF X。批准期间关闭与原申请人撤写权均在任何 PO 前拒绝。

已锁申请以服务器 `DATE_FORMAT(approved_at,'%Y-%m-%d')` 取首次批准日期，不取今日、客户端或快照日期。内部 locator 与完整 RF 冻结身份在 RF X 后先核；借用原 F2 同连接执行，没有内层事务管理或池读取。申请写痕与真实 IN 同提交，随后才单笔 F3 核对与结果保存。永久申请核完整 actor/UUID/action/key/RF canonical body/hash/source快照，16位申请指纹只是附加校验；显式控制原因在 HTTP 同键复用中也必须一致。本人 `GET /supplier-refunds/backfill-applications/:uuid` 仅认证、精确原身份与当前完整仓范围，不加 VIEW/写权，不返回价款或自动 POST。

申请自己的所有关联资金必须准确只有一条（不先过滤 biz6 隐藏错误类型），再核 RF/方向/金额/账户/真实日/批准 override/backfillID 与 F3 完整源及凭证。`inspectBackfillVouchers` 新种类是同一只读 RR 的完整单源/prove，不调用生成或保存。结果沿实际260的时间/error300与278的 voucher_id/error500，无新时间列/迁移；零分有专有“已核对/无需分位凭证”结果，不能仅靠时间字段判生成。所有 SQL/等锁/真实期间行为仍待隔离 MySQL。

F4 共享来源窄修：`loadSources` 对本批 backfill IDs 一次批取全部 `finance_account_transactions`，不按 biz_type/金额预筛；每个申请必须恰一条且 ID 等于 RF 已绑定资金，再核原完整来源与批准身份。该门共用于单笔、批量生成与结账；已执行申请也沿 `originalFund` 全关联集合核对原 ACK/head 的准确资金 ID，不以按 ACK ID 单独读出的行代替唯一性。无申请的普通来源不加此查询，无新锁/事务/迁移。

F4 后提交窄修：`settleVouchersFor` 的种类读取也进入凭证失败隔离；读取失败不猜旧种类或调用全期间生成，返回原业务成功与 pending。申请错误按258/260的300个字符保存，保存异常仍返回 pending；RF278的500字符结果列不改。自动重试将种类读取及错误保存纳入逐笔隔离，一笔失败计 failed 后继续下一笔，旧 receipt_settle 仍无资金/无生成。无新 SQL 列、迁移、授权或业务事务。

### 2026-10-06：首次 MySQL8.0.46 CHECK 字符串边界修补

本轮专属临时实例首次执行 277，在 CREATE 后的精确 CHECK 对账中拒绝了自己创建的约束；当时迁移 ledger 只记录到 276，277/278 均为未提交、未发布的新源码。真实 `CHECK_CLAUSE` 的字符串边界包含反斜线及单引号两个字节（92、39），例如 `_utf8mb4\'sale_order\'`；追加 `NO_BACKSLASH_ESCAPES` 后只读元数据仍返回相同原文。278 原三张 CREATE 的诊断读取也确认同类边界，未记录为完整迁移成功。此前 2026-10-05 的源码打印推导遗漏该反斜线，不能作为真实数据库通过证据。

仅 277 的 `ck_dhl_target/ck_dhl_budget` 与 278 的 `ck_sro_resource/ck_sra_state` 的 BINARY 精确期望改为完整 `CONCAT(...,CHAR(92,39),...)` 字面构造；字符串片段不含反斜线转义，构造不依赖会话 SQL_MODE。CREATE/缺约束 ADD 的业务表达式、其他 CHECK、列形状、索引和 FK 保持原字节；不改已成功执行的 001–276。仍只接受各约束已知完整原文，不 LOWER/REPLACE、不删括号/空格/introducer，不自动重建未知约束。

本域离线测试提取迁移实际 SET，有限模型只接固定字面量或 CONCAT/CHAR(92,39)，分别核普通模式和 `NO_BACKSLASH_ESCAPES` 的同字节构造；不声称执行 MySQL SQL。正例固定真实打印字节，负例包括漏/多反斜线、去 introducer、括号/空格/大小写漂移，以及原预算分组、JSON 分组、收到 type 和成功 resource 的 NULL/UNKNOWN 弱式。首次红测 62/54/8 全为边界判断失败，修补后 62/62；精确 before/after 与日志保存在 `/tmp/go-live-runtime-migration-cu8oo1xn`。真实首次继续、幂等重跑、元数据和写入约束反例由独立数据库 runner 验收，结果另记，不据离线绿推定通过。

### F5/F6 退款来源与统一待审

getSource在原已授权RR快照内additive返回canonical PR items、paymentRecordId与currentPaidAmount4，原ACK、预算与锁规则不改。itemLabels只取同次已读PRI保存product_code/name/article_number/spec/color，canonical frozen原行仍不含展示主档猜值。findById additive confirmAllowed从当前已完整授权actor推导，写服务仍重核。

统一approval pending的RF metadata独立于BIZ_DOC_META六类与旧DOCUMENT_PENDING_META三类；真实RF created_by/remark/refund_no、creator.real_name与created_at作为VM，RF1动作confirm，所有engine ID NULL。当前RF actor和PO/PR关系/三仓范围在同RR只读COUNT/page集合前过滤，未知require/SQL在有限VM夹具throw；该夹具不是MySQL执行或锁并发证明。

E7 B 提交后详情隔离：execute 首次执行与已执行重放、regenerate 的最后 findOne 查询/JSON 格式化均在业务提交已确定成功之后单独隔离。锁行/种类查询明确 SELECT 原字段和 APPLICATION_NO_SQL alias，返回稳定 id/applicationNo/bizType/bizTypeName、原 result 与 postingPeriod；详情失败只置 application:null、applicationPending/applicationError，不改 voucherResult/voucherError。RF 重放读取已保存逐笔证明，不重生成或写 metadata；提交前失败正常回滚，commit 抛错仍拒绝，不猜提交是否成功。旧 payment/receipt/receipt_settle/refund 的授权、事务、原期与凭证策略保持。


### 成套配件对齐商品资料（2026-10-07，本地实现）

成套主档增加分类、供应商、基本单位、型号、颜色、供应商型号、进价及备注，沿商品字段名；引用非空时核启用未删主档，列表/详情一次 JOIN 回显名称，避免逐行查询。新增迁移 282 按列元数据、索引名字与列序、外键引用 schema/规则核对并幂等补齐；269–281 不修改。旧资料缺字段继续可读，旧 API 的 referenceUnitPrice 保持价格 A 兼容。

创建/修改接受旧 code 字段但不采信指定值。新建在同事务调用 generateMasterCode(K,kit_definitions)，明确编码唯一键撞号才回滚并取得新连接事务重试；不是在旧 RR 快照中重复 MAX。成功原键仍只返回原主档与版本。编码编辑只读，旧码不重排。

四档售价保存在不可变版本，A 沿 reference_unit_price，B/C/D 新列可空以保留未知历史；版本 DTO 保留 NULL，资料顶层显示 NULL→A 的有效价。新建空档按独立进价和 loadPriceRates/computeTierPrices 计算；编辑 undefined 表示原档，null 表示员工明确清空后按进价计算；明确 0 必须保留，五位小数与超界拒绝。referenceUnitPrice 与 salePriceA 同传必须一致。只改价格复制原组件依据，旧版本与订单不变。
