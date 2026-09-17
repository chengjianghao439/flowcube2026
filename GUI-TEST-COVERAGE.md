# GUI 真人操作式验收 · 覆盖表（2026-09-17）

方式：agent-browser 独立会话 `flowcube-gui-0917` 打开真实运行的 ERP（5173）与 PDA（5174），
逐页真实渲染、截图、读取可见文本与可交互元素；功能项以真实点击/输入/提交为准。
后台（API/DB/代码/日志）只用于调查与取证，不作 PASS 依据。

状态含义：
- **GUI VERIFIED**：本次真实操作过该功能并观察到预期结果。
- **PARTIAL**：页面真实打开并观察过，但核心操作未实际执行（或只执行了部分）。
- **FAILED**：真实操作后结果不符合预期。
- **NOT TESTED**：未在 GUI 中打开或未操作。
- **NOT VERIFIED**：需要真实硬件/外部系统，无法在本环境验证。

## A. 页面打开与视觉观察（阶段 1：72 个 ERP 路由全部真实打开）

| 模块 | 页面 | 路由 | GUI 打开 | 观察结果 | 功能操作 |
|---|---|---|---|---|---|
| 概览 | 仪表盘 | /dashboard | ✅ | 4 张摘要卡 + 待办 + 趋势，真实数据 | PARTIAL |
| 采购 | 采购订单 | /purchase | ✅ | 列表默认最近 7 天，含"逾期未到"入口 | PARTIAL |
| 采购 | 采购申请 | /purchase-requisitions | ✅ | 26 行真实数据 | PARTIAL |
| 采购 | 采购建议 | /procurement | ✅ | 计划/补货两视图 + 27 行 | PARTIAL |
| 采购 | 收货订单 | /inbound-tasks | ✅ | 状态分类齐全，4 行 | PARTIAL |
| 采购 | 采购退货 | /returns/purchase | ✅ | 5 行，含金额列 | PARTIAL |
| 采购 | 供应商管理 | /suppliers | ✅ | 33 行，导入/导出/新增可见 | PARTIAL |
| 销售 | 销售管理 | /sale | ✅ | 15 行，状态分类与导出可见 | GUI VERIFIED（建单/占库/出库/取消全流程，见 C 节） |
| 销售 | 销售退货 | /returns/sale | ✅ | 16 行 | PARTIAL |
| 销售 | 超额放行申请 | /credit-overrides | ✅ | 41 行，审批状态可见 | PARTIAL |
| 销售 | 物流运单 | /logistics | ✅ | 42 行 | PARTIAL |
| 销售 | 客户管理 | /customers | ✅ | 116 行（含大量测试客户） | PARTIAL |
| 销售 | 客户对账门户 | /portal/statements | ✅ | 真实渲染 | PARTIAL |
| 销售 | 供应商到货门户 | /portal/purchase-status | ✅ | 真实渲染 | PARTIAL |
| 销售 | 承运商管理 | /carriers | ✅ | 119 行 | PARTIAL |
| 销售 | 快递账号绑定 | /carrier-accounts | ✅ | 真实渲染 | PARTIAL |
| 库存 | 库存管理 | /inventory | ✅ | 总览 + 出入库记录页签 | PARTIAL |
| 库存 | 塑料盒管理 | /plastic-boxes | ✅ | 661 行（测试数据占多数） | PARTIAL |
| 库存 | 批次追溯 | /inventory/trace | ✅ | 扫码追溯空态文案正确 | PARTIAL |
| 库存 | 库存盘点 | /stockcheck | ✅ | 931 行，含系统自动排程单 | PARTIAL |
| 库存 | 商品分档与分批盘规则 | /stockcheck/abc | ✅ | 需先选仓库，空态有引导 | PARTIAL |
| 库存 | 滞销库存处理 | /disposals | ✅ | 993 行 | PARTIAL |
| 库存 | 库存调拨 | /transfer | ✅ | 默认 7 天无数据，空态正确 | PARTIAL |
| 商品 | 商品管理 | /products | ✅ | 16 行，启用状态列 | PARTIAL |
| 商品 | 商品分类 | /categories | ✅ | 4 级分类，共 5 个 | PARTIAL |
| 商品 | 商品改价申请 | /price-change | ✅ | 5 行，含"待审批" | PARTIAL |
| 商品 | 批次拣货 | /picking-waves | ✅ | 1 行 | PARTIAL |
| 仓储 | 仓库管理 | /warehouses | ✅ | 251 行（248 个测试仓，见问题 G-1） | PARTIAL |
| 仓储 | 库位管理 | /locations | ✅ | 208 行 | PARTIAL |
| 仓储 | 货架管理 | /racks | ✅ | 1 行 | PARTIAL |
| 仓储 | 分拣格管理 | /sorting-bins | ✅ | 3 格全部"占用"（见问题 G-2） | PARTIAL |
| 财务 | 现结供应商账款 | /payments/payable | ✅ | 69 行 | PARTIAL |
| 财务 | 现结客户账款 | /payments/receivable | ✅ | 611 行 | PARTIAL |
| 财务 | 月结供应商对账 | /reports/reconciliation/payable | ✅ | 空态文案正确 | PARTIAL |
| 财务 | 月结客户对账 | /reports/reconciliation/receivable | ✅ | 空态文案正确 | PARTIAL |
| 财务 | 运费对账 | /logistics/freight-reconciliation | ✅ | 2 行 | PARTIAL |
| 财务 | 资金看板 | /finance/dashboard | ✅ | 94 个启用账户、余额合计真实 | PARTIAL |
| 财务 | 账户管理 | /finance/accounts | ✅ | 94 行 | PARTIAL |
| 财务 | 资金流水 | /finance/transactions | ✅ | 空态"共 0 笔" | PARTIAL |
| 财务 | 费用报销 | /finance/expenses | ✅ | 空态"共 0 张" | PARTIAL |
| 财务 | 费用类别 | /finance/expense-categories | ✅ | 7 行 | PARTIAL |
| 财务 | 退货退款单 | /refunds | ✅ | 22 行 | PARTIAL |
| 会计 | 会计科目表 | /accounting/accounts | ✅ | 31 个科目，分 5 类 | PARTIAL |
| 会计 | 记账凭证 | /accounting/vouchers | ✅ | 1202 张，3 处"有差异"标记（见问题 G-3） | PARTIAL |
| 会计 | 总账/试算平衡 | /accounting/ledger | ✅ | 借贷各 68,110.00 平衡 | PARTIAL |
| 会计 | 会计报表 | /accounting/reports | ✅ | 利润表/资产负债表可切换 | PARTIAL |
| 会计 | 发票管理 | /accounting/invoices | ✅ | 空态 | PARTIAL |
| 会计 | 会计期间/期末结转 | /accounting/periods | ✅ | 3 行，未结账 | PARTIAL |
| 会计 | 固定资产 | /accounting/fixed-assets | ✅ | 空态 | PARTIAL |
| 会计 | 合并报表/账套 | /accounting/consolidation | ✅ | 12 行，多账套 | PARTIAL |
| 会计 | 报税数据 | /accounting/tax | ✅ | 申报期间选择 | PARTIAL |
| 报表 | 报表中心 | /reports | ✅ | 三类统计总览 | PARTIAL |
| 报表 | 销售毛利 | /reports/profit-analysis | ✅ | 毛利 -1,484.08（测试数据） | PARTIAL |
| 报表 | 成本对账 | /reports/avg-cost-reconciliation | ✅ | "一致 · 200 行" | PARTIAL |
| 报表 | 经营 KPI | /reports/kpi | ✅ | 环比口径说明清晰 | PARTIAL |
| 报表 | 采购建议 | /reports/replenishment | ✅ | 5 行 | PARTIAL |
| 报表 | 存放时长与滞销 | /reports/inventory-aging | ✅ | 1768 行 | PARTIAL |
| 报表 | 仓库运营 | /reports/warehouse-ops | ✅ | 拣货中 903（僵尸任务的可视表现） | PARTIAL |
| 报表 | 批次效率 | /reports/wave-performance | ✅ | 空态 | PARTIAL |
| 报表 | PDA 异常分析 | /reports/pda-anomaly | ✅ | 扫码 1 次、错误 0 | PARTIAL |
| 报表 | 待办中心 | /reports/role-workbench | ✅ | 可见 4159 个按钮（见问题 G-4） | PARTIAL |
| 系统 | 打印模板 | /settings/print-templates | ✅ | 9 个模板 | PARTIAL |
| 系统 | 打印机管理 | /settings/printers | ✅ | 6 行，含桌面端提示 | PARTIAL |
| 系统 | 条码打印查询 | /settings/barcode-print-query | ✅ | 102 行，三类条码页签 | PARTIAL |
| 系统 | 待我审批 | /approvals/pending | ✅ | 空态 | PARTIAL |
| 系统 | 审批流配置 | /approvals/flows | ✅ | 空态 | PARTIAL |
| 系统 | 部门管理 | /departments | ✅ | 空态 | PARTIAL |
| 系统 | 用户管理 | /users | ✅ | 35 行 | PARTIAL |
| 系统 | 权限管理 | /permissions | ✅ | 明确提示"管理员角色权限固定不可修改" | PARTIAL |
| 系统 | PDA 设备 | /settings/pda-devices | ✅ | 76 行，含绑定说明 | PARTIAL |
| 系统 | 系统设置 | /settings | ✅ | 33 个输入项；已实测保存成功（见 C 节） | GUI VERIFIED（保存） |
| 系统 | 操作日志 | /oplogs | ✅ | 120 行 | PARTIAL |

