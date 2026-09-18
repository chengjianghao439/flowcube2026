# v0.9.24 发布结果（2026-09-18）

## 结论

v0.9.24 已发布并验证：`release:verify` **10/10 项一致**。

| 项目 | 值 |
|---|---|
| 发布提交 | `ccc1de0`（版本号 + 说明 + 官网摘要） |
| 实际部署 SHA | `f48ddf3`（含下述两个 CI 修复） |
| tag | `v0.9.24` → `f48ddf3` |
| GitHub Release | `v0.9.24`，附件 `Jixu-Flow-Setup-0.9.24.exe`（112,367,363 bytes） |
| 桌面清单 | `latest.json=0.9.24`，sha256 `773debc12ddd…` |
| PDA | `0.9.24` / versionCode `132` / 可下载 |

本版内容：`role_id` 列对齐 BIGINT（预防角色数超 255 后写不了权限）+ 采购计划与工资单改批量写入。详见 `docs/release-notes/0.9.24.md`。

## 发布过程中发现并修复的两个 CI 缺陷

本版首发被**两个基础设施缺陷**连续拦下，两者都只在 CI 偶发，与业务改动无关（同一批代码本地 `smoke:mainline` 49/49 通过）。

### 1. 镜像归档上传超时（首次部署，`exit code 124`）

首次部署只跑 **11.5 分钟**就失败，线上仍是旧版。外层上限 40 分钟、Deploy 步骤上限 70 分钟**都没到**——真正超时的是 `deploy-browser.yml` 里上传 `flowcube-images.tar.gz` 的 `timeout -k 10 600 scp`。

根因：这是 v0.9.17 记录过的**同一个慢盘根因**。`scripts/server-update.sh` 里的 `docker load` 当时已放宽到 1800 秒，**但上传这一步仍是 600 秒——只改了一个环节**。失败信息指向外层，与真正的内层罪魁对不上，极易误判为"部署整体太慢"。

修复：上传 600→**1800 秒**、Deploy 步骤 70→**105 分钟**、job 130→**165 分钟**；`tests/deployment-resources.test.js` 新增机械守卫，钉住两处时限一致、且步骤/job 预算真的容得下（已反向验证：改回 600 秒即失败）。

### 2. 测试服务端口随机撞上 MySQL 的 3306

第二次失败换成了 `EADDRINUSE: address already in use :::3306`，而第一次是 `TypeError: fetch failed`——两次表象与失败步骤都不同。

根因：`tests/helpers/smokeTestKit.js` 用 `3100 + Math.floor(Math.random() * 1000)` 自选测试 HTTP 服务端口，而**该范围包含 3306**（CI 的 MySQL 端口），随机命中即冲突（约 1/1000）；它启动时又没指定 host，可能只绑到 IPv6 `::` 而 baseUrl 固定走 `127.0.0.1`，在非 dual-stack 环境下表现为 `fetch failed`。其余 10 个 smoke 套件一直是 `app.listen(0, '127.0.0.1')`，只有它不一致。

修复：改为 `app.listen(0, '127.0.0.1')`，端口从 `server.address().port` 取，并补 error 监听（端口异常明确失败而非挂起到超时）；同样加机械守卫 + 反向验证。

> 顺带修正一处守卫写法：源码文本契约测试"先去注释"时**只能剔整行注释**——按 `//` 全剔会把 `http://127.0.0.1` 字面量的后半行一起砍掉，导致断言自我误报（本次实测遇到）。

## 验证记录

| 项目 | 结果 |
|---|---|
| Tests（`f48ddf3`） | success |
| Security Scan | success |
| Deploy Browser App | success |
| Build Desktop Installer（tag 触发） | success |
| Build PDA APK（`checkout_ref` 补跑） | success |
| `release:verify` | 10/10 一致 |

本地补充验证：`smoke:mainline` 49 passed / 0 failed（迁移 253 在本机 `flowcube_test` 正常执行且幂等）；`deployment-resources.test.js` 15 passed（含两个新守卫）；`test:agents-md-guard`、`test:sql-identifier`、`test:frontend-date-source`、`test:landing-updates`、`test:permissions`、`test:acceptance-fixes`、`test:sql-placeholder` 全部通过。

## 已知限制（未在本次解决）

- **浏览器部署与 PDA 构建仍共用 `flowcube-server-deploy` 并发组**，PDA 的 build job 内含「等本提交浏览器部署」，PDA 先拿到组时会互等。本次沿用既定处置：`gh run cancel <pda-run-id>` 让路 → 等浏览器部署 success → 打 tag → 用 `checkout_ref=f48ddf3` 补跑 PDA。彻底解法（把 PDA 发布拆成只让发布阶段占组的独立 job）仍待专门一轮实施与验证。
- `detect-desktop` 类 Release 保持 `isDraft=true`，与本仓库历史各版一致（附件已就位、`latest.json` 已发布，桌面端可正常检测到更新）。
