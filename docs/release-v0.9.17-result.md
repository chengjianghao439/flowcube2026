# v0.9.17 发布结果（2026-09-16）

**三端版本**：0.9.17（PDA versionCode 125）
**发布 SHA**：`303cbaf6`
**发布方式**：push main + `npm run release:tag-desktop`（tag `v0.9.17`）

## 产物核验

| 端 | 核验结果 |
|---|---|
| 浏览器 | `Deploy Browser App` success；服务器已 reset 到 `303cbaf6`，前后端容器重建；**已在生产实测三处修复生效**（全局搜索框不再被自动填充、销售列表默认窗口为 7 天、查询弹窗显示当前日期） |
| 桌面 | `Build Desktop Installer` success；`/api/app-update/latest` 返回 `version=0.9.17` + 本版 notes；安装包 `/versions/v0.9.17/FlowCube-Setup-0.9.17.exe` 可下载（HTTP 200，112,358,203 字节） |
| PDA | `Build PDA APK` success；`/api/pda/version` 返回 `0.9.17` / `versionCode 125` / 更新说明 / 下载链接 + sha256 |

同 SHA 的 `Tests`、`Security Scan` 均为 success（打 tag 前已确认）。

## 发布过程中遇到的问题：CI 并发抢部署锁导致超时

**现象**：首次发布时 `Deploy Browser App` 与 `Build PDA APK` **双双失败**，日志末尾为 `##[error]Process completed with exit code 124`（timeout，在 10 分钟处被强杀）。

**根因**：`push main` 同时触发浏览器部署与 PDA 构建，紧接着打 tag 又触发桌面构建——**三个 workflow 并发 SSH 到同一台服务器，竞争同一把部署锁** `/tmp/flowcube-deploy.lock`（各 workflow 内 `flock -w 300` 只等 5 分钟）。先拿到锁的桌面构建正常完成，后到的等到超时被外层 timeout 杀掉。**不是代码或配置错误**。

**处置**：改为串行重跑——先 `gh run rerun <deploy-run> --failed`（成功，服务器随即更新到 `303cbaf6`），确认后再重跑 PDA 构建（成功）。

**对线上的影响**：无。处置期间后端与前端容器始终正常（`/api/health` 返回 ok、`/api/ready` 200、三个容器 Up），只是前端内容停留在上一版直到重跑成功。

**待办（本次未做）**：让这三个 workflow 之间不并发——例如给部署类 workflow 加 `concurrency` group 串行化，或调整触发时序（先等浏览器部署完成再打 tag）。本次靠人工串行重跑绕过；下次发版若仍并发触发，会重复踩到。

## 另外记录（待核实）

- `https://jixuflow.com/health` 返回的是前端 HTML，而非健康检查 JSON；`/api/health` 正常返回 `{"status":"ok"}`，`/api/ready` 也正常。监控链路用的是 `/api/ready`（AGENTS.md 第 8 节已如此规定），因此不影响监控，但与本文件"`/health`、`/api/health` 为存活/网络检查"的描述不一致——待核实 nginx 路由配置，或订正文档描述。
- 发版前 `backend/apk/version.json` 的 `versionCode`（124）与 `frontend/android/app/build.gradle`（125）不一致，`bump-version.sh` 已自动对齐并提示。

---

## 补充：上述两个问题均已修复（同日）

**① 桌面「验证构建」占用部署锁（导致其他 workflow 被取消）**

`build-desktop` 在 push main 时只做验证构建——它所有 SSH / 发布步骤都带 `if: github.ref_type == 'tag'`，**根本不碰服务器**，却与 `deploy-browser` / `build-pda-apk` 共用同一个 concurrency group。结果是：既把真正的部署挤进 pending 排队，又因 GitHub「同一 group 内后到的 pending 会取消先前的 pending」的语义，在三者同时触发时取消掉其中之一（本文档开头记录的 Build PDA APK 被 cancelled 即由此而来）。

**修复**：按事件分 group——tag / 手动触发走 `flowcube-server-deploy`（与部署类串行），push main 走独立的 `build-desktop-ci`。

**② `docker load` 的 600 秒时限在慢盘上不够**

首次加载一个新镜像要解压全部层，慢盘上会超过 10 分钟被 `bounded` 强杀（exit code 124，日志停在「加载并验证 CI 应用镜像」之后且没有任何 docker 输出）。**这正是本文档开头记录的首次部署失败原因**——重跑时镜像层已存在，所以只要 9 秒。

**修复**：`scripts/server-update.sh` 里该步时限由 600 秒放宽到 **1800 秒**（外层部署 timeout 为 2400 秒，仍能容纳）。

**验证**：修复后的一次 push 同时触发了桌面构建与浏览器部署，两者**并行运行**（修复前会互相排队甚至取消其一），`Deploy Browser App` 正常完成、服务器更新到位。