## B. PDA 页面（5174）

| 页面 | 路由 | GUI 打开 | 操作 |
|---|---|---|---|
| PDA 登录 | /pda/login | ✅ | GUI VERIFIED（真实登录） |
| 作业台 | /pda | ✅ | GUI VERIFIED（工位卡片、待办计数） |
| 设备绑定 | /pda/bind | ✅ | GUI VERIFIED（手动输入设备码+密钥绑定成功；显示"所属仓库 北京主仓"） |
| 拣货任务列表 | /pda/picking | ✅ | GUI VERIFIED（207 个 SKU 列表） |
| 扫码拣货 | /pda/task/:id | ✅ | GUI VERIFIED（扫容器条码 I000214 → 拣货完成 → 任务进入待分拣） |
| 分拣作业 | /pda/sort | ✅ | PARTIAL（Put Wall 无空闲格，无法继续） |
| 复核 / 打包 / 出库 | /pda/check /pack /ship | ✅ 列表页打开 | NOT TESTED（被分拣格占用阻断） |
| 收货 / 上架 / 盘点 / 调拨 / 退货 / 改单确认 | /pda/{inbound,putaway,stockcheck,transfer,cancel-return,adjustments} | NOT TESTED | 未操作 |

## C. 完整业务流程（GUI 操作）

