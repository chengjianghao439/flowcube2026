# 普通与成套销售统一开单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 新增销售订单共用一张表单和明细，可同时添加普通商品与成套配件。

**Architecture:** 复用已有 CommercialEditor、权威整单预览与成套成交/真实组件链。标准 `/sale/new` 的纯普通新单转换为原普通创建载荷，含套新单仍提交 kit-v1；旧 `/sale/new-kit` 保留其原模型、标签和恢复身份。历史普通订单与处理来源继续原链，不做模型迁移。

**Tech Stack:** React/TypeScript、React Query、Vitest/jsdom、Express/MySQL8。

用户已确认同单混排并统一入口与明细。本批继续当前隔离工作树，基线 `97bff819c85b6f1afd4d696f24ca5ef0ca0a1e32`。仅本地实现、验收与明确路径提交，未请求新一轮发布。

## Task 1：统一新建入口与来源

**Files:** `frontend/src/pages/sale/form/index.tsx`、`frontend/src/pages/sale/index.tsx`、`frontend/src/pages/sale/commercial/CommercialSalePage.tsx`、`frontend/src/pages/sale/commercial/CommercialEditor.tsx`；新建真实表单路由回归及既有 `reorder.test.tsx`。

- [x] 新测试先证明 `/sale/new` 未出现两类添加按钮，而 `/sale/new-kit` 仍可正常新建；检查同一张真实表单同时保留两类明细及正确保存载荷。保存未知、来源参数非法、隐藏迟到和处理来源保持原回归。
- [x] 把空白与 ordinary 来源再开转入共用新建容器，处理来源分支保持优先：

```tsx
if (isNew && typeof handlingId === 'number') return <HandlingCreateView sourceId={handlingId} tabPath={tabPath} closeTab={closeTab} />
if (isNew) return <NewCommercialSale tabPath={tabPath} onDone={id => { closeTab(); if (id) navigate(`/sale/${id}`) }} sourceId={typeof reorder === 'number' ? reorder : undefined} sourceModel="ordinary" ordinaryOnlySave />
```

`NewCommercialSale` 给重复新建的 `useSaleReorderSource`/`useRepeatSaleCreate` 透传原来源模型，普通源仍 ordinary，旧 new-kit 源仍 kit-v1；不得改原 query scope/key 或解除已有 pending。删普通 RepeatCreateView 及其已无调用的引用，CreateView 留处理来源用途。
- [x] 删除销售列表的「开单方式」及独立成套入口，主按钮仍一次进入 `/sale/new`。共用新建标题统一「新建销售单」，明细普通商品按钮排前、套按钮排后，套行标出成套及真实组件折叠。旧深链路由/权限/标签 key 不改；已有历史订单仍按真实模型打开。
- [x] 原普通来源回归使用真实共同明细 DOM，原身份/0量/可选带量、ABA、KeepAlive、恢复断言保持；API adapter 补合法预览信封，不放开网络。

## Task 2：纯普通创建载荷兼容

**Files:** 新建 `frontend/src/pages/sale/commercial/newSalePayload.ts`、`newSalePayload.test.ts`；`frontend/src/types/sale-commercial.ts`、CommercialEditor 实际保存回归。

- [x] 先在真实 Editor 用 `/sale/new` 验證纯普通保存仍发 commercialModel 的红灯，随后验证辅助单位量价、默认价格、手工价和重复/失配报价的拒绝。
- [x] 新函数 `buildNewSalePayload(body: CommercialBody, preview: CommercialPreview): CreateSaleParams | CommercialBody`：含任一 kit 返回原 body；纯 ordinary 剥 commercial marker/revision/groups，并按 lineKey 找准确同商品、仓库、录入单位和数量的预览 entry 与单组件。不得把组件基本量作为录入量，不用八位展示价倒算成交。只读预览不可被当作已保存事实。

```ts
// default/list 与 manual 都交原 foldEntryItems 再核权威换算；这里的价格是录入单位价。
return { ...head, customerName: body.customerName ?? '', warehouseName: body.warehouseName ?? '', items: matched.map(({ input, group, entry, component }) => ({
  productId: input.productId, productCode: component.productCode, productName: component.productName,
  unit: component.unit, entryUnit: entry.entryUnit, quantity: entry.entryQty, unitPrice: entry.entryUnitPrice,
  priceSource: input.priceSource, resolvedPrice: group.metadata.quote?.referenceUnitPrice ?? null,
  resolvedPriceLevel: group.metadata.quote?.resolvedPriceLevel ?? null,
  warehouseId: input.warehouseId ?? body.warehouseId,
})) }
```

纯普通重复 `(productId, warehouseId)` 拒绝并提示合并量；含套按原商业独立归属+物料汇总。必须有且仅有每个请求组对应预览组，身份/entry/价格缺失或非有限拒绝，不能丢行。
- [x] CommercialOperation 仅 create 分支容许 `CreateSaleParams | CommercialBody`，update/adjust 仍严格 CommercialBody。共享操作 hook/端点/稳定键/原请求冻结与回执不改。
- [x] Editor 在标准新建 `ordinaryOnlySave` 时、保存前基于当前完整预览调用 builder；编辑旧商业单及旧 new-kit 继续原 body。普通来源再开也使用此转换，但保存记录仍绑原来源 ordinary 身份。转换报错可见且保留草稿。

## Task 3：验收、说明与交付

**Files:** `docs/frontend-pda-conventions.md`、`docs/business-semantics.md`、`docs/unified-sale-entry-2026-10-07.md` 与本计划。既有验证命令未新增，继续遵循 `docs/verification-commands.md`。

- [x] 受影响 Vitest 覆盖真实混排/纯普通保存/辅助单位、两种来源、unknown/重挂、旧详情与处理来源；app 类型、触及文件 lint、前端约定、文档引用及 diff 检查。既有套/商业金额专项在本批最终一次运行。
- [x] 独立测试库验证真实 HTTP 普通保存保原模型与量价、含套保存+共享 SKU 汇总及原回执重放；真实浏览器从销售列表主入口添加两类商品、保存并重开，再用纯普通单检查原详情/分仓入口。仅本批拥有资源，准确 ID 清理账号与会话，保留业务审计，关闭本任务浏览器与预览进程并核实。
- [x] 独立规格复核通过后品质复核；修必修项。同步主题文档与准确验证边界，只暂存逐个已核路径、本地提交、核工作区干净。全量发版门禁、生产/真机/物理出纸未执行，不据本地结果声称上线。

## 实施补充与已完成验证

- [x] 标准空白新建绑定服务器、账号、会话、角色与权限的变化代次；同会话正常续签 access token 不冻结草稿，服务器 A→B→A 不复活旧响应。共享写 hook 增加可选归属门，原请求完整体与查询身份仍被冻结。
- [x] 保存/恢复期间标签隐藏再显示，迟到成功保留已保存提示，禁止重复提交，由员工明确查看；来源再开仍使用原来源恢复身份。
- [x] 客户与选品弹窗暂停时保留搜索及页号，恢复重新读取，忽略旧请求；真实 StrictMode 客户选择器回归反向验证失败后还原，修后通过。
- [x] 首次不报校验错，点击保存给客户、仓库、明细的可定位问题；折扣超过金额也可定位。全量前端 243 文件 / 1843 用例通过；类型、lint、ERP 构建及既有成套/商业金额专项通过。
- [x] 独立测试库真实 GUI 保存纯普通与混合单、刷新读取，再用原 HTTP 请求和原键重放，均返回原回执；未产生重复订单/事件/实物明细。临时账号及其令牌族已停用，浏览器会话和两个预览端口已关闭。具体证据及边界见验收记录。
