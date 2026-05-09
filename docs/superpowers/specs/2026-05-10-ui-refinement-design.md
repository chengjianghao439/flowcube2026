# FlowCube UI 细节优化设计

日期：2026-05-10  
状态：已定稿

## 概述

在保持现有布局结构（顶栏导航 + 多标签工作区）、配色方案（蓝色 `hsl(221 58% 47%)`）和全部功能不变的前提下，对全局 UI 视觉细节进行 9 项优化。目标：去 AI 感、更专业、更干净。

## 改动清单

### 1. 全局圆角 12/16px → 8px

- **涉及文件**：`index.css`（`--radius`）、`tailwind.config.js`、`card-base` 工具类
- **改动**：`--radius: 0.5rem` → `--radius: 0.375rem`（即 `rounded-lg` 级别，约 6-8px）
- **备注**：卡片、表格、按钮、输入框等全局生效

### 2. 去掉卡片阴影

- **涉及文件**：`index.css`（`.card-base` 去掉 `shadow-sm`）、`FilterCard.tsx`、`DataTable.tsx`
- **改动**：所有卡片和表格容器移除 `shadow-sm`，仅保留 `border`
- **效果**：更扁平、更干净

### 3. 筛选区去外层卡片包裹

- **涉及文件**：各页面筛选组件（`SaleFilters.tsx`、采购筛选、库存筛选等）
- **改动**：FilterCard 组件不再包裹外层 `rounded-xl border bg-card shadow-sm` 卡片，筛选控件直接渲染在页面上
- **保留**：折叠模式（collapsible）仍可用，但外层样式简化

### 4. 表头去大写

- **涉及文件**：`index.css`（`.text-table-head`）
- **改动**：移除 `uppercase` 和 `tracking-wide`，保留 `text-xs font-medium text-muted-foreground`
- **效果**：中文表头不再强制全大写，更自然

### 5. 页面背景纯白 → 极淡灰

- **涉及文件**：`index.css`（`--background`）
- **改动**：`--background: 0 0% 100%` → `--background: 220 14% 97%`（约 `#f8f9fa`）
- **效果**：减少白色刺眼感，减轻长时间使用疲劳

### 6. 操作列 SplitButton

- **涉及文件**：`TableActionsMenu.tsx`（需要重构）、各页面的 RowActions 组件
- **改动**：
  - 主按钮文字统一为两个字（占用、发货、查看、详情、编辑等）
  - 主按钮与下拉箭头合并为一个 SplitButton 组（中间有分隔线）
  - 点击主按钮触发主要操作，点击箭头展开更多操作
- **按钮文字调整**：

| 原文字 | 新文字 |
|---|---|
| 占用库存 | 占用 |
| 查看任务 | 查看 |
| 查看详情 | 详情 |
| 编辑订单 | 编辑 |

### 7. Emoji → SVG 线条图标

- **涉及文件**：全局替换所有使用 Emoji 的图标处
- **方案**：全部使用 Lucide React 线条图标（项目已有依赖）
- **替换清单**：
  - 搜索：`<Search>` 替代 `🔍`
  - 通知：`<Bell>` 替代 `🔔`
  - 下拉：`<ChevronDown>` 替代 `▾`
  - 新建：`<Plus>` 替代文字 `+`
  - 导出：`<Download>` 替代纯文字
  - 分页：`<ChevronLeft>` / `<ChevronRight>` 替代 `‹` `›`

### 8. 表格全部列左对齐

- **涉及文件**：`DataTable.tsx`（默认对齐方式）、各页面列定义中的 `render` 函数
- **改动**：移除列配置中 `text-align:right` 样式，所有列默认左对齐
- **备注**：通过 DataTable 的 `th` 和 `td` 默认样式统一控制

### 9. 统一等线字体，不用等宽

- **涉及文件**：`index.css`（排版工具类）、各页面中 `font-mono` / `fontFamily: 'SF Mono'` 的引用
- **改动**：
  - 移除数字和单号上的 `font-mono` 等宽字体
  - 全局统一使用系统等线字体：`-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei`
  - `.text-doc-code` 相关的等宽字体类保留（代码展示场景除外）
- **效果**：数字渲染更清晰，与中文混排更协调

## 不改的内容

- 蓝色主色 `hsl(221 58% 47%)` 不变
- 布局结构（顶栏 + 多标签）不变
- 所有功能按钮保留
- 状态 Badge 组件保留
- 暗色模式不变

## 实施顺序

1. 先改 `index.css` 和 `tailwind.config.js`（改动 1/2/4/5/9，一次性生效全局）
2. 改 `DataTable.tsx`（改动 8，列对齐）
3. 改 `FilterCard.tsx` 和各页面筛选区（改动 3）
4. 重构 `TableActionsMenu.tsx`（改动 6，SplitButton）
5. 全局替换 Emoji 为 Lucide 图标（改动 7）
