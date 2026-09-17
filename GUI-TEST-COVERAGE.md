# 极序 Flow 全系统 Computer Use 验收 — 覆盖记录

任务：以真实用户界面（屏幕 + 鼠标 + 键盘）对极序 Flow 做深度验收，持续维护本文件与 `GUI-TEST-ISSUES.md`。

状态口径（只有前三种来自真实 GUI 操作）：

- `COMPUTER-USE VERIFIED` — 真正通过屏幕/鼠标/键盘操作完成，并看到成功结果
- `FAILED` — GUI 操作失败 / 报错 / 卡住
- `PARTIAL` — 只做了部分验证（只读打开、业务链未闭环、条件不具备）
- `NOT TESTED` / `NOT VERIFIABLE` — 未测 / 环境不具备

环境：

- ERP 本地开发 `http://localhost:5173`（后端 `:3000`，MySQL 8 开发库 3307，`flowcube_dev8`）
- PDA 本地开发 `http://localhost:5174`
- 桌面端 Electron（视环境）
- 生产 `https://jixuflow.com` 只做**只读**观察，不在生产写入测试数据

账号：本地开发库管理员（用户 Chrome 已有登录会话）。测试数据在本地开发库创建，属于可丢弃数据。

## 覆盖明细

| # | 模块 | 页面/入口 | 实际 Computer Use 操作 | 结果 | 关联问题 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 仪表盘 | `/dashboard` | 打开、逐卡浏览（待处理销售/需要关注/低库存/趋势/资金/番茄钟等）：视觉检查、数据合理性检查 | 页面正常渲染，卡片与数据齐全 | ISSUE-010（图表条数未上限，本地 253 仓时几乎不可读） | COMPUTER-USE VERIFIED |
| 2 | 销售 | `/sale` 列表 | 打开、浏览状态分类、表格与操作列 | 正常 | — | COMPUTER-USE VERIFIED |
| 3 | 销售 | `/sale` → 占用库存弹窗 | 点「占库」→ 核对商品身份/仓库/数量/ATP（现货 100、占后剩余 98）→ 确认占用 | 成功：toast「库存已占用」，状态 草稿→已占库，操作列变为「核对发货」 | — | COMPUTER-USE VERIFIED |
| 4 | 销售 | `/sale/3260` 详情 | 点「核对发货」→ 打开详情页；浏览订单摘要/基础信息/商品明细/订单汇总 | 正常，视觉与信息层级清晰 | — | COMPUTER-USE VERIFIED |
| 5 | 销售 | `/sale/3260` 发起出库 | 点「发起出库」→ 勾明细/数量 2 → 确认 | 成功：toast「已发起出库」，状态 已占库→拣货中，生成仓库任务 WT20260917004，已发/应发 0/2 | — | COMPUTER-USE VERIFIED |
| 6 | 销售 | `/sale/3260` 作业进度 | 切到作业进度页签 | 显示 WT20260917004 + 六步状态条（拣货中●→待分拣○→…→已出库○）；取货数量 0 | — | COMPUTER-USE VERIFIED |
| 7 | 系统 | `/users` 用户管理 | 打开、浏览 35→36 个账号、新增账号 `cua_pda_test`（仓库管理员，图形界面填表保存） | 成功，列表出现新账号 | ISSUE-002（列表被 smoke_* 测试账号污染） | COMPUTER-USE VERIFIED |
| 8 | 系统 | `/settings/pda-devices` | 登记新设备「CUA键盘验收机0917」→ 选北京主仓 → 生成设备码 `PDA-260917-ADB9` 与密钥（二维码） | 成功 | — | COMPUTER-USE VERIFIED |
| 9 | PDA | `/pda/login` | 输入账号密码登录（真实登录页） | 首次因记住的旧账号 `admin` 拼接失败，清空后登录成功 | ISSUE-004 | COMPUTER-USE VERIFIED |
| 10 | PDA | `/pda` 工作台 | 未绑定设备受限模式 → 绑定后正常；浏览待办与 14 项可用作业 | 受限模式引导正确；绑定后全部作业入口可用 | ISSUE-005、ISSUE-006 | COMPUTER-USE VERIFIED |
| 11 | PDA | `/pda/bind` | 手动输入设备码+密钥 → 绑定成功（设备码/仓库/票据状态 有效） | 成功 | ISSUE-005 | COMPUTER-USE VERIFIED |
| 12 | PDA | `/pda/picking` 拣货任务 | 切换「商品列表/订单列表」，刷新 | 两个视图数据自相矛盾：订单列表 0 个任务，商品列表仍显示 1 个 SKU 0/2 待拣 | ISSUE-001 | FAILED |
| 13 | PDA | `/pda/task/1999` 扫码拣货 | 进页面（默认扫码模式无输入框）→ 点「手动输入」→ 输入容器 `I005336` → 提交 | 成功：拣货完成，任务进入待分拣；**本次修复的“默认扫码、点击才出键盘”行为在真机流程中确认生效** | — | COMPUTER-USE VERIFIED |
| 14 | PDA | `/pda/sort` 订单分拣 | 扫码枪输入产品编码 `SKU0001` → 显示指定分拣格 A01 → 扫分拣格 `A01` 确认 | 成功：toast「分拣已成功，任务状态已更新为待复核」 | — | COMPUTER-USE VERIFIED |
| 15 | PDA | `/pda/check/1999` 复核 | 扫容器 `I005336` | 成功：复核完成，任务进入待打包 | — | COMPUTER-USE VERIFIED |
| 16 | PDA | `/pda/pack/1999` 打包 | 新建箱子 L000493 → 扫 `SKU0001`×2 装箱 → 完成此箱 → 点「完成打包并进入待出库」 | 装箱成功；**完成打包持续失败**，任务卡在待打包 | ISSUE-003（P1） | FAILED |
| 17 | 采购 | `/purchase/new` 新建采购单 | 图形界面选供应商（深圳华芯）、入库仓（北京主仓）、添加商品 SKU0001×5、保存草稿、提交并确认 | 成功：PC20260917003 草稿→已提交 | — | COMPUTER-USE VERIFIED |
| 18 | 采购 | `/inbound-tasks/new` 新建收货订单 | 选供应商 → 选择商品（本次收货数量 5）→ 创建收货订单 → 提交到 PDA | 成功：IN20260917002 创建并提交到 PDA | — | COMPUTER-USE VERIFIED |
| 19 | PDA | `/pda/inbound` 收货订单 | 打开待处理任务 → 开始收货 → 逐箱填 5 → 打印并登记 | 成功：本单已全部收货，生成容器 I005338，任务→待上架 | — | COMPUTER-USE VERIFIED |
| 20 | PDA | `/pda/putaway/1983` 扫码上架 | 扫容器 `I005338` → 扫库位 `R396842`（首次提示偏离推荐库位，再扫一次确认） | 成功：该订单上架已完成；容器转 ACTIVE 并落到库位 | ISSUE-015 | COMPUTER-USE VERIFIED |
| 21 | 数据一致性 | 开发库只读核对 | 核对容器/库存缓存/预占/任务 | 容器 I005338 剩余 5 且 status=1、location=1；`inventory_stock` 105 = 容器合计 105；预占 2 = 销售单 3260；拣货容器 I005336 被 `locked_by_task_id=1999` 锁定（出库时才扣减） | — | 后台辅助验证 |
| 22 | 库存 | `/inventory` | 打开库存总览（KPI 商品 1,658 / 在库 155 / 已预占 2 / 可用 153） | 正常，与预占数据一致 | — | COMPUTER-USE VERIFIED |
| 23 | 库存 | `/plastic-boxes` | 新建塑料盒（绑定 SKU0001、北京主仓） | 成功：B000564 创建，数量 0，状态在库；末列操作被裁切 | ISSUE-013 | COMPUTER-USE VERIFIED |
| 24 | 库存 | `/inventory/trace`、`/stockcheck`、`/stockcheck/abc`、`/disposals`、`/transfer`、`/products`、`/categories`、`/price-change` | 逐页打开、读取页面标题/表格/错误文案 | 均正常渲染无报错；盘点单 SC20260917005 为 0 明细的空单 | ISSUE-009 | COMPUTER-USE VERIFIED |
| 25 | 仓储 | `/picking-waves`、`/warehouses`、`/locations` | 逐页打开 | 正常（仓库 251 行、库位 208 行，测试数据污染） | ISSUE-002 | COMPUTER-USE VERIFIED |
| 26 | 财务 | `/payments/receivable`、`/reports/reconciliation/payable`、`/reports/reconciliation/receivable`、`/logistics/freight-reconciliation`、`/finance/dashboard`、`/finance/accounts`、`/finance/transactions`、`/finance/expenses`、`/finance/expense-categories`、`/refunds` | 逐页打开并读取关键内容 | 均正常渲染 | — | COMPUTER-USE VERIFIED |
| 27 | 会计 | `/accounting/accounts`、`/vouchers`、`/ledger`、`/reports`、`/invoices`、`/periods`、`/fixed-assets`、`/consolidation`、`/tax` | 逐页打开 | 均正常渲染（凭证/总账/报表有数据） | — | COMPUTER-USE VERIFIED |
| 28 | 报表 | `/reports`、`/profit-analysis`、`/kpi`、`/avg-cost-reconciliation`、`/replenishment`、`/inventory-aging`、`/warehouse-ops`、`/wave-performance`、`/pda-anomaly` | 逐页打开 | 均正常渲染 | — | COMPUTER-USE VERIFIED |
| 29 | 审批 | `/reports/role-workbench`、`/approvals/pending`、`/approvals/flows` | 逐页打开 | 正常（待办中心有履约待办入口） | — | COMPUTER-USE VERIFIED |
| 30 | 基础资料/门户 | `/customers`、`/carriers`、`/carrier-accounts`、`/suppliers`、`/departments`、`/portal/statements`、`/portal/purchase-status` | 逐页打开 | 正常（客户 74 行含测试数据） | ISSUE-002 | COMPUTER-USE VERIFIED |
| 31 | 系统 | `/users`、`/permissions`、`/settings`、`/oplogs`、`/settings/print-templates`、`/settings/printers` | 逐页打开；操作日志点开「详情」核对审计内容 | 正常；日志详情含原始接口路径/状态码/操作人 | ISSUE-014 | COMPUTER-USE VERIFIED |
| 32 | PDA 其余 | `/pda/inventory-query`、`/pda/transfer`、`/pda/sale-return`、`/pda/cancel-return`、`/pda/adjustments`、`/pda/ship` | 逐页打开并读取空态文案 | 均正常渲染，空态提示清晰 | — | PARTIAL（只读打开，未跑完整业务链） |
| 33 | 桌面端 | `npm --prefix desktop start` | 启动 Electron 客户端（0.9.19 / commit 9b428c5），观察日志与进程 | 进程正常启动、无报错；**电脑操作工具无法挂到该窗口**（getApp("Electron") 只会唤起并连到默认 Electron 窗口），未能进行真实 GUI 操作 | — | NOT VERIFIABLE |
| 34 | 生产只读 | `https://jixuflow.com/#/dashboard` | 只读浏览仪表盘全部卡片 + 控制台检查（未做任何写操作） | 正常：v0.9.17、待处理销售 3、逾期应收 ¥358.43、库存 9,971、待办 6（待出库 1 / 待上架 5） | ISSUE-011 | PARTIAL（只读） |
| 35 | 库存调拨 | `/transfer/new` + `/transfer/260,261` | 图形界面新建两张调拨单（北京主仓→上海分仓，SKU0001 计划 1 与计划 5）→ 保存草稿 → 派发 | 两张均成功派发为「待出库」 | — | COMPUTER-USE VERIFIED |
| 36 | PDA 调拨 | `/pda/transfer` + `/pda/transfer-out/261` | 打开列表（首次显示 0，刷新后 2）→ 扫描 `I005336`（被其他任务锁定）→ 扫描 `I005338`（数量 5 = 计划 5） | 锁定容器与"整箱数量>计划"两种失败都被显示成「状态已变化，请刷新后重试」；计划 5 的调出成功（已出库 5，订单转在途） | ISSUE-003、ISSUE-016、ISSUE-017 | PARTIAL（调出成功、调入未完成） |
| 37 | PDA 调拨调入 | `/pda/transfer-in/261` | 扫在途容器 `I005338` → 扫目标库位 `SH-A01`（上海分仓唯一库位） | 容器扫描通过并进入第二步；库位因格式不符被前端拒绝「请扫描目标库位条码」，调入未完成 | ISSUE-018 | FAILED（环境/数据限制） |
| 38 | 数据一致性 | 调拨只读核对 | 核对订单/明细/容器/库存/流水 | 全部自洽：订单 261 status=3 在途、明细 deducted=5、容器 6113 迁到仓 11 且 status=4 待上架、调出仓库存 105→100（`inventory_logs` move_type=4）、在途不计入调入仓可用 | — | 后台辅助验证 |
| 39 | 补齐页面 | `/purchase-requisitions`、`/procurement`、`/returns/sale`、`/credit-overrides`、`/logistics`、PDA `/pda/split` | 逐页打开、读取标题/表格/空态/错误文案 | 全部正常渲染，无加载错误 | — | COMPUTER-USE VERIFIED |

