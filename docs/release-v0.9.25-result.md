# v0.9.25 发布结果（2026-09-19）

## 结论

v0.9.25 已发布并验证：`release:verify` **10/10 项一致**。

| 项目 | 值 |
|---|---|
| 发布提交 | `fa53598`（三端 + PDA 版本号、本版说明、官网摘要） |
| 实际部署 SHA | `b205507`（含凭证静默漏记修复） |
| tag | `v0.9.25` → `b205507` |
| GitHub Release | `v0.9.25`，附件 `FlowCube-Setup-0.9.25.exe` |
| 桌面清单 | `latest.json=0.9.25`，sha256 `3f39d6567403…` |
| PDA | `0.9.25` / versionCode `133` / 可下载 |

本版内容：三端依赖整体升级（含桌面 Electron 44）、凭证生成不再静默跳过缺日期单据、发布流程构建/等待结构拆分。详见 `docs/release-notes/0.9.25.md`。

## 本版实测：PDA 三段拆分在真实发布中生效

v0.9.24 只完成了 `build-pda-apk.yml` 的结构拆分与 workflow 级验证（当时因为 `preflight` 判定「0.9.24 已发布、跳过构建」，完整产物路径没被走过）。本版是**首次全链路实测**：

- 打 tag 前的 push 触发 4 个 run：`Tests`、`Security Scan`、`Deploy Browser App`、`Build PDA APK`；
- `Deploy Browser App` 先 `pending` 约 9 分钟（在等本 SHA 的 Tests，**不是**在等 PDA 释放部署组），随后正常 `in_progress` → `success`；
- `Build PDA APK` 的 `build-pda`（独立 `build-pda-ci` 组）并行构建、`wait-browser` 只等待不占组、`publish-pda` 在浏览器部署成功后才持锁发布 → 最终 `success`。

也就是说，v0.9.23 那种「浏览器部署长期 pending 且不报错、只能人工 `gh run cancel` 让路」的自锁形态，在本版没有再出现。

## 发布过程中新增的两条守卫（已随本 SHA 通过 CI）

`Tests` 成功即验证了两条新守卫在 CI 中生效：

- `npm run test:eslint-disable-rationale`：每处 `eslint-disable` 必须写明理由，整文件禁用仅限机器产物白名单；
- `npm run test:agents-md-guard` 升级：**断言防呆清单与全部红线关键词必须落在默认注入预算 64 KiB 以内**。此前防呆清单排在 118 KB 文件的末尾，默认预算下 100% 进不了模型上下文——规则写了、代理读不到，且全链路不报错。现已前移为 `§0.1`（起点约 4.2 KB），并把这条从「只告警」升级为「直接失败」（反向验证：挪回文件末尾即失败）。

## 随本版发布的修复：凭证不再静默漏记

`toDateStr` 对「缺少业务发生日期」是**有意 fail-loud**（抛 `ACCT_VOUCHER_NO_DATE`），但 `generateVouchers` 用 `catch { continue }` 把它整个吞掉——该错误码因此全仓只有抛出点，没有消费方也没有测试；凭证静默消失，且 `stats` 连 `total` 都不增加，日志显示「正常生成 N 条」，只有人工对账才可能发现少了一张。

现改为计入 `stats.skippedNoDate` 并逐条 `logger.warn`（带 `sourceType`/`sourceId`/`sourceNo`，便于定位到单据），保留「跳过单条、不整批失败」的既有行为。`tests/accounting-voucher-mapping.test.js` 新增两条断言钉住「不得退回静默 continue」（反向验证：改回 `catch { continue }` 即失败）。

## 验证记录

```
✅ 桌面更新清单版本：latest.json=0.9.25，期望 0.9.25
✅ 桌面安装包路径：url=/versions/v0.9.25/FlowCube-Setup-0.9.25.exe
✅ 桌面安装包摘要：sha256=3f39d6567403…
✅ 桌面更新说明：notes 首行=# v0.9.25
✅ 桌面更新接口版本：/api/app-update/latest=0.9.25
✅ PDA 已发布版本：/api/pda/version=0.9.25
✅ PDA 已发布 versionCode：versionCode=133
✅ PDA 安装包可下载：available=true
✅ PDA 更新说明：releaseNote=本版是**安全与稳定性更新**：三端依赖整体升级…
✅ 生产健康检查：/api/health=ok
核对 https://jixuflow.com：10/10 项一致（期望桌面 0.9.25、PDA 0.9.25/133）
```

同 SHA 的 `Tests`、`Security Scan`、`Deploy Browser App`、`Build Desktop Installer`、`Build PDA APK` 均 success。
