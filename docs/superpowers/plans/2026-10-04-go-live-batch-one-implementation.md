# 极序 Flow 第一批开发记录

日期：2026-10-04。基线：`14e97aa9dc9df0700b394d59cafbc53dba0c5e69`（v0.12.0）。

授权范围：用户明确要求开始“审批分页与跳转、商品搜索、原单退货入口”。在隔离工作树 `/Users/chengjianghao/.codex/worktrees/go-live-batch-one/flowcube`、分支 `codex/go-live-batch-one` 实施；main 和钉钉等其他工作树保留。

主方案：`2026-10-04-flowcube-go-live-backlog.md`。本批不实施单级审核汇总适配、处置执行纠偏、资料扩列、预占明细或其他后续任务。不推送、部署或连接生产。

## 任务与交付范围

### A. 审批分页与原单定位

- [x] 待我审批使用明确分页模式，第二页及总数可达。
- [x] 审批页与首页共享六类业务标签、原单目标映射。
- [x] 列表型原单用稳定 id 精确打开已有详情；原 URL、草稿和请求所有者保护保留。
- [x] 六类概要批量读取，原业务查看权限与仓库/本人范围在统计和分页前应用。
- [x] 原审核接口、动作权限、自批限制、审批历史和引擎写逻辑保持。
- [x] 离线/组件验证、规格与质量独立审阅及整批静态检查。

### B. 商品搜索

- [x] 开单选择器、商品管理、全局商品采用编码、名称、条码、供应商型号、型号、颜色六字段。
- [x] 有关键词时精确编码/条码优先，展示命中字段；无关键词保留原入口排序。
- [x] 保留停用过滤、分类/供应商/仓库条件、查询范围、过期选择保护。
- [x] 全局保留兼容的有界 id 游标；采用取齐后排序，完整取齐后再形成用户结果，不返回残缺批次。
- [x] 离线/组件验证与规格、质量独立审阅；不新建 AI 搜索或索引工程；整批静态检查已完成。

### C. 原单退货入口

- [x] 普通销售、成套销售、采购原单详情可按原权限发起退货。
- [x] 来源携带准确 id/no，规范解析新建路径与 query，独立草稿不覆盖已有输入。
- [x] 来源参数的空值/重复值不得被规范化成有效来源或与无源草稿合并；关闭与脏状态登记使用规范化工作区 key。
- [x] 预载复用现有来源 API、原价及剩余可退规则；精确核对来源身份。
- [x] 延迟响应、切来源、清来源、换账号/服务器不覆盖当前草稿。
- [x] 保留旧系统无本系统原单入口；成套维持原成交/实际出库来源，退货与退款分开。
- [x] 离线/组件验证、规格与质量独立审阅；不改库存/账款写链。

## 验证记录

### 最终本地检查结果

使用 Node v22.23.2；frontend/backend 按锁文件安装依赖，未复制真实 `.env`。以下命令由主代理运行并确认自然退出；最后的审批重入修补后重新执行前端全量单测、lint、完整类型检查与构建，后端代码在此前检查后没有改动。专项与全量有重合，不能累加为更多独立用例。

| 检查 | 实际结果 | 证据边界 |
|---|---|---|
| `npm --prefix frontend run test:unit -- --maxWorkers=4` | **203 文件、1342/1342，exit 0，37.27s** | 离线规则、组件和客户端适配器测试；日志有 JSDOM XHR 连接失败信息，未影响断言，不证明真实 API 可用 |
| `npm --prefix backend run lint` | exit 0，无错误或警告 | 后端静态检查 |
| `npm --prefix frontend run lint` | exit 0，0 errors / 33 warnings | 警告均在本批未改文件；没有通过禁用规则掩盖新增问题 |
| `tsc -p frontend/tsconfig.app.json --noEmit` | exit 0 | 完整前端 app 类型检查，未使用空壳 tsconfig.json |
| `npm --prefix frontend run build` | exit 0，6.38s | ERP/Electron 目标前端构建；不是桌面安装包、PDA 构建或应用运行验收 |
| 后端离线专项与守卫 | 24/24，exit 0 | approval-list-batches 6、product-finder/search-all-dates 14；SQL 占位符/标识符、查询循环、路由权限四个守卫；DB 边界 stub，不连库 |
| 前端/API/文档静态守卫 | 10/10，exit 0 | frontend-conventions、frontend-polling-contract、frontend-session-contract、api-route-contract、eslint-disable-rationale、agents-md-injection-guard |
| 范围与空白检查 | `git diff --check` exit 0 | 包含新增文件内容审阅；没有暂存、提交、合并 main、推送或部署 |

