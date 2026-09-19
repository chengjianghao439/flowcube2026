# CI 接线缺口排查（2026-09-19）

本文件记录 2026-09-19 一轮「反复挖掘问题」的发现与修复，主题是**同一类缺陷：守卫/套件写了，但没有任何一处会执行它**。这类缺陷在 CI 全绿时完全不可见——不是代码错，而是规则没有被跑起来。

## 结论速览

| # | 缺口 | 影响 | 修复 |
|---|---|---|---|
| 1 | `tests/fulfillment-credit-concurrency.smoke.test.js` 是孤儿测试：无 `package.json` 脚本、无 CI 步骤 | 授权并发（同客户抢额度）回归只在有人手工跑时才生效 | 新增 `smoke:fulfillment-credit`，接入 Tests CI 回归 job 与 AGENTS §3 矩阵 |
| 2 | `scripts/check-deprecated-downloads.js` 存在、`release:check-downloads` 也声明了，但**没有任何 workflow 执行** | 「`backend/downloads/` 已废弃、不得提交发布文件」这条规则无人执行 | 接入 Tests CI 静态 job；并加守卫防它再次失联 |
| 3 | `smoke:atp`（销售预计库存 ATP）未出现在任何 workflow | ATP 是 §7 的核心规则，8 条断言只在手工执行时才跑 | 接入 Tests CI 回归 job（与 `smoke:sale-adjustment` 相邻） |
| 4 | 缺一条通用的「套件必须接进 CI」不变量 | 上面 1–3 会反复重演 | `tests/deployment-resources.test.js` 新增守卫，双向校验豁免表 |

## 逐项证据

### 1. 孤儿测试

扫描口径：`tests/*.test.js` 的文件名是否出现在 `package.json`（含三端）或任一 `.github/workflows/*.yml` 中。

- 首次扫描结果：114 个测试文件，按「文件名被引用」维度为 0 孤儿——因为该测试已被其它方式提及；
- 真正的问题是**可执行入口**维度：`npm run` 脚本与 CI 步骤都没有它。

### 2. 废弃目录守卫

`backend/downloads/.gitignore` 内容为 `*` + `!.gitignore` + `!README.md`，所以：

- 普通 `git status` **看不见**放进该目录的文件 → 守卫的 `git status --porcelain` 分支永远为空；
- 唯一危险路径是 `git add -f`（强制跟踪），此时守卫有效。

反向验证（实测）：

```
$ echo x > backend/downloads/stray.exe && git add -f backend/downloads/stray.exe
$ npm run release:check-downloads
[deprecated-downloads] backend/downloads 已废弃，禁止继续提交或修改发布文件。
 - backend/downloads/stray.exe      # exit 1
```

结论：脚本逻辑正确，缺的只是执行入口。

### 3. ATP 套件

`tests/sale-atp.smoke.test.js` 头部注释写明覆盖迁移 228 的 5 个行为（现货 0 也能按采购预计量占库、记录 `sale_order_expected_bindings`、采购取消 409 `BINDING_SALE_DEPENDENCY`、释放占库后绑定作废、解绑后可取消）。

本机实测（独立测试库）：

```
8 passed, 0 failed        # exit 0
```

它与同 job 里其它 smoke 套件使用同一套 `helpers/smokeTestKit`（`prepareSmokeContext` + 真实 MySQL + 自清理），无需额外环境。

### 4. 通用守卫

新守卫断言三件事：

1. 每个 `smoke:*`/`test:*` 脚本要么 CI 可达（workflow 直接 `npm run`、`matrix.suite`、或按文件 `node --test`），要么在豁免表里并写明理由；
2. 豁免表条目必须仍存在（防僵尸条目）；
3. **已接线的脚本不得留在豁免表里**——防止豁免表腐烂成「什么都豁免」。

当前豁免 5 条，均有可核对理由：`smoke:legacy-receivable-repair`、`test:legacy-receivable-repair`、`smoke:purchase-repair`（都需专用 `flowcube_repair20260908_test` 库且必须串行）、`smoke:pages`、`smoke:reconciliation`（需在线前端/凭据/playwright 的实机验收）。

反向验证（两条方向都必须失败）：

```
撤掉 smoke:atp 的 CI 步骤
  → AssertionError: 这些测试脚本没有任何 workflow 会执行…：smoke:atp
把已接线的 smoke:mainline 塞进豁免表
  → AssertionError: 这些脚本已经接进 CI，豁免条目必须删除：smoke:mainline
```

## 排查过但不成立的线索

避免下次重复排查，一并记录：

- **空 `catch` 块**：后端 350 个 js 文件里只有 6 处，逐条核对均有正当理由（bcrypt 失败后回退 sha256 比较、best-effort 打包进度事件、凭据不外泄、配置缺失时按未知结果处理），无静默吞错。
- **测试文件孤儿**：除第 1 项外，`tests/` 下 114 个测试文件全部有 `package.json` 入口。
- **文档声称的守卫是否在 CI**：AGENTS §3 里 `smoke:warehouse-assets-waves`、`smoke:warehouse-masterdata`、`smoke:masterdata`、`smoke:prelaunch-*` 等确由 `prelaunch-regression` job 的 `matrix.suite` 执行（字面扫描会误报，需展开 matrix）。
- **`check:schema` / `check:schema:strict`**：脚本未在 CI 里以 npm 形式调用，但 CI 直接执行 `node backend/scripts/schema-reconcile.js --strict`，不构成缺口。

## 已知待办（本轮未处理）

- `AGENTS.md` 已达 126,244 字节，离 128 KiB（131,072）硬限只剩约 4.8 KB；一旦超出，`npm run test:agents-md-guard` 会直接失败并阻断全部改动。§10 中数段「事故经过」叙事与 `docs/release-v0.9.17-result.md`、`docs/release-v0.9.20-result.md` 重复，可按 §0.4「本文件保留摘要和路径」的口径下沉到 docs。
- 28 处真实 N+1 查询点（早前缩进扫描结果）尚未处理。
