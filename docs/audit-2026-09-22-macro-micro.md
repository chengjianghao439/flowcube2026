# 2026-09-22 全仓审计：宏观架构与微观实现

> 本文保留整改前审计快照；后续修复与验证见 [整改结果](audit-remediation-2026-09-22.md)。

审计基线：`main`，`f8ca1e572356e47fd40d2e6aa8cf6b90c8d1d741`。本次只新增审计报告、复现脚本与日志，没有修复业务代码，没有提交、推送或操作生产。历史记录仅用于选择检查方向，以下结论重新核对当前源码或本地执行结果。

## 结论

现有库存事务、幂等、状态机、迁移及回归体系有较扎实的基础，但权限约束在不同入口间并不闭合。最需要优先处理的是：授信申请权限可走无流程审批兜底、打印读写仓库范围不一致、PDA 建会话与换仓吊销之间的竞态、销售累计凭证的跨期归属，以及用户管理中的自身角色提权。

本次记录 **12 项需修复问题：5 项 P1、7 项 P2**，另列 **3 项策略/加固事项**。P1 表示应优先排入修复的权限或账务风险；P2 表示功能正确性、故障一致性或性能防护问题。没有确认 P0，并不等于已经排除所有未覆盖路径。

仓库级扫描清单含 **1,449 个文件、178,545 行、62 个后端模块**。这是所选源码、迁移、测试和运维文件的清单与规则扫描范围，**不是全部文件逐行人工审阅的证明**。人工深查集中在权限/仓库范围、设备会话、打印、审批、凭证、列表汇总、路由保活及部署入口。其余业务域以规则扫描和现有回归覆盖为主；具体边界见末尾覆盖矩阵。

## 宏观评估

| 维度 | 当前基础 | 本次识别的主要风险 | 改进方向 |
|---|---|---|---|
| 架构 | 单租户模块化单体；React 共用于浏览器、Electron 和 Capacitor PDA；后端 routes → controller → service → engine，手写 SQL | 同一约束需要多个入口手工传参，容易出现列表受限、动作不受限；大型 service 仍集中许多职责 | 优先建立明确的领域授权入口与事务契约，不必为了拆分而引入微服务 |
| 数据一致性 | ACTIVE 容器为库存事实源；库存缓存写入口、锁顺序、CAS、操作回执有守卫及数据库回归 | 单条业务命令的事务正确，不代表与其他命令并发时仍正确；设备建会话没有参与换仓锁协议 | 按资源统一锁顺序；为创建、吊销、换仓、重置建立成对并发测试 |
| 权限 | 用户认证、功能权限、仓库范围、设备身份、工作站标识分别存在 | 它们未在所有动作中组合执行；`null` 在不同域分别代表不限制、无仓、缺失 | 按领域明确空值语义；读取、补打、领取、确认、重试等动作共用资源授权，不能只检查路由挂了权限中间件 |
| 财务 | 科目映射、金额处理、结账、凭证重算及采购修订有验证 | 销售收入与成本仍将累计发货量绑定首次应收日期；当前金额正确不代表期间正确 | 明确发货批次/业务事件与凭证来源的映射，再设计已关账期间的差额修订；不要直接改历史已执行迁移 |
| 前端 | TypeScript、React Query、统一表格、状态常量、保活工作区 | 保活页面与浏览器可见性混淆；分页累计结果缺少跨页身份检查；原生 history 与 HashRouter 混用 | 统一工作区激活条件、路由历史封装、列表一致性策略，并补行为测试 |
| 交付运维 | CI 包含静态、数据库、部署预算、备份恢复和制品规则；ERP/PDA 可构建 | 部分安全头被 location 配置覆盖；滚动基础镜像和外部服务仍需运行态验收 | 为最终 HTTP 响应补断言；结合实际镜像固定策略与可追溯构建，保留同 SHA 的部署验收 |
| 质量体系 | 现有自动化范围广，主线与并发套件通过 | 源码存在性契约容易漏掉授权对象、数据来源与跨命令竞态；文档红线不一定被行为测试证实 | 每项高优先级修复必须有可失败的负向用例；将本次复现转成正式回归时反转预期，并证明修复前失败 |

