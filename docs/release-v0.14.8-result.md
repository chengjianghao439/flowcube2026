# v0.14.8 发布结果

2026 年 11 月 27 日 04:30:06（北京时间），网页与后端、Android PDA 及 Windows 桌面端完成正式发布，并通过公网三端 12/12 核对。上一版为 v0.14.7。[新版说明](release-notes/0.14.8.md)

## 发布版本与验收

- **合入提交（`main` / `v0.14.8`）**：`2083aa747ffb4da8b8ca916aa1620d383c1b909e`（[PR #126](https://github.com/chengjianghao439/flowcube2026/pull/126)，PR 门禁 38/38 全绿）
- **远端 Tag**：`v0.14.8` → `2083aa747ffb4da8b8ca916aa1620d383c1b909e`
- **GitHub Release**：[v0.14.8](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.14.8)（`isDraft=false`，2026-11-27 04:30:02 北京时间转正）

| 检查项 | 状态与运行记录 |
|---|---|
| 同提交门禁 | [Tests](https://github.com/chengjianghao439/flowcube2026/actions/runs/45883343831)（成功）、[Security Scan](https://github.com/chengjianghao439/flowcube2026/actions/runs/45883343783)（成功）、[Build Desktop Installer（main 验证）](https://github.com/chengjianghao439/flowcube2026/actions/runs/45883343821)（成功） |
| 网页与后端（首次，传输失败保留记录） | [Deploy Browser App #45883395325](https://github.com/chengjianghao439/flowcube2026/actions/runs/45883395325)（失败：镜像传输阶段 WireGuard 中断退出 124，停写与迁移未开始，线上保持 v0.14.7） |
| PDA（首次，因网页未过退出） | [Build PDA APK #45883399123](https://github.com/chengjianghao439/flowcube2026/actions/runs/45883399123)（`build-pda` / `sign-pda` 成功，`wait-browser` 因首次网页运行失败退出） |
| 网页与后端（恢复重跑，成功） | [Deploy Browser App #45888275860](https://github.com/chengjianghao439/flowcube2026/actions/runs/45888275860)（成功，2026-11-27 04:04:02 → 04:08:10，执行迁移 302/303/304 及页面门禁） |
| PDA（恢复重跑，成功） | [Build PDA APK #45888279453](https://github.com/chengjianghao439/flowcube2026/actions/runs/45888279453)（成功，版本 `0.14.8`，`versionCode 168`，公网实下 APK `20,152,899` 字节，SHA-256 `6bf234592b02bc9f0a4bd747d29ad2d4ee159ce3eeb23e20dd103e5d5425de28`） |
| Windows 桌面正式发布（Tag `v0.14.8`） | [Build Desktop Installer #45890904932](https://github.com/chengjianghao439/flowcube2026/actions/runs/45890904932)（成功，2026-11-27 04:25:15 → 04:30:06，公网实下 EXE `117,778,751` 字节，SHA-256 `28d403b3d6868f27647a54d8b0fcb0979d41fb5ba7060c5abd9c5463294e2e13`） |

## 耗时与传输路径记录

- **首次启动到最终核验总耗时**：约 66 分钟（03:24:17 启动首次发布 → 04:02:11 首次传输超时 → 04:03:45 清理残留并重启发布 → 04:30:51 三端核对完成，其中有效恢复轮用时 1,606 秒 / 26 分 46 秒）。
- **实际传输路径**：恢复轮中，本机代理中转因 WireGuard 隧道限速在 180 秒单流超时内未完成交付，网页（`#45888275860`）、PDA（`#45888279453`）与 Windows（`#45890904932`）均经 CI 既有 HTTPS/SCP 回退路径将本次运行原产物完整送达并通过服务端 SHA-256 校验；`release-prod.sh` 因此在三端 12/12 通过后按约束提示记录实际回退路径。
- **线上验收**：发布入口内验收与独立执行 `npm run release:verify -- --origin https://jixuflow.com` 均通过 **12/12**。

## 生产运行、镜像与磁盘盘点

- 本机 `/api/ready` 返回 `ready`，公网 `/api/health` 返回 `ok`；三个容器均无重启（`restarts=0`）。

| 容器 | 容器 ID | 镜像 ID | OCI Revision |
|---|---|---|---|
| `flowcube-backend` | `556707a35666b371274a3a1361858bb13c904da9987e6ebab8a5b7e4bd99e0d7` | `sha256:84d6bae8dbae89250bb244a5e30a84f6816f65eb2b87099b5a148fb781c8ed2f` | `2083aa747ffb4da8b8ca916aa1620d383c1b909e` |
| `flowcube-frontend` | `6274d33d520dc73e740c95f83221e5b3529fa80c9ed3dea6c71b0cf884dcd5f1` | `sha256:c411ae013d5bb759452f9ac716da62b5bdd601e6f2c1cc8e902c871e336424be` | `2083aa747ffb4da8b8ca916aa1620d383c1b909e` |
| `flowcube-mysql` | `0851f73a4cb6b5ac3d8e7bcd96568c2b8b3362ab1738a7b2cdc0f18fd2612308` | `sha256:6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39` | —（MySQL 8.0.46） |

- **磁盘与暂存**：根盘 `/dev/vda3` 使用率 **48%**，可用 **24,849 MiB**（较 v0.14.7 发布后减少 442 MiB）；`/tmp/flowcube-*` 仅剩锁文件与空目录 `/tmp/flowcube-desktop-release`，无残留归档或分片。
- **镜像留存结论**：服务器当前共 39 个唯一镜像 ID；本轮全部保留（未执行删除，待后续单独核对历史镜像恢复兼容性并获确认后再按低 IO 策略分批清理）。

## 未验边界

- Windows 实机从旧版自动弹窗升级与 UAC 确认、Android PDA 真机安装与硬件扫码广播、实体打印机走纸以及备份恢复演练待现场验证。
