# 商品 Finder 陈旧缓存的取证与修复（2026-09-28）

> **范围**：`docs/export-filters-fix-2026-09-27.md` §22.5 B 里的**商品 Finder**（`ProductFinderModal`）。
> **状态**：先只读取证，后经 Codex 接受两个 A 项并**实施窄修复**（`staleTime:0` + `selectedId` 派生）。
> **不含**：客户价/权限/生产迁移；**不把"缓存陈旧"本身夸大成"成交价错误"**。

## 一、被测链路（代码事实）

- `frontend/src/components/shared/ProductFinderModal.tsx`：`open ? <ProductFinderContent key={`${mode}-${warehouseId}`} /> : null` ⇒ **关闭即卸载**；**没有** `refetchOnMount:'always'`。
- `frontend/src/hooks/useProducts.ts`（`useProductFinder`）：`useQuery({ queryKey:['products','finder',p], enabled })` ⇒ **无 `staleTime` 覆盖** ⇒ 用全局 **5min**；**全仓仅 `ProductFinderContent` 一个调用点**。
- 参考售价列显示 `product.salePrice`；后端 `findForFinder`（`backend/src/modules/products/products.service.js`）把它映射为 **`sale_price_a` 优先、无 A 才回退 `sale_price`**。
- 选中态（修复前）：`selected` 存**整行对象**；`canConfirm = selected && !pending && !query.isError && products.some(p => p.id === selected.id)`；页脚 `onClick={() => confirm(selected)}`，行 `onDoubleClick={() => confirm(product)}`。
- 销售单侧（`frontend/src/pages/sale/form/useSaleOrderForm.ts`）：`handleFinderConfirm` 先置 `unitPrice = product.salePrice ?? 0`，随后 `if (cid) lookupPrice(...)` **实时取价**；取到 `salePrice > 0` ⇒ **覆盖**并记 `priceSource:'list'`；否则 ⇒ `'当前客户未设置有效价格，请手动确认单价'`；**请求抛错** ⇒ `'价格查询失败，请手动确认单价'`。

## 二、真实界面取证（修复前；隔离库 + 本地栈）

夹具：商品（`sale_price_a=100`）、客户、供应商。**未保存任何真实销售单**。

| 场景 | 结果 |
|---|---|
| 打开销售单 → 商品 Finder（首次 `GET /api/products/finder` 200）→ 参考售价 **¥100.00** | ✅ |
| 关闭 Finder → HTTP 改 `sale_price_a` 100→150 → **5 min 内重开并重复搜索同一关键词** | 参考售价仍 **¥100.00**，**网络零 finder 请求** ⇒ **陈旧确认** |
| 选中该行 → 页脚「确认选择」 | 订单行**单价 = 100**、来源「默认价格」（= 回传**旧对象**） |
| 填客户（实时取价 `GET /api/price-lists/customer-price` 200） | **单价被覆盖为最新价**、来源「价格表定价」⇒ **取价成功时不沿用旧参考价** |
| 无有效价夹具（价格全 0，接口返回 `salePrice:0`） | **提示「当前客户未设置有效价格，请手动确认单价」+「确认当前单价」按钮**（不静默沿用旧价） |

> **注**：`CustomerFinder` 双击对照属组件层证据（见下节），**不在**本表内 —— 本表的真实浏览器动作只有上述几条。

## 三、组件层证据（真实 `ProductFinderModal` + 真实 `QueryClient`）

回归：`frontend/src/components/shared/ProductFinderModal.stale-cache.test.tsx`（6 例，与生产同 `staleTime 5min`，只 mock 边界接口）。

**原实现（修复前）跑：3 红 / 3 绿** ——
- 红：**重开后重复搜索同一关键词**（该关键词只请求 1 次）、**A→B→A**（回到 A 不重取）、**refetch 后页脚「确认选择」回传旧对象**（100）；双击与 Enter 同因。
- 绿：延迟响应期间禁确认、选中行被移除后禁确认、查询出错禁确认 —— 这三条**原实现已正确**。

