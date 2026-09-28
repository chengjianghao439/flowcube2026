# 客户 / 供应商 Finder 的选中一致性：取证与修复（2026-09-28）

> **范围**：`CustomerFinder` / `SupplierFinder` / 通用 `FinderModal`（含 `FinderTable` 的 Space 确认入口）。
> **状态**：先**只读取证**，后经 Codex 授权**实施统一守卫的窄修复**。
> **背景**：商品 Finder 的同类缺陷已修，见 `docs/finder-stale-cache-investigation-2026-09-28.md`。

## 一、代码事实（修复前）

- 通用 `frontend/src/components/finder/FinderModal.tsx`：`selected` 由**外部传入**（**整行对象**）；页脚 `<Button disabled={!selected}>` —— **只判"有没有选中"**；另有 `onConfirmRow` 供双击"绕过 selected 状态"确认。
- `frontend/src/components/finder/FinderTable.tsx` 键盘：`Enter ⇒ onSelect(row)`（**只是选择**）、`Space ⇒ preventDefault + onDoubleClickRow(row)`（**确认**）。
- 两个 Finder（结构一致）：`selected` 存**整行对象**；`useEffect` **只在关闭时清空**；`handleKeywordChange` **不 resetSelection**。
- **调用方核对（Codex 全仓 `rg` 核对）**：`FinderModal` **仅** `CustomerFinder` / `SupplierFinder` 两个调用方；`FinderTable` **仅** `FinderModal` 使用 ⇒ 可在通用组件**统一守卫**，不必写两套补丁。
- **这两个 Finder 的使用方（当前源码，排除 `*.test`）**：`<CustomerFinder>` **9 个实例**、`<SupplierFinder>` **11 个实例**，共 **20 个实例、分布 15 个文件**。**接口形状未变只表示"不必改调用代码"**；本批改动的是**运行行为守卫**（何时可确认、选中是否从当前列表派生），**仍会影响**这些使用方 —— 涉及**付款/核销、采购/销售/退货、查询窗口**等页面，**尚未逐页做运行时 / GUI 验收**（见 §五 B 项）。

## 二、第一轮只读取证（真实组件 + mock 数据 hook，4/4）

| # | 场景 | 结果 |
|---|---|---|
| ① | 选中「客户甲」→ 数据改名（同 id）→ 页脚确认 | 回传 **旧对象**；双击回传**当前行** |
| ② | 选中行已不在当前列表 → 页脚确认 | **按钮仍可用**，回传**列表之外**的对象 |
| ③ | 选中后 `isFetching` → 页脚确认 | **按钮仍可用** |
| ④ | 选中后改搜索关键词 | **选中未被清空** |

> **口径更正**：该轮**只测了 `CustomerFinder`**（且 mock 的是数据 hook），**`SupplierFinder` 当轮未实测**。下节用**真实 `QueryClient` + API 边界 mock 对两个都补测**。

## 三、修复与回归（真实 `QueryClient` + API 边界 mock；两个 Finder **各 9 例**，TDD 阶段为 6 例）

期望行为（修复目标）：①数据刷新（改名 / 联系方式）后页脚与双击都回传**当前行**；②选中行被移除或**停用（`isActive:false`）**后不得确认；③**debounce 期间与请求挂起期间**页脚 / 双击 / Space 都不得确认（**Enter 仍只是选择**）；④查询**出错**时不得确认并给出**可重试**入口；⑤关闭后重开清空选中。

- 回归文件：`CustomerFinder.test.tsx`、`SupplierFinder.test.tsx`（**每个 9 例，共 18**）。
- **TDD（6 例版）**：两个 Finder **各 5 红 / 1 绿**（红=①改名后回传旧值、②行移除仍可确认、③停用仍可确认、④debounce 与挂起仍可确认、⑤错误无重试入口；绿=关闭重开清空）。
- **加强版每个 Finder 新增 3 例**：**独立 debounce 未落定**例（断言"搜索请求尚未发出 + 旧行仍在 + 页脚/双击/Space 均不回调"）、**输入后立即关闭 → 越过 timer 再重开**、**带首尾空格输入**。
- **修复后**：**18/18**。
- **反向验证（均在本最终版上重做，未套用 6 例版结果）**：摘掉 `debouncing` ⇒ **仅**「debounce 未落定」1 例红；摘掉关闭/卸载清 timer ⇒ **仅**「输入后立即关闭」1 例红；把 `keyword !== searchText` 改回 `.trim()` 比较 ⇒ **仅**「首尾空格」1 例红。
- **注意**：先前记录的 Node 22 全量 **142 文件 / 656 用例**是**加强版之前**的数字。本次修正后**只补跑受影响项**（18/18 + `tsc -p tsconfig.app.json --noEmit` + 改动文件 eslint，均干净），**未再跑全量**。