| 流程 | 步骤 | 结果 | 数据核对 |
|---|---|---|---|
| 销售建单→占库→出库→取消 | 新建销售单（选客户/仓库/商品/数量）→ 保存 → 占库 → 发起出库 → 取消订单 | GUI VERIFIED（同会话更早一轮完整跑通；本轮复测在仓库下拉处被工具限制卡住，见 F 节） | 取消后明细 reserved/dispatched 归零、预占释放、任务取消（同事务） |
| 销售表单校验 | 空表单点"保存草稿" | GUI VERIFIED | 页面提示"还有 3 处需要处理，点击可定位：请选择客户／请选择仓库／请添加至少一条商品明细" |
| 商品选择 | 打开"添加商品"→搜索 SKU0001→选中→确认 | GUI VERIFIED | 明细行出现，数量/单价可编辑，金额自动计算 |
| 系统设置保存 | 改/保存系统设置 | GUI VERIFIED | `PUT /api/settings` 200，废弃键不再出现在页面 |
| PDA 设备绑定→拣货 | 手动绑定 → 拣货扫容器条码 | GUI VERIFIED | 任务 2→3、容器锁定到任务、库存缓存不变 |
| 采购建单→提交（阶段 2） | 新建采购单：选供应商→选仓库→添加商品→改数量/单价→保存草稿→详情页点"提交"→确认弹窗 | GUI VERIFIED | 生成 PC20260917002（成都西部原材料公司 / 北京主仓 / ¥150.00 / 已提交 / 验收临时账号）；列表按单号核对一致 |
| 采购提交后的收货衔接（阶段 2） | 提交后在"收货订单"列表按该采购单号查找 | GUI VERIFIED（结果为空） | 1,948 行收货订单中 0 行关联该采购单 → **提交采购单不会自动生成收货单** |
| 会计对账卡（阶段 2） | 打开记账凭证页读取三张对账卡 | GUI VERIFIED（发现异常） | 资金 凭证 88,590.00 / 业务 162,075.00（差 -73,485.00）；应付 85,284.00 / 116,476.00（差 -31,192.00）；应收 4,310.00 / 46,510.00（差 -42,200.00） |
| 多角色：只读账号（阶段 3） | 以 `codex_ui_test`（只读查看，40 权限）登录，逐个直访业务页 | GUI VERIFIED（发现 G-10） | `/settings`、`/users` 正确 403 页；`/sale/new`、`/purchase/new`、`/transfer/new`、`/stockcheck`、`/products`、`/customers`、`/warehouses` **正常渲染完整写操作界面**（保存草稿 / 新增 / 编辑 / 批量导入） |
| 只读账号尝试写（阶段 3） | 在 `/customers` 打开"新增客户"、填名称、点"保存" | PARTIAL | 弹窗正常打开、表单可填；提交后**数据库无新客户**（后端拒绝）；但本次未在界面上观察到明确失败提示（程序化点击可能未命中，需下一阶段用真实点击复测） |
| 收货订单建单（阶段 4） | 收货订单 → 新建 → 选择供应商（真实点击）→ 选择商品 | GUI VERIFIED（建单未完成） | "选择收货商品"弹窗直接列出刚提交的采购单 `PC20260917002` 的待收明细（含订单数量/已收/未收/单价/本次数量），说明收货单是从采购单挑行发起，入口可用 |
| 收货订单建单（阶段 5 复核） | 重新登录 → 选供应商（真实点击）→ 打开"选择收货商品" | PARTIAL | 弹窗稳定重现：`PC20260917002 / SKU0001 / 北京主仓 / 订单 3 / 已收 0 / 未收 3 / 单价 50.00 / 已选 0 项`，带"确定"按钮；本阶段未完成勾行与提交，留待阶段 6 |
| 收货订单建单→提交到 PDA（阶段 6） | 选供应商 → 选择商品（填本次收货数量 3 → 确定）→ 创建收货订单 → 详情页"提交到 PDA" | GUI VERIFIED（据此更正一处口述） | 生成 `IN20260917001`（草稿 → 点"提交到 PDA"后页面显示**已提交**）并带出 PC20260917002 的未收行；**核对更正**：此时数据库里该收货单 `status=1`、**容器 0 个**——按设计容器在 PDA 实际收货扫码时才创建，所以"打印"只是详情页动作入口，不能据此说"容器标签已入队打印"（上一轮我的口述有夸大，已更正） |
| PDA 收货执行（阶段 7） | PDA 绑定设备（手动输入设备码+密钥成功）→ 收货订单列表 → 开始收货 → 填本次收货数量 3 → 点"打印并登记" | GUI VERIFIED | 页面提示"本单已全部收货，请前往「扫码上架」"；数据库核对：生成待上架容器 `I005335`（status=4 待上架、余量 3、归属该收货单）——与设计一致（待上架不计 ACTIVE 实物） |
| PDA 收货列表显示（阶段 7） | 观察 IN20260917001 在 PDA 收货列表的展示 | **FAILED（显示缺陷）** | 列表显示"`0 种商品`"，但同一单据在收货执行页显示"待收商品 **1** 个待收 SKU"，数据库 `inbound_task_items` 也确有 1 条明细 → **列表页商品种类数显示为 0，是错误显示** |
| PDA 扫码上架（阶段 7） | 打开 /pda/putaway/1982，尝试扫描容器条码 `I005335` + 货位 `R396842` | NOT VERIFIED — REAL HARDWARE | 该页面在浏览器里**没有任何 input 元素**（DOM 查询为空），键盘输入与 Enter 均无效；扫码组件依赖原生相机/扫码枪 → 必须在真机验证，不能算通过 |
| 盘点建单（阶段 8） | 库存盘点 → 点"+ 新建盘点" → 打开"新建盘点单"对话框 | PARTIAL | 对话框正常打开（含"选择仓库*（请选择）/ 盘点类型（全盘）/ 备注 / 取消 / 创建盘点"）；点"创建盘点"被校验拦住（未选仓库），**未创建成功**；仓库下拉同样被 248 个测试仓淹没（G-1 的同一根因） |
| 盘点建单（阶段 9 重做） | 选仓库（程序化 pointer 事件）→ 全盘 → 创建盘点 | GUI VERIFIED | 列表新增 `SC20260917002｜北京主仓｜全盘｜进行中｜验收临时账号｜2026-09-17 20:11` |
| 盘点填写与提交（阶段 9） | 点"查看/填写"→ 填"测试商品1实盘数量=1"→ 滚动后点"保存实盘数"→ 点"提交盘点" | PARTIAL（未提交成功，**发现高风险设计**） | 填写视图字段齐全（账面数量/实盘数量/差异/刷新账面）、动作按钮为"保存实盘数 / 提交盘点 / 取消盘点"；但**提交未生效**（单据仍 `status=1` 进行中）。核对数据发现：全盘单自动展开 **1,554 行**，其中 **1,553 行 `actual_qty=0`、全部 1,554 行 `diff_qty≠0`** —— 未填写行被当成"实盘 0"参与差异计算，一旦提交就会把未盘点商品的库存按 -账面量 调整 |