不建议把本轮结论简化成“整体需要重写”。已有库存和事务基础值得保留，主要工作是补齐边界与事件模型。维护性上的热点包括 `sale.service.js`（1,921 行）、`export.service.js`（1,600 行）、`containerEngine.js`（1,333 行）和打印模板编辑页（2,358 行）；行数只用于定位拆分候选，不作为缺陷或性能结论。

## 微观发现

### F01 · P1 · 无审批流时，授信申请权限可以批准他人的申请

- **位置**：`backend/src/modules/credit-overrides/credit-overrides.routes.js:24`；`credit-overrides.service.js:129`、`:139`。
- **原因**：approve 路由只要求 `sale.credit.override.apply`。有实例时由审批引擎校验审批人；没有实例时直接把状态从待审批改为已批准，仅排除申请人本人。
- **复现**：在隔离库停用该业务类型的流程，A、B 均仅有申请权限。A 创建、提交成功，`multiLevel=false`；B 调用 approve 返回 200、`status=3`。复现后还原流程配置。
- **影响/条件**：没有配置或没有匹配到流程时，两个申请用户可以互相放行，绕过实际审批人配置。已有正常匹配流程的路径不由这个复现推断失效。
- **建议**：无匹配流程时拒绝提交/审批，或要求明确的单级审批授权；同查 reject 兜底。回归应覆盖无流程、不匹配流程、申请人本人、申请权限用户、合法审批人。
- **证据等级**：HTTP + 本地 MySQL 状态实测；`reproduction-results.json` 的 `credit-approval-with-apply-only`。

### F02 · P1 · 打印详情拒绝跨仓，但补打、领取和确认未实施同等范围校验

- **位置**：`backend/src/modules/print-jobs/print-jobs.controller.js:36`、`:73`、`:120`；`print-jobs.label-command.js:561`；`print-jobs.dispatch.js:16`；`print-jobs.command.js:309`。
- **原因**：detail/list 透传 `scopeWarehouseIds`，动作入口没有；工作站校验比较调用者提供的 clientId/打印机标识，不能代替用户仓库范围。
- **复现**：只授权 A 仓的用户，对 B 仓任务 GET detail 返回 403，但物流条码补打返回 200、`queued=true`；提供匹配工作站标识后 complete-local 返回 200、状态变为 2；claim-client 返回 B 仓任务及确认令牌。使用的是合成 ZPL、测试打印机记录，没有调用实体打印设备。
- **影响/条件**：持相应打印动作权限且知道目标标识的用户，可获取/操作其读权限以外的任务，造成标签内容泄露、重复打印入队或错误完成状态。不能据此声称匿名用户可操作，也未实测物理打印。
- **建议**：把用户范围与工作站归属组合成服务层授权；补打时根据源记录派生仓库并校验；创建、重试、领取、完成及失败入口一并检查。不能只补前端禁用按钮。
- **证据等级**：HTTP + 状态实测；`cross-warehouse-reprint`、`cross-warehouse-complete-local`、`cross-warehouse-print-claim`。

### F03 · P1 · PDA 会话创建可跨过换仓事务的吊销边界

- **位置**：`backend/src/modules/pda/pda.sessions.service.js:59`、`:80`；`backend/src/modules/pda-devices/pda-devices.service.js:131`、`:153`；`backend/src/middleware/pdaSession.js:68`。
- **原因**：换仓和吊销已在同一事务，但 createSession 先无锁读取设备仓库，随后异步校验密钥并独立插入会话；会话校验又优先使用会话里的旧仓库，没有检查与设备当前仓库是否一致。
- **复现**：暂停创建会话的设备查询返回，完成 A→B 换仓及吊销后继续创建。数据库显示设备属 B、新会话仍属 A、`revoked_at=null`；该票据随后通过 PDA 中间件，todo-counts 返回 200。
- **影响/条件**：并发绑定/登录与换仓时，旧仓设备身份可能继续有效。业务用户权限仍另行生效，本结论不等于绕过全部业务授权。
- **建议**：创建会话加入同一设备锁协议，在事务中重新校验状态、仓库和密钥版本；考虑在请求校验中检查绑定版本，作为失效防线。覆盖重置、停用/再启用与建会话的交错。
- **证据等级**：真实数据库 + 受控执行顺序复现；没有改写生产服务代码。证据 `device-rebind-session-creation-race`。

### F04 · P1 · 销售跨月分批发货仍归入首次应收日期