独立专项：A 初次六前端文件 65/65、后端 6/6，最后审批重入修补由质量审查者复跑 34/34；B 六前端文件 25/25、后端 14/14；C 最终十一文件 137/137。三项均完成各自规格与质量审阅。C 的独立规格探针（含超容量）8/8，独立真实客户端错误反馈探针2/2；其中重复场景不累加到全量1342。

最后整批交叉代码审阅发现的唯一 Important 已修补并独立复核：关闭审批原单详情、离开再从待办进入同一 detailId 时，KeepAlive 页恢复读取资格。同页主动关闭仍保持关闭；恢复资格不清其它弹窗或草稿，原对象、来源与权限守卫保留。原真实 hook/Router/auth/QueryClient 失败探针由最终审查者独立复跑 1/1 通过，A 相邻五文件 60/60 通过；整批代码审阅已接受，没有剩余 Critical/Important。测试进入现有 CI wildcard/static 接线，本轮没有触发远程 CI。

主代理最终前端日志：`/tmp/go-live-batch-one-reopen-final-{unit,lint,types,build}.log`；后端日志：`/tmp/go-live-batch-one-backend-{lint,contracts}.log`；静态守卫日志：`/tmp/go-live-batch-one-accepted-contracts.log`。整批独立复核日志：`/tmp/flowcube-final-review-approval-reopen-independent-green.log`、`/tmp/flowcube-final-review-approval-narrow-green.log`。这些是本机临时证据路径，长期任务状态以本记录及仓库中的回归用例为准。

### 开发中发现并关闭的问题

| 问题与失败证据 | 最终处理及复核 |
|---|---|
| A 初版误将 API 默认改成单页；扩大既有 dashboard API 验证后自然 2 例失败 | 恢复默认/false自动取齐、true摘要；仅显式paged单页，六文件65/65通过 |
| A 账号变化残留费用原对象、旧商品预选与审批定位竞争 | 读取上下文隔离；审批定位优先，旧productId仅活跃/无其它弹窗时一次消费；普通关闭再打开另一费用在原基线本已正常，只作回归保留 |
| A 手动详情所在行卸载后阻挡状态不清，探针确认“弹窗为0、交接仍阻挡” | 仅已打开的非受控详情卸载通知；未打开行和受控详情不误清其它上下文；详情交接29/29独立复核 |
| A 首次整批 tsc exit2、15条 string/PermissionRequirement 不兼容诊断 | 映射/回调/hook收窄为现有PermissionCode，无any/断言；质量审查者确认两文件前后JavaScript输出完全一致，完整tsc复跑通过 |
| A 整批交叉审阅发现同 detailId 关闭后离开再进入不能重开，独立探针自然 exit1；四页重入及草稿回归自然5失败 | 仅离开交接时解除 dismissed；同页保持关闭、草稿与原对象保留，实际四页 KeepAlive 回归34/34，最终审查原探针1/1与相邻五文件60/60通过 |
| B 特殊通配符会让空字段形成虚假命中说明，边界红测确认 | WHERE保留原LIKE语义，说明用NULLIF排除空值；离线SQL/参数与前端取齐排序分层验证，不声称MySQL比较或27条端到端集成已验 |
| C 初版原入口缺失、query新建误判详情、来源草稿合并，4文件自然22失败/25通过 | 三原单入口、严格新建路径与来源key、真实KeepAlive及dirty/关闭回归进入仓库，原套件回执恢复用例保留 |
| C 来源未核对补手工行可提交，2例红；后来独立身份/晚成功探针5/5红 | 携带身份仅显式清除解除；API回包或invalidate等待中切B均不抢导航；已确认A锁原key、禁清除/重提并可显式查看；独立5例转绿 |
| C 满30标签成功时先add结果会LRU移除旧dirty B，3变体自然红 | 先移除已确认A腾位，再add/navigate；超容量不能腾位时保留成功状态；普通销售/采购/kit及超容量独立复核通过，全局store未改 |
| C 普通销售提交沿kit配置skipGlobalError导致静默失败；独立真实Axios探针2/2红、实际AppToast回归3/3红 | 仅普通分支恢复全局反馈，保留owner/baseURL/session/no-fallback和原请求键；409/400/网络错误显示、输入保留、同键重试真实客户端回归转绿；kit write.error链未改 |

基线四个前端用例文件28例、search-all-dates3例及finder/approval2例曾分别通过，仅作为开发前对照，不计入最终新增结果。三项各自及整批的审查拒绝项均有修补后复核，未用实现者自查代替独立接受。

## 结果边界

