# 弹窗内日期日历被裁切/错位修复（2026-09-18）

本记录对应 2026-09-18 用户截图反馈：`财务 → 现结客户账款 → 查询 → 创建日期` 打开日历后，日历的月份表头与星期行被裁掉，浮层跑到查询弹窗左上角并盖住「关联单号 / 客户 / 状态」等条件。修改在本地开发模式复现并验证，未发布、未做桌面端与 PDA 验收。

## 现象与几何证据

- 复现环境：本地开发模式（`localhost:5173` + `localhost:3000`），视口 1280×633。
- 修复前：查询弹窗（`[role=dialog]`）位于 `x=304, y=98, w=672, h=438`，带 `translate-x-[-50%] translate-y-[-50%]` 与 `overflow-y-auto`；日历浮层为 `position: fixed`，Radix 计算的 `transform: translate(24px, -148px)` 以弹窗为原点，实际 `y=-45`，即整块日历被弹窗上沿裁掉，只剩底部日期与「清除/今天」可见。
- 与用户截图的差异只是窗口高度不同（浮层在弹窗内的落点不同），裁切量与定位错误同源。

## 根因

1. `PopoverContent` 的定位策略是 `fixed`。正常情况下它的包含块是视口，祖先的 `overflow` 裁不到它。
2. `DialogContent` 用 `translate-x/y-[-50%]` 居中，transform 使弹窗成为 fixed 后代的包含块：浮层坐标改以弹窗为原点，同时被弹窗的 `overflow-y-auto` 按弹窗边界裁切。
3. Radix 的碰撞检测默认参考最近的裁剪祖先（`clippingAncestors`），于是即使浮层可以溢出错位显示，也会被判成"放不下"而翻到弹窗外。

## 现行行为

- `frontend/src/components/ui/dialog.tsx`：`DialogContent` 居中改为 `inset-0 m-auto h-fit` + 既有 `max-h-[calc(100dvh-2rem)]`/`overflow-y-auto`，去掉 `translate-x/y-[-50%]`；进场/退场动画只保留 fade + zoom，去掉依赖 translate 的 `slide-in-*`/`slide-out-*`。弹窗仍居中，超长内容仍按 `max-h` 滚动。
- `frontend/src/components/ui/popover.tsx`：`PopoverContent` 显式把碰撞边界设为视口（`collisionBoundary=[]`、`collisionPadding=8`、`sticky="always"`），不再按带 `overflow` 的弹窗内容框判定；仍然**不使用 Portal**。
- 不使用 Portal 是刻意保留的：Portal 到 `document.body` 后，外层 Dialog 的 FocusScope 会把焦点抢回弹窗，浮层的 FocusScope 立刻判定焦点移出并 `onDismiss`，实测日历"一闪即关"（同一秒内 `onOpenChange(true)` 紧跟多次 `false`）。
- `frontend/src/components/shared/DatePicker.tsx`：日历外层增加 `max-h-[var(--radix-popper-available-height)]` 的滚动容器，底部「清除/今天」用 `shrink-0` 常驻。视口足够时（1440×900）日历 388px 完整展示、不出现滚动；视口偏矮时只滚动日历本体，不把表头或按钮切掉。

## 本次验证（本地开发模式实测）

- 视口 1440×900，`现结客户账款 → 查询 → 创建日期`：输入框 `y=476..512`，日历浮层 `x=409, y=88..476, height=388`，月份表头、星期行、六行日期与「清除/今天」全部可见，无内部滚动。
- 视口 1280×633：浮层被夹在视口内（`y=10..343`），日历本体滚动、「清除/今天」常驻，不再出现表头被切。
- 视口 1000×420：查询弹窗 `x=240, y=21, 520×378`，横竖都居中；日历浮层 `y=6..254` 完整落在视口内。
- 视口 1200×420，操作日志详情（`max-w-4xl max-h-[90vh]`）：弹窗 `152,21,896×378` 居中，`scrollHeight 634 > clientHeight 376`，滚动仍可用。
- 交互：点日历中的 15 号后输入框写入 `2026-09-15`、浮层关闭、查询弹窗保持打开；「清除」清空为 `""`；「今天」写入 `2026-09-18`；「查询」后弹窗关闭并生成条件标签「创建日期：2026-09-18」，列表按条件重新查询。
- 其他浮层回归：通知中心 Popover（`x=696, y=45, 420×460`，右对齐到铃铛）正常打开、内容完整。
- 代码级：`vitest run` 81 个文件 393 项全部通过（新增 `frontend/src/components/ui/dialog.test.tsx` 两项守卫生效）；`tsc -p frontend/tsconfig.app.json --noEmit`、修改文件 ESLint、`npm --prefix frontend run build` 均通过。

## 未验证与限制

- 未验证 Electron 桌面端窗口、PDA、深色主题与 Safari/WebView；未发布，线上仍是旧行为。
- 本次只处理 `ui/dialog.tsx` 的 `DialogContent`。`AppDialog` 本就不用 transform 居中（内部用 `left/top` 计算），不受此问题影响；若以后有组件给 `DialogContent` 传自定义 transform 类，需要重新评估。
- 日历在视口高度不足以完整显示时依靠日历区域自身滚动，未做"缩减月份行高/只显示部分周"的自适应。