- **位置**：`backend/src/modules/accounting/voucher-engine.js:229`、`:269`、`:543`。
- **原因**：销售收入、成本用累计 `shipped_qty` 计算，日期取 `payment_records.created_at`，来源仍为销售单 ID；生成器先按这个日期筛选期间，再处理关闭期间。
- **复现**：合成销售单首次应收日期为 8 月 31 日，已发金额为 50；9 月将累计发货改为 100，再调用当前 buildSaleRevenue，金额变为 100，日期仍是 8 月 31 日，因此不满足 9 月期间条件。
- **影响/条件**：跨期追加发货时，新发生额可能不进入实际发生期；重算旧期还受关账/凭证状态约束。成本构建器存在相同结构。不能用“总金额勾稽一致”证明期间正确。
- **建议**：先确定按发货事件/批次确认的业务模型，保留唯一来源与重算幂等；关闭期间使用可追踪的差额修订。测试必须包含跨月两次发货、旧期关闭、退货、税折分摊与重复生成。
- **证据等级**：真实 SQL 构建器输出 + 生成器筛选代码；没有把本用例描述为完整的发货→关账→总账端到端验收。证据 `cross-period-cumulative-voucher`。

### F05 · P1 · 仅有 user.update 的用户可给自己换成权限更高的内置角色

- **位置**：`backend/src/modules/users/users.service.js:9`、`:165`；对照同文件 `:227` 已禁止非超管自改仓库范围。
- **原因**：角色赋予只特别保护 roleId=1，自身改派到 2–5 没有相同限制，也没有检查是否授出了操作者不具备的权限。
- **复现**：合成用户仅有 `user.update`，访问库存返回 403；PUT 自己的 roleId=2 返回 200；随后同一用户访问 `/api/inventory/stock` 返回 200。
- **影响/条件**：可自授现有非超管角色的功能权限。需要先持 user.update，不能升级为 roleId=1，也不直接改变原仓库范围。如果产品将 user.update 定义为授予所有普通角色的完整管理权，应明确记录该信任边界；当前与自改仓库权限的限制不一致。
- **建议**：将用户资料编辑与角色赋予授权分开，至少禁止非超管自改角色；按允许授予的角色集合校验其他用户改派。须测试原 token 下的即时权限变化。
- **证据等级**：HTTP 403→200→200 实测；`user-update-self-role-escalation`。

### F06 · P2 · 限仓管理员能创建和操作不限仓 PDA 设备

- **位置**：`backend/src/modules/pda-devices/pda-devices.service.js:55`、`:88`、`:109`、`:144`；`backend/src/utils/warehouseScope.js:60`。
- **原因**：列表明确排除 `warehouse_id IS NULL`，详情/创建/更新却使用遇到 null 即放行的通用 assertInScope。
- **复现**：A 仓用户以 `warehouseId:null` 创建设备返回 201，直接详情返回 200，而列表不包含同一设备。
- **影响**：绕过“不限仓设备仅由不限仓管理员处置”的域约束，设备身份不再受预期仓库绑定限制；用户自身业务范围仍需另验。
- **建议**：定义设备专用授权，将无仓设备按全局资源处理；创建、清空仓库、详情、重置和状态修改保持一致。不要直接修改通用 null 语义而破坏允许无仓的其他业务单据。
- **证据**：HTTP 实测 `limited-user-unbound-device`。

### F07 · P2 · 重置 PDA 密钥与吊销票据不原子

- **位置**：`backend/src/modules/pda-devices/pda-devices.service.js:214`。
- **复现**：在密钥写入后注入吊销查询失败，resetSecret 抛错；旧密钥已不匹配数据库哈希，但旧会话仍返回 200。
- **影响**：故障时留下“密钥已换、有效票据未撤销”的中间状态，新密钥又没有成功返回给操作者；这是可用性与失效一致性缺口。
- **建议**：行锁、换密钥、吊销使用同一事务，并结合 F03 处理并发创建。失败时要么全部不变，要么有可恢复的明确状态。
- **证据**：数据库故障注入 `device-reset-not-atomic`；未声称健康数据库的正常路径必然失败。

### F08 · P2 · 动态角色可以创建，但用户表单和接口只能分配 2–5

