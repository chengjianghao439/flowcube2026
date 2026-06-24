# 打印模块重构计划（条码模板渲染层 + 编辑器）

> 状态：设计已定稿，待落代码。基线：main @ v0.4.7。
> 本文档是交接锚点——上次重构无文档无提交、思路丢失、改动悬在旧 worktree 的 stash 里，本次以此文档为准。

## 1. 问题

- 条码模板**预览与真机打印不一致**。
- 模板**编辑器难用**，需重写。

## 2. 根因（已在 main 最新代码上核实）

### 2.1 三套渲染几何并存

| 几何 | 位置 | 单位换算 | 字号处理 |
|------|------|---------|---------|
| 编辑器画布 | `frontend/src/pages/settings/print-templates/editor.tsx` | 1mm=5px(`MM_PX`)×zoom | `fs×scale×0.35`px |
| 预览 | `frontend/src/components/print/TemplateRenderer.tsx` | 1mm=3.7795px(96dpi) | `fs×scale`**pt** |
| 真机 ZPL | `backend/src/modules/print-jobs/labelZplTemplate.js` | 1mm=7.9874dot(203dpi) | `fs×203/72`dot，clamp[14,160] |

**注意**：字高其实三套是对齐的（fontSize=10 → 都≈3.5mm）。那个 `×0.35` 魔数本质就是 pt→mm 的 0.3528 近似。所以 pt 是个靠魔数对齐的隐藏中间单位。

### 2.2 真正的不一致来自渲染语义差异（不是单位）

| # | 不一致点 | 预览 | 真机 ZPL |
|---|---------|------|---------|
| 1 | label 前缀 | 渲染"数量：12" | 只渲染"12"（不拼 label） |
| 2 | 加粗 | title `fontWeight:bold` | `^A0N` 永不加粗 |
| 3 | 字宽 | 系统字体自然宽 | `^A0N,h,h` 方块字（宽=高） |
| 4 | clamp | 不限制 | 字号[14,160]dot、条码高[28,120]dot |
| 5 | divider/table | 渲染 | `labelZplTemplate.js:67` 直接 filter 丢弃 |
| 6 | 对齐/换行 | flex+wordBreak 自动换行 | `^FB w,1,0,C` 锁 1 行 |

### 2.3 is_default 陷阱（"改了没变"）

- `print-templates.service.js:99` INSERT **不写** is_default → DB 默认 0
- `:112` UPDATE **不碰** is_default
- 仅显式 setDefault（`:119-120`）置 1
- 而后端 `labelZplTemplate.js:116` 只认 `WHERE type=? AND is_default=1`

→ 编辑器建/改的模板永远 is_default=0，真机取不到 → 改了没变。

## 3. 边界（不动）

- 只重写**渲染层 + 编辑器**。
- 保留 `printers` / `printer_bindings` / `print_jobs` / 桌面端打印链路。
- `print_templates` 表 schema 不改（`layout_json` 是 JSON 列，改其内部结构不算改 schema）。
- `enqueueXxxLabelJob` 签名不改。

## 4. 已定决策

1. **字号单位**：`fontSize`(pt) → `fontHeightMm`(mm)，消灭 0.35 魔数；读取时 normalize 老模板 `pt×0.3528`。
2. **label 前缀**：默认不显（与真机一致），新增 `showLabel` 开关，两端统一遵守。
3. **元素类型**：标签编辑器只留 `text` / `title` / `barcode`，去掉 `divider` / `table`（属单据画布模板，真机本不画）。
4. **is_default**：编辑器保存/新建时自动设为该 type 默认 + 后端查不到 is_default=1 时 fallback 到最近更新的同 type 模板（双保险）。

## 5. layout_json v2 结构

```ts
interface LabelElement {
  id: string
  type: 'text' | 'title' | 'barcode'
  fieldKey: string
  label: string
  showLabel: boolean              // 是否拼 "label：" 前缀，两端统一
  x: number; y: number            // mm
  width: number; height: number   // mm
  fontHeightMm: number            // 替代 fontSize(pt)
  textAlign: 'left' | 'center' | 'right'
  // 去掉 fontWeight（去加粗）
}
interface LabelLayout {
  version: 2
  canvasWidthMm: number
  canvasHeightMm: number
  elements: LabelElement[]
}
```

## 6. 统一几何函数（核心架构）

建一个中性"图元"层 + 一个纯几何函数，预览和 ZPL 都消费它，几何只算一次：