仍待真实隔离 MySQL/API 验证和员工现场验证；未做生产连接、部署、真机或物理打印。开发检查通过不代表正式上线已具备条件。

## 页面、接口与主要位置

| 范围 | 员工可见调整 | 主要代码与接口 |
|---|---|---|
| 审批列表 | 每页 20 条、总数、翻页；六类原单正确定位 | `pages/approvals/pending.tsx`、`lib/approvalBusiness.ts`、`hooks/useApprovals.ts`；`GET /approvals/pending` → `approvals.controller.js/service.js` |
| 首页审批与列表型原单 | 首页沿同一类型映射；列表按原单 id 打开详情，保留已有弹窗输入 | `ListWidgets.tsx`、`useApprovalDetailHandoff.ts`、`useApprovalReadScope.ts`、`ApprovalHandoffNotice.tsx`；credit-overrides、price-change、disposal、finance/expenses 四页与原详情 API；`OrderActivityDialog.tsx` 关闭/卸载通知 |
| 商品选择与管理 | 六字段搜索、精确编码/条码优先、命中说明 | `products/productSearch.js`、`products.service.js`；`GET /products/finder`、`GET /products`；`ProductFinderModal.tsx`、`pages/products/index.tsx`、`ProductQueryDialog.tsx`、`types/products.ts` |
| 全局商品搜索 | 各类批次取齐后，只对商品结果做稳定精确优先排序 | `search.service.js`、`api/search.ts`、`GlobalSearch.tsx`；`GET /search`，原 id 游标与其它实体顺序保留 |
| 原单退货入口 | 普通销售、成套销售和采购详情增加“发起退货” | `sale/form/index.tsx`、`sale/commercial/CommercialSalePage.tsx`、`purchase/form/index.tsx`、`returns/ReturnSourceButton.tsx`；入口不调用创建/退款接口 |
| 来源草稿与表单 | 来源与无源草稿分离，载入原价和余量；kit 由员工明确选原实发组件 | `returns/sourceHandoff.ts`、两个 `returns/*/form/index.tsx`、`api/returns.ts`、`routeDefinitions.ts`、`workspaceRouteMeta.ts`；`GET /returns/{sale,purchase}/source-order`，原 `POST /returns/{sale,purchase}` 写接口复用 |

上表前端相对位置均在 `frontend/src/`，后端在 `backend/src/modules/`。测试使用既有 CI 的 unit/static 接线；本轮没有触发远程 CI。后端没有迁移或新增写接口，未修改审批引擎、容器库存、预占、退货/退款执行、收付款、期间锁或历史快照。

## 后续验收（本轮未执行）

| 证据层 | 场景 | 通过标准 |
|---|---|---|
| 隔离 MySQL/API | 六类型审批跨页、无原单查看权限、费用本人/view_all、限仓/空仓范围 | 列表和总数口径一致，分页无重复/漏页；仅准确原单可达；没有因入口赋予额外审核或查看权限 |
| 隔离 GUI | 四类列表原单关闭后同页等待、离开再从首页/待办进入同一原单；已有新建/处理草稿 | 同页不自动重开，重新交接会核对并打开准确原单；已有草稿保持输入并阻挡自动打开，账号/权限/服务器变化隔离旧对象 |
| 隔离 MySQL/API | 中文/大小写/空字段/通配符六字段查询与跨批全局结果 | 实际数据库排序、命中说明、筛选正确；全局低 id 精确商品可见且优先；记录执行计划与实际性能，不能用 stub 替代 |
| 隔离 API | 普通销售部分发货/已有退货、采购已关闭或完成收货/未关闭收货、历史停用商品、零可退 | 来源、原价、余量与原后端规则一致；创建仍重新校验，未关闭收货不能被详情累计量误当可退；不产生重复库存/账款变化 |
| 隔离 API | kit 原成交版本、原已确认出库批次、同 SKU 多来源、版本冲突与原请求键重放 | 不把全部组成自动带入；原来源、预算与不同来源分单约束保留；查询原回执不把新草稿当作已提交 |
| 隔离 GUI | 同源重复点击、A/B/无源切换、满标签、未核实来源、A 提交在途切 B | 输入保留、来源身份不可绕过；满标签不挤掉草稿；原成功不抢 B 页面；真正关闭对应规范 key |
| 员工现场 | 开单人员用编码/供应商型号/颜色选品、售后从原单退货、审批人跨页查看 | 能找对商品与原单，理解余量和 kit 来源；旧系统无源退货可达；不误以为发起退货已完成退款 |

本批代码检查与离线组件证据另见上方验证记录。PDA 真机、物理打印、员工现场、远程 CI、发布与生产部署均没有执行，不计入本地通过结果。