- **位置**：`backend/src/modules/users/users.routes.js:24`；`frontend/src/pages/users/components/UserFormDialog.tsx:23`；对照 `backend/src/modules/roles/roles.routes.js` 的 create/duplicate。
- **复现**：有效自定义角色 ID 大于 5，更新用户时请求被 schema 拒绝（400）；前端选项也硬编码四个内置角色。校验不随操作者是否超管改变。
- **影响**：角色管理新增/复制的角色不能通过正常用户维护流程分配；已有自定义角色用户的编辑也可能受阻。
- **建议**：从可分配角色接口取选项，后端验证存在性和赋予权限；保留管理员角色保护，不能简单去掉上限后扩大 F05。
- **证据**：接口实测 + 表单源码；`custom-role-assignment-rejected`。

### F09 · P2 · 未保存内容的 popstate 拦截使用了非 HashRouter 地址

- **位置**：`frontend/src/components/layout/KeepAliveOutlet.tsx:143`。
- **复现**：执行当前源码中的实际 handlePopState，模拟 dirty 页面。HTTPS 地址由 `/#/sale/new` 变成 `/sale/new`，hash 丢失；jsdom 的 `file:///…/index.html#/sale/new` 环境抛出 `SecurityError`，showConfirm 未执行。
- **影响/条件**：用户在未保存页面执行浏览器前进/后退时，可能出现错误地址、刷新后跳错页面、离开确认未展示。桌面结果是 file URL 语义的模拟证据，尚未在真实 Electron 中操作验收；监听器与 Router 的时序也需补端到端测试。
- **建议**：通过统一 HashRouter history 封装恢复完整文档地址和 hash，并覆盖确认、取消、连续返回、查询参数与桌面 file URL。
- **证据**：`frontend-reproduction-results.json` 的 `hash-dirty-popstate`；没有将此归为截图或真浏览器验收。

### F10 · P2 · 分页汇总会把部分重叠的数据当作完整结果

- **位置**：`frontend/src/api/allRecords.ts:43`、`:61`。
- **原因**：只比较整页“长度、首行、尾行”的签名；总数没变不等于跨页没有重复或遗漏。
- **复现**：两页 ID 分别 `[1,2]`、`[2,3]`，total=4；真实 collectAllRecords 返回 `[1,2,2,3]`、`truncated=false`，未报错。
- **影响/条件**：分页期间发生排序变化或增删抵消时，列表漏行/重复仍显示为已取齐；会影响列表理解与按列表进行的后续选择。不据此声称服务端金额已被重复入账。
- **建议**：采用稳定排序与游标/快照，或传入领域唯一键后做跨页一致性检测。单纯去重后返回成功仍会隐藏缺失记录。
- **证据**：真实 TypeScript 函数转译执行；`partial-page-overlap`。

### F11 · P2 · Nginx 子 location 的缓存头覆盖了上层安全头继承

- **位置**：`docker/nginx.conf:7`、`:14`、`:22`、`:28`。
- **原因**：server 配了 nosniff、X-Frame-Options 等；`/index.html`、`/assets/`、`/` 又各自声明 add_header。仓库没有为这些层级配置合并继承。
- **影响**：按当前 Nginx 配置默认语义，这些静态响应不会继承 server 的安全头。API 的 Helmet 不能替代静态 HTML 响应头；生产上游是否额外添加，未访问核实。
- **建议**：在每个需要的 location 引用共同安全头片段，或在确认镜像版本支持后显式合并；用最终 HTTP 响应验证 200/304/404、入口、资源和下载清单。
- **证据等级**：配置与 [Nginx 官方 add_header 文档](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header) 的继承规则确认；未宣称已实测生产响应。

### F12 · P2 · 保活的隐藏仪表盘仍启用轮询

- **位置**：`frontend/src/hooks/useDashboard.ts:27`、`:28`、`:32`、`:38`、`:52`；`frontend/src/components/layout/KeepAliveOutlet.tsx:80`。
- **原因**：工作区隐藏使用 CSS display:none，浏览器文档仍可见；多个 hook 只检查 document.hidden。同文件 useRoleWorkbench 已正确使用工作区激活状态，可作为对照。
- **复现**：将 useActiveWorkspaceTab 设为 false、document.hidden 设为 false，执行当前 hooks；四类 query 仍 enabled，轮询分别为 60/30/60/60 秒，role-workbench 则正确 disabled。
- **影响**：离开仪表盘但保持页面保活时继续发起统计请求。共享 queryKey 会去重，不能把每个 widget 都算成独立请求，也没有据此推算生产 CPU 或延迟。
- **建议**：复用工作区可见性感知 hook，补切换工作区后的计时器/网络请求断言。
- **证据等级**：源码与 hook 配置执行；未进行生产负载测试。证据 `inactive-workspace-dashboard-options`。

