# v0.9.26 发布结果（2026-09-19）

## 结论

v0.9.26 已发布并验证：`release:verify` **10/10 项一致**。

| 项目 | 值 |
|---|---|
| 发布提交 | `3cb68de`（三端 + PDA 版本号、本版说明、官网摘要） |
| 实际部署 SHA | `3cb68de`（`Deploy Browser App` 同一提交，success） |
| tag | `v0.9.26` → `3cb68dedb53f9d358544a6ebb5a8ebc5a4b40275` |
| GitHub Release | `v0.9.26`，附件 `Jixu-Flow-Setup-0.9.26.exe` |
| 桌面清单 | `latest.json=0.9.26`，sha256 `d5e80966b0d3…` |
| PDA | `0.9.26` / versionCode `134` / 可下载 |

本版内容：资金看板「账户余额分布」改为只显示余额最高的 8 个账户 + 「其他 N 个账户」（配色只有 8 种，此前全量成扇区时颜色重复、无法分辨）；同时加固发布与运维链路上四处「偶发失败且看不出原因」的环节——部署磁盘预检失败改为打印实际余量、桌面发布中转目录退出即清、SSH `known_hosts` 建立带重试、备份恢复演练临时卷改具名并在启动前幂等清理。详见 `docs/release-notes/0.9.26.md`。

## 同批带出的改动

本版一并发布了此前已合入 `main` 但未发版的多项运维与文档改动：只读服务器诊断入口（`server-diagnostics.yml`）、恢复演练残留卷修复（7 个孤儿卷约 1.55G 的根因）、`AGENTS.md` 文档体系重构（130.6 KB → 21.5 KB，全文件进入默认注入预算）。

## CI 结果（同 SHA `3cb68de`）

| workflow | 结果 |
|---|---|
| Tests | success |
| Security Scan | success |
| Deploy Browser App | success |
| Build Desktop Installer（push 验证构建） | success |
| Build Desktop Installer（`v0.9.26` tag 发布） | success |
| Build PDA APK | success |

PDA 前置条件在发版前已核对：`backend/apk/version.json`（0.9.26 / 134）与 `frontend/android/app/build.gradle`（versionName 0.9.26 / versionCode 134）一致，且线上当时仍是 0.9.25 / 133，因此 `preflight` 不会跳过构建。

## 说明与观察

- **本次五个 workflow 一次全过**：前几轮曾因服务器 SSH 间歇不可用、磁盘余量不足而连续失败，`known_hosts` 重试与磁盘预检自解释正是本版修复项，本版是它们的首次全链路验证。
- **与发版无关的失败**：`d35c437`（Dependabot `vite` 8.3.0 PR 分支 `dependabot/npm_and_yarn/frontend/main/vite-8.3.0`）的 Tests / Security 失败属于该依赖升级 PR，不在 `main` 上，与本版无关（该升级在 `docs/dependency-upgrade-2026-09-18.md` 中记录为「刻意保留」）。
- GitHub Release 附件名是历史品牌名 `Jixu-Flow-Setup-0.9.26.exe`，而服务器权威包（`latest.json` 指向）为 `FlowCube-Setup-0.9.26.exe`：两者是不同产物（Release 附件 vs 更新清单指向的包），历来如此，不影响客户端更新。
