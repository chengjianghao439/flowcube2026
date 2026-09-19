# 分布类图表系列上限：财务看板饼图漏改（2026-09-19）

## 缺陷

财务看板（`/finance/dashboard`，页面标题「资金看板」）的「账户余额分布」饼图把接口原始数组直接喂给
`<Pie>`：

```tsx
<Pie data={data.accounts} dataKey="balance" nameKey="name" ...>
  {data.accounts.map((a, i) => <Cell key={a.id} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
</Pie>
```

`PIE_COLORS` 只有 **8** 个颜色（`frontend/src/pages/finance/dashboard/index.tsx`），而本机开发库
`finance_accounts` 有 **94** 个启用账户：切片数等于账户数，颜色从第 9 个开始重复，第 1 个与第 9 个
切片同色，读者无法判断哪块是哪个账户；94 项图例同时把饼图挤成一条线。

同一份「Top N + 其他」口径在 `frontend/src/components/dashboard/widgets/ChartWidgets.tsx` 里早就落地
（`TOP_SERIES_LIMIT = 8`；`ChartWarehouseStock` → 「其他 N 个仓」、`ChartAccountBalance` → 「其他 N 个账户」），
AGENTS §9 也写明「分布类图表（各仓库存价值分布、账户余额分布）统一 `TOP_SERIES_LIMIT = 8` + 「其他 N 个」，
不得按主数据条数全量成系列」。**但这条规则当时没有任何机械约束**：没有测试引用 `TOP_SERIES_LIMIT` 或
`ChartWidgetShell`，三处分布图表各自抄一份 IIFE，漏抄一处不会有人发现——本次就是漏抄的那一处。

同类缺陷的形态：**规则写在 AGENTS 里、实现靠人记得照抄，于是同一个口径在多处实现并漂移。**

## 修复

1. 抽出唯一实现 `frontend/src/lib/topSeries.ts`：
   - `export const TOP_SERIES_LIMIT = 8`；
   - `limitTopSeries(all, { value, makeRest })`：按 `value` 降序排序，超过上限时取前 8 项并把其余合并为
     一个聚合项（`rest` 与 `restValue` 交给调用方构造，名称文案与需要守恒的派生字段如饼图 `share` 由调用方给出）。
     入参不被就地修改（入参是 React Query 缓存数据）。
2. 三处调用点全部改走该函数：`ChartWidgets.tsx` 的 `ChartWarehouseStock`、`ChartAccountBalance`，以及
   财务看板饼图。
3. 财务看板饼图的「其他 N 个账户」切片使用中性色 `OTHER_ACCOUNT_COLOR`（`hsl(var(--muted-foreground))`），
   不再轮回到 `PIE_COLORS[0]` 与第一个账户同色；聚合项的 `share` 取被合并账户占比之和，tooltip 语义不变。

## 验证

**行为（`frontend/src/lib/topSeries.test.ts`，vitest，CI `前端单元测试 — vitest` 步骤执行）**：8 个用例覆盖
上限常量、≤8 不追加聚合项、94 → 9（含聚合项文案与 id）、合计守恒、聚合项 `rest` 可见性、入参不可变、
0/1/9 边界、同值稳定排序。

**机械契约（`npm run test:chart-series-limit` = `node --test tests/chart-series-limit-contract.test.js`）**，
5 条断言：

| 断言 | 防的是什么 |
|---|---|
| `const TOP_SERIES_LIMIT = <数字>` 只能出现在 `lib/topSeries.ts` | 各页面再抄一份常量与切片逻辑 |
| 每个 `<Pie>` 的 `data` 必须来自 `limitTopSeries(...)` 返回值（或直接调用） | 本次缺陷本体；`data={data.accounts}` 这类裸 API 数组 |
| 两个点名的分布卡片（各仓库存价值分布、账户余额分布）仍存在且 `data` 有界 | 页面改名后守卫静默失效 |
| 「其他 `${rest.length}` 个仓 / 个账户」文案仍在 | 退化成静默截断（只显示前 8 个、其余凭空消失） |
| 豁免表（当前为空）项必须被命中 | 表腐烂成「什么都豁免」 |

**反向验证（三种破坏都必须让守卫失败，已实测）**：

| 破坏 | 结果 |
|---|---|
| 饼图 `data={accounts}` 改回 `data={data.accounts}` | exit=1 ✓ |
| 在 `ChartWidgets.tsx` 再写一份 `const TOP_SERIES_LIMIT = 8` | exit=1 ✓ |
| 删掉「其他 N 个账户」文案改成静默截断 | exit=1 ✓ |

第一版守卫在第一条反向验证上**没有失败**：判据用了 `\baccounts\b`，而 `.` 也是词边界，
`data.accounts` 中的属性名被当成了有界变量。现改为「标识符不得是成员访问的属性名」后才拦住。
这条反向验证本身再次证明：**没被破坏性验证过的守卫等于没有守卫**。

## 影响范围与边界

- 纯前端呈现口径，不涉及库存/账款事实；接口返回值未变，导出与 `summary.totalBalance` 合计不受影响
  （饼图只用前 8 + 「其他」，悬停仍显示各自金额与占比）。
- `ChartWidgets.tsx` 两处行为不变（仅改为复用同一函数）：原来「先排序再判上限」与现在
  「`limitTopSeries` 内排序再判」等价，且都返回排序结果。
- 未覆盖：真实浏览器下的视觉核对（本机 Node 26 前端单测有既有 `localStorage is not available` 假失败，
  与本次改动无关；饼图切分数与配色已在单测层面锁定，运行时仍建议在开发库 94 账户环境下目视一次）。