## 另外三项策略或加固事项

| 编号 | 观察与证据 | 定性与后续 |
|---|---|---|
| R01 | `pda.routes.js:70` 的 todo-counts 只检查设备票据与 PDA header；不带用户 Authorization 也实测返回 200 和仓库待办计数 | 设备已认证，不能写成“完全匿名”。但用户停用/退出及用户仓库范围不参与该接口判断。其注释明确允许设备身份，需确认这是有意的信息公开边界；若待办应受用户权限约束，应加认证和范围交集 |
| R02 | `pda-devices.service.js:45` 直接使用 pageSize；`pageSize=1000000` 返回相同分页值，未统一 normalizePagination | 确认无界参数，未用百万行数据压测或制造内存压力。建议补分页上限及负数/非整数输入校验，优先级低于上述权限/账务问题 |
| R03 | npm audit 前端报告 2 个 moderate 依赖条目：vitest 与 @vitest/mocker，实际为同一 GHSA；安装版本 3.2.7 | [官方公告 GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) 说明是开发服务器 mock 路径问题；此次源码搜索未发现独立 mockerPlugin/interceptorPlugin 用法，未证实生产可利用。应规划测试工具升级并回归；不是 2 个独立漏洞，也不需要直接 force 升级 |

## 已执行验证与证据

本地使用 Node **22.23.2**，MySQL 8 独立合成测试库 `flowcube_audit20260922_macro_micro_test`，回环地址 `127.0.0.1:3307`、`NODE_ENV=test`。没有连接生产数据库，没有读取真实生产配置或真实客户账款。

| 验证 | 结果 | 证据文件（均在下述 output 目录） |
|---|---|---|
| 后端 lint、前端 lint、tsc app 配置、前端单测 | 4/4 命令通过；前端 lint **0 errors、30 warnings**；单测 **90 文件、452 用例通过** | `static-results.json`、`frontend-unit.log`、`frontend-lint.log` |
| 根 test:* 初次离线批次 | 52 命令中 51 通过；print-purge 因故意使用不可连接端口失败，随后移入正确测试库重跑通过 | `offline-results.json`、`db-test-print-purge.log` |
| 全新数据库迁移 | 成功执行 **255 个迁移文件**；不是生产迁移证明，也不是所有历史脏数据升级路径证明 | `migrations.log` |
| 数据库批次 | **49/49 命令通过**，包括主线、并发、财务、会计、审批、仓库范围、设备、打印、集成和 strict schema 检查 | `db-results.json` 与各 `db-*.log` |
| CI 补充检查 | **5/5 命令通过**；含 63 用例的部署/恢复/CORS/PDA header 守卫、状态规则、搜索范围、用户角色及废弃下载目录检查 | `extra-results.json`、`extra-ci-guards.log` |
| ERP / PDA Vite 构建 | 两项成功，输出写入审计目录；未改 frontend/dist | `build-results.json`、`build-erp.log`、`build-pda.log` |
| 依赖安全扫描 | backend/desktop/browser-smoke 未报告漏洞；frontend 报同一公告关联的 2 个 moderate 条目；四个目标均无 high/critical | `dependency-summary.json` 与原始 JSON |
| 针对性后端复现 | 12 个场景记录，含授权、竞态、失败注入和凭证构建器；诊断断言通过表示缺陷成功复现，并非业务健康 | `reproduce.cjs`、`reproduction-results.json`、`reproduction.log` |
| 针对性前端复现 | 分页重叠、HTTPS/file URL 拦截、隐藏工作区 query 配置 | `reproduce-frontend.cjs`、`frontend-reproduction-results.json` |

strict schema 日志有一个 `party_identity_names` “意外表”提示：核对迁移 239 后确认它是迁移创建的 VIEW，是识别范围造成的提示，未列为缺失表缺陷。测试通过不能覆盖未运行路径；命令数有不同批次与重跑，不把它们直接相加称为独立测试用例数。

