# v0.11.1 深度验收修复发布结果

应用发布提交与 tag：`e7c22f7127512e997965b21babded8411e06dff9` / `v0.11.1`。浏览器、PDA 与桌面正式版已发布；本记录为事后文档，不属于安装包。

## 发布身份与线上证据

| 工作流 | Run ID | 结果 |
| --- | --- | --- |
| Tests | [35992914859](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992914859) | success |
| Security Scan | [35992914945](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992914945) | success |
| Deploy Browser App | [35992914857](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992914857) | success |
| Build PDA APK | [35992914821](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992914821) | success |
| Desktop main 验证构建 | [35992914803](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992914803) | success，仅验证 |
| Desktop tag 正式发布 | [35993751056](https://github.com/chengjianghao439/flowcube2026/actions/runs/35993751056) | success |

生产前后端容器的 `org.opencontainers.image.revision` 均为上述 40 位应用 SHA。GitHub [Release v0.11.1](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.11.1) 为公开正式版（Release ID `395613766`，`draft=false`）；EXE 附件 ID `585836594` 为 `uploaded`，附件 API digest 与官网清单一致。

- 桌面：`latest.json`、`/api/app-update/latest` 均为 `0.11.1`；EXE `112,382,750` 字节，SHA-256 `1e8ee17d07f42d3aa6cde2b2be5c7d7540d7295b636c5b5d46debbe474c0ea35`。
- PDA：`/api/pda/version` 为 `0.11.1` / versionCode `145` / `available=true`；APK `15,086,388` 字节，SHA-256 `3ace604046af7544c054490830283026635277e9dde9459ffd096094555cf52a`。
- `npm run release:verify -- --origin https://jixuflow.com` 独立复验：实际下载 EXE 与 APK、核对摘要及健康接口，12/12 项通过。

## 本地与 CI 回归

合并主工作区整改与 `codex/deep-acceptance-fixes` 后，在独立 MySQL 8 测试库验证：主链 49/0、并发 121/0、P0 43/0、P1 45/0、财务 118/0、会计 11/0、销售改单 72/0、预计库存 8/0、PDA 设备会话 28/0、集成 96/0，以及主数据、导入、分拣格、打印队列、认证、账号与金额精度专项。前端完整 Vitest 为 130 文件、593 用例通过；后端 lint、前端 lint（0 错误、31 条 Fast Refresh 警告）、类型检查、ERP/PDA 构建与发布契约守卫通过。最终发布提交的 Tests CI 所有 job 均为 success。

销售改单测试最初因新分拣格守卫拒绝无格任务而失败；夹具补足本轮专用分拣格并按 ID 清理后，72/0 通过。这个失败是测试前置条件与新业务规则不一致，不将其记作业务链成功前的通过结果。

## 失败与恢复

首次发布提交 `801d4bc` 的 [Tests 35991759781](https://github.com/chengjianghao439/flowcube2026/actions/runs/35991759781) 失败：新界面文案违反既有文案契约守卫。修正文案并同步业务文档后，第二次提交 `83dbfcc` 的 [Tests 35992271718](https://github.com/chengjianghao439/flowcube2026/actions/runs/35992271718) 又暴露两处旧单测前置条件/等待时序问题：PDA 返回键测试未模拟新设备信息水合，对账页测试未等待 React Query 刷新完成。修复并本地跑完整前端套件后，第三次提交 `e7c22f7` 的所有必需工作流成功。前两次失败记录保留，不计作首次全绿。

从首次 GitHub Tests 创建 `2026-09-24 11:13:23 UTC` 到正式桌面工作流完成 `11:40:58 UTC`，跨三轮的可核对发布历时至少 **27 分 35 秒**；第三轮从 `11:25:20 UTC` 到 `11:40:58 UTC` 为 **15 分 38 秒**。发布入口对第三轮报告约 950 秒，包含其本地预检、等待和下载验收。传输依赖本机在线中转：PDA 与桌面使用 relay，浏览器镜像工作流直达；此次不能算脱离本机的托管交付链路验收。

## 范围与后续验收

本次合入了当前主工作区全部已审阅改动与活跃深度验收修复分支的 10 个提交。两个无活跃工作树的历史分支 `codex/party-ledger`（2026-09-08/09）和 `fix/integration-test-green`（2026-06-22）仍保留旧分叉提交，涉及过时实现及归档产物；未将其历史快照覆盖到本版主线。

线上健康、清单和下载摘要已验证；**Windows 实机安装与旧客户端自动更新弹窗、i6310pro PDA 真机扫码/打印外设操作仍未验收**。本地及 CI 成功不能代替这些设备结果。
