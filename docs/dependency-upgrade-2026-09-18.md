# 依赖升级记录（2026-09-18）

## 结论速览

| 类别 | 数量 | 处置 |
|---|---|---|
| CI 全绿、可直接升级 | 14 | 已合并进 `eedc5a8`，对应 PR 已关闭 |
| 需专门迁移或有明确不适合理由 | 4 | 保留开放，理由见下（逐项可复核） |

本记录同时回答一个日后必然会被问到的问题：**为什么 zod 还停在 3、vite 还停在 6？**

## 一、已完成的 14 项升级

提交 `eedc5a8 chore(deps): 合并 14 个 CI 全绿的依赖升级`，只改 `package.json` + lockfile，无代码改动。这 14 个 PR 在合并前均为 **19/19 SUCCESS**（Dependabot rebase 后复核过）。

| 端 | 包 | 变更 |
|---|---|---|
| backend | mysql2 | `^3.12.0` → `^3.24.4` |
| backend | @sentry/node | `^10.70.0` → `^10.74.0` |
| backend | globals | `^17.8.0` → `^17.12.0` |
| backend | express-rate-limit | `^7.5.1` → `^8.7.0`（major） |
| backend | eslint | `^9.39.5` → `^10.10.0`（major） |
| frontend | recharts | `^3.7.0` → `^3.10.1` |
| frontend | cross-env | `^7.0.3` → `^10.1.0`（major） |
| frontend | typescript-eslint | `^8.18.2` → `^8.70.0` |
| frontend | @radix-ui/react-dropdown-menu | `^2.1.4` → `^2.1.24` |
| frontend | @sentry/react | `^10.70.0` → `^10.74.0` |
| frontend | core-js | `^3.48.0` → `^3.50.0` |
| frontend | @radix-ui/react-toast | `^1.2.4` → `^1.2.23` |
| frontend | eslint-plugin-react-refresh | `^0.4.16` → `^0.5.6` |
| desktop | electron | `44.2.0` → `44.3.0`（该端精确锁定，无 caret） |

### 两个 major 的实际行为核对（不靠"CI 绿"推断）

- **eslint 9 → 10**：后端 `eslint src/` 干净；前端 0 errors（30 条 `react-refresh/only-export-components` warning，集中在 `components/ui/{badge,button}.tsx` 等 shadcn 风格文件与 4 个页面组件，属既有形态，`exit 0` 不阻断）。
- **express-rate-limit 7 → 8**：实测构造限流器成功，且**用 `max` 不产生任何运行时弃用告警**。v8 的类型定义把 `max` 标为 `@deprecated 7.x`，但明确「不会在可预见的将来移除」。因此**没有**顺手把业务代码里的 `max` 改成 `limit`——保持与 CI 已完整验证的内容一致，避免把「依赖升级」和「代码改写」混在一次改动里。
- **@types/node 26**：见下节，是本轮唯一需要"拒绝"的一项。

### 验证证据（本地，本机 Node 26）

```
两端 lint                 通过（后端 clean；前端 0 errors / 30 warnings）
前端 tsc                  0 错误
前端 build                ✓ built（vite + recharts + core-js 全链路）
npm audit 三端            0 high / 0 critical（frontend 2 moderate，低于阻断阈值）
16 项离线契约测试          全部 PASS
前端 vitest               82 文件 / 409 用例 通过
运维回归（node --test）     41 项 通过
```

推送到 main 后由 CI 的回归 job 用真实 MySQL 跑完整 smoke 矩阵，作为最终判据。

## 二、刻意未升级的 4 项

### PR #39 — zod `3.25.76` → `4.6.2`（暂缓，需专门迁移）

失败检查：`回归门禁（smoke + 集成）`、5 个上线审计专项（masterdata、prelaunch-hr、prelaunch-scope-export、warehouse-assets-waves、warehouse-masterdata）。具体失败步骤为 `smoke:p0-regression`、`smoke:prelaunch-scope-export` 等——**是 DB 支撑的校验链路成片失败**，符合 zod 4 改了校验语义与错误结构的表现（路由层的 schema 全校验不过，业务断言随之失败）。

