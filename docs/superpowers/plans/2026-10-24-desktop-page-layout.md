# 电脑端页面版式收敛实施计划

> **For agentic workers:** 使用当前会话逐项实施并自审；用户已要求计划后立即开始，不增加执行方式确认。本轮不委派、不提交、不推送。

**Goal:** 以最初应用模板与当前销售订单页为基准，把系统设置、快递账号绑定、采购申请表单整理成可推广的三种版式。

**Architecture:** 复用 PageHeader、ActionBar、SectionCard、ResizableTable 与已有表单。只调整页面结构类名和 ERP 作用域 CSS；设置按组纵向展开、主从管理页采用一个连续工作区、单据表单收紧页头与区块间距。值、请求、权限、配置键、状态、幂等、未保存保护、工作区切换与 PDA 保持原实现。

**Tech Stack:** React、TypeScript、现有 Tailwind 与 desktop-page-samples.css；不新增依赖。

---

## 1. 现场与差异基线

- [x] 核对分支、工作树和未提交改动；复用 codex/desktop-page-samples，保留既有修改。
- [x] 复读初始应用 HTML、样板计划、前端/筛选返回/本地验收规范。
- [x] 将本批涉及的原文件保存到仓库外 /tmp/flowcube-desktop-samples-preview/layout-baseline，后续用此增量核对。

## 2. 系统设置：连续分组，字段就近阅读

**Files:** frontend/src/pages/settings/index.tsx、frontend/src/styles/desktop-page-samples.css。

- [x] 把 sample-settings-grid 从等宽卡片网格改为单一连续设置面板；每个分组用窄标题列与宽字段列，组间细分隔。
- [x] 字段采用 `grid-template-columns:160px minmax(0,1fr)`，值与输入均左对齐、输入限制到合理阅读宽度；长值与备注可换行。
- [x] Logo 仍在原上传链路，展示区与其他分组对齐；只调整展示说明的排布。
- [x] 窄屏依次转为上下分组、上下字段；不缩短字段、不隐藏未知设置。

## 3. 快递账号绑定：连续主从工作区

**Files:** frontend/src/pages/carrier-accounts/index.tsx、frontend/src/pages/carrier-accounts/NewAccountForm.tsx、frontend/src/styles/desktop-page-samples.css。

- [x] 删除页面根部重复 p-4/sm:p-6，使用 `.desktop-management-page`，使标题与销售列表同一基线。
- [x] 将左右区域包在 `.desktop-split-workbench`；列表侧 256px，主内容 `minmax(0,1fr)`，只保留区域分隔，消除重复圆角边框。
- [x] 搜索、数量说明、可滚动列表构成左侧连续区域；保留全部选择/筛选/dirty 确认/disabled 逻辑。
- [x] 新增表单标题、字段与底部操作对齐；保留 native submit、必填、字符上限与 pending。
- [x] <900px 上下排列，列表单独限制高度；空状态提示适用于上下与左右两种布局。

## 4. 采购申请：紧凑单据版式

**Files:** frontend/src/pages/purchase-requisitions/form.tsx、frontend/src/styles/desktop-page-samples.css。

- [x] 添加 `.desktop-requisition-form` 作用域，统一页头有效高度与下方间距；不全局改变其他单据。
- [x] 基本信息字段标签减为普通中等字重；保持现有字段、选择器、只读态和 disabled。
- [x] 明细区用 `.desktop-requisition-items` 去掉表格外重复留白，保留原 ResizableTable 列、宽度及行行为；空行垂直留白 28px。
- [x] 核对新建与已有单据、申请信息/审批进度/记录切换；不得触碰审批、转单与创建恢复链路。

## 5. 自审、验证与交付

**Files:** docs/frontend-pda-conventions.md、docs/desktop-ui-review-2026-10-24.md、本计划。

- [x] 相对仓库外快照检查所有 TSX 增量，确认事件处理器、API、数据转换及权限判断未变；`git diff --check` 无错误。
- [x] 本批纯展示改动不新增镜像实现的测试；复用真实组件回归验证设置原键保存/取消/只读、账号表单/导航草稿、采购申请幂等/恢复。
- [x] 本批一次执行 `npm --prefix frontend run test:unit -- src/pages/settings src/pages/carrier-accounts src/pages/purchase-requisitions src/pages/procurement/intent-recovery.test.tsx`，预期无失败；失败先查明归因再补验证。
- [x] 本地合成预览 5197 实际打开三个页面；1470、1024、800 宽核对布局、设置编辑/取消、账号新增/筛选、采购添加商品/数量输入/页签保留；不提交业务写入。
- [x] 同步前端主题文档与本轮证据，截图保存在仓库外。lint、类型检查、构建及全量回归遵守项目集中验证规则，未跑明确列为待发版前验证。
- [x] 清除本任务创建的临时浏览器和工作区标签，保留原仪表盘未完成编辑及既有用户预览；提供计划、三页预览与实拍。

## 验收标准

同宽下三页标题与销售页对齐；同层级区块标题与主次按钮一致；设置值不横跨整卡寻找；管理页内无重复外边距与双重卡片；表格内部可横向滚动、页面不整体溢出。Logo、主标题、业务逻辑、配置和 PDA 不改。浏览器合成数据证据与真实后台、生产、设备验收分开报告。

## 本批执行结果

三种版式样板已在本地实施；受影响组件 15 文件 / 102 例、前端约定和文档守卫通过。1470/1024/800 实拍与交互检查完成，临时夹具及标签已收尾。完整记录见 docs/desktop-ui-review-2026-10-24.md。按计划本轮未跑 lint、类型检查、构建和全量业务套件，均待发版前集中验证；未提交、推送或部署。
