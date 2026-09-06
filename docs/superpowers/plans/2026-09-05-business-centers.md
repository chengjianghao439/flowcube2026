# 业务入口合并实施计划

**目标：** 合并采购建议、经营报表、仓库运营的入口与工作区，保留原有业务操作和权限。

**架构：** 路由保留原地址，共享合并组的工作区 key 和页面外壳。标题下使用视图导航，按需挂载已访问视图并保留其状态；隐藏视图停止轮询。菜单先过滤权限再按组合并，避免仅有补货报表权限的账号丢失入口。

**范围：** `/procurement` 与 `/reports/replenishment` → 采购建议；`/reports`、`/reports/kpi`、`/reports/profit-analysis` → 报表中心；`/reports/warehouse-ops`、`/reports/wave-performance`、`/reports/pda-anomaly` → 仓库运营。

应收应付只服务现结，对账只服务月结，保持原样。用户已确认首页摘要＋完整待办中心：统一命名和缓存，完整页归审批中心；默认布局加入摘要，只迁移精确匹配的历史默认，不覆盖个人布局。无后端、数据库和发版操作。

- [x] 路由与交互测试：不同原地址复用一个工作区；采购权限分别保留；视图切换与返回保留条件；隐藏轮询停止；财务及工作台不变。
- [x] 新增 `frontend/src/router/mergedPageGroups.ts`，集中组名、路径、视图名称与原权限。
- [x] 修改 `routeDefinitions.ts`、`workspaceRouteMeta.ts`、`TopNav.tsx`，菜单权限过滤后合并、标签共享、原地址仍有效。
- [x] 新增合并外壳和页头上下文，修改 `PageHeader.tsx`、`routeRegistry.ts`、`useActiveWorkspaceTab.ts`，仅加载访问过的页面，保留页内动作。
- [x] 更新 AGENTS.md 现行规则与实施说明；执行定向单测、前端 lint、app 类型检查及 ERP 构建。
- [ ] 启动或复用本地开发服务，用独立 agent-browser 会话验证导航、筛选保留和旧地址，关闭并核验本任务浏览器会话。

验证命令：先 `source "$HOME/.config/flowcube/dev-env.sh"`；运行 `npm --prefix frontend run test:unit -- src/router/mergedPageGroups.test.ts src/components/shared/MergedPage.test.tsx`、`npm --prefix frontend run lint`、`frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit`、`npm --prefix frontend run build`。

本地开发服务已启动，浏览器认证被后端拒绝，页面验收等待有效凭据；浏览器会话已清理。完整结果见 `docs/business-centers-2026-09-05.md`。