证据目录：[`output/audit-2026-09-22-macro-micro/`](../output/audit-2026-09-22-macro-micro/)。该目录受 git ignore 影响，原始日志和脚本当前仅保留在本机，**不随这份报告自动进入提交**。包含 `verification-summary.json`、`file-inventory.json`、扫描日志、构建产物及复现材料。此报告中的结果来自本次执行，不复用旧审计的通过数字。

复现脚本要求本次专用测试库；不要指向生产或开发业务库。脚本调用真实 app/service，并在 finally 关闭自己的 HTTP server 和连接池。收尾时发现早期复现直接导入打印 service 会自动启动 sweeper，连接池关闭后仍留下定时器；已结束本次脚本的残留进程，并在最终脚本导入前设置 `DISABLE_PRINT_JOB_SWEEPER=1` 后重跑。最终复现不启动该定时器、实体打印客户端或浏览器会话。此处也提示打印模块可进一步显式管理启动/停止生命周期，不能把 import 当成无副作用操作。保留专用合成测试库用于复核，未清理或停止用户原有 MySQL/Colima。

## 覆盖矩阵与明确未验证项

| 领域 | 本次覆盖方式 | 边界 |
|---|---|---|
| 62 个后端模块、engine/utils、迁移、前端、桌面、测试和运维源码 | 文件清单、危险 sink/范围/异常处理搜索，相关契约测试 | 清单数量不等于逐行人工覆盖；未给未审函数贴“安全”标签 |
| 库存/采购/销售/调拨/退货/盘点/处置 | 规则与事务路径检查，主线、并发、精度、改单、ATP、仓库执行等数据库回归 | 未执行真实仓储作业；未穷举每个状态组合、死锁调度和历史数据形态 |
| 会计/财务/账款/发票/工资 | 多个财务、税、期间、开票和报表套件；收入凭证构建器深查 | 未对真实账套出审计意见；采购跨期修订不直接外推为与销售同样缺陷 |
| 认证/权限/审批/设备/打印 | 路由到服务深查、限仓负向请求、实际 SQL 状态和并发/失败注入 | 没有扩大到互联网渗透测试；不把 company-level 的业务接口一律误报为缺少 warehouse scope |
| ERP/PDA 前端 | lint、tsc、全部现有单测、两种构建；关键路由/汇总/轮询代码复现 | 未做本次全页视觉、键盘/读屏、窄屏或用户真实数据验收 |
| Electron / Android | 桌面安全边界与发布配置审查、相关现有契约；PDA Web 构建 | 未构建 Windows 安装包/Android APK，未做真机扫码、打印、更新安装或性能验证 |
| CI、部署、备份恢复 | workflow/配置检查、部署与恢复守卫、依赖审计 | 未触发远程 CI、部署、生产重启、恢复演练；实际生产镜像、响应头、资源余量和告警未核实 |

本次未运行 `test:browser-smoke`、`smoke:pages`、`smoke:reconciliation` 的活体页面验收；`smoke:purchase-repair`、`smoke:legacy-receivable-repair` 涉及专门修复夹具库，也未运行（对应静态/单元检查已运行）。因此本报告不称为“全套 CI 均通过”或“生产验收通过”。

## 建议修复顺序与验收标准

1. **权限边界**：F01、F02、F05、F06；把路由权限、资源范围和动作主体校验统一。验收先证明受限用户被拒绝，再证明合法用户原功能不回归。
2. **设备生命周期**：F03、F07；统一事务/锁/绑定版本，覆盖建会话与换仓、重置、吊销的交错，不能只在单个 update 函数加事务。
3. **财务期间模型**：F04 单独设计来源和差额修订，避免把历史凭证直接改到当前日期；验收跨月、已关账、退货和幂等。
4. **用户与前端正确性**：F08–F10；动态角色分配必须与 F05 一起收口；对 HashRouter 与 Electron 补真实端到端路径。
5. **运行效率和交付加固**：F11–F12、R01–R03；验证最终响应头、隐藏页面请求停止、分页上限，以及依赖升级后的现有套件。

以上为修复建议，没有在本次审计中实施。后续改动须按仓库规则同步对应主题文档；修改共用函数或路由契约后运行完整相关套件，并把本轮仍未验证的生产与设备事项单独验收。
