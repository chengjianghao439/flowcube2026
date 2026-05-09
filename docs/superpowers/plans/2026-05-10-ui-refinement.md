# UI 细节优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持布局结构和配色方案不变的前提下，对 FlowCube 前端进行 9 项视觉优化：减小圆角、去阴影、筛选区简化、表头去大写、背景微灰、SplitButton 操作列、Emoji 换 Lucide 图标、表格全左对齐、统一等线字体。

**Architecture:** 自底向上实施——先改全局 CSS 变量和 Tailwind 配置（一次性影响全部页面），再改共享组件（DataTable、FilterCard、TableActionsMenu），最后逐页面清理列定义中的对齐/字体/Emoji 引用。PDA 子系统保持不动。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + shadcn/ui + Lucide React

---

### Task 1: 全局 CSS 变量和 Tailwind 配置

**Files:**
- Modify: `frontend/src/index.css:7-8,13-14,122`
- Modify: `frontend/tailwind.config.js:77-81`

修改 5 项全局设计 token：圆角、阴影、表头样式、背景色、排版工具类。

- [ ] **Step 1: 修改 `--radius` 和 `--background` CSS 变量**

在 `frontend/src/index.css` 中：

```css
/* 第 7 行，改圆角：0.5rem → 0.375rem */
--radius: 0.375rem;

/* 第 8 行附近，改背景：纯白 → 极淡灰 */
--background: 220 14% 97%;  /* 约 #f8f9fa */
```

- [ ] **Step 2: 改 `.card-base` 去阴影**

在 `frontend/src/index.css` 第 122 行：

```css
/* 原来 */
.card-base { @apply rounded-2xl border border-border bg-card shadow-sm; }

/* 改为 */
.card-base { @apply rounded-lg border border-border bg-card; }
```

- [ ] **Step 3: 改 `.text-table-head` 去大写**

在 `frontend/src/index.css` 第 101 行：

```css
/* 原来 */
.text-table-head { @apply text-xs font-medium uppercase tracking-wide text-muted-foreground; }

/* 改为 */
.text-table-head { @apply text-xs font-medium text-muted-foreground; }
```

- [ ] **Step 4: 验证 CSS 改动**

运行前端 dev server，确认：
- 页面背景变为极淡灰
- 卡片圆角变小
- 卡片无阴影

```bash
cd frontend && npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: 全局样式优化 — 圆角8px、去阴影、表头去大写、背景微灰"
```

---

### Task 2: DataTable 去阴影 + 全左对齐

**Files:**
- Modify: `frontend/src/components/shared/DataTable.tsx:205,228-261,308-321`

- [ ] **Step 1: 去掉 DataTable 容器上的 shadow**

```tsx
// 第 205 行，原来
<div className="rounded-xl border border-border bg-card overflow-hidden">

// 改为
<div className="rounded-lg border border-border bg-card overflow-hidden">
```

- [ ] **Step 2: 所有 th 改为 text-left**

```tsx
// 第 240 行，原来
className={`px-4 py-2.5 text-left text-table-head ${...}`}

// 保持不变 —— 已经是 text-left
```

确认所有 `th` 元素中 `text-left` 保持不变。

- [ ] **Step 3: 所有 td 默认 text-left**

检查第 311 行的 td className，确保没有 `text-right` 强制：

```tsx
// 第 311 行，确保默认左对齐
className={`px-4 text-foreground align-middle ${...}`}
```

默认情况下表格单元格会继承左对齐，不需要显式设置。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/DataTable.tsx
git commit -m "style: DataTable 去阴影、圆角8px、确保左对齐"
```

---

### Task 3: FilterCard 简化 + 各页面筛选区去卡片包裹

**Files:**
- Modify: `frontend/src/components/shared/FilterCard.tsx:51`
- Modify: 各页面筛选组件（约 19 个文件，见下方列表）

FilterCard 默认模式去掉外层卡片样式，让筛选控件直接展示在页面上。折叠模式保留但外层样式同步简化。

页面文件列表：`customers/index.tsx`, `warehouses/index.tsx`, `payments/index.tsx`, `stockcheck/index.tsx`, `products/index.tsx`, `suppliers/index.tsx`, `transfer/index.tsx`, `locations/index.tsx`, `inventory/index.tsx`, `users/index.tsx`, `racks/index.tsx`, `returns/index.tsx`, `picking-waves/index.tsx`, `inbound-tasks/index.tsx`, `carriers/index.tsx`, `purchase/index.tsx`, `sorting-bins/index.tsx`, `reports/reconciliation.tsx`, `settings/barcode-print-query/index.tsx`

- [ ] **Step 1: 简化 FilterCard 默认模式**

```tsx
// FilterCard.tsx 第 51 行，原来
<div className={cn('rounded-xl border border-border bg-card px-4 py-3 shadow-sm', className)}>
  <div className="flex flex-wrap items-center gap-2">{children}</div>
