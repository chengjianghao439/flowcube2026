# 其他电脑端页面样式精修 Implementation Plan

> **For agentic workers:** Inline execution in this session; preserve the reviewed commit `93109deb5c922266d49634fa8fdcc817083830b4` and append on `codex/desktop-ibm-style`.

**Goal:** 核实参考增补 CSS，并在不改 TSX、结构、类名或业务行为的前提下修正其他页面族的样式值。

**Architecture:** 只在 `frontend/src/styles/desktop-page-samples.css` 末尾追加有范围和状态条件的规则；保留已有内容逐字一致。颜色、圆角和阴影沿已有令牌，新增浮层圆角令牌限定 ERP。浏览器使用真实 React 路由及仓库外合成 transport，不连接真实业务库。

**Tech Stack:** React / TypeScript / Tailwind / Radix / cmdk / Vite / agent-browser。

---

### Task 1: 源码与级联核对

- [x] 核对分支、干净状态和既有提交；读取项目前端、验收、预览规则。
- [x] 对照 GlobalSearch、Popover、Select、DropdownMenu、ReportTable 的全元素属性及库输出。
- [x] 检索采购、收货、库存、调拨、会计、审批、资金、报表和打印页面的圆角、颜色及状态类，记录已有 utility，避免重复。
- [x] 建立 `docs/desktop-other-pages-review-2026-10-25/selector-audit.json`，区分 TSX、库与实际 DOM 证据。

### Task 2: 样式增补

- [x] 追加全局搜索选中态、分组、底栏及浮层圆角令牌；排除禁用项。
- [x] 面板沿 `--desktop-radius`，同步内嵌表格底角；核实库存已有 tabular-nums 并记录计算样式，不重复 utility。
- [x] 保留与主表一致的浅灰库存表头，不重复 ReportTable 的 tfoot；对额外发现先核实再修正。

### Task 3: 浏览器状态矩阵

- [x] 复用本地合成预览，使用独立会话 `flowcube-other-pages-20261025`。
- [x] 逐路由检查采购列表/表单、收货创建/详情、库存、调拨、账簿/凭证、审批、资金看板、仓库运营和条码查询。
- [x] 对每页记录正常、选中、危险、禁用、空与加载状态；不存在或未触达的状态明确列出，模拟响应与真实操作分开记录。
- [x] 搜索验证 `[cmdk-group-heading]`、`data-selected`、键盘切换与搜索加载/空/失败状态。
- [x] 保存截图与 DOM/计算样式摘要，关闭命名会话并核对 session list。

### Task 4: 最终验证与报告

- [x] `git diff --check`；断言 CSS 原前缀逐字一致、TSX 零差异、增补零 hex；审阅全部 diff。
- [x] 使用 Node 22 执行前端 lint、`tsc -p frontend/tsconfig.app.json --noEmit` 和 Vite 构建到任务临时目录。
- [x] 执行 `test:chart-series-limit`、`test:frontend-conventions` 与 `test:agents-md-guard`，保存退出结果。
- [x] 同步 `docs/frontend-pda-conventions.md` 和 `docs/desktop-other-pages-review-2026-10-25.md`，附逐页状态及未覆盖范围。

### Task 5: 提交与推送

以下为提交后的外部执行清单；事实以最终交付回复和远端完整 SHA 为准，不用提交内的勾选自证同一提交已推送。

- [ ] 列出并核对本轮文件；仅暂存明确路径。
- [ ] 追加提交，推送 `codex/desktop-ibm-style`，不合 main、不打 tag、不发版。
- [ ] 核对远端完整提交哈希、main 和干净状态；交付后停止。