## F. 工具限制与待办（诚实登记）

| 事项 | 说明 |
|---|---|
| Radix 下拉的"真实点击" | agent-browser 对该表单的仓库下拉真实点击被 sticky 元素判定为"被遮挡"，我改用注入 pointer 事件的程序化点击完成选择（属于真实 UI 操作，但不是物理鼠标点击）。因此"仓库选择"这条证据的强度低于普通按钮点击。下一阶段改用键盘导航或先把元素滚到视口中部再点。 |
| 阶段 2 待做 | 采购建单→提交→审批、收货订单→PDA 收货→上架、调拨、盘点、退货、退款、财务核销、打印补打、多角色菜单差异、异常操作（连点/刷新/后退/多标签）。 |

## D. 阶段 1 发现（GUI 可见，详见报告）

| 编号 | 现象 | 类型 |
|---|---|---|
| G-1 | 仓库管理 251 行中 248 个为测试仓 | 数据污染 |
| G-2 | 分拣格 A01–A03 全部"占用"，Put Wall 无法使用 | 业务阻断 |
| G-3 | 记账凭证页出现"有差异"标记 | 待查 |
| G-4 | 待办中心单页可见 4159 个按钮（页面极重） | 性能 |
| G-5 | 工作区标签 keep-alive：打开越多页，DOM 越大（按钮数从 161 累积到 4011） | 性能 |
| G-6 | 塑料盒管理 661 行、盘点 931 行、库存 1200 行级列表一次性渲染 | 性能 |
| G-7 | 记账凭证页三张对账卡全部"有差异"：资金差 -73,485.00、应付差 -31,192.00、应收差 -42,200.00 | 账实不符（待判断是否测试数据所致） |
| G-8 | 采购单提交后不会自动生成收货订单，需人工另建（GUI 实测 1,948 行收货单 0 匹配）。**阶段 4 修正**：人工入口可用——"收货订单 → 新建 → 选择商品"会列出该采购单的未收明细（含未收数量），因此不是断链，而是"由仓库按到货发起"的设计选择；真实风险仅是无人主动发起时会积压 | 流程衔接（降级） |
| G-9 | Radix 下拉的真实点击在元素贴视口顶部时被判"被 sticky 元素遮挡"；滚到视口中部后真实点击成功 —— 确认为**测试工具遮挡问题，不是产品缺陷** | 工具限制（已澄清） |
| G-10 | **前端权限拦截不对称**：只读账号直访 `/settings`、`/users` 正确显示 403 页，但 `/sale/new`、`/purchase/new`、`/transfer/new`、`/stockcheck`、`/products`、`/customers`、`/warehouses` 都渲染完整写界面（保存草稿 / 新增 / 编辑 / 批量导入按钮可见） | 权限（前端）/UX，后端已有拦截 |
| G-11 | PDA 收货订单列表把有 1 条明细的单据显示为"**0 种商品**"（同单据的收货执行页显示"待收商品 1 个待收 SKU"，数据库也有 1 条明细） | 显示缺陷（PDA） |
| G-12 | PDA 扫码上架页在浏览器中没有任何输入元素（`document.querySelectorAll('input')` 为空），键盘输入/回车都不生效 | 环境限制（需真机）→ NOT VERIFIED — REAL HARDWARE |
| G-14 | PDA 收货单在无打印机环境下因"打印超时"被标成**异常中**（`IN20260917001` 实测：应到 3 / 已收 3，但打印显示"超时待确认 · 上架 待上架"，单据整体显示"异常中"）。演示/开发环境没有物理打印机，这类单会持续堆积成异常 | 环境相关，需确认真机（有打印机）时的行为与超时阈值是否过长 |
| G-10 修复 + 复验（阶段 14） | ① 路由：7 个模块的 `/new` 从"查看权限"改为"创建权限"（sale/purchase/products/purchase-requisitions/transfer/returns×2）；② 页面：products、customers、stockcheck、transfer、inbound-tasks、warehouses（含共享 BaseCrudPage 新增 `canCreate`）按权限渲染写入口 | **已修复，GUI 复验（只读账号）** | 复验结果：`/sale/new` → **403 页**；`/transfer/new` → **403 页**；`/products`、`/stockcheck`、`/warehouses` → 写按钮 **0 个**（修复前分别有 新增商品/批量导入、+ 新建盘点、新增仓库）。`tsc -p frontend/tsconfig.app.json --noEmit` 通过、ESLint 0 error |
| G-13 | **盘点（全盘）未填写行按"实盘 0"参与差异**：`SC20260917002` 自动展开 1,554 行，仅 1 行有填写值，但 1,553 行 `actual_qty=0` 且全部 1,554 行 `diff_qty≠0`（等于把账面量全部记为盘亏）。本次提交未生效（单据仍"进行中"），但这是**可能一次性清零大量库存的高风险设计**，需确认提交前是否强制要求逐行确认/是否只对"已填写"行算差异 | 高风险待确认 |
| G-13 界面取证（阶段 10） | 打开 `SC20260917002` 填写视图 + 点"提交盘点" | 已确认 | ① 界面上未填写行的"实盘数量"显示"-"，但"差异"直接显示 `-账面量`（如 SKU0002 账面 97 → 差异 -97.00），**肉眼可见会误导仓管**；② 点"提交盘点"只弹出"确认提交盘点 / 取消 / 确认提交"，**没有任何"有 1,553 行未填写"之类的提示或校验**；③ 我点了取消、并回查数据库确认单据仍为"进行中"（status=1），**未产生任何库存调整** |
| G-13 修复 + 复验（阶段 13） | 改前端：空输入不再当 0；新建盘点单 `SC20260917004`（北京主仓/全盘）→ 只填第 1 行"5" → 点"保存实盘数" | **已修复，GUI + 数据双验** | 修复前：保存后 `actual_qty=0` 的行 1,553（未填写行被写成 0）。修复后同一操作：**`NULL` = 1,553、`0` = 0、`>0` = 1、总计 1,554** —— 未填写行保持"未盘"状态，不再被当成盘亏。代码：`frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx`（`validateActuals` 只提交用户填写过的行；一行都没填时提示"请至少填写一行实盘数量后再保存"） |
| G-11 修复 + 复验（阶段 13） | 改前端：PDA 收货列表改用后端聚合字段 `lineCount`；重新绑定设备后打开 PDA 收货订单列表 | **已修复，GUI 复验** | 修复前：`IN20260917001` 显示"0 种商品"。修复后同一单据显示"**北京主仓 · 1 种商品**"。代码：`frontend/src/pages/pda/inbound.tsx`（`task.lineCount ?? task.items?.length ?? 0`）；`tsc -p frontend/tsconfig.app.json --noEmit` 通过 |
| 异常操作：未保存离开（阶段 11） | 在"新建采购单"填入备注"未保存测试备注"（输入框确认有值）→ 直接切换到"销售管理"路由 | PARTIAL（未确认） | 切换瞬间检测到页面存在 `[role=dialog]`（`dialog:true`），但紧接着按 dialog/alertdialog 精确查询返回空，无法确认是否为"放弃未保存修改"的拦截框；工作区标签 keep-alive 会让半填表单继续留在原标签内，因此"数据是否丢失/是否被拦截"尚未定性，需下一阶段用真实点击触发切换并即时读取弹窗文案 |
| 异常操作：未保存离开（阶段 12 复测） | ① 填备注后真实点击导航"仪表盘"离开；② 再切回该标签尝试点标签关闭按钮 | ① 已定性 ② PARTIAL | ① **不会弹任何"未保存"提示**（`[role=dialog]` 为空），但半填表单因工作区 keep-alive 仍留在原标签内（`stillEditing:true`）——即数据不丢、也不提醒；② 点标签关闭后标签仍在（`tabGone:false`）且未观察到弹窗，无法判定是"被脏数据守卫拦住但未渲染文案"还是"我的选择器没点中真正的关闭按钮"，保持未确认 |