</div>

// 改为（去掉圆角、阴影、背景、边框，只保留 flex 容器）
<div className={cn('flex flex-wrap items-center gap-2', className)}>
  {children}
</div>
```

- [ ] **Step 2: 简化 FilterCard 折叠模式**

```tsx
// FilterCard.tsx 第 58 行，原来
<div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>

// 改为
<div className={cn('rounded-lg border border-border bg-card', className)}>
```

- [ ] **Step 3: 更新 SaleFilters 去掉外层 FilterCard 包裹**

检查 `frontend/src/pages/sale/components/SaleFilters.tsx` 已经使用 FilterCard：

```tsx
// 当前 SaleFilters 返回了 FilterCard 包裹的内容
// FilterCard 简化后自动生效，无需额外修改
```

- [ ] **Step 4: 验证**

运行 `npm run dev`，打开销售管理页面，确认筛选区控件直接显示在页面上，不再被卡片包裹。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/FilterCard.tsx
git commit -m "style: FilterCard 简化 — 默认模式去外层卡片包裹"
```

---

### Task 4: TableActionsMenu 重构为 SplitButton

**Files:**
- Modify: `frontend/src/components/shared/TableActionsMenu.tsx`
- Modify: `frontend/src/pages/sale/components/SaleRowActions.tsx`
- Modify: 其他页面的 RowActions 组件（purchase, transfer, returns, stockcheck, inbound-tasks 等）

将现有的「主按钮 + 更多按钮」两个独立按钮，合并为一个 SplitButton（主按钮 + 下拉箭头合并在同一组内）。

- [ ] **Step 1: 重构 TableActionsMenu 组件**

```tsx
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// ... 保留 TableActionItem 和 TableActionsMenuProps 接口定义不变 ...

export default function TableActionsMenu({
  primaryLabel, onPrimaryClick, primaryVariant = 'default',
  primaryDisabled = false, items,
}: TableActionsMenuProps) {
  const visibleItems = items.filter(item => !item.disabled)

  if (visibleItems.length === 0) {
    return (
      <Button size="sm" variant={primaryVariant} disabled={primaryDisabled} onClick={onPrimaryClick}>
        {primaryLabel}
      </Button>
    )
  }

  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        disabled={primaryDisabled}
        onClick={onPrimaryClick}
        className={cn(
          'px-3 py-1.5 text-xs font-medium border-r border-border/60 transition-colors',
          primaryVariant === 'outline'
            ? 'bg-transparent text-foreground hover:bg-muted'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        {primaryLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={primaryDisabled && visibleItems.every(item => item.disabled)}
            className="px-1.5 py-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {visibleItems.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.disabled}
                className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
                onClick={item.onClick}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
```

- [ ] **Step 2: 精简 SaleRowActions 中 primaryLabel 为两个字**

```tsx
// SaleRowActions.tsx 中的 primaryLabel 调整：
// status=1（草稿）："占用库存" → "占用"
// status=2（已确认）："发货" → "发货"（已两字）
// status=3（已发货）："查看任务" → "查看"
// status=4（已完成）："详情" → "详情"（已两字）
// 其他："详情" → "详情"

// 同时 primaryVariant 改为 'default'（蓝色实心），关键操作用蓝色突出
// 已完成/已取消等状态的 primaryVariant 改为 'outline'
```

- [ ] **Step 3: 更新其他页面的 RowActions（以采购为例）**