迁移面（本机实测计数）：`backend/src` 下 **48 个文件**引用 zod；`z.record(` / `.strict()` / `.email()` 这类 zod 4 变更点共 **7 处**。另需确认错误响应结构变化是否影响前端的错误提示消费。

结论：需要单独一轮，先跑通 `test:*` 与全部 `smoke:*`，再改 schema 写法。不适合与依赖批量升级混在一起。

### PR #52 — vite `6.4.3` → `8.3.0`（暂缓，插件生态需协同升级）

失败步骤是 **`安装前端依赖`**，不是类型检查——真实报错：

```
npm error code ERESOLVE
npm error While resolving: @vitejs/plugin-legacy@6.1.1
npm error Found: vite@8.3.0
npm error Could not resolve dependency:
npm error peer vite@"^6.0.0" from @vitejs/plugin-legacy@6.1.1
```

即 `@vitejs/plugin-legacy` 的 peer 仍要求 `vite@^6`，单独把 vite 提到 8 会直接装不上。**真实验证方式是把 vite 与其插件（`@vitejs/plugin-legacy`、`@vitejs/plugin-react`、Tailwind/PostCSS 链、PWA 插件等）一起升到互相兼容的一组**，再跑构建与 `build:pda`。

结论：属协调升级，需要专门一轮。仅看"类型检查失败"会低估工作量——实际连依赖树都装不起来。

### PR #53 — @types/node `22.19.13` → `26.5.1`（不建议采纳）

失败步骤：`TypeScript — 前端类型检查`，共 4 处：

```
error TS2550: Property 'at' does not exist on type '...'. Do you need to change your target library?
  client.refresh.test.ts(147,19)
  FulfillmentTodos.test.tsx(30,36)
  useSaleOrderForm.test.tsx(45,21)
  print-templates/editor.test.tsx(133,51)
```

**不建议采纳的核心理由是运行时与类型不匹配**：项目运行时锁 Node 22（`.nvmrc=22`，`backend engines.node >= 20`），而 @types/node 26 描述的是 Node 26 的 API。用 26 的类型去检查一个跑在 22 上的项目，会放行 22 上并不存在的 API。当前声明 `^22.10.2`（实际 22.19.13）跟随 Node 22 线是正确的。

顺带发现（已在本轮修掉）：这 4 个错误只是"症状"。前端 `tsconfig.app.json` 原为 `lib: ["ES2020", ...]`，而代码里已在 7 处使用 `Array.prototype.at`（ES2022）。它能通过检查，是靠 `@types/node` 的 lib 引用**顺带**提供了这些类型——**对传递依赖的隐性依赖**。已把 `lib` 显式提为 `ES2022`（实测 0 错误、构建不变），使类型检查与运行时一致，不再受 @types/node 版本摆布。

### PR #43 — @zxing/library `0.21.3` → `0.23.0`（暂缓）

失败步骤：`单元测试 — 标签几何及前端镜像（Node 22 实际执行）` 与 `smoke:prelaunch-hr`。

前者与包本身直接相关：该单测会解码标签位图里的条码，`@zxing/library` 0.21→0.23 的 API/识别行为变化会直接影响解码结果。后者（HR）与 zxing 无关，怀疑是夹具顺序或共享测试库状态，不足以单独说明问题，但也不构成"可以直接升"的证据。

结论：需先定位标签解码回归，再评估 0.23 的行为差异。

## 三、可复用结论

1. **"CI 绿"只能证明当时那条分支能跑通，不能替代对 major 跳跃的行为核对**。express-rate-limit 8 就是正面例子：跑得快绿，但仍要实测运行时是否告警，才能决定要不要动业务代码。
2. **失败检查名会误导工作量**。vite 8 的检查名是"静态检查（lint + 类型）"，实际死因却是 `npm ci` 的 ERESOLVE；只按检查名判断，会把"插件生态协调升级"误记成"改几个类型"。
3. **升级前先看清 `engines`/`.nvmrc` 锚点**。@types/node 26 看起来只是 devDependency，实际是"用未来的运行时类型检查今天的运行时"。
4. **`lib` 与 `target` 是两件事**：`lib` 只管类型可见性，`target` 管语法降级与 emit。提高 `lib` 不改构建产物，代价低但能消除对传递依赖的隐性依赖。
