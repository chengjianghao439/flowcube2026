# 电脑端 IBM 蓝样式校正实施清单

> **For agentic workers:** Use executing-plans to implement this checklist in the current session. Preserve the approved component structure and interaction; this is a style-only task.

**Goal:** 以用户附件 CSS 为基线统一浅色令牌、字体和图表，恢复组件原有页签形态，实际检查六类页面。

**Architecture:** 仅调整样式、字体资源和图表颜色常量。组件 TSX、类名、路由、状态、请求与后端保持原样；样式按源码和真实页面适配。

**Tech Stack:** React / Tailwind CSS / PostCSS / Vite / agent-browser。

## 1. 源码与基线

- [x] 核对工作区与附件，在 `codex/desktop-ibm-style` 隔离修改。
- [x] 读取 AppLayout、TopNav、WorkspaceTabs、PageHeader、OrderStatusFilter、TableActionsMenu 与六类页面入口。
- [x] 以附件替换 `frontend/src/styles/desktop-page-samples.css`，逐条建立选择器到源码的对应清单；删除无来源或冲突覆盖，不新增组件形态。

## 2. 统一视觉值

- [x] `frontend/src/index.css` 统一浅色品牌、语义和中性令牌；按钮悬停加深；`.dark` 不变。
- [x] 保留 TSX 类名，以样式映射现有调色板类到语义令牌；不改变错误、禁用和选中含义。
- [x] 加载 Inter / Noto Sans SC，检查真实字形请求成功与 tabular-nums。
- [x] `frontend/src/components/dashboard/chartTheme.ts` 只保留 IBM 蓝与语义令牌；不改数据和格式化。
- [x] 核实无引用后删除 `pages/landing/landing.css` 与 `pages/landing-preview/preview.css`。

## 3. 验收与说明

- [x] 用本地合成数据预览实际工作树；检查销售列表、新建表单、详情、仪表盘、系统设置与销售查询弹窗，记录截图和选择器命中。
- [x] 检查页签下划线、行操作普通/危险变体、悬停深浅、表格选中态、查询重置及窄窗口。
- [x] 汇总执行一次前端 lint、`tsc -p tsconfig.app.json --noEmit`、构建与受影响的既有专项；以实际退出结果报告。
- [x] 核对 TSX 与业务代码无差异，更新 `docs/frontend-pda-conventions.md` 并写逐页记录，说明未覆盖范围。
- [x] 关闭本任务浏览器并用 session list 确认；保留可供用户查看的本地服务。不推送、不发布。
