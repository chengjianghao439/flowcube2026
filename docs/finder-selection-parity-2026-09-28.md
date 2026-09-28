# 客户 / 供应商 Finder 的选中一致性对照（2026-09-28，**只读取证，未批准修改业务代码**）

> **范围**：`CustomerFinder` / `SupplierFinder` / 通用 `FinderModal`。
> **状态**：只读取证 + 最小方案（**未改其业务代码**）。
> **背景**：商品 Finder 的同类缺陷已修，见 `docs/finder-stale-cache-investigation-2026-09-28.md`。

## 一、代码事实（修复前的商品 Finder 对照）

- 通用 `frontend/src/components/finder/FinderModal.tsx`：`selected` 由**外部传入**（**整行对象**）；页脚 `<Button disabled={!selected} onClick={onConfirm}>确认选择</Button>` —— **只判"有没有选中"**；另提供 `onConfirmRow`，源码注释写明「双击行时直接以该行数据确认，**绕过 selected 状态**」。
- `CustomerFinder.tsx` / `SupplierFinder.tsx`（二者结构一致）：`const [selected, setSelected] = useState<Row|null>(null)`；`useEffect(() => { if (!open) { …; setSelected(null) } }, [open])` ⇒ **只在关闭时清空**；`handleKeywordChange` **只改 keyword/searchText，不调 resetSelection**；`handleConfirm`（页脚）用 `selected`；`onConfirmRow`（双击）用**当前 row**。

## 二、很窄对照取证（真实 `CustomerFinder` + 真实 `FinderModal`，**4/4 通过**）

在 `/tmp` 独立副本运行（只 mock 数据 hook 与 `AppDialog`），**未提交**：

| # | 场景 | 结果 |
|---|---|---|
| ① | 选中「客户甲」→ 数据更新为「客户甲改名」（同 id）→ 页脚「确认选择」 | 回传 **「客户甲」（旧对象）**；**双击**回传 **「客户甲改名」（当前行）** |
| ② | 选中「客户甲」→ 数据变为不含该行（只剩「客户乙」）→ 页脚确认 | **按钮仍可用**，回传 **列表之外的「客户甲」** |
| ③ | 选中后 `isFetching = true`（加载中）→ 页脚确认 | **按钮仍可用** |
| ④ | 选中后修改搜索关键词 | **选中未被清空**，页脚确认仍可用 |

## 三、与商品 Finder 的守卫差异

| 守卫 | 商品 Finder（已修） | 客户 / 供应商 Finder |
|---|---|---|
| 选中对象来源 | **从当前列表派生**（只存 `selectedId`） | 存**整行对象快照** |
| 选中行须在当前列表 | ✅（派生为 null ⇒ 禁确认） | ❌ 无 ⇒ 可回传**列表之外**的对象 |
| 加载中禁确认 | ✅（`!pending`） | ❌ 无 ⇒ 加载中仍可确认 |
| 搜索变化清空选择 | ✅（`resetSelection`） | ❌ 无 |
| 双击以当前行确认 | ✅ | ✅（`onConfirmRow`） |

## 四、A / B / C

- **A（已实测、未修）**：客户/供应商 Finder 的**页脚确认**会回传**过期或已不在当前列表**的行对象；**加载中也可确认**；**搜索不清空选中**。
- **B（未量化）**：这三处的**实际业务影响未量化**。注意其回传字段是 `id / name / code / contact / phone`（**不是价格**），陈旧值多为名称或联系方式，且通常是"用户刚刚看到的那条"，风险量级低于商品参考价 —— **不得据此直接外推为与商品 Finder 同级问题**。
- **C（非缺陷）**：双击 / Enter 以当前行确认是**正确设计**；关闭时清空选中同样正确。

## 五、最小方案（**待批准，未实施**）

与商品 Finder 同范式，**只动这两个具体 Finder**；**通用 `FinderModal` 是否改需单独评估**：

1. `CustomerFinder` / `SupplierFinder`：`selected` 改为**只存 `selectedId`**，由当前 `data.list` 派生（行不在 ⇒ 派生 `null` ⇒ 页脚自动禁用）；**搜索变化时 `resetSelection()`**。
2. `FinderModal`：页脚禁用条件由 `disabled={!selected}` 收紧为 `disabled={!selected || isLoading}` —— 这会**影响所有调用方**，须先列出调用清单再决定（可能更适合让调用方传 `canConfirm`）。
3. 回归：真实组件测试，把上表 ①②③④ 的断言**翻转为期望行为**（页脚回传当前行 / 行不在则禁用 / 加载中禁用 / 搜索清空选中）。

## 六、边界（如实）

- **未修改任何业务代码**；对照测试在 `/tmp` 副本运行、**未提交**。
- **未列出** `FinderModal` 的全部调用方，也未评估收紧页脚条件对它们的影响。
- 未做真实浏览器取证（纯组件层）。
