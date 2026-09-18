# SQL 标识符插值守卫（2026-09-18 全仓审视）

本文记录一次「抛开文档自述、直接读代码」的全仓审视中，与 **SQL 标识符插值**有关的部分：
发现、修法、守卫和验证证据。现行规则已写入 `AGENTS.md` 第 5 节与 §11.1 防呆清单。

## 1. 审视范围与方法

不依赖 `AGENTS.md` 的自述，直接对代码做机械扫描，逐项核对「文档声称」与「实际」：

| 维度 | 结论 |
|---|---|
| 规模 | 后端 349 文件 / 52,867 行；前端 609 文件 / 75,663 行；测试 107 文件 |
| TODO/FIXME/HACK | 0 处真实遗留（4 处命中是 `OP_TODO_KEY` 变量名） |
| `eslint-disable` | 19 处，16 处是 `react-hooks/exhaustive-deps`（合理），无为过门禁而屏蔽 |
| `console.log` | 10 处，全部在 `migrate.js`/`db.js`/`logger.js`/`app.js` 的启动日志，非调试残留 |
| 孤儿测试 | **0**（107 个测试文件全部被 `package.json`/CI 或其它测试引用） |
| 孤儿组件 | 5 个初判未引用，核实后 4 个是 `lazy(() => import(...))` 动态加载、1 个是文档明确保留的 `landing-preview` |
| 文档引用 | `AGENTS.md` 的 75 个 `docs/*.md`、52 个 `npm run` 脚本引用 **0 失效** |
| 空 `catch` | 27 处，抽查 4 处均为**合理降级**（阈值缓存失败用默认值、refresh token 统一 401、会话解析失败返回空、队列失败计数） |
| 依赖漏洞 | 后端 `npm audit --omit=dev` **0 vulnerabilities** |
| 迁移/路由/模块计数 | 252 迁移文件、62 路由文件、62 模块，与文档一致 |
| 测试覆盖 | 62 个后端模块中仅 `customer-addresses` 未在测试文本中出现（未深挖） |

真正收敛出问题的是**动态 SQL 的标识符插值**。

## 2. 问题：值有占位符，标识符没有

本仓大量使用「表名/列名由代码传入、值走 `?` 占位」的动态 SQL（约 390 处模板插值）。
这种写法本身没问题，但**标识符无法参数化**——值用 `?` 保护不了表名与列名，注入面只能靠白名单校验。

审视时全仓只有 `backend/src/utils/statusTransition.js` 有 `assertSqlIdentifier`，且是**文件内私有**的。
逐个追插值表达式的来源后，确认了 7 个文件、12 个标识符插值点缺少校验：

| 文件 | 插值点 | 性质 |
|---|---|---|
| `utils/statusTransition.js` | `lockStatusRow` 的 `columns` | **真缺口**：同文件的 `table`/`statusColumn`/`extraSet` 键都有校验，唯独漏了这个 |
| `utils/codeGenerator.js` | `generateMasterCode` 的 `table`、`codeField` | **真缺口**：直接插进 FROM 与列引用；调用方当时全是字面量，但本仓有 `code_prefix_*` 配置驱动编码的先例 |
| `price-change.service.js` | `applyApprovedPrice` 的 `column` | **真缺口**：`create` 入口（`:83`）挡了非法 `price_type`，审批通过路径读的是库里历史值，没有独立守卫 |
| `search.service.js` | `ent.table`、`noField`、`subtitleField`、`columns` | 来自文件内 `ENTITIES`/`DETAIL_FIELDS` 常量注册表（49 字段已机械验证全合法），属预防性收口 |
| `scan-logs.service.js` | `buildLogReadFilter` 的 `alias`、`dateColumn` | 调用方传 `'sl'`/`'scanned_at'` 字面量，属预防性收口 |
| `carriers.binding.js` | `remove` 里 for-of 字面量数组的 `table` | 同上 |
| `price-lists.service.js` | `findCustomerPrice` 的 `field` | 来自 `fieldMap` 白名单映射，属预防性收口 |

**没有发现可利用的注入**——所有调用点传的都是字面量或常量映射。但「同类守卫有、新增入口漏一个参数」
正是本仓历次审计反复出现的病根，所以按「不给后来者留口子」收口，而不是等出事。

## 3. 修法

新增 `backend/src/utils/sqlIdentifier.js`，把校验做成公共能力（避免像 `carriers.guards.js` 那样「照抄两份、注定漂移」）：

- `assertSqlIdentifier(value, label)`：`/^[a-zA-Z_][a-zA-Z0-9_]*$/`，非法抛 `AppError(500, INTERNAL_CONFIG)`
  （属程序员错误/配置缺陷，不是用户输入错误，不该报 4xx）。