```
resolveLayout(layout, data, paperSize) → DrawPrimitive[]
  每个图元已解析为：绝对 mm 坐标 + 类型 + 最终文本(含 showLabel 拼接) + 条码目标宽高mm + 对齐
前端预览：DrawPrimitive × MM_PX     → CSS
后端 ZPL：DrawPrimitive × MM_TO_DOT → ^FO/^A0/^BC
```

**实现注意**：backend 是 CommonJS、frontend 是 TS/ESM，无现成共享包。`resolveLayout` 写成零依赖纯函数，两端各持一份镜像，用一组"同输入→同输出图元"的快照测试锁死一致性（防两端漂移）。

## 7. 实施阶段（落地状态）

- ✅ **P0 几何核心**（commit a601283）：`backend/.../labelGeometry.js` 的 `resolveLayout` 纯函数 + `normalize`(老→新) + 快照 fixture + node 测试（14 项）。
- ✅ **P1 后端接入**（5dfb34c）：拆出零依赖 `labelZpl.js`，`generateZplFromElements` 改用图元层 ×MM_TO_DOT（字高 mm 与旧 pt 数学等价）；`labelZplTemplate.js` re-export 保持 API；`getLabelZplFromDefaultTemplate` 加 fallback；`print-templates.service.js` 标签 create/update 自动置默认。ZPL 测试 9 项。
- ✅ **P2 前端几何镜像 + 一致性锁定**（26fafc8）：`frontend/src/lib/labelGeometry.ts` 零运行时依赖镜像；`tests/label-geometry-frontend.test.js` 用 Node 类型剥离跑同一 fixture 断言两端逐例相等；`npm run test:label` 接入 CI（node<23.6 优雅跳过）。
- ✅ **P3 编辑器接入**（80c6c01）：标签画布/预览切到统一几何 —— 去 ×0.35 改真实 mm 字高、去加粗、`labelText` 走 showLabel 规则、属性面板「字高(mm)」+「显示标签前缀」开关；新建标签元素带 `fontHeightMm/showLabel`；旧模板回退 `fontSize→mm`。单据(1-4)路径不变。tsc 通过。
- ◑ **P4 验证**：静态验证全部通过 —— 全测试绿（14+9+4）、tsc 0 错误、确认标签几何已收敛单一 `resolveLayout`（编辑器/ZPL 共用，桌面端只 raw 转发，无第三/四套残留）。**待人工**：浏览器看编辑器预览、真机实打一张、CI 集成测试验证 is_default DB 改动（本机无 mysql）。

**已知残差**：真机 ZPL 用 `^A0` 方块字（字宽=字高），编辑器/预览已改用等宽字体（Courier）近似以缓解，但仍非逐字点阵级精确 —— 一行容字数可能略有出入。坐标、字高、文本内容、对齐、label 前缀、加粗、元素过滤等主要不一致点均已统一；条码不受字宽影响。

## 8. 编辑器易用性增强（重构后追加）

为「让标签编辑/预览更好用」追加，均限标签路径、单据(1-4)不受影响，tsc 全通过：

- **拖角改大小**（58765f2）：选中元素 8 向手柄拖拽改尺寸，吸附 1mm、最小 3mm、画布内 clamp；条码可直接拖宽/拖高。方向键移 1mm、Shift+方向键 5mm。
- **撤销/重做 + 复制 + 对齐 + 吸附**（5866f4c）：100 步 history（Ctrl+Z/Y）；Ctrl+D 复制；属性面板六向对齐到画布；拖动吸附参考线（边/中心，阈值 1.2mm）。
- **条码参数 + 等宽预览**（0ce4673）：barcode 码制（Code128/EAN13）+ 可读数字(HRI)开关，贯穿几何层→预览(JsBarcode)/真机(^BC/^BE)；标签预览文本改 Courier 等宽近似真机字宽。

**待人工验收**：以上为前端交互，本机无浏览器/后端环境实跑，仅 tsc 把关，需真机点测。

## 9. 历史残留处理

- 旧重构改动悬在 worktree `condescending-kowalevski-497e78`：工作区 WIP（删 `editor/index.tsx` 等）+ stash@{0}（29 文件）。
- 该分支停在 **v0.3.94，落后 main 109 提交**，基线过旧、与 main 已有打印修复冲突。
- **处置：废弃，仅作思路参考，不复用其代码。** 本次在 main 最新基线重写。
- 提交 `71b3e0a`（"删死码"）从未落盘，无需追。