同理精简 `frontend/src/pages/purchase/components/PurchaseRowActions.tsx` 的 primaryLabel：
- 草稿：`primaryLabel="编辑"`, `primaryVariant="outline"`
- 已提交：`primaryLabel="收货"`, `primaryVariant="default"`

其他模块（transfer, returns, stockcheck, inbound-tasks）按同样模式处理。

- [ ] **Step 4: 验证**

```bash
cd frontend && npm run dev
```

打开销售管理、采购管理等页面，确认操作列显示为 SplitButton，下拉菜单正常工作。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/TableActionsMenu.tsx frontend/src/pages/sale/components/SaleRowActions.tsx
git commit -m "feat: 操作列重构为 SplitButton — 主按钮精简为两字"
```

---

### Task 5: ERP 页面 Emoji 替换为 Lucide 图标

**Files:**
- Modify: `frontend/src/components/shared/GlobalSearch.tsx:7`
- Modify: `frontend/src/pages/reports/warehouse-ops.tsx:135-138`

只改 ERP 侧，PDA 保持不变。

- [ ] **Step 1: GlobalSearch 中 TYPE_ICON 替换**

```tsx
// GlobalSearch.tsx，引入 Lucide 图标
import { Package, Factory, User, ShoppingCart, Truck } from 'lucide-react'

// 原来
const TYPE_ICON: Record<string, string> = { product:'📦', supplier:'🏭', customer:'👤', purchase:'🛒', sale:'🚚' }

// 改为 —— 这里不在 JSX 中直接渲染组件，调整为映射到组件
const TYPE_ICON_COMPONENT: Record<string, typeof Package> = {
  product: Package,
  supplier: Factory,
  customer: User,
  purchase: ShoppingCart,
  sale: Truck,
}
```

然后在渲染处将字符串改为 `<IconComponent className="size-4" />`。

- [ ] **Step 2: warehouse-ops.tsx KpiCard 图标替换**

```tsx
// 引入 Lucide 图标
import { Layers, BarChart3, AlertTriangle } from 'lucide-react'

// 原来
<KpiCard icon="🗂️" ... />
<KpiCard icon="📊" ... />
<KpiCard icon="⚠️" ... />

// 改为（KpiCard 组件需支持 ReactNode 类型的 icon prop）
<KpiCard icon={<Layers className="size-5" />} ... />
<KpiCard icon={<BarChart3 className="size-5" />} ... />
<KpiCard icon={<AlertTriangle className="size-5" />} ... />
```

检查 KpiCard 组件定义，确认 `icon` prop 类型是否支持 ReactNode。若当前只支持 string，需扩展类型。

- [ ] **Step 3: 验证**

确认全局搜索弹窗中图标正常显示，仓库运营看板中 KPI 卡片图标正常。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/GlobalSearch.tsx frontend/src/pages/reports/warehouse-ops.tsx
git commit -m "style: ERP 页面 Emoji 替换为 Lucide 线条图标"
```

---

### Task 6: ERP 页面表格列全部左对齐

**Files:**
- Modify: 各 ERP 页面 index.tsx 中的列定义（约 15+ 个文件）

将金额、状态、数量、时间、操作等列的 `text-right` 改为默认左对齐。

- [ ] **Step 1: 销售管理页面**

`frontend/src/pages/sale/index.tsx` 的 columns 定义中，移除所有 render 函数中的 text-align:right 样式。检查 `render` 返回值的 className，将 `text-right` 改为不指定对齐。

```tsx
// 金额列（第 120-122 行），render 中未显式设置 text-right，className 中无 text-right，保持不变

// 状态列（第 125-140 行），render 中未显式设置 text-right，保持不变

// 创建时间列（第 142 行），render 中未显式设置 text-right，保持不变

// 操作列（第 143-163 行），render 中 SaleRowActions 组件内部无 text-right，保持不变
```

实际情况：DataTable 列定义中的对齐主要由列数据本身的 render 控制，不是通过 DataTable 的 th/td className。检查 render 返回的 JSX 即可。

- [ ] **Step 2: 逐页面检查并修改**

用 grep 查找所有 ERP 页面中 `columns` 定义里的 `text-right`：

```bash
grep -rn "text-right" frontend/src/pages/ --include="*.tsx" | grep -v "pda/"
```