- `assertSqlColumnList(value, label)`：允许 `*`，或逗号分隔的 `col` / `alias.col`。

`statusTransition.js` 改为复用公共实现（原来那份私有函数删除），其余 6 个文件各自在插值点之前加校验。

## 4. 守卫：`npm run test:sql-identifier`

`tests/sql-identifier-contract.test.js`（纯静态，已进 Tests CI 的 regression job）：
扫描 `backend/src` 全部 SQL 模板里的标识符型插值，要求每个点在**它所属函数的范围内**有一次
`assertSqlIdentifier` / `assertSqlColumnList`，或命中三种**可机械验证**的安全形式：

1. 硬编码三元白名单：`const table = type === 2 ? 'sale_orders' : 'purchase_orders'`
2. `for (const table of ['sale_orders', ...])` 字面量数组
3. 文件内定义的箭头函数参数（如 `const pendingTask = alias => ...`，调用点也在同文件）

**不接受「一句话豁免」**——每条豁免都必须能被正则检查，否则它会悄悄腐烂（沿用
`test:route-permission-contract` 的豁免策略）。当前实测：27 个标识符插值点，13 个已校验、14 个命中安全形式、0 未决。

## 5. 写这个测试时踩的两个坑（值得复用）

1. **扫描器自身的漏检**：源码里转义的反引号（`` FROM \`${table}\` ``）会被 /`` `[^`]*` ``/
   当成模板结束符，把模板切成碎片；碎片里往往没有 SQL 关键字，于是插值被整段跳过。
   第一版就因此**看不见 `generateMasterCode` 的 `${table}`**——反向验证（删掉校验）当时竟然通过。
   修法是扫描前用等长占位符替换 `\``（不影响行号），提取时还原。**修好后立刻多扫出 4 个点**，
   并暴露出一处此前完全看不见的未决点（`price-change.service.js`）。
   教训：**反向验证不只是验证被测代码，也在验证测试自己有没有盲区**。
2. **`JOIN` 误报**：`SQLISH` 最初含 `JOIN`，把 `fields.join('')`（ZPL 光栅化，与 SQL 无关）
   当成了 SQL。改用 `\bJOIN\s+[A-Za-z_]` 并要求模板含 `FROM`/`INTO`/`UPDATE`/`DELETE` 之一。

## 6. 连带修复：改 require 依赖会打到 vm 沙箱测试

给 `search.service.js` 加新依赖后，`test:search-all-dates` 立刻失败：

```
TypeError: assertSqlIdentifier is not a function
```

该测试用 `vm.runInNewContext` 加载服务源码并通过 stub 的 `require` 只替换数据库边界，
新依赖不在 stub 里 → 拿到 `undefined`。

处理方式是**修测试的 stub**（把真实的 `sqlIdentifier` 传进去，它本来就是纯函数，
测试理应走真实校验），**不是**为了过门禁而弱化业务代码或放宽校验。
这与 `AGENTS.md` §11.1 最后一条「改共用函数或路由契约后跑全量套件」是同一类风险。

## 7. 验证证据

- 新增契约测试：27 个标识符插值点、0 未决。
- **反向验证（回退必失败）**：分别删掉 `statusTransition.columns`、`generateMasterCode.table`、
  `price-change.column`、`search.columns`、`scan-logs.alias` 的校验，契约测试各报 **1 条 FAIL**；
  恢复后回到 0 失败。
- `sqlIdentifier` 单元行为：合法标识符/列清单 11 个通过，注入串（`1abc`、`a-b`、`` `x` ``、
  `id; DROP TABLE x`、`a.b.c` 等）15 个全部拒绝且错误形状为 `INTERNAL_CONFIG`。
- 后端 ESLint 0 错；受影响的离线测试（`test:search-all-dates` 3/3、`test:direct-express` 50/50）通过。

## 8. 未做与限制

- 本轮的契约测试只覆盖**后端**（`backend/src`）。前端不写 SQL，无需覆盖。
- 「白名单映射」这类形态（`PRICE_COLUMN[type]`、`fieldMap[level]`）不在三种可机械验证形式里，
  因此这些点走的是**显式校验**而不是豁免——如果将来出现第 4 种高频安全形态，应扩展 `SAFE_FORMS`
  并同步本文与 `AGENTS.md`，而不是往豁免清单里塞一句话。
- 生产是否受影响：这些插值点在修复前都只有字面量/常量输入，**不构成既成风险**；
  收口的意义是防止未来改动把配置值或外部输入引进来。
