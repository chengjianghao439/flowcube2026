# 成套配件商品资料对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用户要求成套资料与商品资料一致、编码自动生成；已确认进价和 A/B/C/D 售价独立维护，空售价按系统加价率计算。

**Architecture:** 成套主档继续引用真实商品的不可变组成版本，不建立虚拟库存。主档新增 categoryId/supplierId/unit/spec/color/articleNumber/costPrice/remark；版本保存四档价格，referenceUnitPrice 保持价格 A 兼容别名。新销售根据客户价格等级选择当前版本价格，成交后沿原商业组快照，不追改历史。

**Tech Stack:** Express/CommonJS/mysql2/zod、MySQL 8、React/TypeScript/Vitest。

## 已确认契约与范围

- `POST /kits` 不要求客户端编码，服务端在创建事务内调用 `generateMasterCode(conn,'K','kit_definitions')`。兼容旧客户端的 `code` 字段但忽略其指定值；`PUT` 不改已有编码。撞号须用新事务重新取号，稳定创建键仍重放原结果，失败不能留下主档、版本或回执。
- 新资料表单使用名称、分类、供应商、基本单位（默认“套”）、型号、颜色、供应商型号、进价、A/B/C/D、备注、启停及组成。类别/供应商复用现有 Finder；不复制普通商品的实物批次/安全库存等开关到无库存套主档。
- API 字段命名与 Product 一致。Create 输入价格均可省略，提供 `costPrice` 时按现行 `loadPriceRates`/`computeTierPrices` 计算空档；用户明确输入包括 0 须原样验证四位精度和范围。旧 API 仅有 `referenceUnitPrice` 时仍可创建，旧版 B/C/D 为 NULL 时回退旧 A，不从未知进价猜值。`referenceUnitPrice` 与 `salePriceA` 同传而不等时拒绝。
- Profile 新增字段兼容旧资料空值，categoryName/supplierName 批量 JOIN 回显；新表单须完善必填项。校验引用为启用未删类别/供应商。单位只是成交单位名称，套数量继续为整数、组件单位与真实数量规则保持。
- `282_kit_product_profile.sql` 为唯一新迁移；不改 269–281。按列元数据条件增加字段，FK 单独幂等核名字/列序/引用 schema。主档新增元数据、版本新增 nullable sale_price_b/c/d，A 沿 reference_unit_price；既有版本不重写。
- 编辑只变元资料沿主档 revision；任一价格或组成变更生成新版本。只改套价时复制原组件参考，禁止重新采样商品 A 价。全量返回 top-level salePriceA/B/C/D 与 version 中同名档价格；costPrice 在主档。
- 列表搜索覆盖 code/name/spec/color/article_number；名称、分类、供应商、单位、型号、颜色、进价及四档可查看。版本与请求恢复、来源绑定、复制后重载保护保持。
- 本轮在 `codex/kit-product-profile` 本地实现、验收、精确路径提交；新发布需用户另行授权。

## Task 1：服务端资料与编码

**Files:** backend/src/modules/kits/{kits.contracts.js,kits.service.js,kits.profile.js}, backend/src/database/282_kit_product_profile.sql, tests/kits-profile.test.js, tests/kits-foundation.smoke.test.js。

- [x] 先加实际契约/纯价格例：`definition.parse({name:'组合',costPrice:10,components:[...]})` 不带 code；空四档产生 11/12/13/14，明确 0 保持，五位小数拒绝；旧 reference A 回退一致。
- [x] 跑红→实现→绿；真实 HTTP 补创建/重放/并发唯一号/旧码不可改/字段往返/版本冻结/过期 revision/引用失效/失败回滚和迁移重跑形状。注册本轮精确 ID 并按来源清理，禁全表清空。
- [x] 测试接既有 `test:kits-composition` 和 `smoke:kits-foundation` CI 入口，根脚本/CI 接线由 root 统一修改。

## Task 2：资料表单、DTO、列表

**Files:** frontend/src/types/kits.ts, frontend/src/pages/kits/{KitEditor.tsx,kitDraft.ts,kitDraft.test.ts,index.tsx}, 新建实际 KitEditor 组件回归。

- [x] 先验证无需 code 可创建、无法编辑生成编码、商品资料字段/空档生成提示、提交正确字段、后台刷新不覆盖草稿。
- [x] 类型新增字段保持历史 fixture 兼容；draft `price` 对应 A，新增 B/C/D 字符串，新增资料项。新建提交省略 code；编辑提交也省略 code。组成没变省略 components。未修改或数值等值的售价档位省略，避免把历史 B/C/D 的 NULL 显示回退误写成新版本。新建验证商品资料必填；旧数据首次补齐后同样正常保存。
- [x] 共享 Category/Supplier Finder 增加可选读取上下文，默认调用不变；本编辑器的商品选择、设置率和资料选择读取固定来源、会话与活动代次。列表展示和搜索口径更新；保留 pending、同键重试、备份失效及显式重载规则。执行受影响组件/载荷回归、app 类型和改动文件 lint。

## Task 3：销售与交付核对

**Files:** backend/src/modules/sale/sale.commercial-resolver.js, tests/sale-commercial-contracts.test.js（或既有商业专项）, frontend/src/types/sale-commercial.ts、商业报价/单位展示相关既有组件及测试；docs/backend-api-sql-conventions.md、docs/business-semantics.md、docs/frontend-pda-conventions.md、docs/verification-commands.md。

- [x] 默认价格读取 version 对应客户 A/B/C/D（NULL 仅回退 A），手工价保持；元资料成交单位写 metadata.kitUnit，新单读当前资料，旧成交组没有字段回退“套”。
- [x] 先红→绿证明客户 B 默认、0 档、手工价、历史保留及单位快照，不把客户端传价当权威默认。普通商品价目表流程保持。
- [x] root 统一检查 diff、运行受影响离线/真实数据库最小回归；准备发布前才做统一全量。独立规格和品质复核后提交明确路径，记录已验证与待统一验证/现场验证。

验收依据见 `docs/verification-commands.md` 的2026-10-07成套资料段；所有步骤为本地交付，发布/全量门禁及现场边界沿该记录。
