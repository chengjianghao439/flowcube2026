# 官网业务内容核对 · 2026-09-05

## 本次范围

用户反馈官网内容仍沿用旧版本，要求先深入了解系统再继续。此次从当前开发工作区的路由、前端页面及后端业务实现梳理产品能力，并据此重写官网内容。未查询真实业务数据、未写数据库、未登录生产、未做全仓审计；代码存在不等于生产配置已启用或真实设备已验收。

## 产品定位

极序 Flow 面向有仓库作业、采购供应和客户账期的经营管理，将 ERP 订单/资金、WMS 执行与会计流程放入同一系统。官网重点从笼统的“多端协同”调整为“销售承诺有供应依据、仓库按任务执行、账款回到业务来源”。这是基于现有实现的内容定位，不是竞品效果、行业排名或效率提升承诺。

## 能力与实现依据

| 官网内容 | 核对实现 | 展示边界 |
|---|---|---|
| 采购预测、补货与计划转采购 | `backend/src/modules/inventory/inventory.procurement.js` 的 getProcurementPlan；`backend/src/modules/procurement/procurement.service.js` 的 generatePlan、调整明细与转采购流程 | SMA/WMA 等基于历史出库的建议，不称 AI 自主下单；建议可调整。旧计算文件的“转采购留 Phase 2”注释不能代表当前模块未实现 |
| 现货、预计供应与销售预占 | `backend/src/utils/expectedStock.js`；AGENTS.md 第 7 节当前 ATP 约定 | 有效预计供应可用于销售占库，但待上架货物不能视作可直接出库实物；绑定仅表示未兑现采购依赖，上架不重复增加订单预占 |
| 拣货、分拣、复核、打包、出库 | `backend/src/constants/warehouseTaskStatus.js`；`backend/src/modules/warehouse-tasks/warehouse-tasks.ship.js`；批次与 PDA 页面 | 按任务锁定的实物出库，不把“供应已有实物支撑”写成自动发货 |
| 商品/容器追溯 | `backend/src/modules/inventory/inventory.service.js` 的 getContainerLogs、traceByProductId 与来源单据解析；`frontend/src/pages/inventory/trace.tsx` | 当前记录涵盖来源、库位与变动操作；不声称无限历史或每件商品均有独立序列号 |
| 销售退货部分质检 | `backend/src/modules/return-tasks/return-tasks.service.js` 的 allocateQaContainers、check 与上架流程 | 合格、拒收、未检数量分别保留；收到退货不等于已回到可用库存 |
| ABC、分批盘点、库存健康 | `backend/src/modules/stockcheck/stockcheck.cycle.js`；`backend/src/modules/inventory/inventory.aging.js`；盘点状态约定 | 按配置执行，未声称所有企业已启用排程；盘点账面变化需重新核对 |
| 信用与审批 | `backend/src/modules/credit-overrides/credit-overrides.service.js`；`backend/src/modules/approvals/approvals.service.js`；出库授信检查 | 超额放行和审批能力依业务配置与权限；不声称所有超额业务无条件阻断 |
| 财务与会计 | `backend/src/modules/accounting/accounting.voucher.service.js`、accounting.ledger.service.js、accounting.period.service.js；routeRegistry 的财务与会计入口 | 应收应付、核销与会计分工不同；凭证存在按期间生成/核对流程，不声称每个动作实时自动记账；不宣传所有财务表均按账套隔离 |
| 岗位分工、待办与异常 | `frontend/src/pages/reports/role-workbench.tsx`；`backend/src/modules/reports/reports.query.js` 的 fetchRoleWorkbenchRows；路由权限与 PDA 设备约定 | 入口与可见内容受权限、仓库和设备绑定限制，不把仓库端描述成可自主改库存的工具 |

物流、门户等虽有目录/路由，但此次未核验外部服务配置，因此没有新增“已对接全部快递、自动电子面单、客户自助全流程”等承诺。未用历史模块数量和角色数量作卖点。

## 内容结构

1. 首屏：业务有序，经营有数；点明采购、销售、仓储、财务与会计。
2. 五场景示意：采购计划、销售占库、仓库执行、退货质检、财务会计。固定示例数据位于 `frontend/src/pages/landing/product-content.ts`，非真实页面截图。
3. 供货示例：`SupplyStory.tsx` 以 80 件订单解释“现货 40 / 待兑现采购 40 → 收货待上架仍为 40 / 40 → 上架后实物支撑 80 / 预计 0”。三阶段是固定文案与数量图示，不复制后端 ATP 算法；假设无其他库存变动。
4. 六类能力：采购补货、销售信用、仓储追溯、盘点库存健康、资金会计、岗位审批，并提供现有系统入口。
5. 三类变化：执行期改单/取消、退货质检、盘点账面变化，以可展开问答说明后续处理。
6. 三端分工、版本记录及下载保留。

## 本地验证

app TypeScript 类型检查、相关 TS/TSX 文件 ESLint、前端构建通过，构建位于 `/tmp/flowcube-product-story-build`。本地开发浏览器验证五个场景展示、退货未检数量示例、供货三阶段切换、hash 不变及桌面/390px 布局无页面级横向溢出。未实际运行采购、占库、财务等写操作；本次证明官网展示与交互，不替代这些业务的回归或生产验收。