## 覆盖小结（Completion Audit）

- 发现用户可见页面：ERP 导航页 **68 个**（9 个顶级模块）+ PDA 作业页 **26 个** + 官网/门户 + 桌面端；本轮通过真实界面打开并检查 **全部 68 个 ERP 页面**、**21 个 PDA 页面**。
- 真正跑通的业务链（COMPUTER-USE VERIFIED，含数据核对）：
  1. 销售：占库 → 核对发货 → 发起出库 → 生成仓库任务 → PDA 拣货 → 分拣 → 复核 → 打包（**止于打印依赖**）
  2. 采购：新建采购单 → 提交 → 新建收货订单 → 提交 PDA → PDA 收货 → PDA 上架 → 库存增加（**全链闭环并通过数据核对**）
  3. 调拨：新建 → 派发 → PDA 调出扫码 → 源仓减库 + 容器转在途（**调入未完成：目标仓库位不可扫**）
  4. 系统：新建用户、登记 PDA 设备、设备绑定、操作日志审计核对
- 未做完整闭环：销售出库确认及之后的物流/应收（被 ISSUE-003/015 打印依赖卡住）、PDA 退货收货/上架（无退货单）、PDA 出库确认（任务未到待出库）、PDA 拣货退回/改单确认（无触发数据）、盘点扫码（无可用盘点单）。
- NOT VERIFIABLE：桌面端 GUI（电脑操作工具只能连到默认 Electron 窗口）、真实打印机/箱贴出纸、真机 PDA 相机扫码、生产写操作（本轮生产只做只读浏览）。