## 四、修复实现（统一守卫，不造框架）

1. **`FinderModal`**：
   - `onConfirm: (row) => void` —— 页脚「确认选择」与行双击/空格**共用同一回调**，映射只由调用方写一次（删掉原来的 `onConfirmRow` 与两处重复映射）；
   - `canConfirm = selected != null && !isLoading && !isError`（页脚）；行确认用 `canConfirmRow = !isLoading && !isError`；
   - 新增 `isError` / `error` / `onRetry` ⇒ 出错时表格区显示可重试的 `QueryErrorState`，**不拿旧 data 确认**；
   - **Enter 不改**（`FinderTable` 仍是 `onSelect`，保持既定键盘语义）。
2. **两个 Finder**：只存 **`selectedId`**；`rows` = 当前**启用**列表（`isActive !== false`）；`selected = rows.find(r => r.id === selectedId) ?? null`；**搜索立刻 `setSelectedId(null)`**；`isLoading = isFetching || debouncing`（debounce 未落定也禁止确认）；透传 `isError` / `error` / `refetch`。
3. **同类边界（独立审查后补，均有反向验证）**：① `debouncing` 用**原始值**比较（`keyword !== searchText`），与定时器提交的原文同语义 —— 早前用 `.trim()` 比较会让带首尾空格的输入**永久 pending**；② 关闭**与卸载**都清 debounce timer（`useEffect` 的 cleanup），否则"输入后 300ms 内关闭"会在重开后把 `searchText` 改回旧词、而 `keyword` 已清空 ⇒ 永久 pending；③ `onSelect` 与页脚/行确认共用同一守卫，pending / 出错时**连"选"都不生效**（避免又把旧行选上）。

## 五、A / B / C

- **A（已实测、已修）**：客户/供应商 Finder 的页脚确认曾回传**过期或列表之外**的行；加载中/出错/debounce 期间也可确认；搜索不清空选中。
- **B（本批未动，另列）**：**客户/供应商自身的 fresh 缓存策略**（是否也需要局部 `staleTime: 0`）—— 本批**不机械扩展**，留待单独评估（**目前无实际业务影响证据**）；请求量代价亦未量化。
- **B（新增，发版前项）**：上述 **20 个使用方实例（15 个文件）的运行时 / GUI 验收** —— 本批只做了**组件层**回归，**未逐页验证其运行行为**（"接口未变"≠"行为不受影响"）。发版前应列入跨端累计验收，重点：**付款 / 核销**（`PaymentQueryDialog`、`SettleReceiptDialog`）、**采购 / 销售 / 退货**（`sale/form`、`SaleOrderHeaderFields` 等）、**查询窗口**（`SaleQueryDialog`、`ProductQueryDialog`）、对账（`portal/statements`）。

> **最终累计专项（Codex 独立复跑，2026-09-28）**：同一条命令内（Node **v22.23.2**）跑 **8 个文件 61/0、exit 0** —— 客户 9、供应商 9、商品 Finder 6、既有 Finder 3、商品编辑 7、销售取价 20、orderEntry 5、改价失效 2。先前记录的"全量 656"**仅对应加强版之前的版本**，不代表最终实现。
- **C（非缺陷）**：`Enter` 只是选择（既定键盘语义）；关闭时清空选中；双击/空格"以当前行确认"是正确设计。

## 六、边界（如实）

- **不改**全局缓存、客户取价、后端；未造新框架。
- 本批为**纯组件层 + 真实 `QueryClient`** 取证与回归，**未做真实浏览器取证**。
- 未评估这些 Finder 使用方（**20 个实例，分布 15 个文件**）的运行时影响规模（**未逐页验收**）。