将发现的 `text-right` 移除（PDA 页面除外）。主要涉及：
- `inventory/overview/index.tsx` — 数量列、操作列
- `reports/index.tsx` — 金额列、数量列
- `sale/form/index.tsx` — 表单内的金额列
- `purchase/form/index.tsx` — 表单内的金额列
- `stockcheck/components/CheckDetailDialog.tsx` — 数量列

逐一移除 `text-right` 或替换为 `text-left`。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/
git commit -m "style: ERP 表格列全部左对齐"
```

---

### Task 7: ERP 页面数字列去掉等宽字体

**Files:**
- Modify: 各页面列定义中 `font-mono` 的使用（仅数字/金额/日期列）
- 保留：表单中 code 字段的 `font-mono`（如仓库编码、客户编码等）

- [ ] **Step 1: 销售管理页面**

`frontend/src/pages/sale/index.tsx` columns 中：
- 单号列 render（第 117 行）：`text-doc-code` → 改为普通 `text-sm`
- 金额列 render（第 122 行）：去掉 `tabular-nums`

```tsx
// 原来（第 117 行）
render: v => <span className="text-doc-code">{String(v)}</span>

// 改为
render: v => <span className="text-sm font-medium text-primary">{String(v)}</span>
```

- [ ] **Step 2: 逐页面检查并修改**

查找 ERP 页面 columns 中的 `font-mono` / `text-doc-code` / `tabular-nums`：

```bash
grep -rn "font-mono\|text-doc-code\|tabular-nums" frontend/src/pages/ --include="*.tsx" | grep -v "pda/" | grep -v "code\|Code\|编码\|编号\|单号\|\.code\|productCode" 
```

主要修改：
- 金额列的 `font-mono` / `tabular-nums` → 去掉
- 日期列的 `font-mono` → 去掉
- 数量列的 `font-mono` → 去掉
- **保留**编码/单号列的 `font-mono`（用户要求单号不用等宽，但编码类如 customer code、product code 仍保留可读性）

修正：用户说"整个页面都改为等线字体"，所以单号列也应该去掉等宽字体。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/
git commit -m "style: 表格数字/日期/单号列去掉等宽字体，统一等线"
```

---

### Task 8: 全局验证

- [ ] **Step 1: 启动 dev server 并检查关键页面**

```bash
cd frontend && npm run dev
```

检查以下页面：
1. `/sale` — 销售管理（最完整的验证页面）
2. `/purchase` — 采购管理（SplitButton 是否正常）
3. `/inventory` — 库存管理（筛选区 + 表格）
4. `/dashboard` — 仪表盘（背景色、卡片样式）
5. `/products` — 商品管理（筛选区去卡片）

- [ ] **Step 2: 检查 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

确保无类型错误。

- [ ] **Step 3: PDA 子系统不受影响**

打开 `/pda` 确认 PDA 页面样式正常，Emoji 保留，布局无异常。

- [ ] **Step 4: Commit（如有遗漏修复）**

```bash
git add .
git commit -m "chore: 全局验证 UI 优化，修复遗漏"
```

---

### 文件变更汇总

| 文件 | 任务 | 改动内容 |
|---|---|---|
| `frontend/src/index.css` | 1 | `--radius`, `--background`, `.card-base`, `.text-table-head` |
| `frontend/tailwind.config.js` | 1 | borderRadius 同步调整 |
| `frontend/src/components/shared/DataTable.tsx` | 2 | 去阴影、圆角 8px |
| `frontend/src/components/shared/FilterCard.tsx` | 3 | 默认模式去卡片包裹 |
| `frontend/src/components/shared/TableActionsMenu.tsx` | 4 | SplitButton 重构 |
| `frontend/src/pages/sale/components/SaleRowActions.tsx` | 4 | primaryLabel 精简为两字 |
| `frontend/src/pages/purchase/components/PurchaseRowActions.tsx` | 4 | 同上 |
| 其他 RowActions 组件 | 4 | 同上 |
| `frontend/src/components/shared/GlobalSearch.tsx` | 5 | Emoji → Lucide |
| `frontend/src/pages/reports/warehouse-ops.tsx` | 5 | Emoji → Lucide |
| 各 ERP 页面 columns 定义 | 6, 7 | 去右对齐、去等宽字体 |