> **口径声明**：本回归**早期**曾出现 5 红，其中两条源于**测试自身夹具误点**（用 `tbody tr` 行数等待，命中了加载/空态那一行）。**该早期结果不作为业务反证**；最终正确版本为上述 **3 红 3 绿**。

## 四、修复（已实施）

1. **`useProductFinder` 局部 `staleTime: 0`**（唯一调用点；**全局默认不变**）。理由：`refetchOnMount:'always'` **只作用于「挂载」**，覆盖不到同一次挂载内的 key 变化（重开后再搜原关键词、A→B→A）。
2. **`ProductFinderContent` 只存 `selectedId`**，`selected` 一律**从当前 `products` 派生**；摘要/高亮/**页脚确认**/**双击**/**Enter** 全部走当前行；`canConfirm = selected != null && !pending && !query.isError`（行不在列表 ⇒ `selected` 为 null ⇒ 禁确认）。**无 effect 同步、无新框架**，不改已加入订单的行、不改客户取价。

**验证**：
- 反向验证：摘掉 `staleTime:0` ⇒ **仅**「重开重复关键词」「A→B→A」2 例变红；恢复 ⇒ **6/6**。
- 相关专项（Node 22 单条命令）：新增 Finder 回归 **6/0**、既有 Finder `ProductFinderModal.test` **3/0**、`useSaleOrderForm`（销售取价/校验）**20/0**，另加 orderEntry 校验、改价失效合计 **36/0**（Codex 独立复跑一致）。
- `tsc -p frontend/tsconfig.app.json --noEmit` 与改动文件 eslint 均 rc=0。

## 五、修复后真实浏览器复验

- 关闭 → 外部改 `sale_price_a` 100→150 → **5 min 内重开并重复搜索同一关键词** ⇒ 参考售价 **¥150.00**（修复前为 100），且重开发起了 **2 次** finder 请求（挂载 + 关键词）。
- 选中该行 → 页脚「确认选择」⇒ 明细单价 **150**（当前值）。

## 六、A / B / C 分类（按证据强度）

- **A（已实测、已修）**：重开 / 重复搜索原关键词 / A→B→A 显示**旧 A 参考价**；页脚「确认选择」回传**过期对象**（双击与 Enter 回传当前值）。
- **B（未量化）**：`staleTime:0` 带来的请求量增加**未实测**（Finder 是显式打开的选择器，每次改关键词/重开多一次请求）。
- **C（合理设计，非缺陷）**：无有效价 ⇒ **明确要求人工确认**；取价成功 ⇒ **覆盖**参考价；**「选中行被移除后禁止确认」是正确守卫**（不列为 A）。

## 七、口径纠正（据独立审查，勿再沿用旧表述）

- 全局 `refetchOnWindowFocus: false` ⇒ **`staleTime:0` 不会开启"窗口重新聚焦取数"**；先前"窗口重新聚焦都会取数"的说法**有误，已删**。
- 「选中行被移除后确认禁用」**属 C（正确守卫）**，**不是** A。
- 客户取价的**请求抛错**分支目前只有**代码/组件证据**；真实浏览器实到的是**无有效价**分支 —— 两者**分开**陈述，不合并。

## 八、边界（如实）

- **未保存任何真实销售单**（只验证到 Finder 选中与草稿行单价）；夹具仅隔离测试库且已按 ID 自洁。
- **未评估生产影响规模**；未做发版前全量（只跑受影响专项）。
- 未评价 `CustomerFinder` / `SupplierFinder` 的同类问题（其 `selected` 亦为整行对象、搜索变化不 `resetSelection`、`FinderModal` 页脚仅 `disabled={!selected}` —— **同根因、守卫更弱**），留待后续**很窄对照**（未批准修改其业务代码）。
